import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MetadataCandidate, MetadataDetails } from '@shared/metadata'
import { LibraryStore } from '../src/main/db/libraryStore'
import { MetadataCache } from '../src/main/db/metadataCache'
import { openLibraryDatabase } from '../src/main/db/openLibraryDatabase'
import type { Database } from '../src/main/db/sqlite'
import { ArtworkCache } from '../src/main/metadata/artworkCache'
import { MetadataService, normalizeQuery } from '../src/main/metadata/metadataService'
import type { MetadataProvider } from '../src/main/metadata/provider'
import { parseSearchResponse, parseVnDetails, type ContentPolicy } from '../src/main/metadata/vndb'
import { bytesResponse, detailsResponse, fakeFetcher, JPEG, PNG, restrictedDetailsResponse, searchResponse } from './fixtures/vndb'

class FakeProvider implements MetadataProvider {
  readonly id = 'vndb' as const
  searches = 0
  detailLookups = 0
  constructor(private readonly details: (policy: ContentPolicy) => MetadataDetails = (policy) => parseVnDetails(detailsResponse, [12], policy)) {}
  async search(_query: string, policy: ContentPolicy): Promise<MetadataCandidate[]> {
    this.searches++
    return parseSearchResponse(searchResponse, policy)
  }
  async getDetails(_id: string, policy: ContentPolicy): Promise<MetadataDetails> {
    this.detailLookups++
    return this.details(policy)
  }
}

