// Read queries and user decisions (flag / keep) on media items.

import type { JunkItem, JunkReason, MediaDetails, MediaItem, MediaQuery } from '@shared/types'
import { all, chunked, get, placeholders, run, transaction } from './db'
import { getSettings } from './settings'

/** Columns needed to build a MediaItem. `t` is the best-known capture time. */
export const ITEM_COLUMNS = `
  m.id, m.source_id, m.kind, m.name, m.dir, m.size, m.width, m.height, m.duration, m.state, m.level,
  m.flagged, m.kept, m.sharpness, m.aesthetic, m.face_count, m.face_quality, m.brightness, m.mtime,
  COALESCE(m.taken_at, m.btime, m.mtime) AS t`

export const VISIBLE = `m.state IN ('pending', 'ready', 'error')`

export interface ItemRow {
  id: number
  source_id: number
  kind: 'image' | 'video'
  name: string
  dir: string
  size: number
  width: number | null
  height: number | null
  duration: number | null
  state: string
  level: number
  flagged: number
  kept: number
  sharpness: number | null
  aesthetic: number | null
  face_count: number | null
  face_quality: number | null
  brightness: number | null
  mtime: number
  t: number
}

export function toItem(r: ItemRow): MediaItem {
  return {
    id: r.id,
    sourceId: r.source_id,
    kind: r.kind,
    name: r.name,
    dir: r.dir,
    size: r.size,
    width: r.width,
    height: r.height,
    takenAt: r.t,
    duration: r.duration,
    analyzed: r.state === 'ready',
    flagged: r.flagged === 1,
    kept: r.kept === 1,
    sharpness: r.sharpness,
    aesthetic: r.aesthetic,
    faceCount: r.face_count,
    faceQuality: r.face_quality,
    brightness: r.brightness,
    // Thumbnails appear once analysis finishes, so the version must change then too.
    v: r.state === 'ready' ? r.mtime + r.level : 0
  }
}

export function listMedia(q: MediaQuery): MediaItem[] {
  const where = [VISIBLE]
  const params: (string | number)[] = []
  if (q.kind) {
    where.push('m.kind = ?')
    params.push(q.kind)
  }
  if (q.sourceId) {
    where.push('m.source_id = ?')
    params.push(q.sourceId)
  }
  return all<ItemRow>(`SELECT ${ITEM_COLUMNS} FROM media m WHERE ${where.join(' AND ')} ORDER BY t DESC, m.id DESC`, ...params).map(toItem)
}

export function itemsByIds(ids: number[]): Map<number, ItemRow> {
  const map = new Map<number, ItemRow>()
  chunked(ids, (chunk) => {
    for (const r of all<ItemRow>(`SELECT ${ITEM_COLUMNS} FROM media m WHERE m.id IN ${placeholders(chunk.length)}`, ...chunk)) {
      map.set(r.id, r)
    }
  })
  return map
}

interface DetailRow extends ItemRow {
  path: string
  source_name: string
  taken_at: number | null
  camera: string | null
  lat: number | null
  lon: number | null
  labels: string | null
  is_utility: number | null
  contrast: number | null
  error: string | null
}

export function getDetails(id: number): MediaDetails | null {
  const r = get<DetailRow>(
    `SELECT ${ITEM_COLUMNS}, m.path, s.name AS source_name, m.taken_at, m.camera, m.lat, m.lon, m.labels,
            m.is_utility, m.contrast, m.error
     FROM media m JOIN sources s ON s.id = m.source_id WHERE m.id = ?`,
    id
  )
  if (!r) return null
  let labels: MediaDetails['labels'] = []
  try {
    labels = (JSON.parse(r.labels ?? '[]') as [string, number][]).map(([label, confidence]) => ({ label, confidence }))
  } catch {
    // keep empty
  }
  return {
    ...toItem(r),
    path: r.path,
    sourceName: r.source_name,
    dateSource: r.taken_at != null ? 'exif' : 'file',
    camera: r.camera,
    lat: r.lat,
    lon: r.lon,
    labels,
    isUtility: r.is_utility == null ? null : r.is_utility === 1,
    contrast: r.contrast,
    error: r.error
  }
}

export function mediaPath(id: number): { path: string; kind: string; ext: string; v: number } | undefined {
  const r = get<{ path: string; kind: string; ext: string; mtime: number }>('SELECT path, kind, ext, mtime FROM media WHERE id = ?', id)
  return r && { path: r.path, kind: r.kind, ext: r.ext, v: r.mtime }
}

