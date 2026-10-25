import type { CollectionInput, GameEntryPatch, LibraryRepository, LibrarySnapshot, NewGameDraft, VerifyResult } from '@shared/contracts'
import type { Collection, GameEntry } from '@shared/types'
import { validateDirectory, validateExecutable } from './executables'
import { parseCollectionInput, parseGamePatch, parseId, parseIdList, parseNewGameDraft } from './validation'

/**
 * The only thing the IPC layer talks to. Parses and bounds every argument, checks
 * that chosen files and folders really exist, then delegates to the store. The
 * renderer therefore can never write arbitrary values or paths into the database.
 */
export class LibraryService implements LibraryRepository {
  constructor(private readonly store: LibraryRepository) {}

  async load(): Promise<LibrarySnapshot> {
    return this.store.load()
  }

  async addGame(draft: NewGameDraft): Promise<GameEntry> {
    const parsed = parseNewGameDraft(draft)
    await validateExecutable(parsed.launch.executablePath)
    await validateDirectory(parsed.launch.workingDirectory)
    return this.store.addGame(parsed)
  }

  async updateGame(id: string, patch: GameEntryPatch): Promise<GameEntry> {
    const gameId = parseId(id, 'game')
    const parsed = parseGamePatch(patch)
    // Only paths that are actually being changed must exist; an already-missing path stays editable.
    if (parsed.launch?.executablePath !== undefined) await validateExecutable(parsed.launch.executablePath)
    if (parsed.launch?.workingDirectory !== undefined) await validateDirectory(parsed.launch.workingDirectory)
    return this.store.updateGame(gameId, parsed)
  }

  async removeGame(id: string): Promise<void> {
    return this.store.removeGame(parseId(id, 'game'))
  }

  async createCollection(input: CollectionInput): Promise<Collection> {
    return this.store.createCollection(parseCollectionInput(input))
  }

  async updateCollection(id: string, input: CollectionInput): Promise<Collection> {
    return this.store.updateCollection(parseId(id, 'collection'), parseCollectionInput(input))
  }

  async deleteCollection(id: string): Promise<void> {
    return this.store.deleteCollection(parseId(id, 'collection'))
  }

  async setGameCollections(gameId: string, collectionIds: string[]): Promise<void> {
    return this.store.setGameCollections(parseId(gameId, 'game'), parseIdList(collectionIds))
  }

  async verifyGame(id: string): Promise<VerifyResult> {
    return this.store.verifyGame(parseId(id, 'game'))
  }

  async addSampleGames(): Promise<void> {
    return this.store.addSampleGames()
  }

  async removeSampleGames(): Promise<void> {
    return this.store.removeSampleGames()
  }
}
