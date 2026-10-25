import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LibraryStore } from '../src/main/db/libraryStore'
import { openLibraryDatabase } from '../src/main/db/openLibraryDatabase'
import type { Database } from '../src/main/db/sqlite'
import { LibraryService } from '../src/main/libraryService'

/** Uses empty placeholder .exe files. Nothing is ever executed. */
describe('LibraryService', () => {
  let dir: string
  let db: Database
  let service: LibraryService

  const makeGame = async (name: string): Promise<{ folder: string; exe: string }> => {
    const folder = join(dir, name)
    await mkdir(folder, { recursive: true })
    const exe = join(folder, 'ゲーム start.exe')
    await writeFile(exe, '')
    return { folder, exe }
  }
  const draftFor = (title: string, folder: string, exe: string) => ({
    title,
    launch: { executablePath: exe, workingDirectory: folder, arguments: '' }
  })

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vnstation-service-'))
    db = openLibraryDatabase(':memory:')
    service = new LibraryService(new LibraryStore(db))
  })
  afterEach(async () => {
    db.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('adds a game whose executable exists, even with spaces and non-English characters', async () => {
    const { folder, exe } = await makeGame('Some Game 星')
    const entry = await service.addGame(draftFor('Some Game', folder, exe))
    expect(entry.launch.executablePath).toBe(exe)
  })

  it('refuses files that are missing, not executables, or relative', async () => {
    const { folder, exe } = await makeGame('G')
    await expect(service.addGame(draftFor('G', folder, join(folder, 'gone.exe')))).rejects.toThrow('could not be found')
    await writeFile(join(folder, 'notes.txt'), '')
    await expect(service.addGame(draftFor('G', folder, join(folder, 'notes.txt')))).rejects.toThrow('Only .exe')
    await expect(service.addGame(draftFor('G', folder, 'game.exe'))).rejects.toThrow('absolute')
    await expect(service.addGame(draftFor('G', join(dir, 'no-such-folder'), exe))).rejects.toThrow('folder could not be found')
    expect((await service.load()).entries).toHaveLength(0)
  })

  it('refuses malformed input before it reaches the database', async () => {
    await expect(service.addGame({ title: '', launch: { executablePath: 'x', workingDirectory: 'y', arguments: '' } })).rejects.toThrow('Give the game a title')
    await expect(service.updateGame('../etc/passwd', { favorite: true })).rejects.toThrow('not valid')
    await expect(service.setGameCollections('g', 'oops' as never)).rejects.toThrow('not valid')
  })

  it('lets the user repair a moved executable', async () => {
    const original = await makeGame('Original')
    const { id } = await service.addGame(draftFor('Moved Game', original.folder, original.exe))

    await rm(original.folder, { recursive: true })
    expect(await service.verifyGame(id)).toEqual({ executableExists: false, workingDirectoryExists: false })

    // Editing other fields still works while the file is missing...
    await service.updateGame(id, { user: { notes: 'moved to E:' } })
    // ...but a repair must point at something that exists.
    const moved = await makeGame('Moved to new place')
    await expect(service.updateGame(id, { launch: { executablePath: join(moved.folder, 'missing.exe') } })).rejects.toThrow('could not be found')

    await service.updateGame(id, { launch: { executablePath: moved.exe, workingDirectory: moved.folder } })
    expect(await service.verifyGame(id)).toEqual({ executableExists: true, workingDirectoryExists: true })
  })

  it('removing an entry never deletes the game’s files', async () => {
    const { folder, exe } = await makeGame('Keep Me')
    const { id } = await service.addGame(draftFor('Keep Me', folder, exe))
    await service.removeGame(id)
    expect((await service.load()).entries).toHaveLength(0)
    expect(existsSync(exe)).toBe(true)
    expect(existsSync(folder)).toBe(true)
  })

  it('manages collections through the same validated path', async () => {
    const { folder, exe } = await makeGame('G')
    const { id } = await service.addGame(draftFor('G', folder, exe))
    const collection = await service.createCollection({ name: ' Favourites ' })
    expect(collection.name).toBe('Favourites')
    await service.setGameCollections(id, [collection.id, collection.id])
    expect((await service.load()).collections[0].gameIds).toEqual([id])
    await expect(service.createCollection({ name: '  ' })).rejects.toThrow('Give the collection a name')
  })
})
