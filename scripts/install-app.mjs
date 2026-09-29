// Copies the freshly built Sift.app (from `electron-builder --dir`) into
// /Applications, replacing an older Sift, then opens it.
// Run through `npm run install:app`, which builds first.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

const APP_ID = 'app.sift.gallery'
const target = '/Applications/Sift.app'

const built = readdirSync('dist')
  .filter((d) => d.startsWith('mac'))
  .map((d) => join('dist', d, 'Sift.app'))
  .filter((p) => existsSync(p))
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
if (!built) {
  console.error('No built Sift.app found in dist/. Run `npm run install:app`.')
  process.exit(1)
}

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim()
const isRunning = () => run('osascript', ['-e', `application id "${APP_ID}" is running`]) === 'true'

if (existsSync(target)) {
  // Only ever replace our own app.
  const id = run('defaults', ['read', join(target, 'Contents', 'Info'), 'CFBundleIdentifier'])
  if (id !== APP_ID) {
    console.error(`${target} belongs to another app (${id}); not replacing it.`)
    process.exit(1)
  }
  if (isRunning()) {
    console.log('Quitting the running Sift…')
    run('osascript', ['-e', `tell application id "${APP_ID}" to quit`])
    const deadline = Date.now() + 15_000
    while (isRunning()) {
      if (Date.now() > deadline) {
        console.error('Sift did not quit (is a macOS permission dialog waiting?). Quit it and run again.')
        process.exit(1)
      }
      execFileSync('sleep', ['0.3'])
    }
  }
  rmSync(target, { recursive: true, force: true })
}

execFileSync('ditto', [built, target])
console.log(`Installed ${target}`)
// `open` hands our environment to the app; with ELECTRON_RUN_AS_NODE set (e.g. in
// some editor terminals) Sift would start as plain Node and exit immediately.
const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env
execFileSync('open', [target], { env })
