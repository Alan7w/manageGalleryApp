// Builds duplicate and similar groups, then picks the photo worth keeping in
// each one, with badges that explain the choice.

import type { Badge, GroupKind, GroupMember, MediaGroup, Overview } from '@shared/types'
import { relative, sep } from 'node:path'
import createClusterWorker from './grouping/worker?nodeWorker'
import type { ClusterInput } from './grouping/cluster'
import { all, get } from './db'
import { getProgress } from './engine'
import { dataVersion } from './events'
import { blurry, itemsByIds, junk, largeVideos, toItem, type ItemRow } from './media'
import { getSettings } from './settings'

// ─── Clustering (cached until analysis data or settings change) ───────────

interface Cached {
  key: string
  groups: Promise<number[][]>
  at: number
}
const cache: Partial<Record<GroupKind, Cached>> = {}

function cacheKey(kind: GroupKind): string {
  const s = getSettings()
  return kind === 'duplicate' ? `${dataVersion}` : `${dataVersion}:${s.strictness}:${s.burstWindowSec}`
}

function idGroups(kind: GroupKind): Promise<number[][]> {
  const key = cacheKey(kind)
  const hit = cache[kind]
  if (hit?.key === key) return hit.groups
  // While a big scan is still analyzing, results change every second; regrouping a
  // large library that often is wasted work, so slightly stale groups are served.
  const settingsPart = key.split(':').slice(1).join(':')
  if (hit && getProgress().phase === 'analyzing' && Date.now() - hit.at < 20_000 && hit.key.split(':').slice(1).join(':') === settingsPart) {
    return hit.groups
  }
  const groups = kind === 'duplicate' ? Promise.resolve(duplicateIdGroups()) : similarIdGroups()
  cache[kind] = { key, groups, at: Date.now() }
  groups.catch(() => delete cache[kind])
  return groups
}

function duplicateIdGroups(): number[][] {
  const bySha = new Map<string, number[]>()
  for (const r of all<{ id: number; sha: string }>(`SELECT id, sha FROM media WHERE state = 'ready' AND sha IS NOT NULL ORDER BY id`)) {
    const g = bySha.get(r.sha)
    if (g) g.push(r.id)
    else bySha.set(r.sha, [r.id])
  }
  return [...bySha.values()].filter((g) => g.length > 1)
}

interface ClusterRow {
  id: number
  kind: string
  t: number
  duration: number | null
  dhash: string | null
  feature: Uint8Array | null
  sha: string | null
}

async function similarIdGroups(): Promise<number[][]> {
  const settings = getSettings()
  const copies = loadCopies()
  const rows = all<ClusterRow>(
    `SELECT id, kind, COALESCE(taken_at, btime, mtime) AS t, duration, dhash, feature, sha
     FROM media WHERE state = 'ready' ORDER BY id`
  )
  // Identical copies are the Duplicates view's job; only the copy it would keep takes part here.
  const extraCopies = new Set<number>()
  for (const ids of duplicateIdGroups()) {
    const list = ids.map((id) => copies.get(id)).filter((c): c is CopyRow => !!c)
    if (list.length < 2) continue
    const keeper = rankCopies(list).keeperId
    for (const id of ids) if (id !== keeper) extraCopies.add(id)
  }
  const members = rows.filter((r) => !extraCopies.has(r.id))
  const n = members.length
  if (n < 2) return []
  const dim = members.find((r) => r.feature)?.feature?.length ?? 0
  const input: ClusterInput = {
    n,
    time: new Float64Array(n),
    kind: new Uint8Array(n),
    duration: new Float32Array(n),
    hashHi: new Uint32Array(n),
    hashLo: new Uint32Array(n),
    hasHash: new Uint8Array(n),
    dim,
    features: new Int8Array(n * dim),
    hasFeature: new Uint8Array(n),
    windowMs: settings.burstWindowSec * 1000,
    // strictness 0 → 0.75 (loose) … 1 → 0.30 (strict)
    burstThreshold: 0.75 - settings.strictness * 0.45,
    maxSpanMs: Math.max(settings.burstWindowSec * 1000 * 10, 15 * 60 * 1000)
  }
  members.forEach((r, i) => {
    input.time[i] = r.t
    input.kind[i] = r.kind === 'video' ? 1 : 0
    input.duration[i] = r.duration ?? 0
    if (r.dhash?.length === 16) {
      input.hashHi[i] = parseInt(r.dhash.slice(0, 8), 16)
      input.hashLo[i] = parseInt(r.dhash.slice(8), 16)
      input.hasHash[i] = 1
    }
    if (r.feature && r.feature.length === dim) {
      input.features.set(new Int8Array(r.feature.buffer, r.feature.byteOffset, dim), i * dim)
      input.hasFeature[i] = 1
    }
  })

  const worker = createClusterWorker({})
  try {
    const groups = await new Promise<number[][]>((resolve, reject) => {
      worker.once('message', resolve)
      worker.once('error', reject)
      worker.postMessage(input, [
        input.time.buffer,
        input.kind.buffer,
        input.duration.buffer,
        input.hashHi.buffer,
        input.hashLo.buffer,
        input.hasHash.buffer,
        input.features.buffer,
        input.hasFeature.buffer
      ] as ArrayBuffer[])
    })
    return groups.map((g) => g.map((i) => members[i].id))
  } finally {
    void worker.terminate()
  }
}

