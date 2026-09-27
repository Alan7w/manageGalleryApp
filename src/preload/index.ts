// The only bridge between the UI and the rest of the app: exposes `window.sift`
// with one async function per SiftApi method, plus an event subscription.

import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { API_METHODS, type SiftBridge, type SiftEvent } from '@shared/types'

const api = Object.fromEntries(
  API_METHODS.map((method) => [method, (...args: unknown[]) => ipcRenderer.invoke(`sift:${method}`, ...args)])
)

const bridge = {
  ...api,
  onEvent(listener: (event: SiftEvent) => void) {
    const handler = (_: unknown, event: SiftEvent): void => listener(event)
    ipcRenderer.on('sift:event', handler)
    return () => void ipcRenderer.removeListener('sift:event', handler)
  },
  pathForFile: (file: File) => webUtils.getPathForFile(file)
} as SiftBridge

contextBridge.exposeInMainWorld('sift', bridge)
