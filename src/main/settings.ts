import { DEFAULT_SETTINGS, type Settings } from '@shared/types'
import { all, run, transaction } from './db'

let cache: Settings | null = null

export function getSettings(): Settings {
  if (cache) return cache
  const stored: Partial<Settings> = {}
  for (const row of all<{ key: string; value: string }>('SELECT key, value FROM settings')) {
    try {
      ;(stored as Record<string, unknown>)[row.key] = JSON.parse(row.value)
    } catch {
      // ignore corrupt values; the default wins
    }
  }
  cache = { ...DEFAULT_SETTINGS, ...stored }
  return cache
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings() }
  transaction(() => {
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in DEFAULT_SETTINGS) || value === undefined) continue
      ;(next as Record<string, unknown>)[key] = value
      run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value))
    }
  })
  cache = next
  return next
}
