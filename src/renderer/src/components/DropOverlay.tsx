import { AnimatePresence, motion } from 'motion/react'
import { FolderPlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { addFolders } from '@/lib/actions'
import { sift } from '@/lib/api'

/** Drag folders from Finder anywhere onto the window to add them as sources. */
export function DropOverlay() {
  const [over, setOver] = useState(false)
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer?.types.includes('Files')
    const enter = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      depth++
      setOver(true)
    }
    const leave = (): void => {
      depth = Math.max(0, depth - 1)
      if (!depth) setOver(false)
    }
    const overFn = (e: DragEvent): void => {
      if (hasFiles(e)) e.preventDefault()
    }
    const drop = (e: DragEvent): void => {
      e.preventDefault()
      depth = 0
      setOver(false)
      const paths = [...(e.dataTransfer?.files ?? [])].map((f) => sift.pathForFile(f)).filter(Boolean)
      if (paths.length) void addFolders(paths)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', overFn)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', overFn)
      window.removeEventListener('drop', drop)
    }
  }, [])

  return (
    <AnimatePresence>
      {over && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="pointer-events-none fixed inset-3 z-[70] grid place-items-center rounded-2xl border-2 border-dashed border-accent bg-accent/10 backdrop-blur-sm"
        >
          <div className="flex flex-col items-center gap-3 text-center">
            <FolderPlus size={40} className="text-accent" strokeWidth={1.5} />
            <div className="text-lg font-semibold">Drop folders to add them</div>
            <div className="text-muted">Sift will scan them — nothing is moved or changed.</div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
