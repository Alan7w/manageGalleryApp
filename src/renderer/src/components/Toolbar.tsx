import clsx from 'clsx'
import { CheckCircle2, Pause, Play, RefreshCw, Search, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { sift } from '@/lib/api'
import { count, eta } from '@/lib/format'
import { useHotkeys } from '@/lib/hooks'
import { useStore, type View } from '@/lib/store'
import { IconButton, Slider } from './ui'

const TITLES: Record<View, string> = {
  overview: 'Overview',
  library: 'Library',
  duplicates: 'Duplicates',
  similar: 'Similar & Bursts',
  blurry: 'Blurry Photos',
  junk: 'Junk',
  videos: 'Large Videos',
  bin: 'Review Bin',
  search: 'Search',
  settings: 'Settings'
}

const GRID_VIEWS: View[] = ['library', 'blurry', 'junk', 'bin', 'search']

function ProgressPill() {
  const p = useStore((s) => s.progress)
  const busy = p.phase !== 'idle'
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0
  const label =
    p.phase === 'scanning'
      ? `Scanning${p.detail ? ` ${p.detail}` : ''} · ${count(p.found)} found`
      : p.phase === 'analyzing'
        ? `Analyzing ${count(p.done)} of ${count(p.total)}`
        : p.phase === 'hashing'
          ? `Checking duplicates ${count(p.done)} of ${count(p.total)}`
          : 'Up to date'

  return (
    <div
      className={clsx('no-drag flex h-8 items-center gap-2 rounded-full border border-line pr-1 pl-3 text-xs', busy ? 'text-fg' : 'text-muted')}
      title={p.phase === 'analyzing' && !p.paused ? `${p.rate.toFixed(1)} items/s · ${eta(p.etaSec)}` : undefined}
    >
      {busy ? (
        <span className="relative grid size-4 place-items-center">
          <svg viewBox="0 0 20 20" className="size-4 -rotate-90">
            <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="2.5" />
            <circle
              cx="10"
              cy="10"
              r="8"
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth="2.5"
              strokeDasharray={`${(p.phase === 'scanning' ? 25 : pct) * 0.5027} 50.27`}
              strokeLinecap="round"
              className={p.phase === 'scanning' ? 'origin-center animate-spin' : ''}
            />
          </svg>
        </span>
      ) : (
        <CheckCircle2 size={14} className="text-ok" />
      )}
      <span className="max-w-[260px] truncate tabular">
        {p.paused ? 'Paused · ' : ''}
        {label}
      </span>
      {busy ? (
        <IconButton
          icon={p.paused ? Play : Pause}
          label={p.paused ? 'Resume' : 'Pause'}
          className="size-6"
          onClick={() => void sift.setPaused(!p.paused)}
        />
      ) : (
        <IconButton icon={RefreshCw} label="Scan again for changes" className="size-6" onClick={() => void sift.rescan()} />
      )}
    </div>
  )
}

function SearchField() {
  const query = useStore((s) => s.query)
  const setQuery = useStore((s) => s.setQuery)
  const [text, setText] = useState(query)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => setText(query), [query])
  useEffect(() => {
    const t = setTimeout(() => text !== query && setQuery(text), 250)
    return () => clearTimeout(t)
  }, [text, query, setQuery])
  useHotkeys({ 'mod+f': () => input.current?.focus() })
  return (
    <label className="no-drag flex h-8 w-64 items-center gap-2 rounded-lg bg-white/[0.06] px-2.5 text-muted focus-within:bg-white/[0.09] focus-within:text-fg">
      <Search size={14} />
      <input
        ref={input}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setText('')
            setQuery('')
            input.current?.blur()
          }
        }}
        placeholder="Search “beach”, “dog”, “2024”…"
        className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-dim"
      />
      {text && (
        <button onClick={() => (setText(''), setQuery(''))} aria-label="Clear search">
          <X size={13} />
        </button>
      )}
    </label>
  )
}

export function Toolbar() {
  const view = useStore((s) => s.view)
  const tileSize = useStore((s) => s.tileSize)
  const setTileSize = useStore((s) => s.setTileSize)
  const zoom = (d: number): void => setTileSize(Math.max(90, Math.min(360, tileSize + d)))
  useHotkeys({ 'mod+=': () => zoom(30), 'mod++': () => zoom(30), 'mod+-': () => zoom(-30) })

  return (
    <header className="drag flex h-[52px] shrink-0 items-center gap-3 border-b border-line px-5">
      <h1 className="mr-auto text-[15px] font-semibold">{TITLES[view]}</h1>
      {GRID_VIEWS.includes(view) && (
        <div className="no-drag flex items-center gap-1.5 text-muted">
          <ZoomOut size={13} />
          <Slider value={tileSize} min={90} max={360} step={10} onChange={setTileSize} className="w-20" />
          <ZoomIn size={13} />
        </div>
      )}
      <ProgressPill />
      <SearchField />
    </header>
  )
}
