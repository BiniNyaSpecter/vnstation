import { beforeEach, describe, expect, it } from 'vitest'
import type { GameLauncher, LaunchResult, MetadataApi, PreferencesRepository } from '@shared/contracts'
import type { Preferences } from '@shared/types'
import { createSampleSnapshot } from '@shared/sampleLibrary'
import { InMemoryLibraryRepository } from '@renderer/services/inMemoryLibraryRepository'
import { services } from '@renderer/services'
import { StubGameLauncher } from '@renderer/services/stubGameLauncher'
import { DEFAULT_PREFS } from '@renderer/lib/prefs'
import { appStore } from '@renderer/state/appStore'

const state = () => appStore.getState()

const unavailable = (): Promise<never> => Promise.reject(new Error('offline'))
const fakeMetadata = (overrides: Partial<MetadataApi> = {}): MetadataApi => ({
  search: unavailable, apply: unavailable, refresh: unavailable, unlink: unavailable,
  chooseArtwork: unavailable, resetArtwork: unavailable, cacheStats: unavailable, clearCache: unavailable,
  getCharacters: unavailable, openExternalVndb: unavailable, ...overrides
})

class MemoryPreferences implements PreferencesRepository {
  saved: Preferences[] = []
  constructor(private stored: unknown | null = null) {}
  async load(): Promise<unknown | null> { return this.stored }
  async save(prefs: Preferences): Promise<void> { this.saved.push(prefs); this.stored = prefs }
}

beforeEach(async () => {
  services.library = new InMemoryLibraryRepository(createSampleSnapshot())
  services.launcher = new StubGameLauncher()
  services.preferences = new MemoryPreferences()
  services.metadata = fakeMetadata()
  appStore.setState({ prefs: DEFAULT_PREFS })
  appStore.setState({ route: { name: 'home' }, history: [{ name: 'home' }], search: '', toast: null, dialog: null, launchingId: null, runningGames: {} })
  await state().init()
})

describe('loading', () => {
  it('loads the library and selects the most recently played visible game', () => {
    expect(state().status).toBe('ready')
    expect(state().games.length).toBeGreaterThan(10)
    expect(state().selectedGameId).toBe('sample-salt-and-ceremony')
  })

  it('flags development data as sample data', () => {
    expect(state().games.every((game) => game.isSample)).toBe(true)
  })
})

describe('navigation', () => {
  it('keeps a back stack for drill-down views', () => {
    state().navigate({ name: 'library' })
    state().openDetails('sample-ashfall-letters')
    expect(state().route).toEqual({ name: 'details', gameId: 'sample-ashfall-letters' })
    expect(state().selectedGameId).toBe('sample-ashfall-letters')
    state().goBack()
    expect(state().route).toEqual({ name: 'library' })
    state().goBack() // nothing left to pop
    expect(state().route).toEqual({ name: 'library' })
  })

  it('moves to the library when searching from another screen', () => {
    state().setSearch('lantern')
    expect(state().route.name).toBe('library')
  })

  it('keeps the selected game when switching views', () => {
    state().selectGame('sample-nine-windows')
    state().navigate({ name: 'favorites' })
    expect(state().selectedGameId).toBe('sample-nine-windows')
  })
})

