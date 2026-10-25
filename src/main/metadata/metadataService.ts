import type { CharacterListResult, CharacterRecord } from '@shared/characters'
import type { ApplyMetadataOptions } from '@shared/contracts'
import type { ArtworkKind, MetadataCandidate, MetadataDetails, MetadataSearchResult } from '@shared/metadata'
import type { GameEntry, ProviderMetadata } from '@shared/types'
import type { LibraryStore } from '../db/libraryStore'
import type { MetadataCache } from '../db/metadataCache'
import { UserFacingError } from '../errors'
import type { ArtworkCache } from './artworkCache'
import type { MetadataProvider } from './provider'
import { VNDB_ID, type ContentPolicy, type SteamVndbReleaseMatch } from './vndb'

const SEARCH_TTL_MS = 24 * 60 * 60_000
const DETAILS_TTL_MS = 7 * 24 * 60 * 60_000

type Store = Pick<LibraryStore, 'getEntry' | 'setProviderMetadata' | 'updateGame' | 'clearProviderArtworkUrls'> &
  Partial<Pick<LibraryStore, 'getCachedCharacters' | 'saveCachedCharacters'>>

export function normalizeQuery(query: unknown): string {
  if (typeof query !== 'string' || query.includes('\0')) throw new UserFacingError('Type a title to search for.')
  const text = query.replace(/\s+/g, ' ').trim()
  if (!text) throw new UserFacingError('Type a title to search for.')
  if (text.length > 200) throw new UserFacingError('That search is too long.')
  return text
}

/**
 * Finds details for a game, downloads its artwork, and saves both. User edits are
 * kept separately by the store, so nothing here can overwrite them.
 */
export class MetadataService {
  constructor(
    private readonly deps: {
      provider: MetadataProvider
      store: Store
      cache: MetadataCache
      art: ArtworkCache
      now?: () => Date
    }
  ) {}

  async search(query: string, options: { includeRestricted: boolean }): Promise<MetadataSearchResult> {
    const text = normalizeQuery(query)
    const policy: ContentPolicy = options.includeRestricted ? 'adult' : 'family'
    const key = `vndb:search:v2:${policy}:${text.toLowerCase()}`
    let candidates = this.deps.cache.get<MetadataCandidate[]>(key, SEARCH_TTL_MS)
    const fromCache = candidates !== null
    if (!candidates) {
      candidates = await this.deps.provider.search(text, policy)
      this.deps.cache.set(key, candidates)
    }
    const restricted = candidates.filter((c) => c.contentRating === 'restricted')
    return options.includeRestricted
      ? { candidates, hiddenRestrictedCount: 0, fromCache }
      : { candidates: candidates.filter((c) => c.contentRating !== 'restricted'), hiddenRestrictedCount: restricted.length, fromCache }
  }

  async apply(gameId: string, externalId: string, options: ApplyMetadataOptions): Promise<GameEntry> {
    if (!VNDB_ID.test(externalId)) throw new UserFacingError('That VNDB ID is not valid.')
    this.deps.store.getEntry(gameId) // fail early if the game is gone
    return this.write(gameId, await this.details(externalId, options.allowAdult ? 'adult' : 'family', false), options.replaceTitle)
  }

  async refresh(gameId: string, options: { allowAdult: boolean }): Promise<GameEntry> {
    const source = this.deps.store.getEntry(gameId).provider.source
    if (!source || source.provider !== 'vndb') throw new UserFacingError('This game is not linked to VNDB yet. Use “Find details” first.')
    return this.write(gameId, await this.details(source.externalId, options.allowAdult ? 'adult' : 'family', true), false)
  }

  async unlink(gameId: string): Promise<GameEntry> {
    return this.deps.store.setProviderMetadata(gameId, null)
  }

  async setUserArtwork(gameId: string, kind: ArtworkKind, sourcePath: string): Promise<GameEntry> {
    this.deps.store.getEntry(gameId)
    const url = await this.deps.art.saveUserImage(sourcePath, gameId, kind)
    return this.deps.store.updateGame(gameId, { user: kind === 'cover' ? { coverUrl: url } : { backgroundUrl: url } })
  }

  async resetArtwork(gameId: string, kind: ArtworkKind): Promise<GameEntry> {
    const entry = await this.deps.store.updateGame(gameId, { user: kind === 'cover' ? { coverUrl: null } : { backgroundUrl: null } })
    await this.deps.art.deleteUserImage(gameId, kind)
    return entry
  }

  cacheStats(): Promise<{ files: number; bytes: number }> {
    return this.deps.art.stats()
  }

  async clearCache(): Promise<void> {
    await this.deps.art.clearProviderCache()
    await this.deps.store.clearProviderArtworkUrls()
  }

