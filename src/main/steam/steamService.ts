import type { SteamApi } from '@shared/contracts'
import type { MetadataCandidate } from '@shared/metadata'
import type {
  ClassificationOverride,
  SteamCatalogItem,
  SteamConnectInput,
  SteamStatus,
  SteamSyncOptions,
  SteamSyncSummary
} from '@shared/steam'
import type { LibraryStore } from '../db/libraryStore'
import type { Database } from '../db/sqlite'
import { UserFacingError } from '../errors'
import type { MetadataService } from '../metadata/metadataService'
import { VNDB_ID, type SteamVndbReleaseMatch } from '../metadata/vndb'
import { classifySteamEntry, isNonGameSteamEntry } from './classifier'
import { detectLocalSteamPath, scanLocalSteamInstallation, type DiscoveredLocalSteamApp } from './localSteam'
import { fallbackCipher, type SecretCipher, type SteamWebApiClient, validateApiKeyFormat } from './steamWebApi'

const CONFIG_KEY = 'steam.config'
const SECRET_KEY = 'steam.secret'

interface StoredSteamConfig {
  mode: 'api' | 'local' | 'both' | null
  steamId: string | null
  personaName: string | null
  profileUrl: string | null
  avatarUrl: string | null
  localSteamPath: string | null
  lastSyncedAt: string | null
  lastSyncSummary: SteamSyncSummary | null
}

const DEFAULT_CONFIG: StoredSteamConfig = {
  mode: null,
  steamId: null,
  personaName: null,
  profileUrl: null,
  avatarUrl: null,
  localSteamPath: null,
  lastSyncedAt: null,
  lastSyncSummary: null
}

export interface SteamServiceDeps {
  db: Database
  store: LibraryStore
  metadata: MetadataService
  webApi: SteamWebApiClient
  cipher?: SecretCipher
  scanLocalSteam?: (steamRootPath: string) => Promise<DiscoveredLocalSteamApp[]>
  detectSteamPath?: () => string | null
  now?: () => Date
}

export class SteamService implements SteamApi {
  private readonly cipher: SecretCipher
  private readonly scanLocal: (steamRootPath: string) => Promise<DiscoveredLocalSteamApp[]>
  private readonly detectPath: () => string | null
  private readonly now: () => Date
  private syncing = false

  constructor(private readonly deps: SteamServiceDeps) {
    this.cipher = deps.cipher ?? fallbackCipher
    this.scanLocal = deps.scanLocalSteam ?? scanLocalSteamInstallation
    this.detectPath = deps.detectSteamPath ?? (() => detectLocalSteamPath())
    this.now = deps.now ?? (() => new Date())
  }

  async getStatus(): Promise<SteamStatus> {
    const config = this.readConfig()
    const hasApiKey = this.readApiKey() !== null
    const catalog = this.deps.store.listSteamCatalog()
    const counts = {
      total: catalog.length,
      vn: catalog.filter((c) => c.classification === 'vn').length,
      review: catalog.filter((c) => c.classification === 'review').length,
      excluded: catalog.filter((c) => c.classification === 'excluded').length,
      unavailable: catalog.filter((c) => !c.available && c.gameId !== null).length
    }
    const apiConnected = Boolean(config.steamId && hasApiKey)
    const localConnected = Boolean(config.localSteamPath)
    const mode: 'api' | 'local' | 'both' | null =
      apiConnected && localConnected ? 'both' : apiConnected ? 'api' : localConnected ? 'local' : null

    return {
      connected: mode !== null,
      mode,
      steamId: config.steamId,
      personaName: config.personaName,
      profileUrl: config.profileUrl,
      avatarUrl: config.avatarUrl,
      hasApiKey,
      localSteamPath: config.localSteamPath,
      detectedSteamPath: this.detectPath(),
      lastSyncedAt: config.lastSyncedAt,
      lastSyncSummary: config.lastSyncSummary,
      catalogCounts: counts
    }
  }

