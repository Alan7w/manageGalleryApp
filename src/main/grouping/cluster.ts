// Pure clustering of "similar" photos. No Electron / DB imports here, so it can
// run inside a worker thread and be unit-tested in isolation.
//
// Two ways photos end up in the same group:
//  1. Burst / same moment: taken within `windowMs` of each other AND look alike
//     (Vision feature-print distance, or the cheap difference hash as backup).
//  2. Same picture saved twice: nearly identical difference hash no matter when
//     (exports, resized copies, messenger re-uploads). Found via hash buckets so
//     we never compare every photo with every other photo.

export interface ClusterInput {
  n: number
  time: Float64Array
  kind: Uint8Array // 0 image · 1 video
  duration: Float32Array
  hashHi: Uint32Array
  hashLo: Uint32Array
  hasHash: Uint8Array
  dim: number
  features: Int8Array // n × dim, int8-quantised unit vectors
  hasFeature: Uint8Array
  windowMs: number
  /** Feature distance (0 identical … ~1.4 unrelated) below which burst shots count as alike. */
  burstThreshold: number
  maxSpanMs: number
}

const popcount = (x: number): number => {
  x -= (x >>> 1) & 0x55555555
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333)
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

export function hamming(inp: ClusterInput, a: number, b: number): number {
  return popcount(inp.hashHi[a] ^ inp.hashHi[b]) + popcount(inp.hashLo[a] ^ inp.hashLo[b])
}

/** Euclidean distance between two unit vectors, from their int8 dot product. */
export function featureDistance(inp: ClusterInput, a: number, b: number): number {
  const { features: f, dim } = inp
  let dot = 0
  const oa = a * dim
  const ob = b * dim
  for (let k = 0; k < dim; k++) dot += f[oa + k] * f[ob + k]
  const cos = dot / (127 * 127)
  return Math.sqrt(Math.max(0, 2 - 2 * cos))
}

function compatible(inp: ClusterInput, a: number, b: number): boolean {
  if (inp.kind[a] !== inp.kind[b]) return false
  if (inp.kind[a] === 1) {
    const da = inp.duration[a]
    const db = inp.duration[b]
    if (Math.abs(da - db) > Math.max(1.5, 0.03 * Math.max(da, db))) return false
  }
  return true
}

/** A hash with almost all bits equal comes from a flat image (black frame, sky) and matches everything. */
function degenerate(inp: ClusterInput, i: number): boolean {
  const bits = popcount(inp.hashHi[i]) + popcount(inp.hashLo[i])
  return bits < 6 || bits > 58
}

class UnionFind {
  parent: Int32Array
  min: Float64Array
  max: Float64Array
  constructor(n: number, time: Float64Array) {
    this.parent = new Int32Array(n)
    for (let i = 0; i < n; i++) this.parent[i] = i
    this.min = Float64Array.from(time)
    this.max = Float64Array.from(time)
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]]
      i = this.parent[i]
    }
    return i
  }
  /** Joins unless the combined group would span more than `maxSpan` (stops endless chaining). */
  union(a: number, b: number, maxSpan: number): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra === rb) return
    const lo = Math.min(this.min[ra], this.min[rb])
    const hi = Math.max(this.max[ra], this.max[rb])
    if (hi - lo > maxSpan) return
    this.parent[rb] = ra
    this.min[ra] = lo
    this.max[ra] = hi
  }
}

export function cluster(inp: ClusterInput): number[][] {
  const { n } = inp
  const uf = new UnionFind(n, inp.time)

  // 1 · Bursts: neighbours in time that look alike.
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => inp.time[a] - inp.time[b])
  for (let x = 0; x < n; x++) {
    const i = order[x]
    for (let y = x + 1; y < n; y++) {
      const j = order[y]
      if (inp.time[j] - inp.time[i] > inp.windowMs) break
      if (!compatible(inp, i, j)) continue
      const bothHash = inp.hasHash[i] && inp.hasHash[j] && !degenerate(inp, i) && !degenerate(inp, j)
      const ham = bothHash ? hamming(inp, i, j) : 64
      let alike: boolean
      if (inp.hasFeature[i] && inp.hasFeature[j]) {
        const d = featureDistance(inp, i, j)
        // Blurry frames of a burst drift far in feature space but keep their overall layout (hash).
        alike = d <= inp.burstThreshold || (ham <= 8 && d <= inp.burstThreshold * 2.2)
      } else {
        alike = ham <= 8
      }
      if (alike) uf.union(i, j, inp.maxSpanMs)
    }
  }

  // 2 · Re-saved copies: same picture at any time, found through 16-bit hash bands.
  // Two 64-bit hashes within 3 bits of each other must share at least one of 4 bands.
  const buckets = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    if (!inp.hasHash[i] || degenerate(inp, i)) continue
    const bands = [inp.hashHi[i] >>> 16, inp.hashHi[i] & 0xffff, inp.hashLo[i] >>> 16, inp.hashLo[i] & 0xffff]
    bands.forEach((v, b) => {
      const key = b * 65536 + v
      const list = buckets.get(key)
      if (list) list.push(i)
      else buckets.set(key, [i])
    })
  }
  for (const list of buckets.values()) {
    if (list.length < 2 || list.length > 400) continue
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const i = list[x]
        const j = list[y]
        if (!compatible(inp, i, j) || hamming(inp, i, j) > 3) continue
        if (inp.hasFeature[i] && inp.hasFeature[j] && featureDistance(inp, i, j) > 0.35) continue
        uf.union(i, j, Number.POSITIVE_INFINITY)
      }
    }
  }

  const groups = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const r = uf.find(i)
    const g = groups.get(r)
    if (g) g.push(i)
    else groups.set(r, [i])
  }
  return [...groups.values()].filter((g) => g.length > 1)
}
