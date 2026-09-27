// Walks a source folder and syncs what it finds into the index. Only new or
// changed files are queued for analysis; files that disappeared are dropped.

import { opendir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, join } from 'node:path'
import { rmSync } from 'node:fs'
import { all, chunked, placeholders, run, transaction } from './db'
import { REMOVED_FOLDER, thumbPath } from './paths'

export const IMAGE_EXT = new Set([
  'jpg', 'jpeg', 'jpe', 'png', 'heic', 'heif', 'hif', 'gif', 'webp', 'avif', 'tif', 'tiff', 'bmp',
  'dng', 'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'orf', 'rw2', 'pef', 'srw', 'x3f', '3fr', 'erf', 'kdc', 'mos', 'iiq'
])
export const VIDEO_EXT = new Set(['mov', 'mp4', 'm4v', 'avi', 'mkv', '3gp', '3g2', 'mts', 'm2ts', 'webm', 'mpg', 'mpeg', 'wmv', 'hevc'])

/** Bundles that belong to other apps. Touching files inside them could corrupt those apps' libraries. */
const SKIP_BUNDLES = /\.(photoslibrary|photolibrary|migratedphotolibrary|aplibrary|lrdata|fcpbundle|imovielibrary|tvlibrary|musiclibrary|app|bundle|framework|plugin|photoboothlibrary)$/i
const SKIP_NAMES = new Set(['node_modules', '$RECYCLE.BIN', 'System Volume Information', REMOVED_FOLDER])
const SKIP_PATHS = new Set([join(homedir(), 'Library')])

export interface FoundFile {
  path: string
  dir: string
  name: string
  ext: string
  kind: 'image' | 'video'
}

async function* walk(root: string): AsyncGenerator<FoundFile> {
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()!
    let handle
    try {
      handle = await opendir(dir, { bufferSize: 256 })
    } catch {
      continue // unreadable folder (permissions, drive unplugged mid-scan)
    }
    for await (const entry of handle) {
      const name = entry.name
      if (name.startsWith('.')) continue // hidden files, AppleDouble "._x" files, .Trashes
      const path = join(dir, name)
      if (entry.isDirectory()) {
        if (SKIP_NAMES.has(name) || SKIP_BUNDLES.test(name) || SKIP_PATHS.has(path)) continue
        stack.push(path)
      } else if (entry.isFile()) {
        const ext = extname(name).slice(1).toLowerCase()
        const kind = IMAGE_EXT.has(ext) ? 'image' : VIDEO_EXT.has(ext) ? 'video' : null
        if (kind) yield { path, dir, name, ext, kind }
      }
    }
  }
}

interface Known {
  id: number
  size: number
  mtime: number
  state: string
  level: number
}

const BATCH = 400

/**
 * Syncs one source into the index.
 * @returns number of files found
 */
export async function scanSource(
  sourceId: number,
  root: string,
  onFound: (found: number) => void,
  shouldStop: () => boolean
): Promise<number> {
  const gen = Date.now()
  const known = new Map<string, Known>()
  for (const row of all<Known & { path: string }>(
    'SELECT id, path, size, mtime, state, level FROM media WHERE source_id = ?',
    sourceId
  )) {
    known.set(row.path, row)
  }

  let found = 0
  let batch: (FoundFile & { size: number; mtime: number; btime: number })[] = []

  const flush = (): void => {
    if (!batch.length) return
    const rows = batch
    batch = []
    transaction(() => {
      for (const f of rows) {
        const k = known.get(f.path)
        if (!k) {
          run(
            `INSERT INTO media (source_id, path, dir, name, ext, kind, size, mtime, btime, scan_gen)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(path) DO UPDATE SET source_id = excluded.source_id, scan_gen = excluded.scan_gen`,
            sourceId, f.path, f.dir, f.name, f.ext, f.kind, f.size, f.mtime, f.btime, gen
          )
        } else if (k.size !== f.size || k.mtime !== f.mtime) {
          // The file changed on disk: forget what we knew and analyze it again.
          run(
            `UPDATE media SET size = ?, mtime = ?, btime = ?, scan_gen = ?, state = 'pending', level = 0,
               error = NULL, sha = NULL, flagged = 0, kept = 0 WHERE id = ?`,
            f.size, f.mtime, f.btime, gen, k.id
          )
        } else if (k.state === 'trashed') {
          // It's back (e.g. the user used Finder's "Put Back").
          run(`UPDATE media SET scan_gen = ?, state = CASE WHEN level > 0 THEN 'ready' ELSE 'pending' END WHERE id = ?`, gen, k.id)
        } else {
          run('UPDATE media SET scan_gen = ? WHERE id = ?', gen, k.id)
        }
      }
    })
  }

  let pendingStats: Promise<void>[] = []
  for await (const file of walk(root)) {
    if (shouldStop()) break
    pendingStats.push(
      stat(file.path).then(
        (s) => {
          if (s.size === 0) return
          batch.push({ ...file, size: s.size, mtime: Math.floor(s.mtimeMs), btime: Math.floor(s.birthtimeMs) })
          found++
        },
        () => {}
      )
    )
    if (pendingStats.length >= 64) {
      await Promise.all(pendingStats)
      pendingStats = []
      if (batch.length >= BATCH) {
        flush()
        onFound(found)
      }
    }
  }
  await Promise.all(pendingStats)
  flush()
  onFound(found)

  if (!shouldStop()) {
    // Anything we didn't see this time is gone from disk (trashed rows are kept for undo).
    const gone = all<{ id: number }>(
      `SELECT id FROM media WHERE source_id = ? AND scan_gen < ? AND state != 'trashed'`,
      sourceId,
      gen
    ).map((r) => r.id)
    forget(gone)
    run('UPDATE sources SET last_scan_at = ? WHERE id = ?', Date.now(), sourceId)
  }
  return found
}

/** Removes rows (and their cached thumbnails) from the index. */
export function forget(ids: number[]): void {
  if (!ids.length) return
  transaction(() => chunked(ids, (chunk) => void run(`DELETE FROM media WHERE id IN ${placeholders(chunk.length)}`, ...chunk)))
  for (const id of ids) rmSync(thumbPath(id), { force: true })
}