  async connect(input: SteamConnectInput): Promise<SteamStatus> {
    const current = this.readConfig()

    if (input.mode === 'api') {
      const rawKey = input.apiKey?.trim()
      const apiKey = rawKey ? validateApiKeyFormat(rawKey) : this.readApiKey()
      if (!apiKey) {
        throw new UserFacingError('Enter your Steam Web API key to connect your Steam account.')
      }
      const rawId = input.steamIdOrVanity?.trim() || current.steamId || ''
      if (!rawId) {
        throw new UserFacingError('Enter your SteamID64 or Steam profile URL.')
      }

      const steamId = await this.deps.webApi.resolveSteamId(rawId, apiKey)
      const summary = await this.deps.webApi.getPlayerSummary(steamId, apiKey)

      this.writeApiKey(apiKey)
      this.writeConfig({
        ...current,
        mode: current.localSteamPath ? 'both' : 'api',
        steamId: summary.steamId,
        personaName: summary.personaName,
        profileUrl: summary.profileUrl,
        avatarUrl: summary.avatarUrl
      })
      return this.getStatus()
    }

    if (input.mode === 'local') {
      const chosenPath = input.localSteamPath?.trim() || this.detectPath()
      if (!chosenPath) {
        throw new UserFacingError('Could not automatically find Steam on this computer. Choose your Steam installation folder.')
      }
      // Verify the folder is a valid Steam installation before saving
      await this.scanLocal(chosenPath)
      const hasApi = Boolean(current.steamId && this.readApiKey())
      this.writeConfig({
        ...current,
        mode: hasApi ? 'both' : 'local',
        localSteamPath: chosenPath
      })
      return this.getStatus()
    }

    throw new UserFacingError('Unsupported Steam connection mode.')
  }

  async disconnect(): Promise<SteamStatus> {
    this.clearApiKey()
    this.writeConfig({
      ...DEFAULT_CONFIG
    })
    return this.getStatus()
  }

  async listCatalog(): Promise<SteamCatalogItem[]> {
    return this.deps.store.listSteamCatalog()
  }

  async cleanupUnavailable(): Promise<number> {
    return this.deps.store.cleanupUnavailableSteamGames()
  }

