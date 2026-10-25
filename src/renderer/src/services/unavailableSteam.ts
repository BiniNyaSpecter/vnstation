import type { SteamApi } from '@shared/contracts'

const unavailable = (): Promise<never> => Promise.reject(new Error('Steam integration requires the desktop app.'))

export const unavailableSteam: SteamApi = {
  getStatus: async () => ({
    connected: false,
    mode: null,
    steamId: null,
    personaName: null,
    profileUrl: null,
    avatarUrl: null,
    hasApiKey: false,
    localSteamPath: null,
    detectedSteamPath: null,
    lastSyncedAt: null,
    lastSyncSummary: null,
    catalogCounts: { total: 0, vn: 0, review: 0, excluded: 0, unavailable: 0 }
  }),
  connect: unavailable,
  disconnect: unavailable,
  sync: unavailable,
  listCatalog: async () => [],
  setClassificationOverride: unavailable,
  linkCatalogVndb: unavailable,
  cleanupUnavailable: unavailable
}