describe('library actions', () => {
  it('toggles favorites', async () => {
    const id = 'sample-salt-and-ceremony'
    await state().toggleFavorite(id)
    expect(state().games.find((g) => g.id === id)?.favorite).toBe(true)
    await state().toggleFavorite(id)
    expect(state().games.find((g) => g.id === id)?.favorite).toBe(false)
  })

  it('adds a game without metadata and keeps it playable', async () => {
    await state().addGame({
      title: '  Example Game ',
      launch: { executablePath: 'D:\\VN\\example_game.exe', workingDirectory: 'D:\\VN', arguments: '' }
    })
    const added = state().games[0]
    expect(added.title).toBe('Example Game')
    expect(added.isSample).toBe(false)
    expect(added.contentRating).toBe('unrated')
    expect(added.coverUrl.startsWith('data:image/svg+xml')).toBe(true)
    expect(added.launch.executablePath).toBe('D:\\VN\\example_game.exe')
    expect(state().selectedGameId).toBe(added.id)
    expect(state().route.name).toBe('library')
    expect(state().toast?.tone).toBe('success')
  })

  it('removes an entry from the library and from collections', async () => {
    const id = 'sample-lanterns-of-hollowmere'
    await state().removeGame(id)
    expect(state().games.some((g) => g.id === id)).toBe(false)
    expect(state().collections.every((c) => !c.gameIds.includes(id))).toBe(true)
    expect(state().toast?.message).toContain('not touched')
  })

  it('stores notes as a user edit, separate from provider data', async () => {
    const id = 'sample-nine-windows'
    await state().updateNotes(id, 'Left off at chapter 3')
    const entry = state().entries.find((e) => e.id === id)!
    expect(entry.user.notes).toBe('Left off at chapter 3')
    expect(entry.provider.title).toBe('Nine Windows')
  })
})

describe('launching', () => {
  it('reports when launching is unavailable in the browser preview', async () => {
    await state().launchGame('sample-nine-windows')
    expect(state().toast?.tone).toBe('info')
    expect(state().launchingId).toBeNull()
  })

  it('tracks running state and updates playtime when the session stops', async () => {
    let listener: ((event: import('@shared/launcher').LauncherEvent) => void) | null = null
    services.launcher = {
      launch: async () => ({ ok: true, startedAt: '2026-10-25T12:00:00.000Z' }),
      running: async () => [],
      history: async () => ({ sessions: [], totalSessions: 0 }),
      openFolder: async () => true,
      subscribe: (fn) => {
        listener = fn
        return () => {
          listener = null
        }
      }
    }
    await state().init()

    await state().launchGame('sample-nine-windows')
    expect(state().runningGames['sample-nine-windows']).toEqual({
      gameId: 'sample-nine-windows',
      startedAt: '2026-10-25T12:00:00.000Z',
      mode: 'process'
    })

    // While running, a second click is ignored.
    await state().launchGame('sample-nine-windows')

    const updated = {
      ...state().entries.find((e) => e.id === 'sample-nine-windows')!,
      lastPlayedAt: '2026-10-25T12:00:00.000Z',
      playtimeMinutes: 999
    }
    listener!({
      type: 'stopped',
      gameId: 'sample-nine-windows',
      session: {
        id: 1,
        gameId: 'sample-nine-windows',
        startedAt: '2026-10-25T12:00:00.000Z',
        endedAt: '2026-10-25T13:00:00.000Z',
        seconds: 3600,
        tracking: 'process'
      },
      entry: updated,
      exitCode: 0
    })

    expect(state().runningGames['sample-nine-windows']).toBeUndefined()
    expect(state().games.find((g) => g.id === 'sample-nine-windows')?.playtimeMinutes).toBe(999)
  })

  it('ignores repeated launch requests while one is in flight', async () => {
    let calls = 0
    let finish: (result: LaunchResult) => void = () => undefined
    const slow: GameLauncher = {
      launch: () => {
        calls++
        return new Promise<LaunchResult>((resolve) => (finish = resolve))
      },
      running: async () => [],
      history: async () => ({ sessions: [], totalSessions: 0 }),
      openFolder: async () => true,
      subscribe: () => () => undefined
    }
    services.launcher = slow

    const first = state().launchGame('sample-nine-windows')
    await state().launchGame('sample-nine-windows')
    await state().launchGame('sample-ashfall-letters')
    expect(calls).toBe(1)

    finish({ ok: true, startedAt: '2026-10-25T12:00:00.000Z' })
    await first
    expect(state().launchingId).toBeNull()
  })
})

const exeDraft = (path: string, title = 'New Game') => ({
  title,
  launch: { executablePath: path, workingDirectory: path.replace(/[\\/][^\\/]*$/, ''), arguments: '' }
})

