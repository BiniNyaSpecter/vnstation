import type { VNStationApi } from './api'

declare global {
  interface Window {
    /** Provided by the preload script. Undefined when running outside Electron. */
    vnstation?: VNStationApi
  }
}
