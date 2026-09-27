import type { MediaItem } from '@shared/types'
import { Check, Film, Trash2 } from 'lucide-react'
import { Thumb } from '@/components/Thumb'
import { Button, EmptyState, Loading, ViewHeader } from '@/components/ui'
import { flag, keep } from '@/lib/actions'
import { useLargeVideos, useSettings } from '@/lib/api'
import { bytes, date, duration, plural } from '@/lib/format'
import { useStore } from '@/lib/store'

function Row({ item, items, index, max }: { item: MediaItem; items: MediaItem[]; index: number; max: number }) {
  const openViewer = useStore((s) => s.openViewer)
  return (
    <div className="group flex items-center gap-4 rounded-xl px-3 py-2 hover:bg-white/[0.04]">
      <Thumb item={item} size={72} onClick={() => openViewer(items, index)} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">{item.name}</div>
        <div className="text-xs text-muted">
          {duration(item.duration)} · {item.width && item.height ? `${item.width}×${item.height} · ` : ''}
          {date(item.takenAt)}
        </div>
        <div className="mt-2 h-1.5 max-w-md overflow-hidden rounded-full bg-white/[0.06]">
          <div className="h-full rounded-full bg-ok/80" style={{ width: `${(item.size / max) * 100}%` }} />
        </div>
      </div>
      <div className="w-20 text-right text-[13px] font-semibold tabular">{bytes(item.size)}</div>
      <div className="flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
        <Button size="sm" icon={Check} onClick={() => void keep([item.id])}>
          Keep
        </Button>
        <Button size="sm" variant="danger" icon={Trash2} onClick={() => void flag([item.id], item.size)}>
          Remove
        </Button>
      </div>
    </div>
  )
}

export function LargeVideos() {
  const { data: items } = useLargeVideos()
  const { data: settings } = useSettings()
  if (!items) return <Loading />
  if (!items.length)
    return (
      <EmptyState icon={Film} title="No large videos">
        No video is bigger than {settings?.largeVideoMB ?? 200} MB. You can change that limit in Settings.
      </EmptyState>
    )
  const totalBytes = items.reduce((s, i) => s + i.size, 0)
  return (
    <div className="flex h-full flex-col">
      <ViewHeader title={plural(items.length, 'large video')} subtitle={`${bytes(totalBytes)} in videos over ${settings?.largeVideoMB ?? 200} MB · biggest first`} />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {items.map((item, i) => (
          <Row key={item.id} item={item} items={items} index={i} max={items[0].size} />
        ))}
      </div>
    </div>
  )
}
