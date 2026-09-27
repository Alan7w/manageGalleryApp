// Virtualized photo grid: renders only the rows on screen, so 100k photos
// scroll as smoothly as 100. Optional month headers like Apple Photos.

import type { MediaItem } from '@shared/types'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useMemo, type ReactNode } from 'react'
import { useWidth } from '@/lib/hooks'
import type { useSelection } from '@/lib/hooks'
import { monthYear } from '@/lib/format'
import { useStore } from '@/lib/store'
import { Thumb } from './Thumb'

type Row = { type: 'header'; label: string; count: number } | { type: 'items'; start: number; items: MediaItem[] }

const GAP = 6
const PAD = 24

export function PhotoGrid({
  items,
  sections = false,
  selection,
  overlay,
  top
}: {
  items: MediaItem[]
  sections?: boolean
  selection?: ReturnType<typeof useSelection>
  overlay?: (item: MediaItem) => ReactNode
  /** Content scrolled together with the grid, above it. */
  top?: ReactNode
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const tileSize = useStore((s) => s.tileSize)
  const openViewer = useStore((s) => s.openViewer)

  const cols = Math.max(1, Math.floor((width - PAD * 2 + GAP) / (tileSize + GAP)))
  const cell = Math.floor((width - PAD * 2 - (cols - 1) * GAP) / cols)

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    const pushItems = (list: MediaItem[], offset: number): void => {
      for (let i = 0; i < list.length; i += cols) out.push({ type: 'items', start: offset + i, items: list.slice(i, i + cols) })
    }
    if (!sections) {
      pushItems(items, 0)
      return out
    }
    let start = 0
    while (start < items.length) {
      const d = new Date(items[start].takenAt)
      let end = start + 1
      while (end < items.length) {
        const e = new Date(items[end].takenAt)
        if (e.getMonth() !== d.getMonth() || e.getFullYear() !== d.getFullYear()) break
        end++
      }
      out.push({ type: 'header', label: monthYear(items[start].takenAt), count: end - start })
      pushItems(items.slice(start, end), start)
      start = end
    }
    return out
  }, [items, cols, sections])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => ref.current,
    estimateSize: (i) => (rows[i].type === 'header' ? 52 : cell + GAP),
    overscan: 4,
    paddingEnd: 96
  })

  return (
    <div ref={ref} className="scroll-thin h-full overflow-y-auto">
      {top}
      {width > 0 && (
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }} key={`${cols}-${cell}`}>
          {virtualizer.getVirtualItems().map((v) => {
            const row = rows[v.index]
            return (
              <div
                key={v.key}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: v.size, transform: `translateY(${v.start}px)` }}
              >
                {row.type === 'header' ? (
                  <div className="flex items-end gap-2 px-6 pt-5 pb-2.5">
                    <span className="text-[15px] font-semibold">{row.label}</span>
                    <span className="pb-px text-xs text-dim tabular">{row.count}</span>
                  </div>
                ) : (
                  <div className="flex px-6" style={{ gap: GAP }}>
                    {row.items.map((item, i) => (
                      <Thumb
                        key={item.id}
                        item={item}
                        size={cell}
                        selected={selection?.selected.has(item.id)}
                        onClick={(e) => {
                          if (selection?.click(e, item)) return
                          openViewer(items, row.start + i)
                        }}
                      >
                        {overlay?.(item)}
                      </Thumb>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