// ─── Cleanup lists ────────────────────────────────────────────────────────

const UNDECIDED = `m.state = 'ready' AND m.flagged = 0 AND m.kept = 0`

export function blurry(): MediaItem[] {
  const s = getSettings()
  return all<ItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM media m
     WHERE ${UNDECIDED} AND m.kind = 'image' AND m.sharpness < ? AND COALESCE(m.brightness, 1) >= ?
     ORDER BY m.sharpness ASC LIMIT 5000`,
    s.blurThreshold,
    s.darkThreshold
  ).map(toItem)
}

const SCREENSHOT_NAME =
  /screen ?shot|screen_shot|снимок экрана|скриншот|bildschirmfoto|capture d.écran|captura de pantalla|schermata|スクリーンショット|屏幕快照|截屏|ekran görüntüsü/i

interface JunkRow extends ItemRow {
  ext: string
  user_comment: string | null
  has_camera: number | null
  is_utility: number | null
  contrast: number | null
}

export function junkReasons(r: JunkRow, darkThreshold: number): JunkReason[] {
  const reasons: JunkReason[] = []
  if (SCREENSHOT_NAME.test(r.name) || r.user_comment?.trim().toLowerCase() === 'screenshot') reasons.push('screenshot')
  if ((r.brightness ?? 1) < darkThreshold || (r.contrast ?? 1) < 0.015) reasons.push('accidental')
  if (r.is_utility === 1 && !reasons.includes('screenshot')) reasons.push('document')
  if (Math.max(r.width ?? 9999, r.height ?? 9999) < 400) reasons.push('tiny')
  return reasons
}

export function junk(): JunkItem[] {
  const s = getSettings()
  const rows = all<JunkRow>(
    `SELECT ${ITEM_COLUMNS}, m.ext, m.user_comment, m.has_camera, m.is_utility, m.contrast FROM media m
     WHERE ${UNDECIDED} AND m.kind = 'image' AND (
       m.brightness < ? OR m.contrast < 0.015 OR m.is_utility = 1 OR MAX(m.width, m.height) < 400
       OR m.user_comment IS NOT NULL OR m.has_camera = 0 OR m.has_camera IS NULL)
     ORDER BY t DESC`,
    s.darkThreshold
  )
  const out: JunkItem[] = []
  for (const r of rows) {
    const reasons = junkReasons(r, s.darkThreshold)
    if (reasons.length) out.push({ ...toItem(r), reasons })
  }
  return out
}

export function largeVideos(): MediaItem[] {
  const s = getSettings()
  return all<ItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM media m
     WHERE ${VISIBLE} AND m.flagged = 0 AND m.kept = 0 AND m.kind = 'video' AND m.size >= ?
     ORDER BY m.size DESC LIMIT 1000`,
    s.largeVideoMB * 1024 * 1024
  ).map(toItem)
}

export function reviewBin(): MediaItem[] {
  return all<ItemRow>(`SELECT ${ITEM_COLUMNS} FROM media m WHERE ${VISIBLE} AND m.flagged = 1 ORDER BY m.flagged_at DESC, t DESC`).map(toItem)
}

// ─── Decisions ────────────────────────────────────────────────────────────

export function setFlagged(ids: number[], flagged: boolean): void {
  const now = Date.now()
  transaction(() =>
    chunked(ids, (chunk) =>
      void run(
        `UPDATE media SET flagged = ?, kept = CASE WHEN ? THEN 0 ELSE kept END, flagged_at = ? WHERE id IN ${placeholders(chunk.length)}`,
        flagged ? 1 : 0,
        flagged ? 1 : 0,
        flagged ? now : null,
        ...chunk
      )
    )
  )
}

export function keep(ids: number[]): void {
  transaction(() =>
    chunked(ids, (chunk) => void run(`UPDATE media SET kept = 1, flagged = 0, flagged_at = NULL WHERE id IN ${placeholders(chunk.length)}`, ...chunk))
  )
}

export function clearDecision(ids: number[]): void {
  transaction(() =>
    chunked(ids, (chunk) => void run(`UPDATE media SET kept = 0, flagged = 0, flagged_at = NULL WHERE id IN ${placeholders(chunk.length)}`, ...chunk))
  )
}
