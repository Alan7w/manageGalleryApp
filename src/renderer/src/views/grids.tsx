// The grid-based views: Library, Blurry, Junk, Search and the Review Bin.

import type { JunkItem, JunkReason, MediaItem } from '@shared/types'
import { Focus, Ghost, Images, Search as SearchIcon, Trash2, Undo2, type LucideIcon } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { PhotoGrid } from '@/components/PhotoGrid'
import { SelectionBar } from '@/components/SelectionBar'
import { Button, Chip, Confirm, EmptyState, Loading, Slider, ViewHeader } from '@/components/ui'
import { flag, moveToTrash } from '@/lib/actions'
import { sift, useBlurry, useJunk, useMedia, useReviewBin, useSearch, useSettings, useSources, useTrashHistory } from '@/lib/api'
import { ago, bytes, count, plural } from '@/lib/format'
import { useSelection } from '@/lib/hooks'
import { useStore } from '@/lib/store'

const total = (items: MediaItem[]): number => items.reduce((s, i) => s + i.size, 0)

function GridScreen({
  items,
  header,
  empty,
  sections,
  overlay,
  mode
}: {
  items: MediaItem[] | undefined
  header: ReactNode
  empty: { icon: LucideIcon; title: string; text: ReactNode }
  sections?: boolean
  overlay?: (item: MediaItem) => ReactNode
  mode?: 'default' | 'bin'
}) {
  const selection = useSelection(items)
  if (!items) return <Loading />
  return (
    <div className="relative flex h-full flex-col">
      {header}
      <div className="min-h-0 flex-1">
        {items.length ? (
          <PhotoGrid items={items} sections={sections} selection={selection} overlay={overlay} />
        ) : (
          <EmptyState icon={empty.icon} title={empty.title}>
            {empty.text}
          </EmptyState>
        )}
      </div>
      <SelectionBar items={items} selection={selection} mode={mode} />
    </div>
  )
}

// ─── Library ───────────────────────────────────────────────────────────────