describe('adding and editing games', () => {
  it('does not add the same executable twice, and takes you to the existing entry', async () => {
    await state().addGame(exeDraft('D:\\VN\\Game One\\start.exe', 'Game One'))
    const count = state().games.length
    await state().addGame(exeDraft('d:/vn/game one/START.exe', 'Game One again'))
    expect(state().games.length).toBe(count)
    expect(state().toast?.message).toContain('already in your library')
    expect(state().games.find((g) => g.id === state().selectedGameId)?.title).toBe('Game One')
  })

  it('edits the title and launch settings, and can repair a moved executable', async () => {
    await state().addGame(exeDraft('D:\\Old\\game.exe', 'Movable'))
    const id = state().selectedGameId!
    const saved = await state().updateGame(id, {
      user: { title: 'Renamed' },
      launch: { executablePath: 'E:\\New place\\game.exe', workingDirectory: 'E:\\New place', arguments: '-windowed' }
    })
    expect(saved).toBe(true)
    const game = state().games.find((g) => g.id === id)!
    expect(game.title).toBe('Renamed')
    expect(game.launch).toEqual({ executablePath: 'E:\\New place\\game.exe', workingDirectory: 'E:\\New place', arguments: '-windowed' })
  })

  it('reports a failed save instead of pretending it worked', async () => {
    const saved = await state().updateGame('does-not-exist', { favorite: true })
    expect(saved).toBe(false)
    expect(state().toast?.tone).toBe('error')
  })
})

describe('collections', () => {
  it('creates, renames, fills and deletes a collection', async () => {
    const created = await state().createCollection({ name: 'Weekend reads', description: null })
    expect(created?.name).toBe('Weekend reads')
    expect(state().collections.some((c) => c.id === created!.id)).toBe(true)

    expect(await state().updateCollection(created!.id, { name: 'Weekend', description: 'Short ones' })).toBe(true)
    expect(state().collections.find((c) => c.id === created!.id)?.description).toBe('Short ones')

    expect(await state().setGameCollections('sample-nine-windows', [created!.id])).toBe(true)
    expect(state().collections.find((c) => c.id === created!.id)?.gameIds).toEqual(['sample-nine-windows'])

    state().push({ name: 'collections', collectionId: created!.id })
    await state().deleteCollection(created!.id)
    expect(state().collections.some((c) => c.id === created!.id)).toBe(false)
    expect(state().games.some((g) => g.id === 'sample-nine-windows')).toBe(true)
    expect(state().route).toEqual({ name: 'collections', collectionId: null })
  })

  it('refuses duplicate collection names with a clear message', async () => {
    await state().createCollection({ name: 'Cozy evenings' })
    expect(state().toast?.message).toBe('A collection with that name already exists.')
  })
})

describe('sample data', () => {
  it('can be removed and added back without touching the user’s own games', async () => {
    await state().addGame(exeDraft('D:\\VN\\Mine\\game.exe', 'Mine'))
    await state().removeSampleGames()
    expect(state().games.map((g) => g.title)).toEqual(['Mine'])
    expect(state().collections).toHaveLength(0)

    await state().addSampleGames()
    await state().addSampleGames()
    expect(state().games.filter((g) => g.isSample)).toHaveLength(13)
    expect(state().games.filter((g) => !g.isSample)).toHaveLength(1)
  })

  it('keeps a valid selection after the selected game disappears', async () => {
    state().selectGame('sample-salt-and-ceremony')
    await state().removeGame('sample-salt-and-ceremony')
    const selected = state().games.find((g) => g.id === state().selectedGameId)
    expect(selected).toBeDefined()
    expect(selected?.contentRating).not.toBe('restricted')
  })
})

describe('preferences', () => {
  it('loads saved preferences on start and validates them', async () => {
    services.preferences = new MemoryPreferences({ accent: 'jade', backdropStrength: 99, defaultSort: 'bogus' })
    await state().init()
    expect(state().prefs.accent).toBe('jade')
    expect(state().prefs.backdropStrength).toBe(1)
    expect(state().prefs.defaultSort).toBe('title')
  })

  it('saves every change', async () => {
    const memory = new MemoryPreferences()
    services.preferences = memory
    state().setPref('railCollapsed', true)
    state().setPref('accent', 'sakura')
    await Promise.resolve()
    expect(memory.saved).toHaveLength(2)
    expect(memory.saved[1].railCollapsed).toBe(true)
    expect(memory.saved[1].accent).toBe('sakura')
  })
})