  async getCharacters(gameId: string, options: { allowAdult: boolean; force?: boolean }): Promise<CharacterListResult> {
    const entry = this.deps.store.getEntry(gameId)
    const source = entry.provider.source
    if (!source || source.provider !== 'vndb' || !VNDB_ID.test(source.externalId)) {
      throw new UserFacingError('This game is not linked to VNDB yet. Use “Find details” first to load its character cast.')
    }

    const vndbId = source.externalId
    const policy: ContentPolicy = options.allowAdult ? 'adult' : 'family'
    const cacheKey = `vndb:characters:v1:${policy}:${vndbId}`
    const existing = this.deps.store.getCachedCharacters?.(vndbId) ?? []
    const cachedMeta = options.force ? null : this.deps.cache.get<{ fetchedAt: string; count: number }>(cacheKey, DETAILS_TTL_MS)

    if (
      cachedMeta !== null &&
      existing.length === cachedMeta.count &&
      existing.every((c) => !c.portraitUrl || c.portraitUrl.startsWith('vnstation-art://'))
    ) {
      return {
        vndbId,
        characters: existing,
        fromCache: true,
        fetchedAt: existing[0]?.fetchedAt ?? cachedMeta.fetchedAt
      }
    }

    if (!this.deps.provider.getCharacters) {
      return {
        vndbId,
        characters: existing,
        fromCache: true,
        fetchedAt: existing[0]?.fetchedAt ?? null
      }
    }

    let remoteCharacters: CharacterRecord[]
    try {
      remoteCharacters = await this.deps.provider.getCharacters(vndbId, policy)
    } catch (error) {
      if (existing.length > 0 && !options.force) {
        return {
          vndbId,
          characters: existing,
          fromCache: true,
          fetchedAt: existing[0]?.fetchedAt ?? null
        }
      }
      throw error
    }

    const previousByCharId = new Map(existing.map((c) => [c.id, c.portraitUrl]))
    const fetchedAt = (this.deps.now?.() ?? new Date()).toISOString()
    const localized: CharacterRecord[] = []

    for (const char of remoteCharacters) {
      const prevPortrait = previousByCharId.get(char.id) ?? null
      const portraitUrl = await this.download(char.portraitUrl, `${char.id}-portrait`, prevPortrait)
      localized.push({
        ...char,
        portraitUrl,
        fetchedAt
      })
    }

    this.deps.store.saveCachedCharacters?.(vndbId, localized)
    this.deps.cache.set(cacheKey, { fetchedAt, count: localized.length })
    return {
      vndbId,
      characters: localized,
      fromCache: false,
      fetchedAt
    }
  }

  async findBySteamAppIds(appIds: readonly number[]): Promise<Map<number, SteamVndbReleaseMatch[]>> {
    if (!this.deps.provider.findBySteamAppIds) return new Map()
    return this.deps.provider.findBySteamAppIds(appIds)
  }

  private async details(externalId: string, policy: ContentPolicy, force: boolean): Promise<MetadataDetails> {
    const key = `vndb:details:v2:${policy}:${externalId}`
    const cached = force ? null : this.deps.cache.get<MetadataDetails>(key, DETAILS_TTL_MS)
    if (cached) return cached
    const details = await this.deps.provider.getDetails(externalId, policy)
    this.deps.cache.set(key, details)
    return details
  }

  private async download(url: string | null, name: string, previous: string | null): Promise<string | null> {
    if (!url) return null
    try {
      return await this.deps.art.downloadProviderImage(url, name)
    } catch (error) {
      // Artwork is optional: keep whatever the game had, and let the generated art fill in.
      console.error('[metadata] artwork download failed:', error instanceof Error ? error.message : error)
      return previous
    }
  }

  private async write(gameId: string, details: MetadataDetails, replaceTitle: boolean): Promise<GameEntry> {
    const id = details.source?.externalId ?? ''
    const previous = this.deps.store.getEntry(gameId).provider
    const meta: ProviderMetadata = {
      source: details.source,
      title: details.title,
      originalTitle: details.originalTitle,
      altTitles: details.altTitles,
      synopsis: details.synopsis,
      developer: details.developer,
      releaseDate: details.releaseDate,
      originalLanguage: details.originalLanguage,
      languages: details.languages,
      genres: details.genres,
      tags: details.tags,
      contentRating: details.contentRating,
      coverUrl: await this.download(details.coverRemoteUrl, `${id}-cover`, previous.source?.externalId === id ? previous.coverUrl : null),
      backgroundUrl: await this.download(details.backgroundRemoteUrl, `${id}-background`, previous.source?.externalId === id ? previous.backgroundUrl : null),
      fetchedAt: (this.deps.now?.() ?? new Date()).toISOString()
    }
    return this.deps.store.setProviderMetadata(gameId, meta, { clearUserTitle: replaceTitle })
  }
}
