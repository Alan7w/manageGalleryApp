import type { SiftBridge } from '../shared/types'

declare global {
  interface Window {
    sift: SiftBridge
  }
}
