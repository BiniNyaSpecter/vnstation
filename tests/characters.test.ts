import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LibraryStore } from '../src/main/db/libraryStore'
import { MetadataCache } from '../src/main/db/metadataCache'
import { openLibraryDatabase } from '../src/main/db/openLibraryDatabase'
import type { Database } from '../src/main/db/sqlite'
import { ArtworkCache } from '../src/main/metadata/artworkCache'
import type { Fetcher } from '../src/main/metadata/http'
import { MetadataService } from '../src/main/metadata/metadataService'
import { RequestScheduler } from '../src/main/metadata/scheduler'
import {
  parseCharacterBiography,
  parseCharactersResponse,
  VndbProvider
} from '../src/main/metadata/vndb'

const TINY_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82
])

const SAMPLE_CHARACTER_API_RESPONSE = {
  more: false,
  results: [
    {
      id: 'c30',
      name: 'Side Kick',
      original: 'サイド',
      aliases: ['Buddy'],
      description: 'Appears in café scenes.',
      blood_type: 'O',
      height: 170,
      weight: 60,
      age: 19,
      birthday: [4, 12],
      image: {
        url: 'https://t.vndb.org/ch/30/12345.jpg',
        dims: [300, 400],
        sexual: 0,
        violence: 0
      },
      vns: [
        { id: 'v999', role: 'main', spoiler: 2 },
        { id: 'v17', role: 'side', spoiler: 0 }
      ],
      traits: [
        { id: 'i10', name: 'Cheerful', group_name: 'Personality', spoiler: 0, lie: false },
        { id: 'i11', name: 'Secret Agent', group_name: 'Role', spoiler: 2, lie: false }
      ]
    },
    {
      id: 'c10',
      name: 'Heroine One',
      original: 'ヒロイン',
      aliases: ['First Girl'],
      description: 'She is a [b]transfer student[/b] from [url=https://vndb.org]Tokyo[/url]. [spoiler]She remembers the previous timeline.[/spoiler]',
      blood_type: 'A',
      height: 160,
      weight: null,
      age: 17,
      birthday: [7, 7],
      image: {
        url: 'https://t.vndb.org/ch/10/11111.jpg',
        dims: [300, 400],
        sexual: 0,
        violence: 0
      },
      vns: [{ id: 'v17', role: 'main', spoiler: 0 }],
      traits: [{ id: 'i1', name: 'Long Hair', group_name: 'Hair', spoiler: 0, lie: false }]
    },
    {
      id: 'c20',
      name: 'Hidden Mastermind',
      original: '黒幕',
      aliases: [],
      description: '[spoiler]The true architect of the time loop.[/spoiler]',
      blood_type: 'AB',
      height: null,
      weight: null,
      age: null,
      birthday: null,
      image: {
        url: 'https://t.vndb.org/ch/20/22222.jpg',
        dims: [300, 400],
        sexual: 1.8, // Unsafe in family mode
        violence: 0
      },
      vns: [{ id: 'v17', role: 'primary', spoiler: 2 }],
      traits: []
    },
    {
      id: 'c99',
      name: 'Unrelated VN Character',
      original: null,
      aliases: [],
      description: 'Only appears in another VN.',
      blood_type: null,
      height: null,
      weight: null,
      age: null,
      birthday: null,
      image: null,
      vns: [{ id: 'v8888', role: 'main', spoiler: 0 }],
      traits: []
    }
  ]
}

describe('VNDB Character Parsing, Role Filtering, and Spoiler Segmentation (Criteria 1, 2, 3, 4, 5, 6)', () => {
  it('filters vns roles and spoiler levels to the current VN only and orders by role priority (Criteria 2, 3)', () => {
    const parsed = parseCharactersResponse(SAMPLE_CHARACTER_API_RESPONSE, 'v17', 'family')
    // c99 belongs only to v8888 and must be excluded
    expect(parsed.map((c) => c.id)).toEqual(['c10', 'c20', 'c30'])

    // c30 is 'main' in v999 (spoiler 2) but 'side' in v17 (spoiler 0) -> must use v17's role & spoiler!
    const sideKick = parsed.find((c) => c.id === 'c30')!
    expect(sideKick.role).toBe('side')
    expect(sideKick.spoiler).toBe(0)

    // c20 has a major spoiler role (spoiler: 2) and an adult-flagged portrait that must be withheld in family policy
    const mastermind = parsed.find((c) => c.id === 'c20')!
    expect(mastermind.role).toBe('primary')
    expect(mastermind.spoiler).toBe(2)
    expect(mastermind.portraitUrl).toBeNull()

    // In adult policy, c20's portrait URL is kept
    const adultParsed = parseCharactersResponse(SAMPLE_CHARACTER_API_RESPONSE, 'v17', 'adult')
    expect(adultParsed.find((c) => c.id === 'c20')?.portraitUrl).toBe('https://t.vndb.org/ch/20/22222.jpg')
  })

  it('strips VNDB BBCode safely while isolating [spoiler] segments for explicit reveal (Criteria 4, 5, 6)', () => {
    const bio = parseCharacterBiography(
      'She is a [b]transfer student[/b] from [url=https://vndb.org]Tokyo[/url]. [spoiler]She remembers the previous timeline.[/spoiler]'
    )
    expect(bio.plainDescription).toBe('She is a transfer student from Tokyo.')
    expect(bio.hasSpoilers).toBe(true)
    expect(bio.segments).toEqual([
      { text: 'She is a transfer student from Tokyo.', spoiler: false },
      { text: 'She remembers the previous timeline.', spoiler: true }
    ])
  })
})

