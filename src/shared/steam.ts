export type LibrarySource = 'manual' | 'steam-api' | 'steam-local'

export type VnClassification = 'vn' | 'review' | 'excluded'

export type ClassificationConfidence = 'high' | 'medium' | 'low' | 'manual'

export type ClassificationOverride = 'include' | 'exclude' | null

export interface SteamCandidateMatch {
  id: string
  title: string
  originalTitle: string | null
  releaseDate: string | null
  developer: string | null
}

export interface SteamCatalogItem {
  steamAppId: number
  name: string
  source: 'steam-api' | 'steam-local'
  installed: boolean
  installDir: string | null
  playtimeMinutes: number
  lastPlayedAt: string | null
  classification: VnClassification
  confidence: ClassificationConfidence
  reason: string
  manualOverride: ClassificationOverride
  vndbId: string | null
  vndbTitle: string | null
  candidateMatches: SteamCandidateMatch[]
  gameId: string | null
  available: boolean
  syncedAt: string
}

export interface SteamSyncSummary {
  source: 'steam-api' | 'steam-local' | 'both'
  discoveredCount: number
  importedVnCount: number
  updatedVnCount: number
  reviewCount: number
  excludedCount: number
  unavailableCount: number
  syncedAt: string
}

export interface SteamStatus {
  connected: boolean
  mode: 'api' | 'local' | 'both' | null
  steamId: string | null
  personaName: string | null
  profileUrl: string | null
  avatarUrl: string | null
  /** True when an encrypted Steam Web API key is stored in the main process. Never exposes the key itself. */
  hasApiKey: boolean
  localSteamPath: string | null
  detectedSteamPath: string | null
  lastSyncedAt: string | null
  lastSyncSummary: SteamSyncSummary | null
  catalogCounts: {
    total: number
    vn: number
    review: number
    excluded: number
    unavailable: number
  }
}

export interface SteamConnectInput {
  mode: 'api' | 'local'
  steamIdOrVanity?: string
  apiKey?: string
  localSteamPath?: string
}

export interface SteamSyncOptions {
  allowAdult: boolean
}
