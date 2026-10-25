import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NewGameDraft } from '@shared/contracts'
import { createSampleSnapshot } from '@shared/sampleLibrary'
import { LibraryStore } from '../src/main/db/libraryStore'
import { openLibraryDatabase } from '../src/main/db/openLibraryDatabase'
import { SettingsStore } from '../src/main/db/settingsStore'
import type { Database } from '../src/main/db/sqlite'
import { UserFacingError } from '../src/main/errors'

let counter = 0
const newStore = (db: Database): LibraryStore => new LibraryStore(db, () => new Date(2026, 9, 1, 12, 0, counter++), () => `id${counter++}`)
const draft = (title: string, path = `D:\\VN\\${title}\\game.exe`): NewGameDraft => ({
  title,
  launch: { executablePath: path, workingDirectory: path.replace(/[\\/][^\\/]*$/, ''), arguments: '' }
})
const count = (db: Database, table: string): number => Number(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)?.n)

describe('LibraryStore: games', () => {
  let db: Database
  let store: LibraryStore
  beforeEach(() => { db = openLibraryDatabase(':memory:'); store = newStore(db) })
  afterEach(() => db.close())

  it('starts empty', async () => {
    expect(await store.load()).toEqual({ entries: [], collections: [] })
  })

  it('adds a game that works without any metadata', async () => {
    const entry = await store.addGame(draft('  Example Game '))
    expect(entry.user.title).toBe('Example Game')
    expect(entry.provider.source).toBeNull()
    expect(entry.provider.contentRating).toBe('unrated')
    expect(entry.isSample).toBe(false)
    expect(entry.favorite).toBe(false)
    expect((await store.load()).entries).toHaveLength(1)
  })

  it('lists newest first', async () => {
    await store.addGame(draft('First'))
    await store.addGame(draft('Second'))
    expect((await store.load()).entries.map((e) => e.user.title)).toEqual(['Second', 'First'])
  })

  it('updates favorites, launch settings and notes', async () => {
    const { id } = await store.addGame(draft('Game'))
    const updated = await store.updateGame(id, {
      favorite: true,
      launch: { arguments: '-windowed' },
      user: { notes: 'Chapter 2', title: 'Renamed' }
    })
    expect(updated.favorite).toBe(true)
    expect(updated.launch.arguments).toBe('-windowed')
    expect(updated.launch.executablePath).toBe('D:\\VN\\Game\\game.exe')
    expect(updated.user.notes).toBe('Chapter 2')
    expect(updated.user.title).toBe('Renamed')
  })

  it('stores last played and playtime', async () => {
    const { id } = await store.addGame(draft('Game'))
    const at = new Date(2026, 9, 5, 20, 0).toISOString()
    const updated = await store.updateGame(id, { lastPlayedAt: at, playtimeMinutes: 95 })
    expect(updated.lastPlayedAt).toBe(at)
    expect(updated.playtimeMinutes).toBe(95)
  })

  it('reports a missing game clearly', async () => {
    await expect(store.updateGame('nope', { favorite: true })).rejects.toThrow('no longer in the library')
  })

  it('clearing a user field falls back to provider data without touching it', async () => {
    await store.addSampleGames()
    const id = 'sample-nine-windows'
    const before = (await store.load()).entries.find((e) => e.id === id)!
    await store.updateGame(id, { user: { title: 'My name for it' } })
    const edited = (await store.load()).entries.find((e) => e.id === id)!
    expect(edited.user.title).toBe('My name for it')
    expect(edited.provider).toEqual(before.provider)

    const cleared = await store.updateGame(id, { user: { title: null } })
    expect(cleared.user.title).toBeNull()
    expect(cleared.provider.title).toBe('Nine Windows')
  })

  it('removes a game with everything attached to it', async () => {
    await store.addSampleGames()
    const tagsBefore = count(db, 'tags')
    await store.removeGame('sample-lanterns-of-hollowmere')
    const { entries, collections } = await store.load()
    expect(entries.some((e) => e.id === 'sample-lanterns-of-hollowmere')).toBe(false)
    expect(collections.every((c) => !c.gameIds.includes('sample-lanterns-of-hollowmere'))).toBe(true)
    expect(Number(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM game_tags WHERE game_id = 'sample-lanterns-of-hollowmere'")?.n)).toBe(0)
    expect(count(db, 'tags')).toBeLessThan(tagsBefore) // 'Ghosts' belonged only to that game
  })

  it('handles a few hundred games', async () => {
    for (let i = 0; i < 300; i++) await store.addGame(draft(`Game ${i}`))
    const { entries } = await store.load()
    expect(entries).toHaveLength(300)
    expect(entries[0].user.title).toBe('Game 299')
  })
})

describe('LibraryStore: persistence', () => {
  let dir: string
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'vnstation-store-')) })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  it('restores the library after the app restarts, including spaces and non-English paths', async () => {
    const file = join(dir, 'library.db')
    const path = 'D:\\ビジュアル ノベル\\星降る夜 (v1.2)\\ゲーム.exe'

    const first = openLibraryDatabase(file)
    const store = newStore(first)
    const { id } = await store.addGame(draft('星降る夜', path))
    await store.updateGame(id, { favorite: true, user: { notes: 'メモ' } })
    const collection = await store.createCollection({ name: 'お気に入り' })
    await store.setGameCollections(id, [collection.id])
    first.close()

    const second = openLibraryDatabase(file)
    const snapshot = await newStore(second).load()
    second.close()
    expect(snapshot.entries).toHaveLength(1)
    expect(snapshot.entries[0].launch.executablePath).toBe(path)
    expect(snapshot.entries[0].user.title).toBe('星降る夜')
    expect(snapshot.entries[0].user.notes).toBe('メモ')
    expect(snapshot.entries[0].favorite).toBe(true)
    expect(snapshot.collections).toEqual([{ id: collection.id, name: 'お気に入り', description: null, gameIds: [id] }])
  })

  it('keeps preferences between runs', async () => {
    const file = join(dir, 'library.db')
    const first = openLibraryDatabase(file)
    expect(await new SettingsStore(first).load()).toBeNull()
    await new SettingsStore(first).save({ accent: 'jade' } as never)
    first.close()
    const second = openLibraryDatabase(file)
    expect(await new SettingsStore(second).load()).toEqual({ accent: 'jade' })
    second.run("UPDATE settings SET value = '{broken'")
    expect(await new SettingsStore(second).load()).toBeNull()
    second.close()
  })
})

