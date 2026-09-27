import type { MediaGroup } from '@shared/types'
import { useVirtualizer } from '@tanstack/react-virtual'
import clsx from 'clsx'
import { Crown, Layers, Play, Wand2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Thumb } from '@/components/Thumb'
import { Button, Chip, Confirm, EmptyState, Loading, ViewHeader } from '@/components/ui'
import { sift, useGroups } from '@/lib/api'
import { bytes, count, dateTime, plural, span } from '@/lib/format'
import { useStore } from '@/lib/store'
import { Cull } from './Cull'

/** Keep the suggestion in each group (plus anything already kept); flag the rest. */
export function suggestedResolutions(groups: MediaGroup[]) {
  return groups.map((g) => {
    const keep = g.members.filter((m) => m.item.id === g.suggestedKeepId || m.item.kept).map((m) => m.item.id)
    return { keep, remove: g.members.filter((m) => !keep.includes(m.item.id)).map((m) => m.item.id) }
  })
}

const CARD = 186
const THUMB = 116

function GroupCard({ g }: { g: MediaGroup }) {
  const openCull = useStore((s) => s.openCull)
  const visible = g.members.slice(0, 8)
  return (
    <div className={clsx('flex h-[172px] flex-col rounded-2xl border border-line bg-panel p-3.5', g.resolved && 'opacity-55')}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <span className="text-[13px] font-semibold">{dateTime(g.startAt)}</span>
          <span className="ml-2 text-xs text-muted">
            {plural(g.members.length, 'shot')} {span(g.spanMs)}
            {g.reclaimable > 0 && ` · ${bytes(g.reclaimable)} to free`}
          </span>
        </div>
        {g.resolved ? (
          <span className="text-xs text-ok">Reviewed</span>
        ) : (
          <>
            <Button size="sm" variant="ghost" onClick={() => void sift.keep(g.members.map((m) => m.item.id))}>
              Not similar
            </Button>
            <Button size="sm" onClick={() => void sift.resolve(suggestedResolutions([g]))}>
              Keep best
            </Button>
          </>
        )}
        <Button size="sm" variant="primary" onClick={() => openCull(g.key)}>
          Review
        </Button>
      </div>
      <div className="mt-3 flex gap-2 overflow-hidden" onClick={() => openCull(g.key)}>
        {visible.map((m) => (
          <Thumb key={m.item.id} item={m.item} size={THUMB} className={m.item.id === g.suggestedKeepId ? 'ring-2 ring-keep/80' : undefined}>
            {m.item.id === g.suggestedKeepId && (
              <div className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-keep text-black shadow">
                <Crown size={11} />
              </div>
            )}
          </Thumb>
        ))}
        {g.members.length > visible.length && (
          <div className="grid shrink-0 place-items-center rounded-md bg-white/[0.04] text-sm text-muted" style={{ width: THUMB, height: THUMB }}>
            +{g.members.length - visible.length}
          </div>
        )}
      </div>
    </div>
  )
}

export function Similar() {
  const { data: groups } = useGroups('similar')
  const cullFrom = useStore((s) => s.cullFrom)
  const openCull = useStore((s) => s.openCull)
  const [showResolved, setShowResolved] = useState(false)
  const [confirmAll, setConfirmAll] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)

  const open = useMemo(() => groups?.filter((g) => !g.resolved) ?? [], [groups])
  const list = showResolved ? (groups ?? []) : open
  const virtualizer = useVirtualizer({ count: list.length, getScrollElement: () => scroller.current, estimateSize: () => CARD, overscan: 4 })

  if (!groups) return <Loading />
  if (cullFrom) return <Cull groups={open} startKey={cullFrom} />
  if (!groups.length)
    return (
      <EmptyState icon={Layers} title="No similar shots found">
        When Sift finds bursts or near-identical photos, they’ll show up here. Try a looser “Similarity” in Settings if you expected some.
      </EmptyState>
    )

  const extra = open.reduce((s, g) => s + g.members.length - 1, 0)
  const reclaim = open.reduce((s, g) => s + g.reclaimable, 0)
  const resolutions = suggestedResolutions(open)
  const flagCount = resolutions.reduce((s, r) => s + r.remove.length, 0)

  return (
    <div className="flex h-full flex-col">
      <ViewHeader
        title={open.length ? `${plural(open.length, 'group')} to review` : 'Everything reviewed'}
        subtitle={open.length ? `${count(extra)} extra shots · up to ${bytes(reclaim)} to free` : `${plural(groups.length, 'group')} reviewed`}
      >
        <Chip active={showResolved} onClick={() => setShowResolved((v) => !v)}>
          Show reviewed
        </Chip>
        {open.length > 0 && (
          <>
            <Button icon={Wand2} onClick={() => setConfirmAll(true)}>
              Auto-pick best in all
            </Button>
            <Button variant="primary" icon={Play} onClick={() => openCull(open[0].key)}>
              Start reviewing
            </Button>
          </>
        )}
      </ViewHeader>
      <div ref={scroller} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-6 pt-4">
        <div style={{ height: virtualizer.getTotalSize() + 40, position: 'relative' }}>
          {virtualizer.getVirtualItems().map((v) => (
            <div key={list[v.index].key} style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${v.start}px)` }}>
              <GroupCard g={list[v.index]} />
            </div>
          ))}
        </div>
      </div>
      <Confirm
        open={confirmAll}
        onClose={() => setConfirmAll(false)}
        title={`Keep the best shot in all ${plural(open.length, 'group')}?`}
        confirmLabel={`Move ${count(flagCount)} to Review Bin`}
        onConfirm={() => void sift.resolve(resolutions)}
      >
        Sift will keep the highest-scoring photo of each group and put the other {count(flagCount)} ({bytes(reclaim)}) in the Review Bin.
        Nothing is deleted until you empty the Review Bin, and you can put anything back.
      </Confirm>
    </div>
  )
}
