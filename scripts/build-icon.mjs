// Renders resources/icon.svg into the app icon:
//   resources/icon.icns  used by the packaged app
//   resources/icon.png   Dock icon while developing
// Electron's own Chromium draws the SVG; macOS `iconutil` packs the .icns.
// Run with `npm run build:icon` after editing the SVG.
import { app, BrowserWindow } from 'electron'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const svg = readFileSync('resources/icon.svg', 'utf8')
const SIZES = [16, 32, 128, 256, 512]

app.dock?.hide()
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1024,
    height: 1024,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true }
  })
  const html = `<body style="margin:0;background:transparent;overflow:hidden">${svg}</body>`
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await new Promise((r) => setTimeout(r, 500)) // let the first frame paint
  let master = await win.webContents.capturePage()
  if (master.getSize().width !== 1024) master = master.resize({ width: 1024, height: 1024, quality: 'best' })

  const iconset = join(app.getPath('temp'), 'sift.iconset')
  rmSync(iconset, { recursive: true, force: true })
  mkdirSync(iconset)
  const png = (size) => (size === 1024 ? master : master.resize({ width: size, height: size, quality: 'best' })).toPNG()
  for (const size of SIZES) {
    writeFileSync(join(iconset, `icon_${size}x${size}.png`), png(size))
    writeFileSync(join(iconset, `icon_${size}x${size}@2x.png`), png(size * 2))
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', 'resources/icon.icns'])
  writeFileSync('resources/icon.png', master.toPNG())
  rmSync(iconset, { recursive: true, force: true })
  console.log('Wrote resources/icon.icns and resources/icon.png')
  app.quit()
})
