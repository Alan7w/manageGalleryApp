// Talks to the native Swift helper (native/analyzer) over stdin/stdout.
// Requests are JSON lines tagged with an id; responses come back in any order.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { analyzerBinary } from './paths'

export interface AnalyzeResult {
  width?: number
  height?: number
  takenAt?: number
  camera?: string
  lat?: number
  lon?: number
  duration?: number
  userComment?: string
  hasCameraInfo?: boolean
  dhash?: string
  sharpness?: number
  globalSharpness?: number
  brightness?: number
  contrast?: number
  clipped?: number
  feature?: string
  labels?: [string, number][]
  aesthetic?: number
  isUtility?: boolean
  faceCount?: number
  faceQuality?: number
}

export class AnalyzerError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message)
  }
}

interface Pending {
  resolve: (value: Record<string, unknown>) => void
  reject: (error: Error) => void
}

export class Analyzer {
  private proc: ChildProcessWithoutNullStreams | null = null
  private pending = new Map<number, Pending>()
  private nextId = 1
  workers = 4

  constructor(private readonly label: string) {}

  private ensure(): ChildProcessWithoutNullStreams {
    if (this.proc) return this.proc
    const proc = spawn(analyzerBinary(), [], { stdio: ['pipe', 'pipe', 'pipe'] })
    proc.stderr.on('data', (d) => console.warn(`[analyzer:${this.label}]`, String(d).trim()))
    createInterface({ input: proc.stdout }).on('line', (line) => {
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(line)
      } catch {
        return
      }
      const p = this.pending.get(msg.id as number)
      if (!p) return
      this.pending.delete(msg.id as number)
      if (msg.ok) p.resolve(msg)
      else p.reject(new AnalyzerError(String(msg.error ?? 'Analyzer error'), String(msg.code ?? 'failed')))
    })
    const fail = (reason: string): void => {
      if (this.proc !== proc) return
      this.proc = null
      for (const p of this.pending.values()) p.reject(new AnalyzerError(reason, 'crashed'))
      this.pending.clear()
    }
    proc.on('exit', (code, signal) => fail(`Analyzer exited (${signal ?? code})`))
    proc.on('error', (err) => fail(`Analyzer failed to start: ${err.message}`))
    proc.stdin.on('error', () => {})
    this.proc = proc
    return proc
  }

  private request<T>(op: string, payload: Record<string, unknown> = {}): Promise<T> {
    const proc = this.ensure()
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as Pending['resolve'], reject })
      proc.stdin.write(JSON.stringify({ id, op, ...payload }) + '\n')
    })
  }

  async start(): Promise<void> {
    const info = await this.request<{ workers: number }>('ping')
    this.workers = info.workers
  }

  analyze(path: string, kind: string, thumb: string, vision: boolean): Promise<AnalyzeResult> {
    return this.request('analyze', { path, kind, thumb, vision })
  }

  async sha(path: string): Promise<string> {
    return (await this.request<{ sha: string }>('sha', { path })).sha
  }

  preview(path: string, kind: string, out: string, max = 2560): Promise<{ width: number; height: number }> {
    return this.request('preview', { path, kind, out, max })
  }

  async trash(path: string): Promise<string | null> {
    return (await this.request<{ trashedPath: string | null }>('trash', { path })).trashedPath
  }

  stop(): void {
    this.proc?.stdin.end()
    this.proc = null
  }
}

/** Long-running bulk work (scans). */
export const bulk = new Analyzer('bulk')
/** Anything the user is waiting on right now (previews, trash), so it never queues behind a scan. */
export const interactive = new Analyzer('interactive')