describe('details lookup', () => {
  it('opens the match screen right after a game is added (when lookups are on)', async () => {
    await state().addGame(exeDraft('D:\\VN\\Fresh\\game.exe', 'Fresh'))
    expect(state().dialog).toEqual({ type: 'match-game', gameId: state().selectedGameId })
  })

  it('does not open it when lookups are switched off', async () => {
    state().setPref('metadataEnabled', false)
    await state().addGame(exeDraft('D:\\VN\\Quiet\\game.exe', 'Quiet'))
    expect(state().dialog).toBeNull()
  })

  it('saves the downloaded details on the game', async () => {
    const id = 'sample-nine-windows'
    services.metadata = fakeMetadata({
      apply: async (gameId, externalId) => {
        const entry = state().entries.find((e) => e.id === gameId)!
        return { ...entry, provider: { ...entry.provider, source: { provider: 'vndb', externalId }, title: 'Official Title' } }
      }
    })
    expect(await state().applyMetadata(id, 'v1', { replaceTitle: true, allowAdult: false })).toBe(true)
    expect(state().games.find((g) => g.id === id)?.source).toEqual({ provider: 'vndb', externalId: 'v1' })
    expect(state().toast?.tone).toBe('success')
  })

  it('stays usable offline: a failed lookup is reported, nothing changes', async () => {
    const before = state().games.length
    expect(await state().applyMetadata('sample-nine-windows', 'v1', { replaceTitle: true, allowAdult: false })).toBe(false)
    expect(await state().refreshMetadata('sample-nine-windows')).toBe(false)
    expect(state().toast).toMatchObject({ tone: 'error', message: 'offline' })
    expect(state().games.length).toBe(before)
  })

  it('reloads after clearing the artwork cache', async () => {
    let cleared = false
    services.metadata = fakeMetadata({ clearCache: async () => { cleared = true } })
    await state().clearArtworkCache()
    expect(cleared).toBe(true)
    expect(state().toast?.tone).toBe('success')
  })
})

describe('dialogs', () => {
  it('a closing dialog cannot dismiss the dialog that replaced it', () => {
    state().openDialog({ type: 'match-game', gameId: 'sample-nine-windows' })
    state().closeDialog('add-game') // the add dialog finishing its own close
    expect(state().dialog?.type).toBe('match-game')
    state().closeDialog('match-game')
    expect(state().dialog).toBeNull()
  })

  it('closes whatever is open when no type is given', () => {
    state().openDialog({ type: 'add-game' })
    state().closeDialog()
    expect(state().dialog).toBeNull()
  })
})

describe('age confirmation for adults-only games', () => {
  it('hides adults-only games until the user confirms they are 18 or older', async () => {
    expect(state().prefs.showRestricted).toBe(false)
    state().updatePrefs({ showRestricted: true }) // not allowed without confirmation
    expect(state().prefs.showRestricted).toBe(false)

    state().openDialog({ type: 'age-gate' })
    state().confirmAdult()
    expect(state().prefs.adultConfirmed).toBe(true)
    expect(state().prefs.showRestricted).toBe(true)
    expect(state().dialog).toBeNull()
  })

  it('remembers the confirmation when adults-only games are hidden again', () => {
    state().confirmAdult()
    state().updatePrefs({ showRestricted: false })
    expect(state().prefs.adultConfirmed).toBe(true)
    state().updatePrefs({ showRestricted: true })
    expect(state().prefs.showRestricted).toBe(true)
  })

  it('passes the age confirmation to the lookup, never more than the user allowed', async () => {
    const seen: boolean[] = []
    services.metadata = fakeMetadata({
      refresh: async (id, options) => {
        seen.push(options.allowAdult)
        return state().entries.find((e) => e.id === id)!
      }
    })
    await state().refreshMetadata('sample-nine-windows')
    state().confirmAdult()
    await state().refreshMetadata('sample-nine-windows')
    expect(seen).toEqual([false, true])
  })
})