  async sync(options: SteamSyncOptions): Promise<SteamSyncSummary> {
    if (this.syncing) {
      throw new UserFacingError('Steam synchronization is already running.')
    }
    this.syncing = true
    try {
      const config = this.readConfig()
      const apiKey = this.readApiKey()
      const useApi = Boolean(config.steamId && apiKey)
      const useLocal = Boolean(config.localSteamPath)

      if (!useApi && !useLocal) {
        throw new UserFacingError('Connect your Steam account or choose a local Steam folder before synchronizing.')
      }

      const merged = new Map<
        number,
        {
          steamAppId: number
          name: string
          source: 'steam-api' | 'steam-local'
          installed: boolean
          installDir: string | null
          playtimeMinutes: number
          lastPlayedAt: string | null
        }
      >()

      if (useLocal && config.localSteamPath) {
        const localApps = await this.scanLocal(config.localSteamPath)
        for (const app of localApps) {
          merged.set(app.steamAppId, {
            steamAppId: app.steamAppId,
            name: app.name,
            source: 'steam-local',
            installed: true,
            installDir: app.installDir,
            playtimeMinutes: 0,
            lastPlayedAt: app.lastPlayedAt
          })
        }
      }

      if (useApi && config.steamId && apiKey) {
        const summary = await this.deps.webApi.getPlayerSummary(config.steamId, apiKey)
        const ownedGames = await this.deps.webApi.getOwnedGames(config.steamId, apiKey, summary.isPublic)
        for (const game of ownedGames) {
          const local = merged.get(game.steamAppId)
          const lastPlayedAt =
            game.lastPlayedAt && local?.lastPlayedAt
              ? game.lastPlayedAt > local.lastPlayedAt
                ? game.lastPlayedAt
                : local.lastPlayedAt
              : (game.lastPlayedAt ?? local?.lastPlayedAt ?? null)
          merged.set(game.steamAppId, {
            steamAppId: game.steamAppId,
            name: game.name || local?.name || `Steam App ${game.steamAppId}`,
            source: 'steam-api',
            installed: local?.installed ?? false,
            installDir: local?.installDir ?? null,
            playtimeMinutes: game.playtimeMinutes,
            lastPlayedAt
          })
        }
      }

      const syncedAt = this.now().toISOString()
      const seenIds = new Set(merged.keys())
      const unavailableCount = this.deps.store.markMissingSteamEntriesUnavailable(seenIds)

      // 1. Batch-lookup exact Steam AppID release extlinks on VNDB
      let releaseMap = new Map<number, SteamVndbReleaseMatch[]>()
      if (merged.size > 0) {
        try {
          releaseMap = await this.deps.metadata.findBySteamAppIds([...merged.keys()])
        } catch {
          // If offline, continue with existing catalog / local classification.
          releaseMap = new Map()
        }
      }

      let importedVnCount = 0
      let updatedVnCount = 0
      let reviewCount = 0
      let excludedCount = 0

      for (const item of merged.values()) {
        const prevCatalog = this.deps.store.getSteamCatalogItem(item.steamAppId)
        const existingEntry = this.deps.store.findBySteamAppId(item.steamAppId)
        const manualOverride = prevCatalog?.manualOverride ?? null
        const userLinkedVndbId =
          existingEntry?.provider.source?.provider === 'vndb'
            ? existingEntry.provider.source.externalId
            : (prevCatalog?.vndbId ?? null)
        const userLinkedVndbTitle =
          existingEntry?.provider.title ?? prevCatalog?.vndbTitle ?? null

        const releaseMatches = releaseMap.get(item.steamAppId) ?? []
        let titleCandidates: MetadataCandidate[] = []

        const needsTitleSearch =
          manualOverride === null &&
          releaseMatches.length === 0 &&
          !userLinkedVndbId &&
          !isNonGameSteamEntry(item.name) &&
          !(prevCatalog && prevCatalog.classification === 'excluded' && prevCatalog.name === item.name)

        if (needsTitleSearch) {
          try {
            const searchRes = await this.deps.metadata.search(item.name, { includeRestricted: true })
            titleCandidates = searchRes.candidates
          } catch {
            titleCandidates = []
          }
        } else if (prevCatalog && prevCatalog.candidateMatches.length > 0) {
          titleCandidates = prevCatalog.candidateMatches.map((c) => ({
            provider: 'vndb',
            externalId: c.id,
            title: c.title,
            originalTitle: c.originalTitle,
            releaseDate: c.releaseDate,
            developers: c.developer ? [c.developer] : [],
            languages: [],
            thumbnailUrl: null,
            contentRating: 'unrated'
          }))
        }

        const decision =
          userLinkedVndbId && manualOverride === null && releaseMatches.length === 0
            ? {
                classification: 'vn' as const,
                confidence: prevCatalog?.confidence ?? ('high' as const),
                reason: prevCatalog?.reason || 'Linked to VNDB.',
                vndbId: userLinkedVndbId,
                vndbTitle: userLinkedVndbTitle,
                candidateMatches: prevCatalog?.candidateMatches ?? []
              }
            : classifySteamEntry({
                steamAppId: item.steamAppId,
                name: item.name,
                manualOverride,
                existingVndbId: userLinkedVndbId,
                existingVndbTitle: userLinkedVndbTitle,
                releaseMatches,
                titleCandidates
              })

        let gameId: string | null = existingEntry?.id ?? null

        if (decision.classification === 'vn') {
          const { entry, created } = this.deps.store.upsertSteamGame({
            steamAppId: item.steamAppId,
            title: item.name,
            source: item.source,
            installed: item.installed,
            installDir: item.installDir,
            playtimeMinutes: item.playtimeMinutes,
            lastPlayedAt: item.lastPlayedAt,
            available: true
          })
          gameId = entry.id
          if (created) importedVnCount++
          else updatedVnCount++

          const currentVndb = entry.provider.source?.provider === 'vndb' ? entry.provider.source.externalId : null
          if (decision.vndbId && !currentVndb) {
            try {
              await this.deps.metadata.apply(entry.id, decision.vndbId, {
                replaceTitle: false,
                allowAdult: options.allowAdult
              })
            } catch {
              // Keep the imported Steam entry even if VNDB details fail to download.
            }
          }
        } else if (decision.classification === 'review') {
          reviewCount++
        } else {
          excludedCount++
        }

        this.deps.store.saveSteamCatalogItem({
          steamAppId: item.steamAppId,
          name: item.name,
          source: item.source,
          installed: item.installed,
          installDir: item.installDir,
          playtimeMinutes: item.playtimeMinutes,
          lastPlayedAt: item.lastPlayedAt,
          classification: decision.classification,
          confidence: decision.confidence,
          reason: decision.reason,
          manualOverride,
          vndbId: decision.vndbId,
          vndbTitle: decision.vndbTitle,
          candidateMatches: decision.candidateMatches,
          gameId,
          available: true,
          syncedAt
        })
      }

      const sourceLabel: 'steam-api' | 'steam-local' | 'both' =
        useApi && useLocal ? 'both' : useApi ? 'steam-api' : 'steam-local'

      const summary: SteamSyncSummary = {
        source: sourceLabel,
        discoveredCount: merged.size,
        importedVnCount,
        updatedVnCount,
        reviewCount,
        excludedCount,
        unavailableCount,
        syncedAt
      }

      this.writeConfig({
        ...this.readConfig(),
        lastSyncedAt: syncedAt,
        lastSyncSummary: summary
      })

      return summary
    } finally {
      this.syncing = false
    }
  }

