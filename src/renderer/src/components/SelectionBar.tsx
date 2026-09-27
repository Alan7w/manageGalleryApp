import type { MediaItem } from '@shared/types'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Trash2, Undo2, X } from 'lucide-react'
import { flag, keep, unflag } from '@/lib/actions'
import { bytes, count } from '@/lib/format'
import { useHotkeys, type useSelection } from '@/lib/hooks'
import { Button, IconButton, Kbd } from './ui'

/** Floating actions for the current multi-selection, with ⌫ / K / Esc shortcuts. */
export function SelectionBar({
  items,
  selection,
  mode = 'default'
}: {
  items: MediaItem[]
  selection: ReturnType<typeof useSelection>
  mode?: 'default' | 'bin'
}) {
  const { selected, clear, selectAll } = selection
  const chosen = items.filter((i) => selected.has(i.id))
  const size = chosen.reduce((s, i) => s + i.size, 0)
  const ids = chosen.map((i) => i.id)

  const remove = (): void => {
    void (mode === 'bin' ? unflag(ids) : flag(ids, size))
    clear()
  }
  const keepAll = (): void => {
    void keep(ids)
    clear()
  }

  useHotkeys({
    'mod+a': selectAll,
    Escape: clear,
    ...(chosen.length ? { Backspace: remove, Delete: remove, ...(mode === 'default' ? { k: keepAll } : {}) } : {})
  })

  return (
    <AnimatePresence>
      {chosen.length > 0 && (
        <motion.div
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 30, opacity: 0 }}
          className="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-line-strong bg-panel/95 p-2 pl-4 shadow-2xl backdrop-blur-xl"
        >
          <span className="mr-2 text-[13px] font-medium tabular">
            {count(chosen.length)} selected <span className="text-dim">· {bytes(size)}</span>
          </span>
          {mode === 'bin' ? (
            <Button icon={Undo2} onClick={remove}>
              Put back <Kbd>⌫</Kbd>
            </Button>
          ) : (
            <>
              <Button icon={Check} onClick={keepAll}>
                Keep <Kbd>K</Kbd>
              </Button>
              <Button variant="danger" icon={Trash2} onClick={remove}>
                Remove <Kbd>⌫</Kbd>
              </Button>
            </>
          )}
          <IconButton icon={X} label="Clear selection (Esc)" onClick={clear} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
