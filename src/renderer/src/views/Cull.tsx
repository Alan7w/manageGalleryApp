// Culling: review one group of similar shots at a time. The best shot is
// pre-selected; confirm with ⏎ and the rest go to the Review Bin.

import type { GroupMember, MediaGroup } from '@shared/types'
import clsx from 'clsx'
import { motion } from 'motion/react'
import { ArrowLeft, Check, CheckCheck, Columns2, Crown, PartyPopper, Trash2, Undo2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Thumb } from '@/components/Thumb'
import { Button, IconButton, Kbd } from '@/components/ui'
import { focusLevel } from '@/components/Viewer'
import { NO_ZOOM, ZoomImage, type ZoomState } from '@/components/ZoomImage'
import { sift } from '@/lib/api'
import { bytes, dateTime, megapixels, plural, span } from '@/lib/format'
import { Layer, useHotkeys } from '@/lib/hooks'
import { useStore } from '@/lib/store'

/** Start from the suggestion, plus anything the user already chose to keep. */
function defaultKeep(g: MediaGroup): Set<number> {
  const kept = g.members.filter((m) => m.item.kept || (m.item.id === g.suggestedKeepId && !m.item.flagged)).map((m) => m.item.id)
  return new Set(kept.length ? kept : [g.suggestedKeepId])
}

function Badges({ member, className }: { member: GroupMember; className?: string }) {
  return (
    <div className={clsx('flex flex-wrap gap-1', className)}>
      {member.badges.map((b) => (
        <span
          key={b.label}
          className={clsx(
            'rounded-full px-2 py-0.5 text-[11px] font-medium',
            b.tone === 'good' ? 'bg-keep/15 text-keep' : 'bg-remove/15 text-remove'
          )}
        >
          {b.label}
        </span>
      ))}
    </div>
  )
}

function Pane({
  member,
  label,
  kept,
  best,
  zoom,
  onZoom
}: {
  member: GroupMember
  label?: string
  kept: boolean
  best: boolean
  zoom: ZoomState
  onZoom: (z: ZoomState) => void
}) {
  return (
    <div className={clsx('relative min-w-0 flex-1 overflow-hidden rounded-xl bg-black/40 ring-2 transition-shadow', kept ? 'ring-keep/70' : 'ring-remove/50')}>
      <ZoomImage item={member.item} zoom={zoom} onZoom={onZoom} still={member.item.kind === 'video'} />
      <div className="pointer-events-none absolute top-3 left-3 flex items-center gap-2">
        {label && <span className="rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium backdrop-blur">{label}</span>}
        {best && (
          <span className="flex items-center gap-1 rounded-full bg-keep px-2.5 py-1 text-xs font-semibold text-black">
            <Crown size={12} /> Best pick
          </span>
        )}
        <span className={clsx('rounded-full px-2.5 py-1 text-xs font-semibold backdrop-blur', kept ? 'bg-black/60 text-keep' : 'bg-remove/90 text-white')}>
          {kept ? 'Keep' : 'Remove'}
        </span>
      </div>
    </div>
  )
}

