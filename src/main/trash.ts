// Removing files, safely. Nothing is ever permanently deleted by Sift:
//  • files go to the macOS Trash (on external drives, that drive's own Trash);
//  • drives without a Trash get a "Sift Removed" folder at the source root;
//  • every move is logged, so a whole batch can be put back with one click.

import type { RestoreResult, TrashBatch, TrashResult } from '@shared/types'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, mkdir, rename, rm } from 'node:fs/promises'
import { basename, dirname, extname, join, relative } from 'node:path'
import { AnalyzerError, interactive } from './analyzer'
import { all, run, transaction } from './db'
import { REMOVED_FOLDER } from './paths'
import { forget } from './scanner'
import { sourceById } from './sources'

interface FlaggedRow {
  id: number
  path: string
  size: number
  source_id: number
}

async function moveFile(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true })
  try {
    await rename(from, to)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
    await cp(from, to, { preserveTimestamps: true, errorOnExist: true, force: false })
    await rm(from)
  }
}

/** `photo.jpg` → `photo (restored).jpg`, `photo (restored 2).jpg`, … when the name is taken. */
function freePath(path: string): string {
  if (!existsSync(path)) return path
  const ext = extname(path)
  const stem = path.slice(0, path.length - ext.length)
  for (let i = 1; ; i++) {
    const candidate = `${stem} (restored${i > 1 ? ` ${i}` : ''})${ext}`
    if (!existsSync(candidate)) return candidate
  }
}

export async function trashFlagged(): Promise<TrashResult> {
  const rows = all<FlaggedRow>(`SELECT id, path, size, source_id FROM media WHERE flagged = 1 AND state IN ('pending', 'ready', 'error')`)
  const batchId = randomUUID()
  const result: TrashResult = { batchId, moved: 0, bytes: 0, movedToFolder: 0, failed: [] }
  const gone: number[] = []
  const stamp = new Date().toISOString().slice(0, 10)

  const log = (row: FlaggedRow, trashedPath: string | null, method: 'trash' | 'folder'): void => {
    transaction(() => {
      run(
        `INSERT INTO trash_log (batch_id, media_id, original_path, trashed_path, method, size, trashed_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        batchId, row.id, row.path, trashedPath, method, row.size, Date.now()
      )
      run(`UPDATE media SET state = 'trashed', flagged = 0, kept = 0 WHERE id = ?`, row.id)
    })
    result.moved++
    result.bytes += row.size
  }

  const queue = [...rows]
  const workers = Array.from({ length: 4 }, async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      if (!existsSync(row.path)) {
        gone.push(row.id) // already deleted outside Sift
        continue
      }
      try {
        log(row, await interactive.trash(row.path), 'trash')
      } catch (e) {
        if (e instanceof AnalyzerError && e.code === 'noTrash') {
          try {
            const source = sourceById(row.source_id)
            const root = source?.path ?? dirname(row.path)
            const target = freePath(join(root, REMOVED_FOLDER, stamp, relative(root, row.path)))
            await moveFile(row.path, target)
            log(row, target, 'folder')
            result.movedToFolder++
          } catch (e2) {
            result.failed.push({ path: row.path, error: (e2 as Error).message })
          }
        } else {
          result.failed.push({ path: row.path, error: (e as Error).message })
        }
      }
    }
  })
  await Promise.all(workers)
  forget(gone)
  return result
}

export function trashHistory(): TrashBatch[] {
  const rows = all<{ batch_id: string; at: number; count: number; bytes: number; paths: string }>(
    `SELECT batch_id, MIN(trashed_at) AS at, COUNT(*) AS count, SUM(size) AS bytes,
            json_group_array(trashed_path) AS paths
     FROM trash_log WHERE restored_at IS NULL
     GROUP BY batch_id ORDER BY at DESC LIMIT 50`
  )
  return rows.map((r) => ({
    batchId: r.batch_id,
    at: r.at,
    count: r.count,
    bytes: r.bytes,
    restorable: (JSON.parse(r.paths) as (string | null)[]).filter((p) => p && existsSync(p)).length
  }))
}

export async function restoreBatch(batchId: string): Promise<RestoreResult> {
  const rows = all<{ id: number; media_id: number; original_path: string; trashed_path: string | null }>(
    `SELECT id, media_id, original_path, trashed_path FROM trash_log WHERE batch_id = ? AND restored_at IS NULL`,
    batchId
  )
  const result: RestoreResult = { restored: 0, failed: [] }
  for (const row of rows) {
    if (!row.trashed_path || !existsSync(row.trashed_path)) {
      result.failed.push({ path: row.original_path, error: 'No longer in the Trash' })
      continue
    }
    try {
      const target = freePath(row.original_path)
      await moveFile(row.trashed_path, target)
      transaction(() => {
        run(`UPDATE trash_log SET restored_at = ? WHERE id = ?`, Date.now(), row.id)
        run(
          `UPDATE media SET state = CASE WHEN level > 0 THEN 'ready' ELSE 'pending' END, path = ?, name = ?, dir = ?
           WHERE id = ? AND state = 'trashed'`,
          target, basename(target), dirname(target), row.media_id
        )
      })
      result.restored++
    } catch (e) {
      result.failed.push({ path: row.original_path, error: (e as Error).message })
    }
  }
  return result
}

/**
 * Housekeeping at startup: forget trashed items the user has since emptied
 * from the Trash, or that were removed more than 60 days ago.
 */
export function pruneTrashed(): void {
  const cutoff = Date.now() - 60 * 24 * 3600 * 1000
  const rows = all<{ media_id: number; trashed_path: string | null; trashed_at: number }>(
    `SELECT t.media_id, t.trashed_path, t.trashed_at FROM trash_log t
     JOIN media m ON m.id = t.media_id AND m.state = 'trashed' WHERE t.restored_at IS NULL`
  )
  const stale = rows.filter((r) => r.trashed_at < cutoff || !r.trashed_path || !existsSync(r.trashed_path)).map((r) => r.media_id)
  forget(stale)
  run(`DELETE FROM trash_log WHERE trashed_at < ?`, cutoff)
}
