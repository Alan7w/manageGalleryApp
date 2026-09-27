// Types shared by the Electron main process, the preload bridge and the UI.

export type MediaKind = 'image' | 'video'

export interface Source {
  id: number
  path: string
  name: string
  /** False when the folder / external drive is not currently reachable. */
  online: boolean
  isPrimary: boolean
  count: number
  bytes: number
  lastScanAt: number | null
}

/** The compact shape used by grids and lists. */
export interface MediaItem {
  id: number
  sourceId: number
  kind: MediaKind
  name: string
  dir: string
  size: number
  width: number | null
  height: number | null
  /** Capture time (EXIF) when known, otherwise the file's own date. ms since epoch. */
  takenAt: number
  duration: number | null
  analyzed: boolean
  flagged: boolean
  kept: boolean
  sharpness: number | null
  aesthetic: number | null
  faceCount: number | null
  faceQuality: number | null
  brightness: number | null
  /** Cache-busting version for thumbnails. */
  v: number
}

export interface MediaDetails extends MediaItem {
  path: string
  sourceName: string
  dateSource: 'exif' | 'file'
  camera: string | null
  lat: number | null
  lon: number | null
  labels: { label: string; confidence: number }[]
  isUtility: boolean | null
  contrast: number | null
  error: string | null
}

export type GroupKind = 'duplicate' | 'similar'

export interface Badge {
  label: string
  tone: 'good' | 'bad'
}

export interface GroupMember {
  item: MediaItem
  /** 0…1, how good this shot is relative to the rest of its group. */
  score: number
  /** Short explanations shown as badges, e.g. "Sharpest" or "Blurry". */
  badges: Badge[]
  /** Duplicates only: which source / folder this copy lives in. */
  location?: string
}

export interface MediaGroup {
  key: string
  kind: GroupKind
  members: GroupMember[]
  suggestedKeepId: number
  /** Bytes freed if every member except the suggested keeper is removed. */
  reclaimable: number
  /** Every member has already been kept or flagged. */
  resolved: boolean
  startAt: number
  spanMs: number
}

export type JunkReason = 'screenshot' | 'accidental' | 'document' | 'tiny'

export interface JunkItem extends MediaItem {
  reasons: JunkReason[]
}

export interface Bucket {
  items: number
  bytes: number
  groups?: number
}

export interface Overview {
  totals: { items: number; images: number; videos: number; bytes: number }
  analysis: { pending: number; ready: number; errors: number }
  cleanup: {
    duplicates: Bucket
    similar: Bucket
    blurry: Bucket
    junk: Bucket
    largeVideos: Bucket
  }
  reviewBin: Bucket
  sources: number
}

export type Phase = 'idle' | 'scanning' | 'analyzing' | 'hashing' | 'grouping'

export interface Progress {
  phase: Phase
  /** Files discovered while scanning. */
  found: number
  done: number
  total: number
  /** Items per second (analysis). */
  rate: number
  etaSec: number | null
  paused: boolean
  detail: string | null
}

export interface Settings {
  /** 0 (loose) … 1 (strict): how alike photos must look to be grouped. */
  strictness: number
  /** Photos taken within this many seconds of each other can form a burst. */
  burstWindowSec: number
  /** Focus score below which a photo counts as blurry. */
  blurThreshold: number
  /** Mean brightness (0…1) below which a photo counts as an accidental dark shot. */
  darkThreshold: number
  /** Videos larger than this (MB) are listed under Large Videos. */
  largeVideoMB: number
  /** Run Apple Vision (similarity, aesthetics, faces, labels). Slower but much smarter. */
  deepAnalysis: boolean
}

export interface AddSourcesResult {
  added: Source[]
  skipped: { path: string; reason: string }[]
}

export interface TrashResult {
  batchId: string
  moved: number
  bytes: number
  /** Moved into a "Sift Removed" folder because the drive has no Trash. */
  movedToFolder: number
  failed: { path: string; error: string }[]
}

export interface TrashBatch {
  batchId: string
  at: number
  count: number
  bytes: number
  restorable: number
}

export interface RestoreResult {
  restored: number
  failed: { path: string; error: string }[]
}

export interface MediaQuery {
  kind?: MediaKind
  sourceId?: number
}

export interface Resolution {
  keep: number[]
  remove: number[]
}

export type SiftEvent =
  | { type: 'progress'; progress: Progress }
  | { type: 'library-changed' }

/** Everything the UI can ask the main process to do. */
export interface SiftApi {
  getOverview(): Promise<Overview>
  getProgress(): Promise<Progress>
  getSources(): Promise<Source[]>
  pickAndAddSources(): Promise<AddSourcesResult>
  addSources(paths: string[]): Promise<AddSourcesResult>
  removeSource(id: number): Promise<void>
  setPrimarySource(id: number): Promise<void>
  rescan(): Promise<void>
  setPaused(paused: boolean): Promise<void>

  listMedia(query: MediaQuery): Promise<MediaItem[]>
  getDetails(id: number): Promise<MediaDetails | null>
  search(text: string): Promise<MediaItem[]>

  getGroups(kind: GroupKind): Promise<MediaGroup[]>
  getBlurry(): Promise<MediaItem[]>
  getJunk(): Promise<JunkItem[]>
  getLargeVideos(): Promise<MediaItem[]>

  setFlagged(ids: number[], flagged: boolean): Promise<void>
  keep(ids: number[]): Promise<void>
  /** Forget any keep / remove decision (e.g. undo, or "put back" from the review bin). */
  clearDecision(ids: number[]): Promise<void>
  resolve(resolutions: Resolution[]): Promise<void>

  getReviewBin(): Promise<MediaItem[]>
  trashFlagged(): Promise<TrashResult>
  getTrashHistory(): Promise<TrashBatch[]>
  restoreBatch(batchId: string): Promise<RestoreResult>

  getSettings(): Promise<Settings>
  updateSettings(patch: Partial<Settings>): Promise<Settings>

  revealInFinder(id: number): Promise<void>
  openExternally(id: number): Promise<void>
}

export const API_METHODS = [
  'getOverview',
  'getProgress',
  'getSources',
  'pickAndAddSources',
  'addSources',
  'removeSource',
  'setPrimarySource',
  'rescan',
  'setPaused',
  'listMedia',
  'getDetails',
  'search',
  'getGroups',
  'getBlurry',
  'getJunk',
  'getLargeVideos',
  'setFlagged',
  'keep',
  'clearDecision',
  'resolve',
  'getReviewBin',
  'trashFlagged',
  'getTrashHistory',
  'restoreBatch',
  'getSettings',
  'updateSettings',
  'revealInFinder',
  'openExternally'
] as const satisfies readonly (keyof SiftApi)[]

/** Compile-time check that API_METHODS lists every SiftApi method. */
type Missing = Exclude<keyof SiftApi, (typeof API_METHODS)[number]>
export const _apiComplete: Missing extends never ? true : Missing = true

/** What the preload script exposes as `window.sift`. */
export interface SiftBridge extends SiftApi {
  onEvent(listener: (event: SiftEvent) => void): () => void
  /** Absolute path of a file / folder dropped onto the window. */
  pathForFile(file: File): string
}

export const DEFAULT_SETTINGS: Settings = {
  strictness: 0.5,
  burstWindowSec: 60,
  blurThreshold: 20,
  darkThreshold: 0.08,
  largeVideoMB: 200,
  deepAnalysis: true
}
