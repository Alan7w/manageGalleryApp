import type { MediaItem } from '@shared/types'
import clsx from 'clsx'
import { Check, Play, Trash2 } from 'lucide-react'
import { memo, useState, type ReactNode } from 'react'
import { thumbUrl } from '@/lib/api'
import { duration } from '@/lib/format'

interface Props {
  item: MediaItem
  size: number
  selected?: boolean
  onClick?: (e: React.MouseEvent) => void
  onDoubleClick?: () => void
  /** Extra overlay content (badges, buttons). */
  children?: ReactNode
  className?: string
  fit?: 'cover' | 'contain'
}

export const Thumb = memo(function Thumb({ item, size, selected, onClick, onDoubleClick, children, className, fit = 'cover' }: Props) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const hasThumb = item.v > 0 && !failed
  return (
    <div
      role="button"
      tabIndex={-1}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      style={{ width: size, height: size }}
      className={clsx(
        'group relative shrink-0 overflow-hidden rounded-md bg-panel-2 outline-none',
        selected && 'ring-2 ring-accent ring-offset-2 ring-offset-bg',
        className
      )}
    >
      {hasThumb && (
        <img
          src={thumbUrl(item)}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={clsx(
            'size-full transition-[opacity,transform] duration-300',
            fit === 'cover' ? 'object-cover' : 'object-contain',
            loaded ? 'opacity-100' : 'opacity-0',
            item.flagged && 'opacity-40 grayscale'
          )}
        />
      )}
      {(!hasThumb || !loaded) && <div className={clsx('absolute inset-0', item.analyzed || failed ? 'bg-panel-2' : 'skeleton')} />}

      {item.kind === 'video' && (
        <div className="absolute right-1.5 bottom-1.5 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur">
          <Play size={10} fill="currentColor" />
          {duration(item.duration)}
        </div>
      )}
      {item.flagged && (
        <div className="absolute top-1.5 left-1.5 grid size-6 place-items-center rounded-full bg-remove text-white shadow">
          <Trash2 size={12} />
        </div>
      )}
      {item.kept && !item.flagged && (
        <div className="absolute top-1.5 left-1.5 grid size-5 place-items-center rounded-full bg-black/50 text-ok backdrop-blur">
          <Check size={12} strokeWidth={3} />
        </div>
      )}
      {selected && (
        <div className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-accent text-white shadow">
          <Check size={12} strokeWidth={3} />
        </div>
      )}
      {children}
    </div>
  )
})
