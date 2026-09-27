import type { MediaDetails, MediaItem } from '@shared/types'
import clsx from 'clsx'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronLeft, ChevronRight, ExternalLink, FolderSearch, Info, Trash2, Undo2, X } from 'lucide-react'
import { useState } from 'react'
import { canPlay, mediaUrl, sift, useDetails } from '@/lib/api'
import { bytes, dateTime, duration, megapixels } from '@/lib/format'
import { Layer, useHotkeys } from '@/lib/hooks'
import { useStore } from '@/lib/store'
import { Button, IconButton, Kbd } from './ui'
import { ZoomImage } from './ZoomImage'

function Meter({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="text-dim">{hint}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(Math.max(0.03, Math.min(1, value)) * 100)}%` }} />
      </div>
    </div>
  )
}

/** Maps the raw focus score (variance of Laplacian) onto 0…1 for display. */
export const focusLevel = (sharpness: number | null): number => (sharpness == null ? 0 : Math.min(1, Math.log10(1 + sharpness) / 3.5))

function InfoPanel({ d }: { d: MediaDetails }) {
  const rows: [string, string | null][] = [
    ['Taken', `${dateTime(d.takenAt)}${d.dateSource === 'file' ? ' (file date)' : ''}`],
    ['Camera', d.camera],
    ['Size', `${d.width ?? '?'} × ${d.height ?? '?'} · ${megapixels(d.width, d.height)} · ${bytes(d.size)}`],
    ['Length', d.duration ? duration(d.duration) : null],
    ['Location', d.lat != null && d.lon != null ? `${d.lat.toFixed(4)}, ${d.lon.toFixed(4)}` : null],
    ['Source', d.sourceName],
    ['File', d.path]
  ]
  return (
    <div className="scroll-thin flex w-80 shrink-0 flex-col gap-5 overflow-y-auto border-l border-line bg-panel/80 p-5 text-[13px]">
      <dl className="flex flex-col gap-3">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-dim">{k}</dt>
              <dd className="mt-0.5 break-words">{v}</dd>
            </div>
          ))}
      </dl>
      {d.analyzed && (
        <div className="flex flex-col gap-3">
          <div className="text-xs font-semibold tracking-wide text-dim uppercase">Quality</div>
          <Meter label="Focus" value={focusLevel(d.sharpness)} hint={d.sharpness != null ? d.sharpness.toFixed(0) : ''} />
          {d.aesthetic != null && <Meter label="Aesthetic score" value={(d.aesthetic + 1) / 2} hint={d.aesthetic.toFixed(2)} />}
          {!!d.faceCount && <Meter label={`Faces (${d.faceCount})`} value={d.faceQuality ?? 0} hint={(d.faceQuality ?? 0).toFixed(2)} />}
          {d.brightness != null && <Meter label="Brightness" value={d.brightness} hint={`${Math.round(d.brightness * 100)}%`} />}
        </div>
      )}
      {d.labels.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-semibold tracking-wide text-dim uppercase">What’s in it</div>
          <div className="flex flex-wrap gap-1.5">
            {d.labels.slice(0, 12).map((l) => (
              <span key={l.label} className="rounded-full bg-white/[0.07] px-2 py-0.5 text-xs text-fg/85" title={`${Math.round(l.confidence * 100)}%`}>
                {l.label.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </div>
      )}
      {d.error && <div className="rounded-lg bg-remove/10 p-3 text-xs text-remove">Couldn’t analyze: {d.error}</div>}
    </div>
  )
}

function ViewerBody({ items, index }: { items: MediaItem[]; index: number }) {
  const setIndex = useStore((s) => s.setViewerIndex)
  const close = useStore((s) => s.closeViewer)
  const [info, setInfo] = useState(true)
  const item = items[index]
  const { data: details } = useDetails(item.id)
  const flagged = details?.flagged ?? item.flagged
  const kept = details?.kept ?? item.kept

  const go = (d: number): void => setIndex(Math.max(0, Math.min(items.length - 1, index + d)))
  const toggleFlag = (): void => {
    void sift.setFlagged([item.id], !flagged)
    if (!flagged) go(1)
  }
  const keep = (): void => {
    void (kept ? sift.clearDecision([item.id]) : sift.keep([item.id]))
    if (!kept) go(1)
  }

  useHotkeys({
    ArrowLeft: () => go(-1),
    ArrowRight: () => go(1),
    Escape: close,
    Backspace: toggleFlag,
    Delete: toggleFlag,
    k: keep,
    i: () => setInfo((v) => !v),
    r: () => void sift.revealInFinder(item.id)
  }, Layer.overlay)

  const video = item.kind === 'video'
  return (
    <motion.div
      className="fixed inset-0 z-40 flex flex-col bg-black/95 backdrop-blur-xl"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      <div className="drag flex h-[52px] shrink-0 items-center gap-3 pr-3 pl-24">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">{item.name}</div>
          <div className="text-xs text-dim tabular">
            {dateTime(item.takenAt)} · {index + 1} of {items.length}
          </div>
        </div>
        <IconButton icon={FolderSearch} label="Show in Finder (R)" onClick={() => void sift.revealInFinder(item.id)} />
        <IconButton icon={ExternalLink} label="Open in default app" onClick={() => void sift.openExternally(item.id)} />
        <IconButton icon={Info} label="Info (I)" active={info} onClick={() => setInfo((v) => !v)} />
        <IconButton icon={X} label="Close (Esc)" onClick={close} />
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {video && canPlay(item) ? (
            <video key={item.id} src={mediaUrl(item)} controls autoPlay className="size-full object-contain" />
          ) : (
            <ZoomImage key={item.id} item={item} still={video} />
          )}
          {index > 0 && (
            <button onClick={() => go(-1)} className="absolute top-1/2 left-3 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-black/40 text-white/80 hover:bg-black/70" aria-label="Previous">
              <ChevronLeft size={22} />
            </button>
          )}
          {index < items.length - 1 && (
            <button onClick={() => go(1)} className="absolute top-1/2 right-3 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-black/40 text-white/80 hover:bg-black/70" aria-label="Next">
              <ChevronRight size={22} />
            </button>
          )}
        </div>
        {info && details && <InfoPanel d={details} />}
      </div>

      <div className="flex h-16 shrink-0 items-center justify-center gap-3 border-t border-white/5">
        <Button variant={flagged ? 'subtle' : 'danger'} icon={flagged ? Undo2 : Trash2} onClick={toggleFlag}>
          {flagged ? 'Put back' : 'Remove'} <Kbd>⌫</Kbd>
        </Button>
        <Button variant={kept ? 'subtle' : 'keep'} icon={Check} onClick={keep} className={clsx(kept && 'text-ok')}>
          {kept ? 'Kept' : 'Keep'} <Kbd>K</Kbd>
        </Button>
        <span className="ml-4 text-xs text-dim">
          <Kbd>←</Kbd> <Kbd>→</Kbd> browse · click to zoom
        </span>
      </div>
    </motion.div>
  )
}

export function Viewer() {
  const viewer = useStore((s) => s.viewer)
  return <AnimatePresence>{viewer && viewer.items[viewer.index] && <ViewerBody items={viewer.items} index={viewer.index} />}</AnimatePresence>
}