export function Library() {
  const [kind, setKind] = useState<'image' | 'video' | undefined>()
  const [sourceId, setSourceId] = useState<number | undefined>()
  const { data: items } = useMedia({ kind, sourceId })
  const { data: sources } = useSources()
  return (
    <GridScreen
      items={items}
      sections
      header={
        <div className="flex items-center gap-2 px-6 pt-4 pb-1">
          <Chip active={!kind} onClick={() => setKind(undefined)}>All</Chip>
          <Chip active={kind === 'image'} onClick={() => setKind('image')}>Photos</Chip>
          <Chip active={kind === 'video'} onClick={() => setKind('video')}>Videos</Chip>
          {sources && sources.length > 1 && (
            <select
              value={sourceId ?? ''}
              onChange={(e) => setSourceId(e.target.value ? Number(e.target.value) : undefined)}
              className="ml-2 h-7 rounded-full border border-line-strong bg-transparent px-3 text-xs text-muted outline-none"
            >
              <option value="">All sources</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          <span className="ml-auto text-xs text-dim tabular">{items && `${count(items.length)} items · ${bytes(total(items))}`}</span>
        </div>
      }
      empty={{ icon: Images, title: 'Nothing here yet', text: 'Photos appear here as soon as Sift finds them in your sources.' }}
    />
  )
}

// ─── Blurry ────────────────────────────────────────────────────────────────

export function Blurry() {
  const { data: items } = useBlurry()
  const { data: settings } = useSettings()
  const [threshold, setThreshold] = useState<number | null>(null)
  const value = threshold ?? settings?.blurThreshold ?? 20
  return (
    <GridScreen
      items={items}
      header={
        <ViewHeader
          title={items ? `${plural(items.length, 'blurry photo')}` : 'Blurry photos'}
          subtitle={items && items.length > 0 ? `Blurriest first · ${bytes(total(items))} · select to remove or keep` : undefined}
        >
          <div className="flex items-center gap-2 text-xs text-muted">
            Only very blurry
            <Slider
              value={value}
              min={5}
              max={80}
              step={1}
              onChange={setThreshold}
              className="w-32"
            />
            Somewhat soft
            <Button size="sm" disabled={threshold == null || threshold === settings?.blurThreshold} onClick={() => void sift.updateSettings({ blurThreshold: value })}>
              Apply
            </Button>
          </div>
          {items && items.length > 0 && (
            <Button variant="danger" icon={Trash2} onClick={() => void flag(items.map((i) => i.id), total(items))}>
              Remove all {count(items.length)}
            </Button>
          )}
        </ViewHeader>
      }
      empty={{ icon: Focus, title: 'No blurry photos', text: 'Nothing falls below the focus threshold. Move the slider to be stricter.' }}
    />
  )
}

// ─── Junk ──────────────────────────────────────────────────────────────────

const JUNK_LABELS: Record<JunkReason, string> = {
  screenshot: 'Screenshots',
  accidental: 'Accidental & dark',
  document: 'Documents & receipts',
  tiny: 'Tiny images'
}

export function Junk() {
  const { data } = useJunk()
  const [reason, setReason] = useState<JunkReason | null>(null)
  const items = useMemo(() => (reason ? data?.filter((i) => i.reasons.includes(reason)) : data), [data, reason])
  const counts = useMemo(() => {
    const c: Partial<Record<JunkReason, number>> = {}
    for (const i of data ?? []) for (const r of i.reasons) c[r] = (c[r] ?? 0) + 1
    return c
  }, [data])
  return (
    <GridScreen
      items={items}
      overlay={(item) => (
        <div className="absolute inset-x-1.5 bottom-1.5 flex flex-wrap gap-1">
          {(item as JunkItem).reasons.map((r) => (
            <span key={r} className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur">
              {JUNK_LABELS[r]}
            </span>
          ))}
        </div>
      )}
      header={
        <ViewHeader title={items ? plural(items.length, 'item') : 'Junk'} subtitle={items ? `${bytes(total(items))} · review and remove what you don’t need` : undefined}>
          <div className="flex flex-wrap gap-1.5">
            <Chip active={!reason} onClick={() => setReason(null)} count={data?.length}>
              All
            </Chip>
            {(Object.keys(JUNK_LABELS) as JunkReason[]).map((r) => (
              <Chip key={r} active={reason === r} onClick={() => setReason(r)} count={counts[r] ?? 0}>
                {JUNK_LABELS[r]}
              </Chip>
            ))}
          </div>
          {items && items.length > 0 && (
            <Button variant="danger" icon={Trash2} onClick={() => void flag(items.map((i) => i.id), total(items))}>
              Remove {count(items.length)}
            </Button>
          )}
        </ViewHeader>
      }
      empty={{ icon: Ghost, title: 'No junk found', text: 'No screenshots, pocket shots, receipts or tiny images waiting for review.' }}
    />
  )
}

// ─── Search ────────────────────────────────────────────────────────────────

const SUGGESTIONS = ['beach', 'sunset', 'food', 'dog', 'cat', 'people', 'snow', 'city', 'document', 'screenshots', 'videos', String(new Date().getFullYear() - 1)]

export function Search() {
  const query = useStore((s) => s.query)
  const setQuery = useStore((s) => s.setQuery)
  const { data: items, isFetching } = useSearch(query)
  return (
    <GridScreen
      items={query ? items : []}
      header={
        <div className="flex flex-wrap items-center gap-1.5 px-6 pt-4 pb-2">
          <span className="mr-2 text-[13px]">
            {query ? (isFetching && !items ? 'Searching…' : `${plural(items?.length ?? 0, 'result')} for “${query}”`) : 'Try:'}
          </span>
          {SUGGESTIONS.map((s) => (
            <Chip key={s} active={query === s} onClick={() => setQuery(s)}>
              {s}
            </Chip>
          ))}
        </div>
      }
      empty={{
        icon: SearchIcon,
        title: query ? 'No matches' : 'Search your library',
        text: query
          ? 'Sift searches what it recognized in each photo, plus dates, cameras and folder names. Photos still being analyzed can’t be found yet.'
          : 'Describe what’s in a photo — “beach”, “dog”, “birthday” — or type a year, a month, a camera or a folder name.'
      }}
    />
  )
}

// ─── Review Bin ────────────────────────────────────────────────────────────

export function ReviewBin() {
  const { data } = useReviewBin()
  // Everything here is flagged; show the photos normally rather than greyed out.
  const items = useMemo(() => data?.map((i) => ({ ...i, flagged: false })), [data])
  const { data: history } = useTrashHistory()
  const [confirm, setConfirm] = useState(false)
  const size = items ? total(items) : 0
  return (
    <GridScreen
      items={items}
      mode="bin"
      header={
        <>
          <ViewHeader
            title={items?.length ? `${plural(items.length, 'item')} marked for removal` : 'Review Bin is empty'}
            subtitle={items?.length ? `${bytes(size)} · last look before they go to the Trash. Select any to put them back.` : undefined}
          >
            {!!items?.length && (
              <>
                <Button icon={Undo2} onClick={() => void sift.setFlagged(items.map((i) => i.id), false)}>
                  Put all back
                </Button>
                <Button variant="danger" icon={Trash2} onClick={() => setConfirm(true)}>
                  Move {count(items.length)} to Trash
                </Button>
              </>
            )}
          </ViewHeader>
          {!!history?.length && (
            <div className="flex items-center gap-2 overflow-x-auto border-b border-line px-6 py-2 text-xs text-muted">
              <span className="shrink-0">Recently removed:</span>
              {history.slice(0, 6).map((b) => (
                <span key={b.batchId} className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/[0.05] py-0.5 pr-1 pl-2.5">
                  {plural(b.count, 'item')} · {bytes(b.bytes)} · {ago(b.at)}
                  {b.restorable > 0 && (
                    <button
                      className="rounded-full px-2 py-0.5 font-medium text-accent hover:bg-white/[0.08]"
                      onClick={() => void sift.restoreBatch(b.batchId).then((r) => useStore.getState().toast({ message: `Restored ${plural(r.restored, 'item')}` }))}
                    >
                      Restore
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
          <Confirm
            open={confirm}
            onClose={() => setConfirm(false)}
            title={`Move ${plural(items?.length ?? 0, 'item')} to the Trash?`}
            confirmLabel="Move to Trash"
            variant="danger"
            onConfirm={() => void moveToTrash()}
          >
            This frees {bytes(size)}. Files go to the macOS Trash (or their drive’s Trash), so you can still restore them from here or from Finder
            until you empty it.
          </Confirm>
        </>
      }
      empty={{
        icon: Trash2,
        title: 'Nothing marked for removal',
        text: 'Photos you remove anywhere in Sift land here first, so you can take a last look before anything goes to the Trash.'
      }}
    />
  )
}
