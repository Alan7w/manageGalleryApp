// sift:// URLs let the UI show images without exposing the file system:
//   sift://thumb/42   → cached 512px thumbnail
//   sift://media/42   → the original (if Chromium can display it) or a
//                       high-res JPEG preview rendered by the analyzer (HEIC, RAW, TIFF…)

import { net, protocol } from 'electron'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { interactive } from './analyzer'
import { mediaPath } from './media'
import { previewPath, thumbPath } from './paths'

const BROWSER_IMAGES = new Set(['jpg', 'jpeg', 'jpe', 'png', 'gif', 'webp', 'avif', 'bmp'])
const BROWSER_VIDEOS = new Set(['mp4', 'm4v', 'mov', 'webm'])

export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'sift', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
  ])
}

const notFound = (): Response => new Response(null, { status: 404 })
const previews = new Map<string, Promise<unknown>>()

export function handleProtocol(): void {
  protocol.handle('sift', async (req) => {
    const url = new URL(req.url)
    const id = Number(url.pathname.slice(1))
    if (!Number.isInteger(id)) return notFound()

    if (url.hostname === 'thumb') {
      const file = thumbPath(id)
      return existsSync(file) ? net.fetch(pathToFileURL(file).toString()) : notFound()
    }

    if (url.hostname === 'media') {
      const m = mediaPath(id)
      if (!m || !existsSync(m.path)) return notFound()
      const native = m.kind === 'video' ? BROWSER_VIDEOS.has(m.ext) : BROWSER_IMAGES.has(m.ext)
      if (native && url.searchParams.get('still') !== '1') {
        // Pass Range headers through so videos can seek.
        return net.fetch(pathToFileURL(m.path).toString(), { headers: req.headers })
      }
      const out = previewPath(id, m.v)
      if (!existsSync(out)) {
        let job = previews.get(out)
        if (!job) {
          job = interactive.preview(m.path, m.kind, out).finally(() => previews.delete(out))
          previews.set(out, job)
        }
        try {
          await job
        } catch {
          return notFound()
        }
      }
      return net.fetch(pathToFileURL(out).toString())
    }
    return notFound()
  })
}