describe('VNDB Character SQLite Caching, Offline Fallback, Refresh, and Empty States (Criteria 7, 8, 9)', () => {
  let db: Database
  let artDir: string
  let store: LibraryStore
  let networkOnline: boolean
  let characterQueryCount: number
  let currentApiCharacters: unknown[]

  beforeEach(async () => {
    artDir = await mkdtemp(join(tmpdir(), 'vnstation-char-art-'))
    db = openLibraryDatabase(':memory:')
    store = new LibraryStore(db)
    networkOnline = true
    characterQueryCount = 0
    currentApiCharacters = SAMPLE_CHARACTER_API_RESPONSE.results
  })

  afterEach(async () => {
    db.close()
    await rm(artDir, { recursive: true, force: true })
  })

  function createMetadataService(): MetadataService {
    const fetcher: Fetcher = async (url) => {
      if (!networkOnline) {
        throw new Error('Network unreachable')
      }
      if (url.endsWith('/character')) {
        characterQueryCount++
        return new Response(
          JSON.stringify({ more: false, results: currentApiCharacters }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      if (url.includes('t.vndb.org/ch/')) {
        return new Response(TINY_PNG, { status: 200, headers: { 'content-type': 'image/png' } })
      }
      return new Response('Not found', { status: 404 })
    }

    const provider = new VndbProvider(fetcher, new RequestScheduler({ minIntervalMs: 0, maxPerWindow: 200, windowMs: 60_000 }), 'VNStation-Test')
    return new MetadataService({
      provider,
      store,
      cache: new MetadataCache(db),
      art: new ArtworkCache(artDir, fetcher)
    })
  }

  it('caches characters and portraits locally, serves from cache offline, and updates on force refresh (Criteria 7, 8)', async () => {
    const service = createMetadataService()
    const game = await store.addGame({
      title: 'Ever17',
      launch: { executablePath: 'C:\\VN\\ever17.exe', workingDirectory: 'C:\\VN', arguments: '' }
    })
    await store.setProviderMetadata(game.id, {
      source: { provider: 'vndb', externalId: 'v17' },
      title: 'Ever17 -the out of infinity-',
      originalTitle: null,
      altTitles: [],
      synopsis: 'Test',
      developer: 'KID',
      releaseDate: '2002',
      originalLanguage: 'Japanese',
      languages: ['Japanese', 'English'],
      genres: [],
      tags: [],
      contentRating: 'teen',
      coverUrl: null,
      backgroundUrl: null,
      fetchedAt: new Date().toISOString()
    })

    // First load fetches from VNDB and downloads portraits to vnstation-art://
    const first = await service.getCharacters(game.id, { allowAdult: false })
    expect(first.fromCache).toBe(false)
    expect(first.characters).toHaveLength(3)
    expect(first.characters[0].portraitUrl).toMatch(/^vnstation-art:\/\/art\/vndb\/c10-portrait\.png/)
    expect(characterQueryCount).toBe(1)

    // Second load while offline serves directly from SQLite cache without network requests
    networkOnline = false
    const second = await service.getCharacters(game.id, { allowAdult: false })
    expect(second.fromCache).toBe(true)
    expect(second.characters).toHaveLength(3)
    expect(characterQueryCount).toBe(1)

    // Force refresh while online re-queries VNDB and updates the cache
    networkOnline = true
    currentApiCharacters = [SAMPLE_CHARACTER_API_RESPONSE.results[1]] // Only c10
    const refreshed = await service.getCharacters(game.id, { allowAdult: false, force: true })
    expect(refreshed.fromCache).toBe(false)
    expect(refreshed.characters).toHaveLength(1)
    expect(refreshed.characters[0].id).toBe('c10')
    expect(characterQueryCount).toBe(2)
  })

  it('handles visual novels with no character records gracefully (Criterion 9)', async () => {
    const service = createMetadataService()
    currentApiCharacters = []
    const game = await store.addGame({
      title: 'Minimal VN',
      launch: { executablePath: 'C:\\VN\\min.exe', workingDirectory: 'C:\\VN', arguments: '' }
    })
    await store.setProviderMetadata(game.id, {
      source: { provider: 'vndb', externalId: 'v500' },
      title: 'Minimal VN',
      originalTitle: null,
      altTitles: [],
      synopsis: null,
      developer: null,
      releaseDate: null,
      originalLanguage: null,
      languages: [],
      genres: [],
      tags: [],
      contentRating: 'all-ages',
      coverUrl: null,
      backgroundUrl: null,
      fetchedAt: new Date().toISOString()
    })

    const result = await service.getCharacters(game.id, { allowAdult: false })
    expect(result.characters).toEqual([])
    expect(result.fromCache).toBe(false)

    // Subsequent call uses the cached empty state without re-fetching
    const cachedEmpty = await service.getCharacters(game.id, { allowAdult: false })
    expect(cachedEmpty.characters).toEqual([])
    expect(cachedEmpty.fromCache).toBe(true)
    expect(characterQueryCount).toBe(1)
  })
})
