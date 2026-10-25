import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LibraryStore } from '../src/main/db/libraryStore'
import { MetadataCache } from '../src/main/db/metadataCache'
import { openLibraryDatabase } from '../src/main/db/openLibraryDatabase'
import type { Database } from '../src/main/db/sqlite'
import { ProcessGameLauncher } from '../src/main/launcher/gameLauncher'
import { ArtworkCache } from '../src/main/metadata/artworkCache'
import type { Fetcher } from '../src/main/metadata/http'
import { MetadataService } from '../src/main/metadata/metadataService'
import type { MetadataProvider } from '../src/main/metadata/provider'
import { classifySteamEntry, isNonGameSteamEntry, normalizeLooseTitle } from '../src/main/steam/classifier'
import { scanLocalSteamInstallation } from '../src/main/steam/localSteam'
import { SteamService } from '../src/main/steam/steamService'
import {
  parseSteamIdentifier,
  type SecretCipher,
  SteamWebApiClient,
  validateApiKeyFormat
} from '../src/main/steam/steamWebApi'
import { parseAppManifestAcf, parseLibraryFoldersVdf } from '../src/main/steam/vdf'

const VALID_KEY = '0123456789ABCDEF0123456789ABCDEF'
const VALID_STEAM_ID = '76561198012345678'

describe('Steam identifier and API key validation (Criterion 1)', () => {
  it('accepts SteamID64, profile URLs, and vanity URLs', () => {
    expect(parseSteamIdentifier(VALID_STEAM_ID)).toEqual({ kind: 'steamid', steamId: VALID_STEAM_ID })
    expect(parseSteamIdentifier(`https://steamcommunity.com/profiles/${VALID_STEAM_ID}/`)).toEqual({
      kind: 'steamid',
      steamId: VALID_STEAM_ID
    })
    expect(parseSteamIdentifier('https://steamcommunity.com/id/visualnovelfan/')).toEqual({
      kind: 'vanity',
      vanity: 'visualnovelfan'
    })
    expect(parseSteamIdentifier('visualnovelfan')).toEqual({
      kind: 'vanity',
      vanity: 'visualnovelfan'
    })
  })

  it('rejects empty or malformed Steam identifiers and invalid API keys', () => {
    expect(() => parseSteamIdentifier('   ')).toThrow('Enter your SteamID64')
    expect(() => parseSteamIdentifier('https://example.com/not-steam')).toThrow('not valid')
    expect(validateApiKeyFormat(VALID_KEY.toLowerCase())).toBe(VALID_KEY)
    expect(() => validateApiKeyFormat('short-key')).toThrow('32-character hexadecimal')
  })
})

describe('VDF and ACF local Steam parsing (Criterion 3)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'vnstation-steam-vdf-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('parses libraryfolders.vdf in both modern nested and legacy flat formats', () => {
    const vdf = `
    "libraryfolders"
    {
      "0"
      {
        "path"    "C:\\\\Program Files (x86)\\\\Steam"
        "label"   ""
      }
      "1"
      {
        "path"    "D:\\\\SteamLibrary"
      }
      "2"   "E:\\\\Games\\\\Steam"
    }
    `
    expect(parseLibraryFoldersVdf(vdf)).toEqual([
      'C:\\Program Files (x86)\\Steam',
      'D:\\SteamLibrary',
      'E:\\Games\\Steam'
    ])
  })

  it('parses appmanifest_*.acf files and scans local Steam library folders', async () => {
    const steamApps = join(tempDir, 'steamapps')
    const commonGameDir = join(steamApps, 'common', 'STEINS;GATE')
    await mkdir(commonGameDir, { recursive: true })

    const acf = `
    "AppState"
    {
      "appid"       "412830"
      "Universe"    "1"
      "name"        "STEINS;GATE"
      "StateFlags"  "4"
      "installdir"  "STEINS;GATE"
      "LastPlayed"  "1700000000"
    }
    `
    await writeFile(join(steamApps, 'appmanifest_412830.acf'), acf, 'utf8')
    // Steamworks Common Redistributables should be ignored automatically
    await writeFile(
      join(steamApps, 'appmanifest_228980.acf'),
      '"AppState" { "appid" "228980" "name" "Steamworks Common Redistributables" "installdir" "Steamworks Shared" }',
      'utf8'
    )

    const parsed = parseAppManifestAcf(acf)
    expect(parsed?.appId).toBe(412830)
    expect(parsed?.name).toBe('STEINS;GATE')
    expect(parsed?.lastPlayedAt).toBe(new Date(1700000000 * 1000).toISOString())

    const discovered = await scanLocalSteamInstallation(tempDir)
    expect(discovered).toHaveLength(1)
    expect(discovered[0]).toMatchObject({
      steamAppId: 412830,
      name: 'STEINS;GATE',
      installDir: commonGameDir
    })
  })
})