  async setClassificationOverride(
    steamAppId: number,
    override: ClassificationOverride,
    options: { allowAdult: boolean }
  ): Promise<SteamCatalogItem> {
    const existing = this.deps.store.getSteamCatalogItem(steamAppId)
    if (!existing) {
      throw new UserFacingError('That Steam entry was not found in the synchronized catalog.')
    }

    if (override === 'exclude') {
      const linkedEntry = this.deps.store.findBySteamAppId(steamAppId)
      if (linkedEntry) {
        await this.deps.store.removeGame(linkedEntry.id)
      }
      const updated: SteamCatalogItem = {
        ...existing,
        manualOverride: 'exclude',
        classification: 'excluded',
        confidence: 'manual',
        reason: 'Excluded manually by you.',
        gameId: null
      }
      this.deps.store.saveSteamCatalogItem(updated)
      return updated
    }

    if (override === 'include') {
      const { entry } = this.deps.store.upsertSteamGame({
        steamAppId: existing.steamAppId,
        title: existing.name,
        source: existing.source,
        installed: existing.installed,
        installDir: existing.installDir,
        playtimeMinutes: existing.playtimeMinutes,
        lastPlayedAt: existing.lastPlayedAt,
        available: existing.available
      })

      const targetVndbId = existing.vndbId ?? existing.candidateMatches[0]?.id ?? null
      const targetVndbTitle = existing.vndbTitle ?? existing.candidateMatches[0]?.title ?? null

      if (targetVndbId && !entry.provider.source) {
        try {
          await this.deps.metadata.apply(entry.id, targetVndbId, {
            replaceTitle: false,
            allowAdult: options.allowAdult
          })
        } catch {
          // Non-fatal if offline
        }
      }

      const updated: SteamCatalogItem = {
        ...existing,
        manualOverride: 'include',
        classification: 'vn',
        confidence: 'manual',
        reason: 'Included manually by you.',
        vndbId: targetVndbId,
        vndbTitle: targetVndbTitle,
        gameId: entry.id
      }
      this.deps.store.saveSteamCatalogItem(updated)
      return updated
    }

    // Reset override to automatic (`override === null`)
    const updated: SteamCatalogItem = {
      ...existing,
      manualOverride: null,
      confidence: existing.vndbId ? 'high' : 'low',
      classification: existing.vndbId ? 'vn' : (existing.candidateMatches.length > 0 ? 'review' : 'excluded'),
      reason: existing.vndbId ? 'Matched on VNDB.' : 'Reset to automatic classification.'
    }
    this.deps.store.saveSteamCatalogItem(updated)
    return updated
  }

