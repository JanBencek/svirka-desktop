// Svirka for the desktop: the Svirka web app (music.bencit.com) in its own window. Everything Svirka does lives
// there, so the app never needs an update for a new feature. What the window adds: the login is kept, the media keys
// and the OS media overlay work (Svirka sets navigator.mediaSession), and Svirka Connect lists it as "Svirka Desktop".
const { app, BrowserWindow, Menu, Notification, Tray, ipcMain, nativeImage, nativeTheme, screen, shell } = require('electron')
const { autoUpdater } = require('electron-updater')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const HOME = process.env.SVIRKA_URL || 'https://music.bencit.com/'  // env: another page, for the screenshot workflow
const INSIDE = /^https:\/\/(music|auth)\.bencit\.com\//  // Svirka and its Authelia login; other links open in the browser

// Media keys / OS media overlay from the page's Media Session, and playback handed over from another device
// (Svirka Connect) may start without a click in this window.
app.commandLine.appendSwitch('enable-features', 'HardwareMediaKeyHandling,MediaSessionService')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

if (!app.requestSingleInstanceLock()) app.quit()

// Jam links: svirka://jam/<id> (Svirka's /jam/<id> page in a browser hands them here) open that page in this window,
// which joins straight away. Windows passes the link on the command line, also to the running Svirka (second-instance).
// ponytail: Windows only; the AppImage isn't installed anywhere a svirka:// handler could point at.
if (app.isPackaged) app.setAsDefaultProtocolClient('svirka')  // npm start would register electron.exe
const linkPage = (argv) => {
  const m = argv.find((a) => a.startsWith('svirka://'))?.match(/^svirka:\/\/jam\/([\w-]+)/)
  return m && new URL(`jam/${m[1]}?web=1`, HOME).href  // ?web=1: the Jam page, not the try-the-apps page in front
}
if (process.platform === 'win32') app.setAppUserModelId('com.bencit.svirka.desktop')  // the update notification shows as Svirka

// Settings: { closeToTray (default on), trayHintShown }
const settingsFile = path.join(app.getPath('userData'), 'settings.json')
let settings = { closeToTray: true, trayHintShown: false }
try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) } } catch {}
const save = () => fs.writeFileSync(settingsFile, JSON.stringify(settings))

// Windows 11: no title bar, the page runs to the top and Windows draws its own minimise / maximise / close over it
// (titleBarOverlay), so snapping, snap layouts, Win+arrows and resizing all stay native. preload.js adds the drag strip
// and keeps the buttons' colours in step with the page. Windows 10 can't be dragged from that strip, so it keeps
// Windows' title bar, dark or light like the page (preload.js reports the colours). Linux keeps its normal window.
const WIN = process.platform === 'win32'
const OVERLAY = process.env.SVIRKA_OVERLAY  // env 1 / 0: force it on or off, to test elsewhere
  ? process.env.SVIRKA_OVERLAY === '1'
  : WIN && Number(os.release().split('.')[2]) >= 22000
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
      ...((OVERLAY || WIN) && { preload: path.join(__dirname, 'preload.js'), additionalArguments: [OVERLAY ? '--svirka-titlebar' : '--svirka-theme'] }),
    },
    ...(OVERLAY && { titleBarStyle: 'hidden', titleBarOverlay: { color: '#0a0a0a', symbolColor: '#ffffff', height: BAR } }),
  })
  if (OVERLAY || WIN) win.webContents.on('preload-error', (_e, _p, err) => console.error('preload', err))
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
  win.loadURL(linkPage(process.argv) || HOME)
}

function show() {
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

// Svirka web listens for this (src/stores/player.tsx), so the buttons work while the window is hidden
const media = (action) => win.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('svirka-media', { detail: '${action}' }))`)

let updateReady = null  // the version downloaded and waiting for a restart
function makeTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png')).resize({ width: 32, height: 32 }))
  tray.setToolTip(`Svirka ${app.getVersion()}`)
  const menu = () => Menu.buildFromTemplate([
    ...(updateReady ? [{ label: `Restart to update to ${updateReady}`, click: () => { quitting = true; autoUpdater.quitAndInstall(true, true) } }, { type: 'separator' }] : []),
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
  refreshTray = () => tray.setContextMenu(menu())
  tray.on('click', () => (win.isVisible() && win.isFocused() ? win.hide() : show()))
}

// The page's colours, from preload.js: the title bar buttons (Windows 11), dark or light title bar (Windows 10)
// (only Svirka's own pages say: the login page is always light, and the page's "auto" follows this setting back)
ipcMain.on('svirka-titlebar', (_e, color, symbolColor, dark) => {
  if (dark !== null) nativeTheme.themeSource = dark ? 'dark' : 'light'
  if (OVERLAY) try { win.setTitleBarOverlay({ color, symbolColor, height: BAR }) } catch {}
})

app.on('second-instance', (_e, argv) => {  // starting Svirka again (or a Jam link) brings the hidden window back
  if (!win) return
  const page = linkPage(argv)
  if (page) win.loadURL(page)
  show()
})
app.on('before-quit', () => { quitting = true })
// Updates from GitHub Releases: checked at start and every 4 hours, downloaded in the background, installed when
// Svirka quits (the tray's Quit, a restart, shutting down) or straight away from the tray's "Restart to update"
let refreshTray = () => {}
function updates() {
  if (!app.isPackaged) return  // npm start
  autoUpdater.on('update-downloaded', ({ version }) => {
    updateReady = version
    refreshTray()
    new Notification({ title: `Svirka ${version} is ready`, body: 'It installs when Svirka restarts. Right-click the tray icon to restart now.' }).show()
  })
  autoUpdater.on('error', (err) => console.error('update', err.message))
  const check = () => autoUpdater.checkForUpdates().catch(() => {})  // offline: next time
  check()
  setInterval(check, 4 * 60 * 60 * 1000)
}

app.whenReady().then(() => { open(); makeTray(); updates() })
app.on('window-all-closed', () => app.quit())