describe('Steam Web API error and privacy handling (Criterion 4)', () => {
  it('reports invalid API keys, private profiles, and network timeouts clearly', async () => {
    const unauthorizedClient = new SteamWebApiClient(async () => new Response('Forbidden', { status: 403 }))
    await expect(unauthorizedClient.getOwnedGames(VALID_STEAM_ID, VALID_KEY)).rejects.toThrow('rejected that Web API key')

    const privateProfileClient = new SteamWebApiClient(async () =>
      new Response(JSON.stringify({ response: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )
    await expect(privateProfileClient.getOwnedGames(VALID_STEAM_ID, VALID_KEY, false)).rejects.toThrow('privacy settings')

    const timeoutClient = new SteamWebApiClient(async () => {
      const err = new Error('Timed out')
      err.name = 'TimeoutError'
      throw err
    })
    await expect(timeoutClient.getPlayerSummary(VALID_STEAM_ID, VALID_KEY)).rejects.toThrow('took too long')
  })
})

describe('Visual Novel Classification Pipeline (Criteria 5, 6, 7, 8)', () => {
  it('confirms a game via exact Steam AppID release extlink on VNDB (Criterion 5)', () => {
    const decision = classifySteamEntry({
      steamAppId: 412830,
      name: 'STEINS;GATE',
      releaseMatches: [
        {
          steamAppId: 412830,
          vndbId: 'v2002',
          title: 'Steins;Gate',
          originalTitle: 'シュタインズ・ゲート',
          rtype: 'complete'
        }
      ]
    })
    expect(decision.classification).toBe('vn')
    expect(decision.confidence).toBe('high')
    expect(decision.vndbId).toBe('v2002')
  })

  it('matches exact and normalized edition titles on VNDB (Criterion 6)', () => {
    expect(normalizeLooseTitle('Clannad HD Edition')).toBe('clannad')
    const decision = classifySteamEntry({
      steamAppId: 324160,
      name: 'CLANNAD HD Edition',
      titleCandidates: [
        {
          provider: 'vndb',
          externalId: 'v4',
          title: 'Clannad',
          originalTitle: 'クラナド',
          releaseDate: '2004-04-28',
          developers: ['Key'],
          languages: ['Japanese', 'English'],
          thumbnailUrl: null,
          contentRating: 'all-ages'
        }
      ]
    })
    expect(decision.classification).toBe('vn')
    expect(decision.confidence).toBe('medium')
    expect(decision.vndbId).toBe('v4')
  })

  it('excludes non-VN Steam games and soundtracks from the default library (Criterion 7)', () => {
    expect(isNonGameSteamEntry('STEINS;GATE Original Soundtrack')).toBe(true)

    const soundtrackDecision = classifySteamEntry({
      steamAppId: 999991,
      name: 'STEINS;GATE Original Soundtrack'
    })
    expect(soundtrackDecision.classification).toBe('excluded')

    const actionGameDecision = classifySteamEntry({
      steamAppId: 730,
      name: 'Counter-Strike 2',
      titleCandidates: [
        {
          provider: 'vndb',
          externalId: 'v999',
          title: 'Counter Clockwise',
          originalTitle: null,
          releaseDate: '2020',
          developers: [],
          languages: ['English'],
          thumbnailUrl: null,
          contentRating: 'all-ages'
        }
      ]
    })
    expect(actionGameDecision.classification).toBe('excluded')
    expect(actionGameDecision.vndbId).toBeNull()
  })

  it('isolates ambiguous multi-match or partial-match titles in the review queue (Criterion 8)', () => {
    const ambiguous = classifySteamEntry({
      steamAppId: 888888,
      name: 'Memories',
      titleCandidates: [
        {
          provider: 'vndb',
          externalId: 'v101',
          title: 'Memories',
          originalTitle: null,
          releaseDate: '2018',
          developers: ['Studio A'],
          languages: ['English'],
          thumbnailUrl: null,
          contentRating: 'all-ages'
        },
        {
          provider: 'vndb',
          externalId: 'v102',
          title: 'Memories',
          originalTitle: null,
          releaseDate: '2021',
          developers: ['Studio B'],
          languages: ['English'],
          thumbnailUrl: null,
          contentRating: 'all-ages'
        }
      ]
    })
    expect(ambiguous.classification).toBe('review')
    expect(ambiguous.vndbId).toBeNull()
    expect(ambiguous.candidateMatches).toHaveLength(2)
  })
})

describe('SteamService end-to-end sync, encryption, overrides, and deduplication (Criteria 2, 9, 10, 11)', () => {
  let db: Database
  let artDir: string
  let store: LibraryStore
  let metadata: MetadataService
  let ownedGamesPayload: Array<{ appid: number; name: string; playtime_forever: number; rtime_last_played: number }>

  const cipher: SecretCipher = {
    encrypt: (plain) => `enc:${Buffer.from(plain, 'utf8').toString('hex')}`,
    decrypt: (enc) => Buffer.from(enc.replace(/^enc:/, ''), 'hex').toString('utf8')
  }

  beforeEach(async () => {
    artDir = await mkdtemp(join(tmpdir(), 'vnstation-steam-art-'))
    db = openLibraryDatabase(':memory:')
    store = new LibraryStore(db)

    ownedGamesPayload = [
      { appid: 412830, name: 'STEINS;GATE', playtime_forever: 240, rtime_last_played: 1700000000 },
      { appid: 730, name: 'Counter-Strike 2', playtime_forever: 1200, rtime_last_played: 1700000500 },
      { appid: 555555, name: 'Ambiguous Story', playtime_forever: 30, rtime_last_played: 0 }
    ]

    const provider: MetadataProvider = {
      id: 'vndb',
      search: async (query) => {
        if (query.toLowerCase().includes('ambiguous')) {
          return [
            {
              provider: 'vndb',
              externalId: 'v301',
              title: 'Ambiguous Story',
              originalTitle: null,
              releaseDate: '2021',
              developers: ['Alpha'],
              languages: ['English'],
              thumbnailUrl: null,
              contentRating: 'all-ages'
            },
            {
              provider: 'vndb',
              externalId: 'v302',
              title: 'Ambiguous Story',
              originalTitle: null,
              releaseDate: '2023',
              developers: ['Beta'],
              languages: ['English'],
              thumbnailUrl: null,
              contentRating: 'all-ages'
            }
          ]
        }
        return []
      },
      getDetails: async (externalId) => ({
        source: { provider: 'vndb', externalId },
        title: externalId === 'v2002' ? 'Steins;Gate' : 'Ambiguous Story',
        originalTitle: externalId === 'v2002' ? 'シュタインズ・ゲート' : null,
        altTitles: [],
        synopsis: 'Official VNDB synopsis.',
        developer: '5pb.',
        releaseDate: '2009-10-15',
        originalLanguage: 'Japanese',
        languages: ['Japanese', 'English'],
        genres: [],
        tags: ['Science Fiction', 'Time Travel'],
        contentRating: 'teen',
        coverRemoteUrl: null,
        backgroundRemoteUrl: null
      }),
      findBySteamAppIds: async (appIds) => {
        const map = new Map()
        if (appIds.includes(412830)) {
          map.set(412830, [
            {
              steamAppId: 412830,
              vndbId: 'v2002',
              title: 'Steins;Gate',
              originalTitle: 'シュタインズ・ゲート',
              rtype: 'complete'
            }
          ])
        }
        return map
      }
    }

    const noopFetcher: Fetcher = async () => new Response('not used', { status: 404 })
    metadata = new MetadataService({
      provider,
      store,
      cache: new MetadataCache(db),
      art: new ArtworkCache(artDir, noopFetcher)
    })
  })

  afterEach(async () => {
    db.close()
    await rm(artDir, { recursive: true, force: true })
  })

  function createSteamService(): SteamService {
    const webFetcher: Fetcher = async (url) => {
      if (url.includes('GetPlayerSummaries')) {
        return new Response(
          JSON.stringify({
            response: {
              players: [
                {
                  steamid: VALID_STEAM_ID,
                  personaname: 'OkabeRintaro',
                  profileurl: `https://steamcommunity.com/profiles/${VALID_STEAM_ID}/`,
                  avatarmedium: 'https://avatars.steamstatic.com/test.jpg',
                  communityvisibilitystate: 3
                }
              ]
            }
          }),
          { status: 200 }
        )
      }
      if (url.includes('GetOwnedGames')) {
        return new Response(
          JSON.stringify({
            response: {
              game_count: ownedGamesPayload.length,
              games: ownedGamesPayload
            }
          }),
          { status: 200 }
        )
      }
      return new Response('Not found', { status: 404 })
    }

    return new SteamService({
      db,
      store,
      metadata,
      webApi: new SteamWebApiClient(webFetcher),
      cipher
    })
  }

  it('encrypts the API key at rest and never exposes it in status responses (Criterion 2)', async () => {
    const service = createSteamService()
    const status = await service.connect({
      mode: 'api',
      steamIdOrVanity: VALID_STEAM_ID,
      apiKey: VALID_KEY
    })

    expect(status.connected).toBe(true)
    expect(status.hasApiKey).toBe(true)
    expect(status.personaName).toBe('OkabeRintaro')
    expect(JSON.stringify(status)).not.toContain(VALID_KEY)

    const rawSecret = db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'steam.secret'")
    expect(rawSecret?.value).toBeDefined()
    expect(rawSecret?.value).not.toContain(VALID_KEY)
    expect(rawSecret?.value.startsWith('enc:')).toBe(true)
  })

  it('imports only confirmed VNs, isolates ambiguous titles, excludes non-VNs, and preserves user data across syncs (Criteria 9, 10, 11)', async () => {
    const service = createSteamService()
    await service.connect({ mode: 'api', steamIdOrVanity: VALID_STEAM_ID, apiKey: VALID_KEY })

    const firstSync = await service.sync({ allowAdult: false })
    expect(firstSync).toMatchObject({
      discoveredCount: 3,
      importedVnCount: 1,
      updatedVnCount: 0,
      reviewCount: 1,
      excludedCount: 1
    })

    // Only STEINS;GATE (412830) should be in the main VN library
    let snapshot = await store.load()
    expect(snapshot.entries).toHaveLength(1)
    const sg = snapshot.entries[0]
    expect(sg.steamAppId).toBe(412830)
    expect(sg.librarySource).toBe('steam-api')
    expect(sg.playtimeMinutes).toBe(240)
    expect(sg.provider.source?.externalId).toBe('v2002')

    // User customizes title, notes, favorite, and collection on STEINS;GATE
    const col = await store.createCollection({ name: 'SciADV' })
    await store.setGameCollections(sg.id, [col.id])
    await store.updateGame(sg.id, {
      favorite: true,
      user: { title: 'Steins;Gate (My Favorite)', notes: 'El Psy Kongroo' }
    })

    // User manually includes the review item (555555)
    await service.setClassificationOverride(555555, 'include', { allowAdult: false })
    snapshot = await store.load()
    expect(snapshot.entries).toHaveLength(2)

    // Increase playtime on Steam and re-sync: no duplicate entries, user edits and overrides stay intact
    ownedGamesPayload[0].playtime_forever = 300
    const secondSync = await service.sync({ allowAdult: false })
    expect(secondSync.importedVnCount).toBe(0)
    expect(secondSync.updatedVnCount).toBe(2)

    snapshot = await store.load()
    expect(snapshot.entries).toHaveLength(2)
    const updatedSg = store.findBySteamAppId(412830)!
    expect(updatedSg.playtimeMinutes).toBe(300)
    expect(updatedSg.favorite).toBe(true)
    expect(updatedSg.user.title).toBe('Steins;Gate (My Favorite)')
    expect(updatedSg.user.notes).toBe('El Psy Kongroo')
    expect(snapshot.collections[0].gameIds).toContain(updatedSg.id)

    // User manually excludes 555555: removed from library and stays excluded on subsequent sync
    await service.setClassificationOverride(555555, 'exclude', { allowAdult: false })
    expect((await store.load()).entries).toHaveLength(1)

    await service.sync({ allowAdult: false })
    expect((await store.load()).entries).toHaveLength(1)
  })
})

describe('Launching Steam entries vs manual executables (Criterion 12)', () => {
  it('launches Steam games via steam://rungameid/<appId> and reports missing Steam cleanly', async () => {
    const db = openLibraryDatabase(':memory:')
    const store = new LibraryStore(db)
    const { entry } = store.upsertSteamGame({
      steamAppId: 412830,
      title: 'STEINS;GATE',
      source: 'steam-api',
      installed: true,
      installDir: null,
      playtimeMinutes: 120,
      lastPlayedAt: null,
      available: true
    })

    const launchedUris: string[] = []
    const launcher = new ProcessGameLauncher({
      store,
      launchSteamUri: async (uri) => {
        launchedUris.push(uri)
        return true
      }
    })

    const res = await launcher.launch(entry.id, { minimizeOnLaunch: false, restoreOnExit: false })
    expect(res.ok).toBe(true)
    expect(launchedUris).toEqual(['steam://rungameid/412830'])
    expect(store.getEntry(entry.id).lastPlayedAt).not.toBeNull()

    // When Steam is unavailable on the system, returns steam-unavailable
    const unavailableLauncher = new ProcessGameLauncher({
      store,
      launchSteamUri: async () => false
    })
    const failRes = await unavailableLauncher.launch(entry.id, { minimizeOnLaunch: false, restoreOnExit: false })
    expect(failRes).toMatchObject({
      ok: false,
      reason: 'steam-unavailable'
    })

    db.close()
  })
})
