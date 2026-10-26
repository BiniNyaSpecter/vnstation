import type { CharacterListResult } from './characters'
import type { ArtworkKind, MetadataSearchResult } from './metadata'
import type { LauncherEvent, LaunchOptions, LaunchResult, PlayHistory, RunningGame } from './launcher'
import type {
  ClassificationOverride,
  SteamCatalogItem,
  SteamConnectInput,
  SteamStatus,
  SteamSyncOptions,
  SteamSyncSummary
} from './steam'
import type { Collection, GameEntry, LaunchConfig, Preferences, UserFields } from './types'

export type { SocialApi } from './social'

/**
 * The renderer talks to these interfaces only. In Electron they are backed by the
 * main process (SQLite, over IPC); in a plain browser (design work) and in tests
 * an in-memory implementation is used, so nothing in the UI changes between them.
 */

export interface NewGameDraft {
  title: string
  launch: LaunchConfig
}

export interface GameEntryPatch {
  favorite?: boolean
  lastPlayedAt?: string | null
  playtimeMinutes?: number
  launch?: Partial<LaunchConfig>
  /** Blank/null optional fields fall back to provider metadata. */
  user?: Partial<UserFields>
}

export interface CollectionInput {
  name: string
  description?: string | null
}

export interface LibrarySnapshot {
  entries: GameEntry[]
  collections: Collection[]
}

export interface VerifyResult {
  executableExists: boolean
  workingDirectoryExists: boolean
}

export interface LibraryRepository {
  load(): Promise<LibrarySnapshot>
  addGame(draft: NewGameDraft): Promise<GameEntry>
  updateGame(id: string, patch: GameEntryPatch): Promise<GameEntry>
  /** Removes the library entry only. Never touches the game's files. */
  removeGame(id: string): Promise<void>
  createCollection(input: CollectionInput): Promise<Collection>
  updateCollection(id: string, input: CollectionInput): Promise<Collection>
  /** Deletes the collection only; the games in it stay in the library. */
  deleteCollection(id: string): Promise<void>
  /** Makes `collectionIds` the complete set of collections the game belongs to. */
  setGameCollections(gameId: string, collectionIds: string[]): Promise<void>
  /** Checks, in the main process, whether the saved paths still exist. */
  verifyGame(id: string): Promise<VerifyResult>
  /** Development preview data. Idempotent. */
  addSampleGames(): Promise<void>
  removeSampleGames(): Promise<void>
}

export interface ApplyMetadataOptions {
  /** Show the official title instead of the one typed when the game was added. */
  replaceTitle: boolean
  /** The user confirmed they are 18 or older: keep descriptions and artwork of adults-only games. */
  allowAdult: boolean
}

/**
 * Online details and artwork. Everything runs in the main process: the renderer
 * only sends a search text and picks from the results, and never fetches anything.
 */
export interface MetadataApi {
  search(query: string, options: { includeRestricted: boolean }): Promise<MetadataSearchResult>
  /** Downloads details and artwork for `externalId` and saves them on the game. */
  apply(gameId: string, externalId: string, options: ApplyMetadataOptions): Promise<GameEntry>
  /** Re-downloads the details of the already linked entry, bypassing the response cache. */
  refresh(gameId: string, options: { allowAdult: boolean }): Promise<GameEntry>
  /** Removes provider details and artwork from the game. The user's own edits stay. */
  unlink(gameId: string): Promise<GameEntry>
  /** Opens a native image picker. Resolves to null if the user cancels. */
  chooseArtwork(gameId: string, kind: ArtworkKind): Promise<GameEntry | null>
  resetArtwork(gameId: string, kind: ArtworkKind): Promise<GameEntry>
  cacheStats(): Promise<{ files: number; bytes: number }>
  /** Deletes downloaded provider artwork (not images the user chose themselves). */
  clearCache(): Promise<void>
  /** Fetches or returns cached VNDB characters for a linked game. */
  getCharacters(gameId: string, options: { allowAdult: boolean; force?: boolean }): Promise<CharacterListResult>
  /** Opens a verified https://vndb.org/ page in the default external browser. */
  openExternalVndb(vndbUrl: string): Promise<boolean>
}

export interface SteamApi {
  getStatus(): Promise<SteamStatus>
  connect(input: SteamConnectInput): Promise<SteamStatus>
  disconnect(): Promise<SteamStatus>
  sync(options: SteamSyncOptions): Promise<SteamSyncSummary>
  listCatalog(): Promise<SteamCatalogItem[]>
  setClassificationOverride(
    steamAppId: number,
    override: ClassificationOverride,
    options: { allowAdult: boolean }
  ): Promise<SteamCatalogItem>
  linkCatalogVndb(
    steamAppId: number,
    externalId: string,
    options: { allowAdult: boolean }
  ): Promise<SteamCatalogItem>
  /** Removes library entries for Steam games marked unavailable, returning the number removed. */
  cleanupUnavailable(): Promise<number>
}

export interface PreferencesRepository {
  /** Raw stored value, or null when nothing has been saved yet. Callers must validate it. */
  load(): Promise<unknown | null>
  save(prefs: Preferences): Promise<void>
}

export type { LaunchResult } from './launcher'

/**
 * Starts games and reports their sessions. In Electron the main process starts the
 * original executable (no shell, argument array) and measures playtime; the renderer
 * only asks and listens.
 */
export interface GameLauncher {
  launch(gameId: string, options: LaunchOptions): Promise<LaunchResult>
  /** Games currently running, so the UI can resynchronise after a reload. */
  running(): Promise<RunningGame[]>
  /** The game's most recent play sessions. */
  history(gameId: string, limit: number): Promise<PlayHistory>
  /** Reveals the game's executable or working directory in the OS file manager. */
  openFolder(gameId: string): Promise<boolean>
  /** Receives start, tracking and stop events. Returns an unsubscribe function. */
  subscribe(listener: (event: LauncherEvent) => void): () => void
}
