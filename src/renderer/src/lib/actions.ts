// User actions that show feedback (and an Undo) in a toast.

import { sift } from './api'
import { bytes, plural } from './format'
import { useStore } from './store'

const toast = (...args: Parameters<ReturnType<typeof useStore.getState>['toast']>): void => useStore.getState().toast(...args)

export async function flag(ids: number[], size?: number): Promise<void> {
  if (!ids.length) return
  await sift.setFlagged(ids, true)
  toast({
    message: `${plural(ids.length, 'item')} added to Review Bin${size ? ` · ${bytes(size)}` : ''}`,
    action: { label: 'Undo', run: () => void sift.setFlagged(ids, false) }
  })
}

export async function unflag(ids: number[]): Promise<void> {
  if (!ids.length) return
  await sift.setFlagged(ids, false)
  toast({ message: `${plural(ids.length, 'item')} put back`, action: { label: 'Undo', run: () => void sift.setFlagged(ids, true) } })
}

export async function keep(ids: number[]): Promise<void> {
  if (!ids.length) return
  await sift.keep(ids)
  toast({ message: `Keeping ${plural(ids.length, 'item')}`, action: { label: 'Undo', run: () => void sift.clearDecision(ids) } })
}

export async function moveToTrash(): Promise<void> {
  const r = await sift.trashFlagged()
  if (r.moved) {
    toast({
      tone: 'success',
      message: `Moved ${plural(r.moved, 'item')} to the Trash · ${bytes(r.bytes)} freed${r.movedToFolder ? ` (${r.movedToFolder} into a “Sift Removed” folder)` : ''}`,
      action: {
        label: 'Undo',
        run: () =>
          void sift.restoreBatch(r.batchId).then((res) => toast({ message: `Restored ${plural(res.restored, 'item')}` }))
      }
    })
  }
  if (r.failed.length) {
    toast({ tone: 'error', message: `${plural(r.failed.length, 'item')} couldn’t be moved: ${r.failed[0].error}` })
  }
}

export async function addFolders(paths?: string[]): Promise<void> {
  const r = paths ? await sift.addSources(paths) : await sift.pickAndAddSources()
  if (r.added.length) {
    toast({ tone: 'success', message: `Added ${r.added.map((s) => `“${s.name}”`).join(', ')} — scanning now` })
    useStore.getState().go('overview')
  }
  for (const s of r.skipped) toast({ tone: 'error', message: `${s.path.split('/').pop()}: ${s.reason}` })
}
