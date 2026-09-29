// electron-builder afterPack hook: signs Sift.app before the DMG is made.
//
// With the certificate from `npm run setup:signing`, every build carries the same
// signature, so macOS keeps the folder and drive permissions granted to Sift.
// Without it, the app gets a free ad-hoc signature (runs fine, but macOS asks
// for permissions again after each update).
import { signApp } from '@electron/osx-sign'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const SIGNING_DIR = join(homedir(), '.sift-signing')
export const SIGNING_CONFIG = join(SIGNING_DIR, 'identity.json')

const security = (args) => execFileSync('security', args, { encoding: 'utf8' })

/** The user's keychain search list (one quoted path per line). */
export function searchList() {
  const list = security(['list-keychains', '-d', 'user'])
    .split('\n')
    .map((l) => l.trim().replace(/^"|"$/g, ''))
    .filter(Boolean)
  if (!list.some((k) => k.endsWith('login.keychain-db'))) throw new Error(`Unexpected keychain search list: ${list.join(', ')}`)
  return list
}
const setSearchList = (list) => security(['list-keychains', '-d', 'user', '-s', ...list])

export default async function signAfterPack({ appOutDir, packager }) {
  const app = join(appOutDir, `${packager.appInfo.productFilename}.app`)
  const local = existsSync(SIGNING_CONFIG) ? JSON.parse(readFileSync(SIGNING_CONFIG, 'utf8')) : null
  const sign = (identity, keychain) =>
    signApp({
      app,
      platform: 'darwin',
      identity,
      keychain,
      identityValidation: false,
      // Hardened runtime and a secure timestamp only matter for Apple notarization.
      optionsForFile: () => ({ hardenedRuntime: false, timestamp: 'none' })
    })

  if (!local) {
    await sign('-')
  } else {
    // codesign only finds identities in keychains on the search list, so ours is listed just
    // while signing. Left listed, the locked keychain could trigger password prompts later.
    const others = searchList().filter((k) => k !== local.keychain)
    security(['unlock-keychain', '-p', local.password, local.keychain])
    setSearchList([...others, local.keychain])
    try {
      await sign(local.sha1, local.keychain)
    } finally {
      setSearchList(others)
      security(['lock-keychain', local.keychain])
    }
  }
  console.log(`  • signed ${app}  with=${local ? local.name : 'ad-hoc signature'}`)
}
