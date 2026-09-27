// The background pipeline: scan sources → analyze new files → hash possible
// duplicates. It reports progress to the UI and can be paused at any time.

import type { Progress } from '@shared/types'
import { AnalyzerError, bulk, type AnalyzeResult } from './analyzer'
import { all, placeholders, run, transaction } from './db'
import { bumpDataVersion, emit, libraryChanged } from './events'
import { thumbPath } from './paths'
import { scanSource } from './scanner'
import { getSettings } from './settings'
import { listSources, onlineSourceIds } from './sources'

const progress: Progress = { phase: 'idle', found: 0, done: 0, total: 0, rate: 0, etaSec: null, paused: false, detail: null }

let lastEmit = 0
function report(force = false): void {
  const now = Date.now()
  if (!force && now - lastEmit < 250) return
  lastEmit = now
  emit({ type: 'progress', progress: { ...progress } })
}

export const getProgress = (): Progress => ({ ...progress })

let running: Promise<void> | null = null
let again = false
let stopping = false
let resume: (() => void) | null = null

/** Starts a full pass (or queues another one if a pass is already running). */
export function startPass(): void {
  if (running) {
    again = true
    return
  }
  running = (async () => {
    do {
      again = false
      try {
        await pass()
      } catch (e) {
        console.error('pipeline pass failed', e)
      }
    } while (again && !stopping)
    running = null
    Object.assign(progress, { phase: 'idle', detail: null, rate: 0, etaSec: null })
    report(true)
    libraryChanged()
  })()
}

export function setPaused(paused: boolean): void {
  progress.paused = paused
  if (!paused) {
    resume?.()
    resume = null
  }
  report(true)
}

export async function shutdown(): Promise<void> {
  stopping = true
  setPaused(false)
  await running
}

async function waitIfPaused(): Promise<void> {
  while (progress.paused && !stopping) {
    await new Promise<void>((r) => (resume = r))
  }
}

async function pass(): Promise<void> {
  // 1 · Scan
  const sources = listSources().filter((s) => s.online)
  Object.assign(progress, { phase: 'scanning', found: 0, done: 0, total: 0, detail: null })
  report(true)
  let foundBefore = 0
  for (const source of sources) {
    progress.detail = source.name
    const found = await scanSource(
      source.id,
      source.path,
      (n) => {
        progress.found = foundBefore + n
        report()
      },
      () => stopping
    )
    foundBefore += found
  }
  bumpDataVersion()
  libraryChanged()

  // 2 · Analyze
  await analyzePending()
  // 3 · Hash files that share a size with another file (only these can be identical)
  await hashCandidates()
}

// ─── Analysis ──────────────────────────────────────────────────────────────

interface Job {
  id: number
  path: string
  kind: string
}

const crashes = new Map<number, number>()

async function analyzePending(): Promise<void> {
  const settings = getSettings()
  if (settings.deepAnalysis) {
    // Deep analysis was switched on after some files were analyzed without it.
    run(`UPDATE media SET state = 'pending' WHERE state = 'ready' AND level = 1`)
  }
  const online = onlineSourceIds()
  if (!online.length) return
  const jobs = all<Job>(
    `SELECT id, path, kind FROM media
     WHERE state = 'pending' AND source_id IN ${placeholders(online.length)}
     ORDER BY mtime DESC`,
    ...online
  )
  if (!jobs.length) return

  await bulk.start()
  Object.assign(progress, { phase: 'analyzing', done: 0, total: jobs.length, rate: 0, etaSec: null, detail: null })
  report(true)

  const vision = settings.deepAnalysis
  const results: { id: number; r: AnalyzeResult | null; error?: string }[] = []
  let lastFlush = Date.now()
  const flush = (): void => {
    if (!results.length) return
    const batch = results.splice(0)
    transaction(() => {
      for (const { id, r, error } of batch) {
        if (r) saveAnalysis(id, r, vision)
        else run(`UPDATE media SET state = 'error', error = ? WHERE id = ?`, error ?? 'Unknown error', id)
      }
    })
    lastFlush = Date.now()
    bumpDataVersion()
    libraryChanged(2500)
  }

  const started = Date.now()
  const inFlight = new Set<Promise<void>>()
  const limit = bulk.workers * 2
  for (const job of jobs) {
    await waitIfPaused()
    if (stopping) break
    const p = bulk
      .analyze(job.path, job.kind, thumbPath(job.id), vision)
      .then(
        (r) => void results.push({ id: job.id, r }),
        (e: AnalyzerError) => {
          // A crash rejects every in-flight job; only blame a file that was present for two crashes.
          if (e.code === 'crashed' && (crashes.get(job.id) ?? 0) < 1) {
            crashes.set(job.id, 1)
            return
          }
          results.push({ id: job.id, r: null, error: e.message })
        }
      )
      .finally(() => {
        inFlight.delete(p)
        progress.done++
        const elapsed = (Date.now() - started) / 1000
        progress.rate = progress.done / Math.max(elapsed, 0.001)
        progress.etaSec = progress.rate > 0 ? Math.round((progress.total - progress.done) / progress.rate) : null
        report()
        if (results.length >= 200 || Date.now() - lastFlush > 1000) flush()
      })
    inFlight.add(p)
    if (inFlight.size >= limit) await Promise.race(inFlight)
  }
  await Promise.all(inFlight)
  flush()
  report(true)
  if (!stopping && crashes.size) {
    // Files that were caught in a crash get one more try.
    const retry = all<{ n: number }>(
      `SELECT COUNT(*) AS n FROM media WHERE state = 'pending' AND id IN ${placeholders(crashes.size)}`,
      ...crashes.keys()
    )[0]
    if (retry.n > 0) again = true
  }
}