function Stat({ label, value, level }: { label: string; value: string; level?: number }) {
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="tabular">{value}</span>
      </div>
      {level != null && (
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(Math.max(0.03, Math.min(1, level)) * 100)}%` }} />
        </div>
      )}
    </div>
  )
}

export function Cull({ groups: initial, startKey }: { groups: MediaGroup[]; startKey: string }) {
  const exit = useStore((s) => s.closeCull)
  const go = useStore((s) => s.go)
  // A snapshot: the list must not shift under the user while groups get resolved.
  const [groups] = useState(initial)
  const [gi, setGi] = useState(() => Math.max(0, groups.findIndex((g) => g.key === startKey)))
  const [keepSets, setKeepSets] = useState<Record<string, Set<number>>>({})
  const [applied, setApplied] = useState<{ key: string; keep: number[]; remove: number[]; bytes: number }[]>([])
  const [compare, setCompare] = useState(false)
  const [zoom, setZoom] = useState<ZoomState>(NO_ZOOM)
  const finished = gi >= groups.length
  const g = groups[Math.min(gi, groups.length - 1)]
  const keepSet = keepSets[g.key] ?? defaultKeep(g)
  const bestIndex = g.members.findIndex((m) => m.item.id === g.suggestedKeepId)
  const [sel, setSel] = useState(bestIndex)
  const strip = useRef<HTMLDivElement>(null)

  // Each new group starts on its best shot, un-zoomed.
  useEffect(() => {
    setSel(Math.max(0, bestIndex))
    setZoom(NO_ZOOM)
  }, [g.key, bestIndex])

  useEffect(() => {
    strip.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [sel])

  const member = g.members[Math.min(sel, g.members.length - 1)]
  const removeList = g.members.filter((m) => !keepSet.has(m.item.id))
  const removeBytes = removeList.reduce((s, m) => s + m.item.size, 0)
  // In compare mode, show the selected shot next to the best one (or the runner-up if the best is selected).
  const other = useMemo(() => {
    if (member.item.id !== g.suggestedKeepId) return g.members[bestIndex]
    const ranked = g.members.filter((m) => m.item.id !== member.item.id).sort((a, b) => b.score - a.score)
    return ranked[0]
  }, [g, member, bestIndex])

  const setKeep = (next: Set<number>): void => setKeepSets((s) => ({ ...s, [g.key]: next }))
  const toggle = (id: number): void => {
    const next = new Set(keepSet)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setKeep(next)
  }

  const apply = async (): Promise<void> => {
    if (finished) return
    const keep = g.members.filter((m) => keepSet.has(m.item.id)).map((m) => m.item.id)
    const remove = removeList.map((m) => m.item.id)
    await sift.resolve([{ keep, remove }])
    setApplied((a) => [...a, { key: g.key, keep, remove, bytes: removeBytes }])
    setGi((i) => i + 1)
  }

  const undo = async (): Promise<void> => {
    const last = applied[applied.length - 1]
    if (!last) return
    await sift.clearDecision([...last.keep, ...last.remove])
    setApplied((a) => a.slice(0, -1))
    setGi(groups.findIndex((x) => x.key === last.key))
  }

  const move = (d: number): void => setSel((s) => Math.max(0, Math.min(g.members.length - 1, s + d)))
  useHotkeys(
    finished
      ? { Escape: exit, 'mod+z': () => void undo() }
      : {
          ArrowLeft: () => move(-1),
          ArrowRight: () => move(1),
          ArrowUp: () => setGi((i) => Math.max(0, i - 1)),
          ArrowDown: () => setGi((i) => Math.min(groups.length, i + 1)),
          ' ': () => toggle(member.item.id),
          b: () => setKeep(new Set([member.item.id])),
          a: () => setKeep(new Set(g.members.map((m) => m.item.id))),
          c: () => setCompare((v) => !v),
          Enter: () => void apply(),
          Escape: exit,
          'mod+z': () => void undo(),
          ...Object.fromEntries(g.members.slice(0, 9).map((_, i) => [String(i + 1), () => setSel(i)]))
        },
    Layer.overlay
  )

  if (finished) {
    const total = applied.reduce((s, a) => s + a.bytes, 0)
    const removed = applied.reduce((s, a) => s + a.remove.length, 0)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-10 text-center">
        <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="grid size-16 place-items-center rounded-2xl bg-keep/15 text-keep">
          <PartyPopper size={30} />
        </motion.div>
        <h2 className="text-2xl font-bold">All caught up</h2>
        <p className="max-w-md text-muted">
          You reviewed {plural(applied.length, 'group')}. {plural(removed, 'photo')} ({bytes(total)}) are waiting in the Review Bin — nothing
          has been deleted yet.
        </p>
        <div className="mt-2 flex gap-2">
          {applied.length > 0 && (
            <Button icon={Undo2} onClick={() => void undo()}>
              Undo last <Kbd>⌘Z</Kbd>
            </Button>
          )}
          <Button onClick={exit}>Back to groups</Button>
          <Button variant="danger" icon={Trash2} onClick={() => go('bin')}>
            Open Review Bin
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={exit}>
          Groups
        </Button>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold tabular">
            Group {gi + 1} of {groups.length}
          </div>
          <div className="text-xs text-muted">
            {dateTime(g.startAt)} · {plural(g.members.length, 'shot')} {span(g.spanMs)}
          </div>
        </div>
        <div className="mx-4 h-1 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
          <motion.div className="h-full bg-accent" animate={{ width: `${(gi / groups.length) * 100}%` }} />
        </div>
        <IconButton icon={Columns2} label="Compare side by side (C)" active={compare} onClick={() => setCompare((v) => !v)} />
      </div>

      {/* Stage */}
      <div className="flex min-h-0 flex-1 gap-4 p-4">
        <div className="flex min-w-0 flex-1 gap-3">
          <Pane member={member} label={compare ? 'Selected' : undefined} kept={keepSet.has(member.item.id)} best={member.item.id === g.suggestedKeepId} zoom={zoom} onZoom={setZoom} />
          {compare && other && (
            <Pane member={other} label={other.item.id === g.suggestedKeepId ? undefined : 'Runner-up'} kept={keepSet.has(other.item.id)} best={other.item.id === g.suggestedKeepId} zoom={zoom} onZoom={setZoom} />
          )}
        </div>

        <aside className="scroll-thin flex w-64 shrink-0 flex-col gap-4 overflow-y-auto">
          <div>
            <div className="truncate text-[13px] font-semibold" title={member.item.name}>
              {member.item.name}
            </div>
            <div className="text-xs text-muted">{dateTime(member.item.takenAt)}</div>
          </div>
          <div className="rounded-xl bg-white/[0.04] p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-muted">Shot score</span>
              <span className="text-2xl font-bold tabular">{Math.round(member.score * 100)}</span>
            </div>
            <Badges member={member} className="mt-2" />
          </div>
          <div className="flex flex-col gap-3">
            <Stat label="Focus" value={member.item.sharpness?.toFixed(0) ?? '—'} level={focusLevel(member.item.sharpness)} />
            {member.item.aesthetic != null && <Stat label="Composition" value={member.item.aesthetic.toFixed(2)} level={(member.item.aesthetic + 1) / 2} />}
            {!!member.item.faceCount && <Stat label={`Faces (${member.item.faceCount})`} value={(member.item.faceQuality ?? 0).toFixed(2)} level={member.item.faceQuality ?? 0} />}
            <Stat label="Resolution" value={megapixels(member.item.width, member.item.height) || '—'} />
            <Stat label="File size" value={bytes(member.item.size)} />
          </div>
          <Button
            variant={keepSet.has(member.item.id) ? 'subtle' : 'keep'}
            icon={keepSet.has(member.item.id) ? X : Check}
            onClick={() => toggle(member.item.id)}
          >
            {keepSet.has(member.item.id) ? 'Mark for removal' : 'Keep this one'} <Kbd>Space</Kbd>
          </Button>
          <div className="mt-auto flex flex-col gap-1.5 text-xs text-dim">
            <div><Kbd>←</Kbd> <Kbd>→</Kbd> choose shot · <Kbd>1</Kbd>–<Kbd>9</Kbd> jump</div>
            <div><Kbd>B</Kbd> keep only this · <Kbd>A</Kbd> keep all</div>
            <div><Kbd>↑</Kbd> <Kbd>↓</Kbd> skip group · <Kbd>C</Kbd> compare</div>
            <div>Click the photo to zoom to 100%</div>
          </div>
        </aside>
      </div>

      {/* Filmstrip */}
      <div ref={strip} className="scroll-thin flex shrink-0 gap-2 overflow-x-auto px-4 pb-3">
        {g.members.map((m, i) => {
          const kept = keepSet.has(m.item.id)
          return (
            <div key={m.item.id} data-i={i} className="relative shrink-0">
              <Thumb
                item={{ ...m.item, flagged: false, kept: false }}
                size={96}
                onClick={() => setSel(i)}
                onDoubleClick={() => toggle(m.item.id)}
                className={clsx('ring-2 transition-all', i === sel ? 'ring-white' : kept ? 'ring-keep/70' : 'ring-transparent', !kept && 'opacity-45')}
              >
                {m.item.id === g.suggestedKeepId && (
                  <div className="absolute top-1 left-1 grid size-5 place-items-center rounded-full bg-keep text-black">
                    <Crown size={11} />
                  </div>
                )}
                {!kept && (
                  <div className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-remove text-white">
                    <X size={11} strokeWidth={3} />
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
                  <div className="h-full bg-keep" style={{ width: `${Math.round(m.score * 100)}%` }} />
                </div>
              </Thumb>
            </div>
          )
        })}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 border-t border-line px-4 py-3">
        <div className="mr-auto text-[13px] tabular">
          Keep <b className="text-keep">{keepSet.size}</b> · Remove <b className="text-remove">{removeList.length}</b>
          {removeBytes > 0 && <span className="text-muted"> · frees {bytes(removeBytes)}</span>}
          {keepSet.size === 0 && <span className="ml-2 text-warn">Nothing kept from this group</span>}
        </div>
        {applied.length > 0 && (
          <Button variant="ghost" icon={Undo2} onClick={() => void undo()}>
            Undo <Kbd>⌘Z</Kbd>
          </Button>
        )}
        <Button icon={CheckCheck} onClick={() => setKeep(new Set(g.members.map((m) => m.item.id)))}>
          Keep all <Kbd>A</Kbd>
        </Button>
        <Button variant="primary" onClick={() => void apply()}>
          {removeList.length ? `Confirm & next` : 'Keep all & next'} <Kbd>⏎</Kbd>
        </Button>
      </div>
    </div>
  )
}
