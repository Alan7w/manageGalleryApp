import type { MediaGroup } from '@shared/types'
import { useVirtualizer } from '@tanstack/react-virtual'
import clsx from 'clsx'
import { Copy, FolderSearch, Wand2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Thumb } from '@/components/Thumb'
import { Button, Chip, Confirm, EmptyState, IconButton, Loading, ViewHeader } from '@/components/ui'
import { sift, useGroups } from '@/lib/api'
import { bytes, count, date, plural } from '@/lib/format'
import { useStore } from '@/lib/store'
import { suggestedResolutions } from './Similar'

function DuplicateCard({ g }: { g: MediaGroup }) {
  const openViewer = useStore((s) => s.openViewer)
  const [keeper, setKeeper] = useState(g.suggestedKeepId)
  const first = (g.members.find((m) => m.item.id === keeper) ?? g.members[0]).item
  const others = g.members.filter((m) => m.item.id !== keeper)
  return (
    <div className={clsx('flex gap-4 rounded-2xl border border-line bg-panel p-4', g.resolved && 'opacity-55')}>
      <Thumb item={first} size={104} onClick={() => openViewer([first], 0)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold">{first.name}</div>
            <div className="text-xs text-muted">
              {plural(g.members.length, 'identical copy', 'identical copies')} · {bytes(first.size)} each
            </div>
          </div>
          {!g.resolved && (
            <Button
              size="sm"
              variant="primary"
              onClick={() => void sift.resolve([{ keep: [keeper], remove: others.map((m) => m.item.id) }])}
            >
              Remove {plural(others.length, 'copy', 'copies')}
            </Button>
          )}
        </div>
        <div className="mt-3 flex flex-col gap-1">
          {g.members.map((m) => {
            const isKeeper = m.item.id === keeper
            return (
              <label
                key={m.item.id}
                className={clsx('group flex items-center gap-3 rounded-lg px-2.5 py-1.5', isKeeper ? 'bg-keep/10' : 'hover:bg-white/[0.04]')}
              >
                <input type="radio" name={g.key} checked={isKeeper} onChange={() => setKeeper(m.item.id)} className="accent-keep" disabled={g.resolved} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px]" title={m.location}>
                    {m.location}
                  </div>
                  <div className="truncate text-[11px] text-dim">
                    {m.item.name} · taken {date(m.item.takenAt)}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  {m.badges.map((b) => (
                    <span key={b.label} className={clsx('rounded-full px-2 py-0.5 text-[11px]', b.tone === 'good' ? 'bg-keep/15 text-keep' : 'bg-white/[0.06] text-muted')}>
                      {b.label}
                    </span>
                  ))}
                </div>
                <span className={clsx('w-16 text-right text-xs font-medium', isKeeper ? 'text-keep' : m.item.flagged ? 'text-remove' : 'text-dim')}>
                  {isKeeper ? 'Keep' : m.item.flagged ? 'In bin' : 'Remove'}
                </span>
                <IconButton icon={FolderSearch} label="Show in Finder" className="size-6 opacity-0 group-hover:opacity-100" onClick={() => void sift.revealInFinder(m.item.id)} />
              </label>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function Duplicates() {
  const { data: groups } = useGroups('duplicate')
  const [showResolved, setShowResolved] = useState(false)
  const [confirmAll, setConfirmAll] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const open = useMemo(() => groups?.filter((g) => !g.resolved) ?? [], [groups])
  const list = showResolved ? (groups ?? []) : open
  const virtualizer = useVirtualizer({
    count: list.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => 90 + list[i].members.length * 44,
    overscan: 4
  })

  if (!groups) return <Loading />
  if (!groups.length)
    return (
      <EmptyState icon={Copy} title="No duplicates">
        No file is saved twice across your sources. Sift checks byte-for-byte, so this is certain.
      </EmptyState>
    )

  const reclaim = open.reduce((s, g) => s + g.reclaimable, 0)
  const resolutions = suggestedResolutions(open)
  const copies = resolutions.reduce((s, r) => s + r.remove.length, 0)

  return (
    <div className="flex h-full flex-col">
      <ViewHeader
        title={open.length ? `${plural(open.length, 'file')} saved more than once` : 'No duplicates left'}
        subtitle={open.length ? `${plural(copies, 'extra copy', 'extra copies')} · ${bytes(reclaim)} to free` : undefined}
      >
        <Chip active={showResolved} onClick={() => setShowResolved((v) => !v)}>
          Show reviewed
        </Chip>
        {open.length > 0 && (
          <Button variant="primary" icon={Wand2} onClick={() => setConfirmAll(true)}>
            Keep one of each
          </Button>
        )}
      </ViewHeader>
      <div ref={scroller} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-6 pt-4">
        <div style={{ height: virtualizer.getTotalSize() + 40, position: 'relative' }}>
          {virtualizer.getVirtualItems().map((v) => (
            <div
              key={list[v.index].key}
              ref={virtualizer.measureElement}
              data-index={v.index}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${v.start}px)` }}
              className="pb-3"
            >
              <DuplicateCard g={list[v.index]} />
            </div>
          ))}
        </div>
      </div>
      <Confirm
        open={confirmAll}
        onClose={() => setConfirmAll(false)}
        title="Keep one copy of every duplicate?"
        confirmLabel={`Move ${count(copies)} copies to Review Bin`}
        onConfirm={() => void sift.resolve(resolutions)}
      >
        For each file, Sift keeps the copy in your main library with its original name (the one marked “Keep”) and puts the other{' '}
        {count(copies)} identical copies ({bytes(reclaim)}) in the Review Bin. The copies are byte-for-byte identical, so no photo is lost.
      </Confirm>
    </div>
  )
}