function saveAnalysis(id: number, r: AnalyzeResult, vision: boolean): void {
  const labels = r.labels ?? []
  run(
    `UPDATE media SET
       state = 'ready', level = ?, error = NULL,
       width = ?, height = ?, taken_at = ?, camera = ?, lat = ?, lon = ?, duration = ?,
       user_comment = ?, has_camera = ?, dhash = ?, sharpness = ?, global_sharpness = ?,
       brightness = ?, contrast = ?, clipped = ?, aesthetic = ?, is_utility = ?,
       face_count = ?, face_quality = ?, feature = ?, labels = ?, label_text = ?
     WHERE id = ?`,
    vision ? 2 : 1,
    r.width ?? null,
    r.height ?? null,
    r.takenAt != null ? Math.round(r.takenAt) : null,
    r.camera ?? null,
    r.lat ?? null,
    r.lon ?? null,
    r.duration ?? null,
    r.userComment ?? null,
    r.hasCameraInfo == null ? null : r.hasCameraInfo ? 1 : 0,
    r.dhash ?? null,
    r.sharpness ?? null,
    r.globalSharpness ?? null,
    r.brightness ?? null,
    r.contrast ?? null,
    r.clipped ?? null,
    r.aesthetic ?? null,
    r.isUtility == null ? null : r.isUtility ? 1 : 0,
    r.faceCount ?? null,
    r.faceQuality ?? null,
    r.feature ? Buffer.from(r.feature, 'base64') : null,
    labels.length ? JSON.stringify(labels) : null,
    labels.length ? ' ' + labels.map(([l]) => l).join(' ') + ' ' : null,
    id
  )
}

// ─── Hashing ───────────────────────────────────────────────────────────────

async function hashCandidates(): Promise<void> {
  const online = onlineSourceIds()
  if (!online.length) return
  const jobs = all<{ id: number; path: string }>(
    `SELECT id, path FROM media
     WHERE sha IS NULL AND state = 'ready' AND source_id IN ${placeholders(online.length)}
       AND size IN (SELECT size FROM media WHERE state IN ('ready', 'pending') GROUP BY size HAVING COUNT(*) > 1)`,
    ...online
  )
  if (!jobs.length) return
  await bulk.start()
  Object.assign(progress, { phase: 'hashing', done: 0, total: jobs.length, rate: 0, etaSec: null, detail: null })
  report(true)
  const inFlight = new Set<Promise<void>>()
  for (const job of jobs) {
    await waitIfPaused()
    if (stopping) break
    const p = bulk
      .sha(job.path)
      .then(
        (sha) => void run('UPDATE media SET sha = ? WHERE id = ?', sha, job.id),
        () => {}
      )
      .finally(() => {
        inFlight.delete(p)
        progress.done++
        report()
      })
    inFlight.add(p)
    if (inFlight.size >= bulk.workers) await Promise.race(inFlight)
  }
  await Promise.all(inFlight)
  bumpDataVersion()
}
