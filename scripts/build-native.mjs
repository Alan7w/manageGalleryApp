// Compiles the Swift analyzer helper (native/analyzer) into resources/bin.
// Skips the build when the binary is already newer than every Swift source.
// Needs only the Xcode Command Line Tools (`xcode-select --install`).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const srcDir = 'native/analyzer'
const outDir = 'resources/bin'
const out = join(outDir, 'sift-analyzer')
const sources = readdirSync(srcDir)
  .filter((f) => f.endsWith('.swift'))
  .map((f) => join(srcDir, f))

const force = process.argv.includes('--force')
const newestSource = Math.max(...sources.map((f) => statSync(f).mtimeMs))
if (!force && existsSync(out) && statSync(out).mtimeMs > newestSource) {
  console.log('sift-analyzer is up to date')
  process.exit(0)
}

if (process.platform !== 'darwin') {
  console.error('The analyzer uses Apple frameworks and can only be built on macOS.')
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
console.log('Compiling sift-analyzer…')
execFileSync(
  'swiftc',
  ['-O', '-swift-version', '5', '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos14.0`, ...sources, '-o', out],
  { stdio: 'inherit' }
)
console.log(`Built ${out}`)
