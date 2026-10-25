import type { MetadataApi } from '@shared/contracts'

/** Used outside Electron (plain-browser design preview), where there is no main process to ask. */
const unavailable = (): Promise<never> => Promise.reject(new Error('Looking up details needs the desktop app.'))

export const unavailableMetadata: MetadataApi = {
  search: unavailable,
  apply: unavailable,
  refresh: unavailable,
  unlink: unavailable,
  chooseArtwork: unavailable,
  resetArtwork: unavailable,
  cacheStats: unavailable,
  clearCache: unavailable,
  getCharacters: unavailable,
  openExternalVndb: unavailable
}
