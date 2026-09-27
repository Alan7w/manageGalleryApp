export function bytes(n: number, digits = 1): string {
  if (!n) return '0 KB'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  const v = n / 1024 ** i
  return `${v.toFixed(i <= 1 ? 0 : v >= 100 ? 0 : digits)} ${units[i]}`
}

const nf = new Intl.NumberFormat()
export const count = (n: number): string => nf.format(n)

export const plural = (n: number, one: string, many = `${one}s`): string => `${count(n)} ${n === 1 ? one : many}`

const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })
export const monthYear = (t: number): string => monthFmt.format(t)

const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
export const date = (t: number): string => dateFmt.format(t)

const dateTimeFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
export const dateTime = (t: number): string => dateTimeFmt.format(t)

export function duration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return ''
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`
}

export function span(ms: number): string {
  if (ms < 1000) return 'within a second'
  if (ms < 60_000) return `in ${Math.round(ms / 1000)} s`
  if (ms < 3_600_000) return `over ${Math.round(ms / 60_000)} min`
  if (ms < 48 * 3_600_000) return `over ${Math.round(ms / 3_600_000)} h`
  if (ms < 60 * 86_400_000) return `over ${Math.round(ms / 86_400_000)} days`
  return 'from different dates'
}

export function eta(sec: number | null): string {
  if (sec == null) return ''
  if (sec < 60) return 'less than a minute left'
  if (sec < 3600) return `about ${Math.round(sec / 60)} min left`
  return `about ${(sec / 3600).toFixed(1)} h left`
}

export function ago(t: number): string {
  const s = (Date.now() - t) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return date(t)
}

export const megapixels = (w: number | null, h: number | null): string =>
  w && h ? `${((w * h) / 1e6).toFixed(w * h >= 1e7 ? 0 : 1)} MP` : ''
