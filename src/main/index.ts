import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { bulk, interactive } from './analyzer'
import { closeDatabase, openDatabase } from './db'
import { shutdown, startPass } from './engine'
import { registerIpc } from './ipc'
import { handleProtocol, registerSchemes } from './protocol'
import { listSources } from './sources'
import { pruneTrashed } from './trash'

registerSchemes()

// Point the app at a separate library (e.g. a test library) without touching the real one.
if (process.env.SIFT_DATA_DIR) app.setPath('userData', process.env.SIFT_DATA_DIR)

if (!app.requestSingleInstanceLock()) app.quit()

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 980,
    minHeight: 620,
    show: false,
    title: 'Sift',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    vibrancy: 'sidebar',
    visualEffectState: 'followWindow',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true
    }
  })
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // Files dropped on the window are handled by the UI; never navigate to them.
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark'
  // The packaged app gets its icon from the bundle; in development show it in the Dock too.
  if (!app.isPackaged) app.dock?.setIcon(join(app.getAppPath(), 'resources', 'icon.png'))
  openDatabase()
  pruneTrashed()
  handleProtocol()
  registerIpc()
  createWindow()
  if (listSources().length) startPass()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let quitting = false
app.on('before-quit', (e) => {
  if (quitting) return
  e.preventDefault()
  quitting = true
  const timeout = new Promise((r) => setTimeout(r, 2000))
  void Promise.race([shutdown(), timeout]).finally(() => {
    bulk.stop()
    interactive.stop()
    closeDatabase()
    app.quit()
    // A quit that began with SIGTERM (e.g. `kill`) can stall after the window closes.
    // Everything is cleaned up by now, so exit rather than hang.
    setTimeout(() => app.exit(0), 3000)
  })
})
