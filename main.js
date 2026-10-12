// Svirka for the desktop: the Svirka web app (music.bencit.com) in its own window. Everything Svirka does lives
// there, so the app never needs an update for a new feature. What the window adds: the login is kept, the media keys
// and the OS media overlay work (Svirka sets navigator.mediaSession), and Svirka Connect lists it as "Svirka Desktop".
const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen, shell } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const HOME = 'https://music.bencit.com/'
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

// Windows 10 never rounds window corners (11 does it itself). Cutting a framed window to a shape doesn't work there
// (with Windows' resize frame kept it paints a grey border, without it the shape is ignored), so the window is
// transparent instead: preload.js rounds the page's own corners, draws the title strip with Windows-style buttons and
// adds resize edges (Windows can't resize a transparent window itself). Elsewhere: the normal window.
const ROUND = (process.platform === 'win32' && Number(os.release().split('.')[2]) < 22000) || process.env.SVIRKA_ROUND === '1'  // env: to test elsewhere

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
      ...(ROUND && { preload: path.join(__dirname, 'preload.js'), additionalArguments: ['--svirka-titlebar'] }),
    },
    ...(ROUND && { frame: false, transparent: true, backgroundColor: '#00000000', resizable: false }),
  })
  if (ROUND) {
    win.webContents.on('preload-error', (_e, _p, err) => console.error('preload', err))
    const sendMax = () => win.webContents.send('svirka-maximized', win.isMaximized())
    win.on('maximize', sendMax)
    win.on('unmaximize', sendMax)
    win.webContents.on('did-finish-load', sendMax)
  }
  // Svirka names this device "Svirka Desktop (…)" in its device list when it sees this
  win.webContents.setUserAgent(`${win.webContents.getUserAgent()} SvirkaDesktop/${app.getVersion()}`)
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (INSIDE.test(url)) return
    e.preventDefault()
    shell.openExternal(url)
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

// The title strip's buttons (preload.js); close goes through the close-to-tray handler like any close
ipcMain.on('svirka-window', (_e, action) => {
  if (action === 'minimize') win.minimize()
  else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize()
  else if (action === 'close') win.close()
})

// Resizing from preload.js's edges: from pointer down (edge = 'n', 'se', …) until pointer up (edge = null), the
// window follows the cursor.
let resizeTimer
ipcMain.on('svirka-resize', (_e, edge) => {
  clearInterval(resizeTimer)
  if (!edge || win.isMaximized()) return
  const start = win.getBounds(), from = screen.getCursorScreenPoint()
  const [minW, minH] = win.getMinimumSize()
  resizeTimer = setInterval(() => {
    const p = screen.getCursorScreenPoint(), dx = p.x - from.x, dy = p.y - from.y
    let { x, y, width, height } = start
    if (edge.includes('e')) width = Math.max(minW, start.width + dx)
    if (edge.includes('s')) height = Math.max(minH, start.height + dy)
    if (edge.includes('w')) { width = Math.max(minW, start.width - dx); x = start.x + start.width - width }
    if (edge.includes('n')) { height = Math.max(minH, start.height - dy); y = start.y + start.height - height }
    win.setBounds({ x, y, width, height })
  }, 16)
})

app.on('second-instance', () => win && show())  // starting Svirka again brings the hidden window back
app.on('before-quit', () => { quitting = true })
app.whenReady().then(() => { open(); makeTray() })
app.on('window-all-closed', () => app.quit())
