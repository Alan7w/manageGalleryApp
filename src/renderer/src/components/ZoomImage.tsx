import type { MediaItem } from '@shared/types'
import clsx from 'clsx'
import { useRef, useState } from 'react'
import { mediaUrl, thumbUrl } from '@/lib/api'

export interface ZoomState {
  on: boolean
  /** Zoom focus point as a percentage of the frame. */
  x: number
  y: number
}

export const NO_ZOOM: ZoomState = { on: false, x: 50, y: 50 }

/**
 * Shows the thumbnail instantly, swaps in the full-resolution image when it
 * arrives, and zooms to 100% pixels where you click (pan by moving the mouse).
 * Pass `zoom` + `onZoom` to sync two images for side-by-side comparison.
 */
export function ZoomImage({
  item,
  zoom,
  onZoom,
  still,
  className
}: {
  item: MediaItem
  zoom?: ZoomState
  onZoom?: (z: ZoomState) => void
  still?: boolean
  className?: string
}) {
  const [local, setLocal] = useState<ZoomState>(NO_ZOOM)
  const z = zoom ?? local
  const set = onZoom ?? setLocal
  const [loadedId, setLoadedId] = useState<number | null>(null)
  const [scale, setScale] = useState(2)
  const box = useRef<HTMLDivElement>(null)

  const point = (e: React.MouseEvent): { x: number; y: number } => {
    const r = box.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 }
  }

  const onLoad = (e: React.SyntheticEvent<HTMLImageElement>): void => {
    setLoadedId(item.id)
    const img = e.currentTarget
    const r = box.current?.getBoundingClientRect()
    if (!r || !img.naturalWidth) return
    const shown = Math.min(r.width, r.height * (img.naturalWidth / img.naturalHeight))
    setScale(Math.max(2, img.naturalWidth / shown))
  }

  const style = { transformOrigin: `${z.x}% ${z.y}%`, transform: z.on ? `scale(${scale})` : 'none' }
  return (
    <div
      ref={box}
      className={clsx('relative size-full overflow-hidden', z.on ? 'cursor-zoom-out' : 'cursor-zoom-in', className)}
      onClick={(e) => set({ on: !z.on, ...point(e) })}
      onMouseMove={(e) => z.on && set({ on: true, ...point(e) })}
    >
      {item.v > 0 && (
        <img
          src={thumbUrl(item)}
          draggable={false}
          style={style}
          className={clsx('absolute inset-0 size-full object-contain', loadedId === item.id && 'invisible')}
        />
      )}
      <img
        key={item.id}
        src={mediaUrl(item, still)}
        draggable={false}
        onLoad={onLoad}
        style={style}
        className={clsx('absolute inset-0 size-full object-contain', loadedId === item.id ? 'opacity-100' : 'opacity-0')}
      />
    </div>
  )
}
