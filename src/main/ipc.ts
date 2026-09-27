// Wires every SiftApi method to an `ipcMain.handle('sift:<method>')` handler.

import { API_METHODS, type AddSourcesResult, type SiftApi } from '@shared/types'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { bumpDataVersion, libraryChanged } from './events'
import { getProgress, setPaused, startPass } from './engine'
import { getGroups, getOverview } from './groups'
import { blurry, clearDecision, getDetails, junk, keep, largeVideos, listMedia, mediaPath, reviewBin, setFlagged } from './media'
import { search } from './search'
import { getSettings, updateSettings } from './settings'
import { addSources, listSources, removeSource, setPrimarySource } from './sources'
import { restoreBatch, trashFlagged, trashHistory } from './trash'

const ids = (value: unknown): number[] => (Array.isArray(value) ? value.filter((v): v is number => Number.isInteger(v)) : [])

function addAndScan(paths: string[]): AddSourcesResult {
  const result = addSources(paths)
  if (result.added.length) {
    bumpDataVersion()
    libraryChanged()
    startPass()
  }
  return result
}

const handlers: SiftApi = {
  getOverview,
  getProgress: async () => getProgress(),
  getSources: async () => listSources(),
  pickAndAddSources: async () => {
    const win = BrowserWindow.getFocusedWindow()
    const options: Electron.OpenDialogOptions = {
      title: 'Add folders or drives',
      buttonLabel: 'Add to Library',
      message: 'Choose folders or external drives with photos and videos. Nothing is changed until you decide.',
      properties: ['openDirectory', 'multiSelections']
    }
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return r.canceled ? { added: [], skipped: [] } : addAndScan(r.filePaths)
  },
  addSources: async (paths) => addAndScan(paths),
  removeSource: async (id) => {
    removeSource(id)
    bumpDataVersion()
    libraryChanged()
  },
  setPrimarySource: async (id) => {
    setPrimarySource(id)
    libraryChanged()
  },
  rescan: async () => startPass(),
  setPaused: async (paused) => setPaused(paused),

  listMedia: async (q) => listMedia(q ?? {}),
  getDetails: async (id) => getDetails(id),
  search: async (text) => search(String(text ?? '')),

  getGroups: (kind) => getGroups(kind === 'duplicate' ? 'duplicate' : 'similar'),
  getBlurry: async () => blurry(),
  getJunk: async () => junk(),
  getLargeVideos: async () => largeVideos(),

  setFlagged: async (list, flagged) => {
    setFlagged(ids(list), !!flagged)
    libraryChanged()
  },
  keep: async (list) => {
    keep(ids(list))
    libraryChanged()
  },
  clearDecision: async (list) => {
    clearDecision(ids(list))
    libraryChanged()
  },
  resolve: async (resolutions) => {
    for (const r of resolutions ?? []) {
      keep(ids(r.keep))
      setFlagged(ids(r.remove), true)
    }
    libraryChanged()
  },

  getReviewBin: async () => reviewBin(),
  trashFlagged: async () => {
    const result = await trashFlagged()
    bumpDataVersion()
    libraryChanged()
    return result
  },
  getTrashHistory: async () => trashHistory(),
  restoreBatch: async (batchId) => {
    const result = await restoreBatch(String(batchId))
    bumpDataVersion()
    libraryChanged()
    return result
  },

  getSettings: async () => getSettings(),
  updateSettings: async (patch) => {
    const before = getSettings()
    const next = updateSettings(patch ?? {})
    if (next.deepAnalysis && !before.deepAnalysis) startPass()
    libraryChanged()
    return next
  },

  revealInFinder: async (id) => {
    const m = mediaPath(id)
    if (m) shell.showItemInFolder(m.path)
  },
  openExternally: async (id) => {
    const m = mediaPath(id)
    if (m) await shell.openPath(m.path)
  }
}

export function registerIpc(): void {
  for (const name of API_METHODS) {
    const fn = handlers[name] as (...args: unknown[]) => unknown
    ipcMain.handle(`sift:${name}`, (_event, ...args: unknown[]) => fn(...args))
  }
}
