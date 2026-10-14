// Svirka for the desktop: the Svirka web app (music.bencit.com) in its own window. Everything Svirka does lives
// there, so the app never needs an update for a new feature. What the window adds: the login is kept, the media keys
// and the OS media overlay work (Svirka sets navigator.mediaSession), and Svirka Connect lists it as "Svirka Desktop".
const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const HOME = process.env.SVIRKA_URL || 'https://music.bencit.com/'  // env: another page, for the screenshot workflow
const INSIDE = /^https:\/\/(music|auth)\.bencit\.com\//  // Svirka and its Authelia login; other links open in the browser

// Media keys / OS media overlay from the page's Media Session, and playback handed over from another device
// (Svirka Connect) may start without a click in this window.
app.commandLine.appendSwitch('enable-features', 'HardwareMediaKeyHandling,MediaSessionService')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

if (!app.requestSingleInstanceLock()) app.quit()

// Settings: { closeToTray (default on), trayHintShown }
const settingsFile = path.join(app.getPath('userData'), 'settings.json')
let settings = { closeToTray: true, trayHintShown: false }
try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) } } catch {}
const save = () => fs.writeFileSync(settingsFile, JSON.stringify(settings))

// Windows: no title bar, the page runs to the top and Windows draws its own minimise / maximise / close over it
// (titleBarOverlay), so snapping, snap layouts, Win+arrows and resizing all stay native. preload.js adds the drag strip
// and keeps the buttons' colours in step with the page. Linux keeps its normal window.
const OVERLAY = process.platform === 'win32' || process.env.SVIRKA_OVERLAY === '1'  // env: to test elsewhere
const BAR = 32

let win, tray
let quitting = false
function open() {
  const area = screen.getPrimaryDisplay().workAreaSize  // never open bigger than the screen
  win = new BrowserWindow({
    width: Math.min(1280, area.width - 80), height: Math.min(820, area.height - 60), minWidth: 400, minHeight: 520,
    title: 'Svirka', icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      backgroundThrottling: false,  // keep the queue moving while minimised
      ...(OVERLAY && { preload: path.join(__dirname, 'preload.js'), additionalArguments: ['--svirka-titlebar'] }),
    },
    ...(OVERLAY && { titleBarStyle: 'hidden', titleBarOverlay: { color: '#0a0a0a', symbolColor: '#ffffff', height: BAR } }),
  })
  if (OVERLAY) win.webContents.on('preload-error', (_e, _p, err) => console.error('preload', err))
  // Svirka names this device "Svirka Desktop (…)" in its device list when it sees this
  win.webContents.setUserAgent(`${win.webContents.getUserAgent()} SvirkaDesktop/${app.getVersion()}`)
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (INSIDE.test(url)) return
    e.preventDefault()
    if (!url.startsWith('file:')) shell.openExternal(url)  // a file dropped outside Settings → Upload music: ignore it
  })
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3) setTimeout(() => win.loadURL(HOME), 5000)  // offline: try again (-3 = aborted)
  })
  // Closing hides the window to the tray and the music keeps playing (unless "Close to tray" is off, or we're quitting)
  win.on('close', (e) => {
    if (quitting || !settings.closeToTray) return
    e.preventDefault()
    win.hide()
    if (!settings.trayHintShown && process.platform === 'win32') {
      tray.displayBalloon({ title: 'Svirka is still playing', content: 'It lives in the tray now. Right-click the icon to quit.', iconType: 'info' })
      settings.trayHintShown = true
      save()
    }
  })
  win.loadURL(HOME)
}

function show() {
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

// Svirka web listens for this (src/stores/player.tsx), so the buttons work while the window is hidden
const media = (action) => win.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('svirka-media', { detail: '${action}' }))`)

function makeTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png')).resize({ width: 32, height: 32 }))
  tray.setToolTip(`Svirka ${app.getVersion()}`)
  const menu = () => Menu.buildFromTemplate([
    { label: 'Show Svirka', click: show },
    { type: 'separator' },
    { label: 'Play / Pause', click: () => media('toggle') },
    { label: 'Next', click: () => media('next') },
    { label: 'Previous', click: () => media('prev') },
    { type: 'separator' },
    { label: 'Close to tray', type: 'checkbox', checked: settings.closeToTray, click: (item) => { settings.closeToTray = item.checked; save() } },
    { label: 'Quit Svirka', click: () => { quitting = true; app.quit() } },
  ])
  tray.setContextMenu(menu())
  tray.on('click', () => (win.isVisible() && win.isFocused() ? win.hide() : show()))
}

// The page's colours, from preload.js, for the title bar buttons
ipcMain.on('svirka-titlebar', (_e, color, symbolColor) => {
  try { win.setTitleBarOverlay({ color, symbolColor, height: BAR }) } catch {}
})

// Moving the window by hand (preload.js: only when Windows doesn't do it from the strip itself)
let dragging
ipcMain.on('svirka-drag', (_e, what) => {
  clearInterval(dragging)
  dragging = undefined
  if (what === 'maximize') return win.isMaximized() ? win.unmaximize() : win.maximize()
  if (!what) return
  if (win.isMaximized()) {  // dragged down from maximised: restore under the cursor
    const c = screen.getCursorScreenPoint()
    win.unmaximize()
    win.setPosition(c.x - Math.round(win.getSize()[0] / 2), c.y - BAR / 2)
  }
  const start = screen.getCursorScreenPoint()
  const [x, y] = win.getPosition()
  dragging = setInterval(() => {
    const c = screen.getCursorScreenPoint()
    win.setPosition(x + c.x - start.x, y + c.y - start.y)
  }, 16)
})

app.on('second-instance', () => win && show())  // starting Svirka again brings the hidden window back
app.on('before-quit', () => { quitting = true })
app.whenReady().then(() => { open(); makeTray() })
app.on('window-all-closed', () => app.quit())
