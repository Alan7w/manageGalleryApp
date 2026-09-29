// One-time setup: creates a self-signed code-signing certificate that only this
// Mac uses to sign Sift builds (see scripts/sign-app.mjs).
//
// Why: macOS remembers the folder / drive permissions you grant per signature.
// Ad-hoc signatures change with every build, so macOS would ask again after each
// update; a fixed certificate keeps the signature stable.
//
// Everything lives in ~/.sift-signing (a keychain of its own plus its password),
// so the login keychain and system trust settings are left untouched. Delete
// that folder to undo. Builds on machines without it fall back to ad-hoc signing.
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SIGNING_CONFIG, SIGNING_DIR, searchList } from './sign-app.mjs'

const NAME = 'Sift Local Signing'
const keychain = join(SIGNING_DIR, 'sift-signing.keychain-db')

if (existsSync(SIGNING_CONFIG)) {
  console.log(`Already set up (${SIGNING_DIR}). Delete that folder to start over.`)
  process.exit(0)
}

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' })
const password = randomBytes(24).toString('hex')
const tmp = mkdtempSync(join(tmpdir(), 'sift-signing-'))

try {
  // 1 · Certificate + key. The system LibreSSL writes a .p12 that `security` can import.
  writeFileSync(
    join(tmp, 'cert.cnf'),
    [
      '[req]',
      'distinguished_name = dn',
      'x509_extensions = ext',
      'prompt = no',
      '[dn]',
      `CN = ${NAME}`,
      '[ext]',
      'basicConstraints = critical, CA:false',
      'keyUsage = critical, digitalSignature',
      'extendedKeyUsage = critical, codeSigning',
      'subjectKeyIdentifier = hash'
    ].join('\n')
  )
  const ssl = (args) => run('/usr/bin/openssl', args)
  ssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '7300', '-config', join(tmp, 'cert.cnf'),
    '-keyout', join(tmp, 'key.pem'), '-out', join(tmp, 'cert.pem')])
  ssl(['pkcs12', '-export', '-name', NAME, '-inkey', join(tmp, 'key.pem'), '-in', join(tmp, 'cert.pem'),
    '-out', join(tmp, 'id.p12'), '-passout', `pass:${password}`])

  // 2 · A keychain of its own. `create-keychain` adds it to the search list; put the list back.
  mkdirSync(SIGNING_DIR, { recursive: true, mode: 0o700 })
  const listBefore = searchList()
  run('security', ['create-keychain', '-p', password, keychain])
  run('security', ['list-keychains', '-d', 'user', '-s', ...listBefore])
  run('security', ['set-keychain-settings', keychain]) // no auto-lock timeout
  run('security', ['unlock-keychain', '-p', password, keychain])
  run('security', ['import', join(tmp, 'id.p12'), '-k', keychain, '-P', password, '-x', '-T', '/usr/bin/codesign'])
  // Lets codesign use the key without a GUI password prompt.
  run('security', ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', password, keychain])

  // 3 · Remember how to find it. The certificate isn't trusted system-wide (it doesn't need
  // to be), so it's looked up without -v and referenced by its SHA-1 hash.
  const line = run('security', ['find-identity', '-p', 'codesigning', keychain]).split('\n').find((l) => l.includes(NAME))
  const sha1 = line?.match(/\b[0-9A-F]{40}\b/)?.[0]
  if (!sha1) throw new Error('The certificate was imported but no signing identity was found.')
  run('security', ['lock-keychain', keychain])
  writeFileSync(SIGNING_CONFIG, JSON.stringify({ name: NAME, sha1, keychain, password }, null, 2) + '\n')
  chmodSync(SIGNING_CONFIG, 0o600)
  console.log(`Created "${NAME}" (${sha1}) in ${SIGNING_DIR}.`)
  console.log('Builds are now signed with it. Run `npm run install:app`; macOS asks for permissions once more, then remembers them.')
} catch (err) {
  if (existsSync(keychain)) execFileSync('security', ['delete-keychain', keychain])
  rmSync(SIGNING_DIR, { recursive: true, force: true })
  throw err
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
