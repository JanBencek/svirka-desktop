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

// Windows 10 never rounds window corners (11 does it itself). There the window keeps Windows' frame (so snapping,
// Win+arrows, double-click-to-maximise and edge resizing stay native) but has no title bar: preload.js draws a strip with
// Windows-style buttons, and the window is cut to rounded corners. Elsewhere: the normal window.
const ROUND = (process.platform === 'win32' && Number(os.release().split('.')[2]) < 22000) || process.env.SVIRKA_ROUND === '1'  // env: to test elsewhere
const RADIUS = 10
// A frameless window with Windows' frame is wider than its page by the invisible resize border on the left, right and
// bottom (8 px at any scaling). The shape is measured from the window's outer edge, so it starts that far in, or the
// border shows up grey on the left and the right edge of the page is cut off.
const BORDER = process.platform === 'win32' ? 8 : 0

// The page's outline: full rows in the middle, rows inset along a circle at the four corners. Maximised: no shape.
function shape() {
  if (win.isMaximized() || win.isFullScreen()) return win.setShape([])
  const [w, h] = win.getSize()
  const rects = [{ x: BORDER, y: RADIUS, width: w, height: h - 2 * RADIUS }]
  for (let i = 0; i < RADIUS; i++) {
    const dy = RADIUS - i - 0.5
    const inset = Math.round(RADIUS - Math.sqrt(RADIUS * RADIUS - dy * dy))
    rects.push({ x: BORDER + inset, y: i, width: w - 2 * inset, height: 1 },
      { x: BORDER + inset, y: h - 1 - i, width: w - 2 * inset, height: 1 })
  }
  win.setShape(rects)
}

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
    ...(ROUND && { frame: false }),
  })
  if (ROUND) {
    win.webContents.on('preload-error', (_e, _p, err) => console.error('preload', err))
    // again once shown: Windows drops a shape set before the window first appears
    for (const e of ['show', 'resize', 'maximize', 'unmaximize', 'restore', 'enter-full-screen', 'leave-full-screen']) win.on(e, shape)
    win.webContents.on('did-finish-load', shape)
    shape()
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

// The title strip's buttons (preload.js); close goes through the close-to-tray handler like any close
ipcMain.on('svirka-window', (_e, action) => {
  if (action === 'minimize') win.minimize()
  else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize()
  else if (action === 'close') win.close()
})

app.on('second-instance', () => win && show())  // starting Svirka again brings the hidden window back
app.on('before-quit', () => { quitting = true })
app.whenReady().then(() => { open(); makeTray() })
app.on('window-all-closed', () => app.quit())
