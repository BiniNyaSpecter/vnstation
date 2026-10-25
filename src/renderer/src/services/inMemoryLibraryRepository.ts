import type {
  CollectionInput,
  GameEntryPatch,
  LibraryRepository,
  LibrarySnapshot,
  NewGameDraft,
  VerifyResult
} from '@shared/contracts'
import { createSampleSnapshot } from '@shared/sampleLibrary'
import type { Collection, GameEntry } from '@shared/types'

const copyCollection = (collection: Collection): Collection => ({ ...collection, gameIds: [...collection.gameIds] })

/**
 * Non-persistent implementation of the library contract. It backs the plain-browser
 * design preview and the store tests; in Electron the SQLite-backed repository
 * (reached over IPC) is used instead.
 */
export class InMemoryLibraryRepository implements LibraryRepository {
  private entries: GameEntry[]
  private collections: Collection[]

  constructor(seed: LibrarySnapshot = { entries: [], collections: [] }) {
    this.entries = [...seed.entries]
    this.collections = seed.collections.map(copyCollection)
  }

  async load(): Promise<LibrarySnapshot> {
    return { entries: [...this.entries], collections: this.collections.map(copyCollection) }
  }

  async addGame(draft: NewGameDraft): Promise<GameEntry> {
    const entry: GameEntry = {
      id: `game-${crypto.randomUUID()}`,
      launch: { ...draft.launch },
      provider: {
        source: null, title: null, originalTitle: null, altTitles: [], synopsis: null, developer: null, releaseDate: null,
        originalLanguage: null, languages: [], genres: [], tags: [], contentRating: 'unrated', coverUrl: null, backgroundUrl: null, fetchedAt: null
      },
      user: { title: draft.title.trim(), synopsis: null, developer: null, releaseDate: null, coverUrl: null, backgroundUrl: null, notes: '' },
      art: null,
      favorite: false,
      addedAt: new Date().toISOString(),
      lastPlayedAt: null,
      playtimeMinutes: 0,
      isSample: false
    }
    this.entries = [entry, ...this.entries]
    return entry
  }

  async updateGame(id: string, patch: GameEntryPatch): Promise<GameEntry> {
    const current = this.entries.find((entry) => entry.id === id)
    if (!current) throw new Error('That game is no longer in the library.')
    const { user, launch, ...rest } = patch
    const updated: GameEntry = {
      ...current,
      ...rest,
      launch: {
        executablePath: launch?.executablePath ?? current.launch.executablePath,
        workingDirectory: launch?.workingDirectory ?? current.launch.workingDirectory,
        arguments: launch?.arguments ?? current.launch.arguments
      },
      user: { ...current.user, ...user }
    }
    this.entries = this.entries.map((entry) => (entry.id === id ? updated : entry))
    return updated
  }

  async removeGame(id: string): Promise<void> {
    this.entries = this.entries.filter((entry) => entry.id !== id)
    this.collections = this.collections.map((c) => ({ ...c, gameIds: c.gameIds.filter((gameId) => gameId !== id) }))
  }

  async createCollection(input: CollectionInput): Promise<Collection> {
    this.assertNameFree(input.name)
    const collection: Collection = { id: `collection-${crypto.randomUUID()}`, name: input.name, description: input.description ?? null, gameIds: [] }
    this.collections = [...this.collections, collection]
    return copyCollection(collection)
  }

  async updateCollection(id: string, input: CollectionInput): Promise<Collection> {
    const current = this.collections.find((c) => c.id === id)
    if (!current) throw new Error('That collection no longer exists.')
    this.assertNameFree(input.name, id)
    const updated = { ...current, name: input.name, description: input.description ?? null }
    this.collections = this.collections.map((c) => (c.id === id ? updated : c))
    return copyCollection(updated)
  }

  async deleteCollection(id: string): Promise<void> {
    this.collections = this.collections.filter((c) => c.id !== id)
  }

  async setGameCollections(gameId: string, collectionIds: string[]): Promise<void> {
    if (!this.entries.some((entry) => entry.id === gameId)) throw new Error('That game is no longer in the library.')
    const wanted = new Set(collectionIds)
    if ([...wanted].some((id) => !this.collections.some((c) => c.id === id))) throw new Error('One of those collections no longer exists.')
    this.collections = this.collections.map((c) => {
      const without = c.gameIds.filter((id) => id !== gameId)
      return { ...c, gameIds: wanted.has(c.id) ? [...without, gameId] : without }
    })
  }

  async verifyGame(): Promise<VerifyResult> {
    return { executableExists: true, workingDirectoryExists: true }
  }

  async addSampleGames(): Promise<void> {
    if (this.entries.some((entry) => entry.isSample)) return
    const sample = createSampleSnapshot()
    this.entries = [...this.entries, ...sample.entries]
    for (const collection of sample.collections) {
      if (!this.collections.some((c) => c.name.toLowerCase() === collection.name.toLowerCase())) this.collections.push(collection)
    }
  }

  async removeSampleGames(): Promise<void> {
    const sampleIds = new Set(this.entries.filter((entry) => entry.isSample).map((entry) => entry.id))
    this.entries = this.entries.filter((entry) => !sampleIds.has(entry.id))
    this.collections = this.collections
      .filter((c) => !c.id.startsWith('sample-'))
      .map((c) => ({ ...c, gameIds: c.gameIds.filter((id) => !sampleIds.has(id)) }))
  }

  private assertNameFree(name: string, exceptId?: string): void {
    if (this.collections.some((c) => c.id !== exceptId && c.name.toLowerCase() === name.toLowerCase())) {
      throw new Error('A collection with that name already exists.')
    }
  }
}