describe('LibraryStore: collections', () => {
  let db: Database
  let store: LibraryStore
  beforeEach(() => { db = openLibraryDatabase(':memory:'); store = newStore(db) })
  afterEach(() => db.close())

  it('creates, renames and describes collections', async () => {
    const c = await store.createCollection({ name: 'Cozy', description: 'Warm' })
    expect(c).toEqual({ id: c.id, name: 'Cozy', description: 'Warm', gameIds: [] })
    const renamed = await store.updateCollection(c.id, { name: 'Very cozy', description: null })
    expect(renamed.name).toBe('Very cozy')
    expect(renamed.description).toBeNull()
  })

  it('does not allow two collections with the same name, ignoring case', async () => {
    await store.createCollection({ name: 'Mystery' })
    await expect(store.createCollection({ name: 'mystery' })).rejects.toThrow('already exists')
    const other = await store.createCollection({ name: 'Other' })
    await expect(store.updateCollection(other.id, { name: 'MYSTERY' })).rejects.toThrow('already exists')
  })

  it('sets which collections a game belongs to, in a stable order', async () => {
    const a = await store.addGame(draft('A'))
    const b = await store.addGame(draft('B'))
    const one = await store.createCollection({ name: 'One' })
    const two = await store.createCollection({ name: 'Two' })

    await store.setGameCollections(a.id, [one.id, two.id])
    await store.setGameCollections(b.id, [one.id])
    let { collections } = await store.load()
    expect(collections.find((c) => c.id === one.id)?.gameIds).toEqual([a.id, b.id])
    expect(collections.find((c) => c.id === two.id)?.gameIds).toEqual([a.id])

    await store.setGameCollections(a.id, [two.id])
    ;({ collections } = await store.load())
    expect(collections.find((c) => c.id === one.id)?.gameIds).toEqual([b.id])

    await store.setGameCollections(a.id, [])
    ;({ collections } = await store.load())
    expect(collections.every((c) => !c.gameIds.includes(a.id))).toBe(true)
  })

  it('rejects unknown games and collections', async () => {
    const a = await store.addGame(draft('A'))
    await expect(store.setGameCollections(a.id, ['collection-missing'])).rejects.toThrow('no longer exists')
    await expect(store.setGameCollections('missing', [])).rejects.toThrow('no longer in the library')
  })

  it('deleting a collection keeps its games', async () => {
    const a = await store.addGame(draft('A'))
    const c = await store.createCollection({ name: 'Temp' })
    await store.setGameCollections(a.id, [c.id])
    await store.deleteCollection(c.id)
    const snapshot = await store.load()
    expect(snapshot.collections).toHaveLength(0)
    expect(snapshot.entries).toHaveLength(1)
  })

  it('throws user-facing errors for expected problems', async () => {
    await store.createCollection({ name: 'X' })
    await expect(store.createCollection({ name: 'x' })).rejects.toThrow(UserFacingError)
  })
})