  async linkCatalogVndb(
    steamAppId: number,
    externalId: string,
    options: { allowAdult: boolean }
  ): Promise<SteamCatalogItem> {
    if (!VNDB_ID.test(externalId)) {
      throw new UserFacingError('That VNDB ID is not valid.')
    }
    const existing = this.deps.store.getSteamCatalogItem(steamAppId)
    if (!existing) {
      throw new UserFacingError('That Steam entry was not found in the synchronized catalog.')
    }

    const { entry } = this.deps.store.upsertSteamGame({
      steamAppId: existing.steamAppId,
      title: existing.name,
      source: existing.source,
      installed: existing.installed,
      installDir: existing.installDir,
      playtimeMinutes: existing.playtimeMinutes,
      lastPlayedAt: existing.lastPlayedAt,
      available: existing.available
    })

    const updatedEntry = await this.deps.metadata.apply(entry.id, externalId, {
      replaceTitle: false,
      allowAdult: options.allowAdult
    })

    const updated: SteamCatalogItem = {
      ...existing,
      manualOverride: 'include',
      classification: 'vn',
      confidence: 'manual',
      reason: 'Linked to VNDB by you.',
      vndbId: externalId,
      vndbTitle: updatedEntry.provider.title ?? existing.vndbTitle,
      gameId: updatedEntry.id
    }
    this.deps.store.saveSteamCatalogItem(updated)
    return updated
  }

  // ---- internal storage helpers ----

  private readConfig(): StoredSteamConfig {
    const row = this.deps.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', CONFIG_KEY)
    if (!row) return { ...DEFAULT_CONFIG }
    try {
      const parsed = JSON.parse(row.value) as Partial<StoredSteamConfig>
      return {
        mode: parsed.mode === 'api' || parsed.mode === 'local' || parsed.mode === 'both' ? parsed.mode : null,
        steamId: typeof parsed.steamId === 'string' ? parsed.steamId : null,
        personaName: typeof parsed.personaName === 'string' ? parsed.personaName : null,
        profileUrl: typeof parsed.profileUrl === 'string' ? parsed.profileUrl : null,
        avatarUrl: typeof parsed.avatarUrl === 'string' ? parsed.avatarUrl : null,
        localSteamPath: typeof parsed.localSteamPath === 'string' ? parsed.localSteamPath : null,
        lastSyncedAt: typeof parsed.lastSyncedAt === 'string' ? parsed.lastSyncedAt : null,
        lastSyncSummary: parsed.lastSyncSummary ?? null
      }
    } catch {
      return { ...DEFAULT_CONFIG }
    }
  }

  private writeConfig(config: StoredSteamConfig): void {
    this.deps.db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      CONFIG_KEY,
      JSON.stringify(config)
    )
  }

  private readApiKey(): string | null {
    const row = this.deps.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', SECRET_KEY)
    if (!row || !row.value) return null
    try {
      return this.cipher.decrypt(row.value)
    } catch {
      return null
    }
  }

  private writeApiKey(plainKey: string): void {
    const encrypted = this.cipher.encrypt(plainKey)
    this.deps.db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      SECRET_KEY,
      encrypted
    )
  }

  private clearApiKey(): void {
    this.deps.db.run('DELETE FROM settings WHERE key = ?', SECRET_KEY)
  }
}
