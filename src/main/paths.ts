import { app } from 'electron'
import { join } from 'node:path'

export const dataDir = (): string => app.getPath('userData')
export const cacheDir = (): string => join(dataDir(), 'cache')

/** Thumbnails are sharded into 256 folders so no single folder gets huge. */
export const thumbPath = (id: number): string => join(cacheDir(), 'thumbs', String(id % 256), `${id}.jpg`)
export const previewPath = (id: number, v: number): string =>
  join(cacheDir(), 'previews', String(id % 256), `${id}-${v}.jpg`)

export function analyzerBinary(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'bin', 'sift-analyzer')
    : join(app.getAppPath(), 'resources', 'bin', 'sift-analyzer')
}

/** Name of the folder used on drives that have no Trash (e.g. some exFAT / network drives). */
export const REMOVED_FOLDER = 'Sift Removed'