describe('LibraryStore: sample data', () => {
  let db: Database
  let store: LibraryStore
  beforeEach(() => { db = openLibraryDatabase(':memory:'); store = newStore(db) })
  afterEach(() => db.close())

  it('stores sample entries without losing any provider detail', async () => {
    await store.addSampleGames()
    const stored = (await store.load()).entries
    const expected = createSampleSnapshot().entries
    expect(stored).toHaveLength(expected.length)
    for (const want of expected) {
      const got = stored.find((e) => e.id === want.id)!
      expect(got.provider).toEqual(want.provider)
      expect(got.art).toEqual(want.art)
      expect(got.favorite).toBe(want.favorite)
      expect(got.isSample).toBe(true)
    }
    expect((await store.load()).collections.map((c) => c.gameIds.length)).toEqual([4, 5, 3])
  })

  it('is idempotent and never touches the user’s own games', async () => {
    const mine = await store.addGame(draft('Mine'))
    await store.addSampleGames()
    await store.addSampleGames()
    expect(count(db, 'games')).toBe(createSampleSnapshot().entries.length + 1)

    await store.removeSampleGames()
    const { entries, collections } = await store.load()
    expect(entries.map((e) => e.id)).toEqual([mine.id])
    expect(collections).toEqual([])
    expect(count(db, 'tags')).toBe(0)
  })

  it('keeps a user collection when sample games are removed', async () => {
    await store.addSampleGames()
    const mine = await store.createCollection({ name: 'My picks' })
    await store.setGameCollections('sample-nine-windows', [mine.id])
    await store.removeSampleGames()
    expect((await store.load()).collections).toEqual([{ id: mine.id, name: 'My picks', description: null, gameIds: [] }])
  })
})

describe('LibraryStore: verifying files', () => {
  let dir: string
  let db: Database
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'vnstation-verify-')); db = openLibraryDatabase(':memory:') })
  afterEach(async () => { db.close(); await rm(dir, { recursive: true, force: true }) })

  it('notices when the executable or its folder has gone', async () => {
    const folder = join(dir, 'Some Game')
    await mkdir(folder)
    const exe = join(folder, 'start.exe')
    await writeFile(exe, '')
    const store = newStore(db)
    const { id } = await store.addGame({ title: 'Some Game', launch: { executablePath: exe, workingDirectory: folder, arguments: '' } })

    expect(await store.verifyGame(id)).toEqual({ executableExists: true, workingDirectoryExists: true })
    await rm(exe)
    expect(await store.verifyGame(id)).toEqual({ executableExists: false, workingDirectoryExists: true })
    await rm(folder, { recursive: true })
    expect(await store.verifyGame(id)).toEqual({ executableExists: false, workingDirectoryExists: false })
  })
})
