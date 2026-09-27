// Data access for the UI: thin React Query hooks over `window.sift`.
// The main process pushes a `library-changed` event whenever something changes,
// and every query simply refetches — so the UI never has to track state by hand.

import type { GroupKind, MediaItem, MediaQuery } from '@shared/types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useStore } from './store'

export const sift = window.sift

export const thumbUrl = (item: Pick<MediaItem, 'id' | 'v'>): string => `sift://thumb/${item.id}?v=${item.v}`
export const mediaUrl = (item: Pick<MediaItem, 'id'>, still = false): string => `sift://media/${item.id}${still ? '?still=1' : ''}`

const PLAYABLE = /\.(mp4|m4v|mov|webm)$/i
export const canPlay = (item: MediaItem): boolean => item.kind === 'video' && PLAYABLE.test(item.name)

export const useOverview = () => useQuery({ queryKey: ['overview'], queryFn: () => sift.getOverview() })
export const useSources = () => useQuery({ queryKey: ['sources'], queryFn: () => sift.getSources() })
export const useMedia = (q: MediaQuery) => useQuery({ queryKey: ['media', q], queryFn: () => sift.listMedia(q) })
export const useGroups = (kind: GroupKind) => useQuery({ queryKey: ['groups', kind], queryFn: () => sift.getGroups(kind) })
export const useBlurry = () => useQuery({ queryKey: ['blurry'], queryFn: () => sift.getBlurry() })
export const useJunk = () => useQuery({ queryKey: ['junk'], queryFn: () => sift.getJunk() })
export const useLargeVideos = () => useQuery({ queryKey: ['large-videos'], queryFn: () => sift.getLargeVideos() })
export const useReviewBin = () => useQuery({ queryKey: ['bin'], queryFn: () => sift.getReviewBin() })
export const useTrashHistory = () => useQuery({ queryKey: ['trash-history'], queryFn: () => sift.getTrashHistory() })
export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => sift.getSettings() })
export const useSearch = (text: string) =>
  useQuery({ queryKey: ['search', text], queryFn: () => sift.search(text), enabled: text.trim().length > 0 })
export const useDetails = (id: number | null) =>
  useQuery({ queryKey: ['details', id], queryFn: () => sift.getDetails(id!), enabled: id != null })

/** Subscribes once to main-process events. */
export function useSiftEvents(): void {
  const client = useQueryClient()
  const setProgress = useStore((s) => s.setProgress)
  useEffect(() => {
    void sift.getProgress().then(setProgress)
    return sift.onEvent((event) => {
      if (event.type === 'progress') setProgress(event.progress)
      else if (event.type === 'library-changed') void client.invalidateQueries()
    })
  }, [client, setProgress])
}