// ─── Picking the keeper ───────────────────────────────────────────────────

const normalise = (v: number, lo: number, hi: number): number => (hi - lo < 1e-9 ? 1 : (v - lo) / (hi - lo))
const argmax = (xs: number[]): number => xs.reduce((best, x, i) => (x > xs[best] ? i : best), 0)

/** Scores burst / similar shots: focus first, then Apple's aesthetic score, faces, exposure, resolution. */
export function scoreSimilar(rows: ItemRow[]): { score: number; badges: Badge[] }[] {
  const rawSharp = rows.map((r) => r.sharpness ?? 0)
  const sharp = rawSharp.map((v) => Math.log1p(v))
  const sharpN = sharp.map((v) => normalise(v, Math.min(...sharp), Math.max(...sharp)))
  const hasAes = rows.every((r) => r.aesthetic != null)
  const aesN = rows.map((r) => ((r.aesthetic ?? 0) + 1) / 2)
  const hasFaces = rows.some((r) => (r.face_count ?? 0) > 0)
  const faceN = rows.map((r) => ((r.face_count ?? 0) > 0 ? (r.face_quality ?? 0) : 0))
  const expo = rows.map((r) => (r.brightness == null ? 0.5 : 1 - Math.min(1, Math.abs(r.brightness - 0.48) * 2.2)))
  const pixels = rows.map((r) => (r.width ?? 0) * (r.height ?? 0))
  const maxPixels = Math.max(1, ...pixels)
  const resN = pixels.map((p) => p / maxPixels)

  const w = hasAes
    ? { sharp: hasFaces ? 0.4 : 0.48, aes: hasFaces ? 0.3 : 0.37, face: hasFaces ? 0.15 : 0, expo: 0.1, res: 0.05 }
    : { sharp: 0.65, aes: 0, face: 0, expo: 0.2, res: 0.15 }

  // Downscaled exports / messenger copies look "sharper" (compression edges count as detail),
  // so a copy with far fewer pixels is penalised no matter how crisp it measures.
  const scores = rows.map(
    (_, i) => (w.sharp * sharpN[i] + w.aes * aesN[i] + w.face * faceN[i] + w.expo * expo[i] + w.res * resN[i]) * (0.55 + 0.45 * Math.sqrt(resN[i]))
  )
  const badges: Badge[][] = rows.map(() => [])
  const maxSharp = Math.max(...rawSharp)
  const spread = (xs: number[]): number => Math.max(...xs) - Math.min(...xs)
  const sharpest = argmax(rawSharp)
  // A downscaled copy can measure sharpest without really being so; don't praise it.
  if (maxSharp > 0 && spread(rawSharp) / maxSharp > 0.1 && resN[sharpest] >= 0.6) badges[sharpest].push({ label: 'Sharpest', tone: 'good' })
  if (hasAes && spread(aesN) > 0.03) badges[argmax(aesN)].push({ label: 'Best composition', tone: 'good' })
  if (hasFaces && spread(faceN) > 0.05) badges[argmax(faceN)].push({ label: 'Best faces', tone: 'good' })
  if (Math.min(...pixels) > 0 && maxPixels / Math.min(...pixels) > 1.2) badges[argmax(pixels)].push({ label: 'Highest resolution', tone: 'good' })
  rows.forEach((r, i) => {
    if (maxSharp > 0 && rawSharp[i] < maxSharp * 0.3) badges[i].push({ label: 'Blurry', tone: 'bad' })
    if (r.brightness != null && r.brightness < 0.12) badges[i].push({ label: 'Too dark', tone: 'bad' })
    if (r.brightness != null && r.brightness > 0.9) badges[i].push({ label: 'Overexposed', tone: 'bad' })
    if (resN[i] < 0.5) badges[i].push({ label: 'Lower resolution', tone: 'bad' })
  })
  return rows.map((_, i) => ({ score: scores[i], badges: badges[i] }))
}

