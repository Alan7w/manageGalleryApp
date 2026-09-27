import type { MediaItem } from '@shared/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type Handler = (e: KeyboardEvent) => void
type Entry = { map: React.RefObject<Record<string, Handler>>; layer: number }

/** Layers: 0 = page, 1 = full-screen overlay (viewer, culling), 2 = dialog. Only the top layer hears keys. */
export const Layer = { page: 0, overlay: 1, dialog: 2 } as const

const registry = new Set<Entry>()
let listening = false

function dispatch(e: KeyboardEvent): void {
  const t = e.target as HTMLElement
  if (t.closest?.('input, textarea, select, [contenteditable]')) return
  const key = (e.metaKey ? 'mod+' : '') + (e.shiftKey && e.key.length > 1 ? 'shift+' : '') + e.key.toLowerCase()
  const top = Math.max(...[...registry].map((r) => r.layer))
  for (const entry of registry) {
    if (entry.layer !== top) continue
    const map = entry.map.current
    const name = Object.keys(map).find((k) => k.toLowerCase() === key)
    if (name) {
      e.preventDefault()
      map[name](e)
      return
    }
  }
}

/**
 * Keyboard shortcuts. Keys are matched against `e.key` (case-insensitive), with
 * optional "mod+" (⌘) and "shift+" prefixes, e.g. { ArrowLeft: prev, 'mod+a': all }.
 * Ignored while typing in an input, and while a higher layer is open.
 */
export function useHotkeys(map: Record<string, Handler>, layer: number = Layer.page, enabled = true): void {
  const ref = useRef(map)
  ref.current = map
  useEffect(() => {
    if (!enabled) return
    if (!listening) {
      window.addEventListener('keydown', dispatch)
      listening = true
    }
    const entry: Entry = { map: ref, layer }
    registry.add(entry)
    return () => void registry.delete(entry)
  }, [enabled, layer])
}

/** Multi-select with ⌘-click (toggle) and shift-click (range). */
export function useSelection(items: MediaItem[] | undefined) {
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const anchor = useRef<number | null>(null)

  // Drop ids that disappeared from the list.
  const ids = useMemo(() => new Set(items?.map((i) => i.id)), [items])
  useEffect(() => {
    setSelected((s) => {
      const next = new Set([...s].filter((id) => ids.has(id)))
      return next.size === s.size ? s : next
    })
  }, [ids])

  const click = useCallback(
    (e: React.MouseEvent, item: MediaItem): boolean => {
      if (!items) return false
      if (e.shiftKey && anchor.current != null) {
        const a = items.findIndex((i) => i.id === anchor.current)
        const b = items.findIndex((i) => i.id === item.id)
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a]
          setSelected((s) => new Set([...s, ...items.slice(lo, hi + 1).map((i) => i.id)]))
          return true
        }
      }
      if (e.metaKey || e.shiftKey) {
        anchor.current = item.id
        setSelected((s) => {
          const next = new Set(s)
          if (next.has(item.id)) next.delete(item.id)
          else next.add(item.id)
          return next
        })
        return true
      }
      return false
    },
    [items]
  )

  return {
    selected,
    click,
    clear: () => setSelected(new Set()),
    selectAll: () => setSelected(new Set(items?.map((i) => i.id))),
    set: setSelected
  }
}

/** Width of an element, kept up to date with a ResizeObserver. */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}