describe('MetadataService', () => {
  let dir: string
  let db: Database
  let store: LibraryStore
  let artFetches: string[]
  let failArt = false
  let provider: FakeProvider
  let service: MetadataService
  let gameId: string

  const build = (p: FakeProvider): MetadataService => {
    const { fetcher } = fakeFetcher((r) => {
      artFetches.push(r.url)
      return failArt ? bytesResponse(JPEG, 503) : bytesResponse(JPEG)
    })
    return new MetadataService({
      provider: p, store, cache: new MetadataCache(db), art: new ArtworkCache(join(dir, 'artwork'), fetcher),
      now: () => new Date('2026-10-20T12:00:00.000Z')
    })
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vnstation-meta-'))
    db = openLibraryDatabase(':memory:')
    store = new LibraryStore(db)
    artFetches = []
    failArt = false
    provider = new FakeProvider()
    service = build(provider)
    gameId = (await store.addGame({ title: 'Hollowmere (from file name)', launch: { executablePath: 'D:\\VN\\h.exe', workingDirectory: 'D:\\VN', arguments: '' } })).id
  })
  afterEach(async () => { db.close(); await rm(dir, { recursive: true, force: true }) })

  describe('search', () => {
    it('hides adults-only results by default and says how many were hidden', async () => {
      const result = await service.search('hollowmere', { includeRestricted: false })
      expect(result.candidates.map((c) => c.externalId)).toEqual(['v101', 'v102', 'v104'])
      expect(result.hiddenRestrictedCount).toBe(1)
    })

    it('includes them only when the user has chosen to see adults-only entries', async () => {
      const result = await service.search('hollowmere', { includeRestricted: true })
      expect(result.candidates.map((c) => c.externalId)).toContain('v103')
      // After the age confirmation their thumbnails are shown too.
      expect(result.candidates.find((c) => c.externalId === 'v103')?.thumbnailUrl).toBe('https://t.vndb.org/cv.t/03/103.jpg')
      expect(result.hiddenRestrictedCount).toBe(0)
    })

    it('keeps family and adult results apart in the cache', async () => {
      await service.search('hollowmere', { includeRestricted: false })
      await service.search('hollowmere', { includeRestricted: true })
      expect(provider.searches).toBe(2)
      await service.search('hollowmere', { includeRestricted: true })
      expect(provider.searches).toBe(2)
    })

    it('answers repeat searches from the cache without asking the provider again', async () => {
      expect((await service.search('Hollowmere', { includeRestricted: false })).fromCache).toBe(false)
      expect((await service.search('  hollowmere ', { includeRestricted: false })).fromCache).toBe(true)
      expect(provider.searches).toBe(1)
    })

    it('validates the query', () => {
      expect(() => normalizeQuery('   ')).toThrow('Type a title')
      expect(() => normalizeQuery('x'.repeat(201))).toThrow('too long')
      expect(() => normalizeQuery(null)).toThrow('Type a title')
      expect(normalizeQuery('  two   words ')).toBe('two words')
    })
  })

  describe('apply', () => {
    it('saves details, downloads artwork and shows the official title', async () => {
      const entry = await service.apply(gameId, 'v101', { replaceTitle: true, allowAdult: false })
      expect(entry.provider.source).toEqual({ provider: 'vndb', externalId: 'v101' })
      expect(entry.provider.title).toBe('Lanterns of Hollowmere')
      expect(entry.provider.originalTitle).toBe('ホロウメアの灯')
      expect(entry.provider.tags).toEqual(['Atmospheric', 'Ghosts'])
      expect(entry.provider.altTitles).toContain('Hollowmere Lanterns')
      expect(entry.provider.contentRating).toBe('teen')
      expect(entry.provider.fetchedAt).toBe('2026-10-20T12:00:00.000Z')
      expect(entry.provider.coverUrl).toMatch(/^vnstation-art:\/\/art\/vndb\/v101-cover\.jpg\?v=\d+$/)
      expect(entry.provider.backgroundUrl).toMatch(/v101-background\.jpg/)
      expect(entry.user.title).toBeNull()
      expect(artFetches).toHaveLength(2)
      expect((await readdir(join(dir, 'artwork', 'vndb'))).sort()).toEqual(['v101-background.jpg', 'v101-cover.jpg'])
    })

    it('can keep the title the user typed', async () => {
      const entry = await service.apply(gameId, 'v101', { replaceTitle: false, allowAdult: false })
      expect(entry.user.title).toBe('Hollowmere (from file name)')
      expect(entry.provider.title).toBe('Lanterns of Hollowmere')
    })

    it('never overwrites what the user edited themselves', async () => {
      await store.updateGame(gameId, { user: { synopsis: 'My own summary', developer: 'Me', notes: 'Chapter 4' }, favorite: true })
      const entry = await service.apply(gameId, 'v101', { replaceTitle: true, allowAdult: false })
      expect(entry.user.synopsis).toBe('My own summary')
      expect(entry.user.developer).toBe('Me')
      expect(entry.user.notes).toBe('Chapter 4')
      expect(entry.favorite).toBe(true)
      expect(entry.provider.synopsis).toContain('Every autumn')
    })

    it('stores no description and no artwork for adults-only games', async () => {
      const restricted = new FakeProvider((policy) => parseVnDetails(restrictedDetailsResponse, [18], policy))
      const entry = await build(restricted).apply(gameId, 'v103', { replaceTitle: true, allowAdult: false })
      expect(entry.provider.contentRating).toBe('restricted')
      expect(entry.provider.title).toBe('Velvet Static')
      expect(entry.provider.synopsis).toBeNull()
      expect(entry.provider.coverUrl).toBeNull()
      expect(entry.provider.backgroundUrl).toBeNull()
      expect(artFetches).toHaveLength(0)
      // the cached response must not contain the description either
      const cached = db.get<{ response: string }>("SELECT response FROM metadata_cache WHERE cache_key LIKE 'vndb:details:%'")
      expect(cached?.response).not.toContain('must never be shown')
    })

    it('keeps the description and artwork of adults-only games once the user has confirmed their age', async () => {
      const adult = new FakeProvider((policy) => parseVnDetails(restrictedDetailsResponse, [18], policy))
      const entry = await build(adult).apply(gameId, 'v103', { replaceTitle: true, allowAdult: true })
      expect(entry.provider.contentRating).toBe('restricted')
      expect(entry.provider.synopsis).toBe('An adult description that must never be shown.')
      expect(entry.provider.coverUrl).toMatch(/v103-cover\.jpg/)
      expect(entry.provider.backgroundUrl).toMatch(/v103-background\.jpg/)
      expect(artFetches).toHaveLength(2)
    })

    it('still saves the details when artwork cannot be downloaded', async () => {
      failArt = true
      const entry = await service.apply(gameId, 'v101', { replaceTitle: true, allowAdult: false })
      expect(entry.provider.title).toBe('Lanterns of Hollowmere')
      expect(entry.provider.coverUrl).toBeNull()
      expect(entry.provider.backgroundUrl).toBeNull()
    })

    it('replaces tags and titles when switching to a different match, without leaving orphans', async () => {
      await service.apply(gameId, 'v101', { replaceTitle: true, allowAdult: false })
      const other = new FakeProvider(() => ({ ...parseVnDetails(detailsResponse, []), source: { provider: 'vndb', externalId: 'v200' }, title: 'Other Game', tags: ['Comedy'], altTitles: [], languages: ['English'] }))
      const entry = await build(other).apply(gameId, 'v200', { replaceTitle: true, allowAdult: false })
      expect(entry.provider.tags).toEqual(['Comedy'])
      expect(entry.provider.altTitles).toEqual([])
      expect(db.all("SELECT name FROM tags").map((r) => r.name)).toEqual(['Comedy'])
    })

    it('fails clearly for invalid ids and for games that no longer exist, before any lookup', async () => {
      await expect(service.apply(gameId, 'x1', { replaceTitle: true, allowAdult: false })).rejects.toThrow('not valid')
      await expect(service.apply('game-gone', 'v101', { replaceTitle: true, allowAdult: false })).rejects.toThrow('no longer in the library')
      expect(provider.detailLookups).toBe(0)
    })

    it('reuses cached details for the same game', async () => {
      await service.apply(gameId, 'v101', { replaceTitle: true, allowAdult: false })
      await service.apply(gameId, 'v101', { replaceTitle: true, allowAdult: false })
      expect(provider.detailLookups).toBe(1)
    })
  })

  describe('refresh, unlink and artwork', () => {
    it('refresh bypasses the cache and requires a linked game', async () => {
      await expect(service.refresh(gameId, { allowAdult: false })).rejects.toThrow('not linked')
      await service.apply(gameId, 'v101', { replaceTitle: false, allowAdult: false })
      await service.refresh(gameId, { allowAdult: false })
      expect(provider.detailLookups).toBe(2)
    })

    it('keeps the old artwork if a refresh cannot download new files', async () => {
      const first = await service.apply(gameId, 'v101', { replaceTitle: false, allowAdult: false })
      failArt = true
      const refreshed = await service.refresh(gameId, { allowAdult: false })
      expect(refreshed.provider.coverUrl).toBe(first.provider.coverUrl)
    })

    it('unlinking removes provider details but keeps the user’s edits', async () => {
      await store.updateGame(gameId, { user: { notes: 'keep me' } })
      await service.apply(gameId, 'v101', { replaceTitle: false, allowAdult: false })
      const entry = await service.unlink(gameId)
      expect(entry.provider.source).toBeNull()
      expect(entry.provider.title).toBeNull()
      expect(entry.provider.tags).toEqual([])
      expect(entry.provider.fetchedAt).toBeNull()
      expect(entry.user.title).toBe('Hollowmere (from file name)')
      expect(entry.user.notes).toBe('keep me')
    })

    it('lets the user pick their own cover and reset it', async () => {
      const picture = join(dir, 'cover.png')
      await writeFile(picture, PNG)
      const withCover = await service.setUserArtwork(gameId, 'cover', picture)
      expect(withCover.user.coverUrl).toMatch(/^vnstation-art:\/\/art\/user\/.*-cover\.png\?v=\d+$/)

      const reset = await service.resetArtwork(gameId, 'cover')
      expect(reset.user.coverUrl).toBeNull()
      expect(await readdir(join(dir, 'artwork', 'user'))).toEqual([])
    })

    it('clearing the cache removes files and forgets their URLs, but keeps the details', async () => {
      await service.apply(gameId, 'v101', { replaceTitle: true, allowAdult: false })
      expect((await service.cacheStats()).files).toBe(2)
      await service.clearCache()
      expect(await service.cacheStats()).toEqual({ files: 0, bytes: 0 })
      const entry = store.getEntry(gameId)
      expect(entry.provider.coverUrl).toBeNull()
      expect(entry.provider.title).toBe('Lanterns of Hollowmere')
    })
  })
})