const COPY_MARKER = /( copy( \d+)?| \(\d+\)|-copy|_copy|^copy of )/i
const TRANSIENT_DIR = /\/(downloads|telegram desktop|whatsapp[^/]*|temp|tmp)(\/|$)/i

interface CopyRow {
  id: number
  path: string
  dir: string
  name: string
  btime: number | null
  mtime: number
  source_path: string
  source_name: string
  is_primary: number
}

/** Location details for every file that has an identical twin. */
function loadCopies(): Map<number, CopyRow> {
  const map = new Map<number, CopyRow>()
  for (const c of all<CopyRow>(
    `SELECT m.id, m.path, m.dir, m.name, m.btime, m.mtime, s.path AS source_path, s.name AS source_name, s.is_primary
     FROM media m JOIN sources s ON s.id = m.source_id
     WHERE m.state = 'ready' AND m.sha IN (
       SELECT sha FROM media WHERE state = 'ready' AND sha IS NOT NULL GROUP BY sha HAVING COUNT(*) > 1)`
  )) {
    map.set(c.id, c)
  }
  return map
}

/** Chooses which identical copy to keep: main library, original name, oldest. */
function rankCopies(copies: CopyRow[]): { keeperId: number; badges: Map<number, Badge[]>; location: Map<number, string> } {
  const stem = (c: CopyRow): string => c.name.replace(/\.[^.]+$/, '')
  const transient = (c: CopyRow): boolean => TRANSIENT_DIR.test(`/${relative(c.source_path, c.dir)}`)
  const oldest = Math.min(...copies.map((c) => c.btime ?? c.mtime))
  const score = (c: CopyRow): number =>
    (c.is_primary ? 100 : 0) +
    (COPY_MARKER.test(stem(c)) ? 0 : 20) +
    (transient(c) ? 0 : 10) +
    ((c.btime ?? c.mtime) === oldest ? 5 : 0) -
    c.path.split(sep).length * 0.1
  const keeper = copies.reduce((best, c) => (score(c) > score(best) ? c : best), copies[0])
  const badges = new Map<number, Badge[]>()
  const location = new Map<number, string>()
  const anyPrimary = copies.some((c) => c.is_primary)
  const anyMarked = copies.some((c) => COPY_MARKER.test(stem(c)))
  for (const c of copies) {
    const b: Badge[] = []
    if (c.id === keeper.id) {
      if (c.is_primary && copies.some((o) => !o.is_primary)) b.push({ label: 'In main library', tone: 'good' })
      if (anyMarked && !COPY_MARKER.test(stem(c))) b.push({ label: 'Original name', tone: 'good' })
      if ((c.btime ?? c.mtime) === oldest && copies.length > 1) b.push({ label: 'Oldest copy', tone: 'good' })
    } else {
      if (COPY_MARKER.test(stem(c))) b.push({ label: 'Named as a copy', tone: 'bad' })
      if (transient(c)) b.push({ label: 'In Downloads', tone: 'bad' })
      if (anyPrimary && !c.is_primary) b.push({ label: 'Outside main library', tone: 'bad' })
    }
    badges.set(c.id, b)
    const rel = relative(c.source_path, c.dir)
    location.set(c.id, rel ? `${c.source_name} › ${rel.split(sep).join(' › ')}` : c.source_name)
  }
  return { keeperId: keeper.id, badges, location }
}

// ─── Public API ───────────────────────────────────────────────────────────

