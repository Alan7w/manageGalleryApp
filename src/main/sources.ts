// Sources are the folders / drives the user adds. Everything in them is shown as
// one library, wherever it physically lives.

import type { AddSourcesResult, Source } from '@shared/types'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, sep } from 'node:path'
import { all, get, run, transaction } from './db'

interface SourceRow {
  id: number
  path: string
  name: string
  last_scan_at: number | null
  is_primary: number
  count: number
  bytes: number
}

const isInside = (child: string, parent: string): boolean =>
  child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep)

/** Folders we refuse to add: they are system locations, not photo collections. */
function forbidden(path: string): string | null {
  if (path === '/' || path === '/System' || path === '/Library' || path === '/Applications') {
    return 'System folders cannot be added'
  }
  if (path === homedir()) return 'Pick a specific folder (e.g. Pictures) rather than your whole home folder'
  if (isInside(path, `${homedir()}/Library`)) return 'App data folders cannot be added'
  if (/\.(photoslibrary|photolibrary|aplibrary)$/i.test(path)) {
    return 'Apple Photos libraries are managed by the Photos app — support for them is coming separately'
  }
  return null
}

export function listSources(): Source[] {
  const rows = all<SourceRow>(`
    SELECT s.id, s.path, s.name, s.last_scan_at, s.is_primary,
           COUNT(m.id) AS count, COALESCE(SUM(m.size), 0) AS bytes
    FROM sources s
    LEFT JOIN media m ON m.source_id = s.id AND m.state != 'trashed'
    GROUP BY s.id
    ORDER BY s.is_primary DESC, s.name COLLATE NOCASE`)
  return rows.map((r) => ({
    id: r.id,
    path: r.path,
    name: r.name,
    online: existsSync(r.path),
    isPrimary: r.is_primary === 1,
    count: r.count,
    bytes: r.bytes,
    lastScanAt: r.last_scan_at
  }))
}

export function onlineSourceIds(): number[] {
  return listSources()
    .filter((s) => s.online)
    .map((s) => s.id)
}

function displayName(path: string): string {
  const volume = path.match(/^\/Volumes\/([^/]+)/)?.[1]
  const name = basename(path)
  if (volume && name !== volume) return `${name} (${volume})`
  return name || path
}

export function addSources(paths: string[]): AddSourcesResult {
  const result: AddSourcesResult = { added: [], skipped: [] }
  transaction(() => {
    for (const raw of paths) {
      let path: string
      try {
        path = realpathSync(raw)
        if (!statSync(path).isDirectory()) {
          result.skipped.push({ path: raw, reason: 'Not a folder' })
          continue
        }
      } catch {
        result.skipped.push({ path: raw, reason: 'Folder not found' })
        continue
      }
      const reason = forbidden(path)
      if (reason) {
        result.skipped.push({ path, reason })
        continue
      }
      const existing = all<{ id: number; path: string }>('SELECT id, path FROM sources')
      const parent = existing.find((s) => isInside(path, s.path))
      if (parent) {
        result.skipped.push({ path, reason: `Already included in “${displayName(parent.path)}”` })
        continue
      }
      const { lastInsertRowid: id } = run(
        'INSERT INTO sources (path, name, added_at, is_primary) VALUES (?, ?, ?, ?)',
        path,
        displayName(path),
        Date.now(),
        existing.length === 0 ? 1 : 0
      )
      // A new source that contains existing ones absorbs them (and their analysis).
      for (const child of existing.filter((s) => isInside(s.path, path))) {
        run('UPDATE media SET source_id = ? WHERE source_id = ?', id, child.id)
        run('DELETE FROM sources WHERE id = ?', child.id)
      }
      const added = listSources().find((s) => s.id === id)
      if (added) result.added.push(added)
    }
    ensurePrimary()
  })
  return result
}

export function removeSource(id: number): void {
  transaction(() => {
    run('DELETE FROM media WHERE source_id = ?', id)
    run('DELETE FROM sources WHERE id = ?', id)
    ensurePrimary()
  })
}

export function setPrimarySource(id: number): void {
  transaction(() => {
    run('UPDATE sources SET is_primary = 0')
    run('UPDATE sources SET is_primary = 1 WHERE id = ?', id)
  })
}

function ensurePrimary(): void {
  if (!get('SELECT id FROM sources WHERE is_primary = 1')) {
    run('UPDATE sources SET is_primary = 1 WHERE id = (SELECT MIN(id) FROM sources)')
  }
}

export function sourceById(id: number): { id: number; path: string; name: string } | undefined {
  return get('SELECT id, path, name FROM sources WHERE id = ?', id)
}
