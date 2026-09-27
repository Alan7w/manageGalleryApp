import { BrowserWindow } from 'electron'
import type { SiftEvent } from '@shared/types'

export function emit(event: SiftEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('sift:event', event)
  }
}

/** Bumped whenever analysis results change, so cached groupings know they're stale. */
export let dataVersion = 0
export function bumpDataVersion(): void {
  dataVersion++
}

let changeTimer: NodeJS.Timeout | null = null
let fireAt = 0
let lastChange = 0
/**
 * Tells the UI to refresh, at most every `minGapMs` (bursts of changes get
 * coalesced). A call with a shorter gap brings a pending refresh forward.
 */
export function libraryChanged(minGapMs = 0): void {
  const at = Math.max(Date.now(), lastChange + minGapMs)
  if (changeTimer) {
    if (at >= fireAt) return
    clearTimeout(changeTimer)
  }
  fireAt = at
  changeTimer = setTimeout(() => {
    changeTimer = null
    lastChange = Date.now()
    emit({ type: 'library-changed' })
  }, at - Date.now())
}