export async function getGroups(kind: GroupKind): Promise<MediaGroup[]> {
  const groups = await idGroups(kind)
  const rows = itemsByIds(groups.flat())
  const copies = kind === 'duplicate' ? loadCopies() : new Map<number, CopyRow>()

  const out: MediaGroup[] = []
  for (const ids of groups) {
    const members = ids
      .map((id) => rows.get(id))
      .filter((r): r is ItemRow => !!r && r.state === 'ready')
      .sort((a, b) => a.t - b.t || a.id - b.id)
    if (members.length < 2) continue

    let groupMembers: GroupMember[]
    let keeperId: number
    if (kind === 'duplicate') {
      const list = members.map((m) => copies.get(m.id)).filter((c): c is CopyRow => !!c)
      if (list.length < 2) continue
      const ranked = rankCopies(list)
      keeperId = ranked.keeperId
      groupMembers = members.map((m) => ({
        item: toItem(m),
        score: m.id === keeperId ? 1 : 0,
        badges: ranked.badges.get(m.id) ?? [],
        location: ranked.location.get(m.id)
      }))
    } else {
      const scored = scoreSimilar(members)
      keeperId = members[argmax(scored.map((s) => s.score))].id
      groupMembers = members.map((m, i) => ({ item: toItem(m), score: scored[i].score, badges: scored[i].badges }))
    }

    const resolved = members.every((m) => m.flagged === 1 || m.kept === 1)
    const reclaimable = members.filter((m) => m.id !== keeperId && m.flagged === 0 && m.kept === 0).reduce((s, m) => s + m.size, 0)
    out.push({
      key: `${kind === 'duplicate' ? 'd' : 's'}:${Math.min(...ids)}`,
      kind,
      members: groupMembers,
      suggestedKeepId: keeperId,
      reclaimable,
      resolved,
      startAt: members[0].t,
      spanMs: members[members.length - 1].t - members[0].t
    })
  }
  return out.sort((a, b) => b.startAt - a.startAt)
}

export async function getOverview(): Promise<Overview> {
  const totals = get<{ items: number; images: number; videos: number; bytes: number }>(
    `SELECT COUNT(*) AS items, SUM(kind = 'image') AS images, SUM(kind = 'video') AS videos, COALESCE(SUM(size), 0) AS bytes
     FROM media WHERE state IN ('pending', 'ready', 'error')`
  )!
  const analysis = get<{ pending: number; ready: number; errors: number }>(
    `SELECT SUM(state = 'pending') AS pending, SUM(state = 'ready') AS ready, SUM(state = 'error') AS errors FROM media`
  )!
  const bin = get<{ items: number; bytes: number }>(
    `SELECT COUNT(*) AS items, COALESCE(SUM(size), 0) AS bytes FROM media WHERE flagged = 1 AND state IN ('pending', 'ready', 'error')`
  )!
  const sources = get<{ n: number }>('SELECT COUNT(*) AS n FROM sources')!.n

  const bucketFromGroups = (groups: MediaGroup[]): Overview['cleanup']['duplicates'] => {
    const open = groups.filter((g) => !g.resolved)
    return {
      groups: open.length,
      items: open.reduce((s, g) => s + g.members.filter((m) => m.item.id !== g.suggestedKeepId && !m.item.flagged && !m.item.kept).length, 0),
      bytes: open.reduce((s, g) => s + g.reclaimable, 0)
    }
  }
  const sum = (items: { size: number }[]): { items: number; bytes: number } => ({
    items: items.length,
    bytes: items.reduce((s, i) => s + i.size, 0)
  })

  const [dups, similar] = await Promise.all([getGroups('duplicate'), getGroups('similar')])
  return {
    totals: { items: totals.items, images: totals.images ?? 0, videos: totals.videos ?? 0, bytes: totals.bytes },
    analysis: { pending: analysis.pending ?? 0, ready: analysis.ready ?? 0, errors: analysis.errors ?? 0 },
    cleanup: {
      duplicates: bucketFromGroups(dups),
      similar: bucketFromGroups(similar),
      blurry: sum(blurry()),
      junk: sum(junk()),
      largeVideos: sum(largeVideos())
    },
    reviewBin: bin,
    sources
  }
}
