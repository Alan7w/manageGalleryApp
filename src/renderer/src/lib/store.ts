import type { MediaItem, Progress } from '@shared/types'
import { create } from 'zustand'

export type View =
  | 'overview'
  | 'library'
  | 'duplicates'
  | 'similar'
  | 'blurry'
  | 'junk'
  | 'videos'
  | 'bin'
  | 'search'
  | 'settings'

export interface Toast {
  id: number
  message: string
  tone?: 'info' | 'success' | 'error'
  action?: { label: string; run: () => void }
}

interface State {
  view: View
  go: (view: View) => void

  query: string
  setQuery: (q: string) => void

  progress: Progress
  setProgress: (p: Progress) => void

  /** Lightbox: the list being browsed and the current position in it. */
  viewer: { items: MediaItem[]; index: number } | null
  openViewer: (items: MediaItem[], index: number) => void
  setViewerIndex: (index: number) => void
  closeViewer: () => void

  /** Culling session for similar groups, opened at a specific group. */
  cullFrom: string | null
  openCull: (groupKey: string) => void
  closeCull: () => void

  tileSize: number
  setTileSize: (size: number) => void

  toasts: Toast[]
  toast: (t: Omit<Toast, 'id'>) => void
  dismiss: (id: number) => void
}

let toastId = 0

export const useStore = create<State>((set, get) => ({
  view: 'overview',
  go: (view) => set({ view, cullFrom: null }),

  query: '',
  setQuery: (query) => set({ query, view: query ? 'search' : get().view === 'search' ? 'library' : get().view }),

  progress: { phase: 'idle', found: 0, done: 0, total: 0, rate: 0, etaSec: null, paused: false, detail: null },
  setProgress: (progress) => set({ progress }),

  viewer: null,
  openViewer: (items, index) => set({ viewer: { items, index } }),
  setViewerIndex: (index) => set((s) => (s.viewer ? { viewer: { ...s.viewer, index } } : {})),
  closeViewer: () => set({ viewer: null }),

  cullFrom: null,
  openCull: (cullFrom) => set({ cullFrom, view: 'similar' }),
  closeCull: () => set({ cullFrom: null }),

  tileSize: Number(localStorage.getItem('tileSize')) || 170,
  setTileSize: (tileSize) => {
    try {
      localStorage.setItem('tileSize', String(tileSize))
    } catch {
      // not important
    }
    set({ tileSize })
  },

  toasts: [],
  toast: (t) => {
    const id = ++toastId
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }))
    setTimeout(() => get().dismiss(id), t.action ? 9000 : 4500)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))
