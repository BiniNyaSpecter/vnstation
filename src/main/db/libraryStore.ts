import { randomUUID } from 'node:crypto'
import type { CollectionInput, GameEntryPatch, LibraryRepository, LibrarySnapshot, NewGameDraft, VerifyResult } from '@shared/contracts'
import type { PlayHistory, PlaySession, SessionTracking } from '@shared/launcher'
import { createSampleSnapshot } from '@shared/sampleLibrary'
import type { ArtMotif, Collection, ContentRating, GameEntry, MetadataProviderId, ProviderMetadata } from '@shared/types'
import { ART_URL_PREFIX } from '@shared/metadata'
import { UserFacingError } from '../errors'
import { pathExists } from '../executables'
import type { Database } from './sqlite'

type GameRow = {
  id: string
  executable_path: string
  working_directory: string
  launch_arguments: string
  favorite: number
  added_at: string
  last_played_at: string | null
  playtime_minutes: number
  playtime_seconds: number
  is_sample: number
  art_motif: string | null
  art_hue: number | null
  provider: string | null
  external_id: string | null
  p_title: string | null
  original_title: string | null
  p_synopsis: string | null
  p_developer: string | null
  p_release_date: string | null
  original_language: string | null
  content_rating: string | null
  p_cover: string | null
  p_background: string | null
  fetched_at: string | null
  u_title: string | null
  u_synopsis: string | null
  u_developer: string | null
  u_release_date: string | null
  u_cover: string | null
  u_background: string | null
  notes: string | null
}

const GAME_SELECT = `
  SELECT g.*, p.provider, p.external_id, p.title AS p_title, p.original_title, p.synopsis AS p_synopsis,
         p.developer AS p_developer, p.release_date AS p_release_date, p.original_language, p.content_rating,
         p.cover_url AS p_cover, p.background_url AS p_background, p.fetched_at,
         u.title AS u_title, u.synopsis AS u_synopsis, u.developer AS u_developer,
         u.release_date AS u_release_date, u.cover_url AS u_cover, u.background_url AS u_background, u.notes
  FROM games g
  LEFT JOIN game_provider_metadata p ON p.game_id = g.id
  LEFT JOIN game_user_fields u ON u.game_id = g.id`

/** User-editable columns. Column names come from this fixed map, never from input. */
const USER_COLUMNS = {
  title: 'title',
  synopsis: 'synopsis',
  developer: 'developer',
  releaseDate: 'release_date',
  coverUrl: 'cover_url',
  backgroundUrl: 'background_url',
  notes: 'notes'
} as const

function groupBy<T extends { game_id: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const list = map.get(row.game_id)
    if (list) list.push(row)
    else map.set(row.game_id, [row])
  }
  return map
}

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('UNIQUE constraint failed')

export class LibraryStore implements LibraryRepository {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID
  ) {}

  // ---- reading ----

  async load(): Promise<LibrarySnapshot> {
    return this.snapshot()
  }

  snapshot(): LibrarySnapshot {
    return { entries: this.fetchEntries(), collections: this.fetchCollections() }
  }

  private fetchEntries(onlyId?: string): GameEntry[] {
    const where = onlyId ? ' WHERE g.id = ?' : ''
    const params = onlyId ? [onlyId] : []
    const relatedWhere = onlyId ? ' WHERE game_id = ?' : ''

    const rows = this.db.all<GameRow>(`${GAME_SELECT}${where} ORDER BY g.added_at DESC, g.id`, ...params)
    const altTitles = groupBy(this.db.all<{ game_id: string; title: string }>(`SELECT game_id, title FROM game_alt_titles${relatedWhere} ORDER BY game_id, position`, ...params))
    const languages = groupBy(this.db.all<{ game_id: string; language: string }>(`SELECT game_id, language FROM game_languages${relatedWhere} ORDER BY game_id, position`, ...params))
    const tags = groupBy(
      this.db.all<{ game_id: string; name: string; kind: string }>(
        `SELECT gt.game_id, t.name, t.kind FROM game_tags gt JOIN tags t ON t.id = gt.tag_id${onlyId ? ' WHERE gt.game_id = ?' : ''} ORDER BY gt.game_id, gt.position`,
        ...params
      )
    )

    return rows.map((row): GameEntry => {
      const gameTags = tags.get(row.id) ?? []
      return {
        id: row.id,
        launch: { executablePath: row.executable_path, workingDirectory: row.working_directory, arguments: row.launch_arguments },
        provider: {
          source: row.provider && row.external_id ? { provider: row.provider as MetadataProviderId, externalId: row.external_id } : null,
          title: row.p_title,
          originalTitle: row.original_title,
          altTitles: (altTitles.get(row.id) ?? []).map((r) => r.title),
          synopsis: row.p_synopsis,
          developer: row.p_developer,
          releaseDate: row.p_release_date,
          originalLanguage: row.original_language,
          languages: (languages.get(row.id) ?? []).map((r) => r.language),
          genres: gameTags.filter((t) => t.kind === 'genre').map((t) => t.name),
          tags: gameTags.filter((t) => t.kind === 'tag').map((t) => t.name),
          contentRating: (row.content_rating ?? 'unrated') as ContentRating,
          coverUrl: row.p_cover,
          backgroundUrl: row.p_background,
          fetchedAt: row.fetched_at
        },
        user: {
          title: row.u_title,
          synopsis: row.u_synopsis,
          developer: row.u_developer,
          releaseDate: row.u_release_date,
          coverUrl: row.u_cover,
          backgroundUrl: row.u_background,
          notes: row.notes ?? ''
        },
        art: row.art_motif && row.art_hue !== null ? { motif: row.art_motif as ArtMotif, hue: row.art_hue } : null,
        favorite: row.favorite === 1,
        addedAt: row.added_at,
        lastPlayedAt: row.last_played_at,
        playtimeMinutes: Math.floor(row.playtime_seconds / 60),
        isSample: row.is_sample === 1
      }
    })
  }

  private fetchCollections(): Collection[] {
    const rows = this.db.all<{ id: string; name: string; description: string | null }>(
      'SELECT id, name, description FROM collections ORDER BY position, created_at'
    )
    const members = this.db.all<{ collection_id: string; game_id: string }>(
      'SELECT collection_id, game_id FROM collection_games ORDER BY collection_id, position'
    )
    const byCollection = new Map<string, string[]>()
    for (const member of members) {
      const list = byCollection.get(member.collection_id)
      if (list) list.push(member.game_id)
      else byCollection.set(member.collection_id, [member.game_id])
    }
    return rows.map((row) => ({ id: row.id, name: row.name, description: row.description, gameIds: byCollection.get(row.id) ?? [] }))
  }

  private requireEntry(id: string): GameEntry {
    const entry = this.fetchEntries(id)[0]
    if (!entry) throw new UserFacingError('That game is no longer in the library.')
    return entry
  }

  // ---- games ----

  async addGame(draft: NewGameDraft): Promise<GameEntry> {
    const id = `game-${this.newId()}`
    const entry: GameEntry = {
      id,
      launch: { ...draft.launch },
      // No provider metadata yet: the entry is fully usable with just a title.
      provider: {
        source: null, title: null, originalTitle: null, altTitles: [], synopsis: null, developer: null, releaseDate: null,
        originalLanguage: null, languages: [], genres: [], tags: [], contentRating: 'unrated', coverUrl: null, backgroundUrl: null, fetchedAt: null
      },
      user: { title: draft.title.trim(), synopsis: null, developer: null, releaseDate: null, coverUrl: null, backgroundUrl: null, notes: '' },
      art: null,
      favorite: false,
      addedAt: this.now().toISOString(),
      lastPlayedAt: null,
      playtimeMinutes: 0,
      isSample: false
    }
    this.db.transaction(() => this.insertEntry(entry))
    return this.requireEntry(id)
  }

  private insertEntry(entry: GameEntry): void {
    const { id, launch, provider, user, art } = entry
    this.db.run(
      `INSERT INTO games (id, executable_path, working_directory, launch_arguments, favorite, added_at, last_played_at, playtime_minutes, playtime_seconds, is_sample, art_motif, art_hue)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, launch.executablePath, launch.workingDirectory, launch.arguments, entry.favorite ? 1 : 0, entry.addedAt,
      entry.lastPlayedAt, entry.playtimeMinutes, entry.playtimeMinutes * 60, entry.isSample ? 1 : 0, art?.motif ?? null, art?.hue ?? null
    )
    this.db.run(
      `INSERT INTO game_provider_metadata (game_id, provider, external_id, title, original_title, synopsis, developer, release_date, original_language, content_rating, cover_url, background_url, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, provider.source?.provider ?? null, provider.source?.externalId ?? null, provider.title, provider.originalTitle,
      provider.synopsis, provider.developer, provider.releaseDate, provider.originalLanguage, provider.contentRating,
      provider.coverUrl, provider.backgroundUrl, provider.fetchedAt
    )
    this.db.run(
      `INSERT INTO game_user_fields (game_id, title, synopsis, developer, release_date, cover_url, background_url, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id, user.title, user.synopsis, user.developer, user.releaseDate, user.coverUrl, user.backgroundUrl, user.notes
    )
    this.insertRelations(id, provider)
  }

  /** Alternative titles, languages and tags: real rows, not strings. */
  private insertRelations(id: string, provider: ProviderMetadata): void {
    provider.altTitles.forEach((title, position) => this.db.run('INSERT INTO game_alt_titles (game_id, position, title) VALUES (?, ?, ?)', id, position, title))
    ;[...new Set(provider.languages)].forEach((language, position) =>
      this.db.run('INSERT INTO game_languages (game_id, position, language) VALUES (?, ?, ?)', id, position, language)
    )
    let position = 0
    for (const [kind, names] of [['genre', provider.genres], ['tag', provider.tags]] as const) {
      for (const name of new Set(names)) {
        this.db.run('INSERT OR IGNORE INTO tags (name, kind) VALUES (?, ?)', name, kind)
        const tag = this.db.get<{ id: number }>('SELECT id FROM tags WHERE name = ? AND kind = ?', name, kind)
        if (tag) this.db.run('INSERT INTO game_tags (game_id, tag_id, position) VALUES (?, ?, ?)', id, tag.id, position++)
      }
    }
  }

  /** The stored entry for one game (throws a user-facing error if it is gone). */
  getEntry(id: string): GameEntry {
    return this.requireEntry(id)
  }

  /** The stored entry for one game, or null if it has been removed. */
  findEntry(id: string): GameEntry | null {
    return this.fetchEntries(id)[0] ?? null
  }

  /**
   * Replaces everything a provider said about a game (or clears it with `null`).
   * User edits live in separate columns and are never touched, except that the
   * user's title is dropped on request so the official title shows.
   */
  async setProviderMetadata(id: string, meta: ProviderMetadata | null, options: { clearUserTitle?: boolean } = {}): Promise<GameEntry> {
    const next: ProviderMetadata = meta ?? {
      source: null, title: null, originalTitle: null, altTitles: [], synopsis: null, developer: null, releaseDate: null,
      originalLanguage: null, languages: [], genres: [], tags: [], contentRating: 'unrated', coverUrl: null, backgroundUrl: null, fetchedAt: null
    }
    this.db.transaction(() => {
      this.requireEntry(id)
      this.db.run(
        `UPDATE game_provider_metadata SET provider = ?, external_id = ?, title = ?, original_title = ?, synopsis = ?, developer = ?,
           release_date = ?, original_language = ?, content_rating = ?, cover_url = ?, background_url = ?, fetched_at = ? WHERE game_id = ?`,
        next.source?.provider ?? null, next.source?.externalId ?? null, next.title, next.originalTitle, next.synopsis, next.developer,
        next.releaseDate, next.originalLanguage, next.contentRating, next.coverUrl, next.backgroundUrl, next.fetchedAt, id
      )
      this.db.run('DELETE FROM game_alt_titles WHERE game_id = ?', id)
      this.db.run('DELETE FROM game_languages WHERE game_id = ?', id)
      this.db.run('DELETE FROM game_tags WHERE game_id = ?', id)
      this.insertRelations(id, next)
      if (options.clearUserTitle && next.title) this.db.run('UPDATE game_user_fields SET title = NULL WHERE game_id = ?', id)
      this.pruneOrphanTags()
    })
    return this.requireEntry(id)
  }

  /** Forgets cached provider artwork URLs (after the cache folder is emptied). Details stay. */
  async clearProviderArtworkUrls(): Promise<void> {
    const pattern = `${ART_URL_PREFIX}vndb/%`
    this.db.run('UPDATE game_provider_metadata SET cover_url = NULL WHERE cover_url LIKE ?', pattern)
    this.db.run('UPDATE game_provider_metadata SET background_url = NULL WHERE background_url LIKE ?', pattern)
  }

  async updateGame(id: string, patch: GameEntryPatch): Promise<GameEntry> {
    this.db.transaction(() => {
      this.requireEntry(id)

      const columns: string[] = []
      const values: Array<string | number | null> = []
      const set = (column: string, value: string | number | null): void => {
        columns.push(`${column} = ?`)
        values.push(value)
      }
      if (patch.favorite !== undefined) set('favorite', patch.favorite ? 1 : 0)
      if (patch.lastPlayedAt !== undefined) set('last_played_at', patch.lastPlayedAt)
      if (patch.playtimeMinutes !== undefined) {
        set('playtime_minutes', patch.playtimeMinutes)
        set('playtime_seconds', patch.playtimeMinutes * 60)
      }
      if (patch.launch?.executablePath !== undefined) set('executable_path', patch.launch.executablePath)
      if (patch.launch?.workingDirectory !== undefined) set('working_directory', patch.launch.workingDirectory)
      if (patch.launch?.arguments !== undefined) set('launch_arguments', patch.launch.arguments)
      if (columns.length) this.db.run(`UPDATE games SET ${columns.join(', ')} WHERE id = ?`, ...values, id)

      const userColumns: string[] = []
      const userValues: Array<string | null> = []
      for (const [field, column] of Object.entries(USER_COLUMNS)) {
        const value = patch.user?.[field as keyof typeof USER_COLUMNS]
        if (value === undefined) continue
        userColumns.push(`${column} = ?`)
        userValues.push(field === 'notes' ? (value ?? '') : value)
      }
      if (userColumns.length) this.db.run(`UPDATE game_user_fields SET ${userColumns.join(', ')} WHERE game_id = ?`, ...userValues, id)
    })
    return this.requireEntry(id)
  }

  async removeGame(id: string): Promise<void> {
    this.db.transaction(() => {
      this.db.run('DELETE FROM games WHERE id = ?', id)
      this.pruneOrphanTags()
    })
  }

  private pruneOrphanTags(): void {
    this.db.run('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM game_tags)')
  }

  async verifyGame(id: string): Promise<VerifyResult> {
    const { launch } = this.requireEntry(id)
    const [executableExists, workingDirectoryExists] = await Promise.all([
      pathExists(launch.executablePath, 'file'),
      pathExists(launch.workingDirectory, 'directory')
    ])
    return { executableExists, workingDirectoryExists }
  }

  // ---- collections ----

  async createCollection(input: CollectionInput): Promise<Collection> {
    const id = `collection-${this.newId()}`
    try {
      this.db.run(
        `INSERT INTO collections (id, name, description, position, created_at)
         VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM collections), ?)`,
        id, input.name, input.description ?? null, this.now().toISOString()
      )
    } catch (error) {
      throw this.translateCollectionError(error)
    }
    return { id, name: input.name, description: input.description ?? null, gameIds: [] }
  }

  async updateCollection(id: string, input: CollectionInput): Promise<Collection> {
    try {
      const result = this.db.run('UPDATE collections SET name = ?, description = ? WHERE id = ?', input.name, input.description ?? null, id)
      if (result.changes === 0) throw new UserFacingError('That collection no longer exists.')
    } catch (error) {
      throw this.translateCollectionError(error)
    }
    const collection = this.fetchCollections().find((c) => c.id === id)
    if (!collection) throw new UserFacingError('That collection no longer exists.')
    return collection
  }

  async deleteCollection(id: string): Promise<void> {
    this.db.run('DELETE FROM collections WHERE id = ?', id)
  }

  async setGameCollections(gameId: string, collectionIds: string[]): Promise<void> {
    this.db.transaction(() => {
      this.requireEntry(gameId)
      const ids = [...new Set(collectionIds)]
      if (ids.length) {
        const marks = ids.map(() => '?').join(', ')
        const found = this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM collections WHERE id IN (${marks})`, ...ids)
        if (Number(found?.n) !== ids.length) throw new UserFacingError('One of those collections no longer exists.')
        this.db.run(`DELETE FROM collection_games WHERE game_id = ? AND collection_id NOT IN (${marks})`, gameId, ...ids)
      } else {
        this.db.run('DELETE FROM collection_games WHERE game_id = ?', gameId)
      }
      for (const collectionId of ids) {
        this.db.run(
          `INSERT OR IGNORE INTO collection_games (collection_id, game_id, position, added_at)
           VALUES (?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM collection_games WHERE collection_id = ?), ?)`,
          collectionId, gameId, collectionId, this.now().toISOString()
        )
      }
    })
  }

  private translateCollectionError(error: unknown): unknown {
    return isUniqueViolation(error) ? new UserFacingError('A collection with that name already exists.') : error
  }

  // ---- development sample data ----

  async addSampleGames(): Promise<void> {
    this.db.transaction(() => {
      if (this.db.get('SELECT 1 AS x FROM games WHERE is_sample = 1 LIMIT 1')) return
      const sample = createSampleSnapshot()
      for (const entry of sample.entries) this.insertEntry(entry)
      for (const collection of sample.collections) {
        this.db.run(
          `INSERT OR IGNORE INTO collections (id, name, description, position, created_at, is_sample)
           VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM collections), ?, 1)`,
          collection.id, collection.name, collection.description, this.now().toISOString()
        )
        collection.gameIds.forEach((gameId, position) =>
          this.db.run(
            'INSERT OR IGNORE INTO collection_games (collection_id, game_id, position, added_at) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM collections WHERE id = ?)',
            collection.id, gameId, position + 1, this.now().toISOString(), collection.id
          )
        )
      }
    })
  }

  async removeSampleGames(): Promise<void> {
    this.db.transaction(() => {
      this.db.run('DELETE FROM games WHERE is_sample = 1')
      this.db.run('DELETE FROM collections WHERE is_sample = 1')
      this.pruneOrphanTags()
    })
  }

  // ---- play sessions ----

  /** Records the start of a launch and stamps `last_played_at` immediately. */
  startPlaySession(gameId: string, startedAt: string): { sessionId: number; entry: GameEntry } {
    return this.db.transaction(() => {
      this.requireEntry(gameId)
      this.db.run('UPDATE games SET last_played_at = ? WHERE id = ?', startedAt, gameId)
      const { lastInsertRowid } = this.db.run('INSERT INTO play_sessions (game_id, started_at) VALUES (?, ?)', gameId, startedAt)
      return { sessionId: lastInsertRowid, entry: this.requireEntry(gameId) }
    })
  }

  /**
   * Closes an open session and adds its seconds to the game's total playtime.
   * Safe to call if the game was removed while it was running (`ON DELETE CASCADE`
   * already removed the session) or if the session was already closed.
   */
  finishPlaySession(
    sessionId: number,
    endedAt: string,
    seconds: number,
    tracking: SessionTracking
  ): { session: PlaySession | null; entry: GameEntry | null } {
    return this.db.transaction(() => {
      const existing = this.db.get<{
        id: number
        game_id: string
        started_at: string
        ended_at: string | null
        duration_seconds: number | null
        tracking: string | null
      }>('SELECT id, game_id, started_at, ended_at, duration_seconds, tracking FROM play_sessions WHERE id = ?', sessionId)
      if (!existing) return { session: null, entry: null }

      if (existing.ended_at === null) {
        const counted = tracking === 'interrupted' ? 0 : Math.max(0, Math.round(seconds))
        this.db.run(
          'UPDATE play_sessions SET ended_at = ?, duration_seconds = ?, tracking = ? WHERE id = ?',
          endedAt,
          counted,
          tracking,
          sessionId
        )
        if (counted > 0) {
          this.db.run(
            'UPDATE games SET playtime_seconds = playtime_seconds + ?, playtime_minutes = (playtime_seconds + ?) / 60 WHERE id = ?',
            counted,
            counted,
            existing.game_id
          )
        }
        return {
          session: {
            id: Number(existing.id),
            gameId: existing.game_id,
            startedAt: existing.started_at,
            endedAt,
            seconds: counted,
            tracking
          },
          entry: this.findEntry(existing.game_id)
        }
      }

      return {
        session: {
          id: Number(existing.id),
          gameId: existing.game_id,
          startedAt: existing.started_at,
          endedAt: existing.ended_at,
          seconds: Number(existing.duration_seconds ?? 0),
          tracking: (existing.tracking as SessionTracking | null) ?? null
        },
        entry: this.findEntry(existing.game_id)
      }
    })
  }

  /**
   * Closes sessions that were still open when VNStation last stopped unexpectedly.
   * Their true end time is unknown, so 0 seconds are added rather than inventing a length.
   */
  closeOrphanSessions(endedAt: string = this.now().toISOString()): number {
    return this.db.run(
      `UPDATE play_sessions SET ended_at = ?, duration_seconds = 0, tracking = 'interrupted' WHERE ended_at IS NULL`,
      endedAt
    ).changes
  }

  listPlaySessions(gameId: string, limit = 10): PlayHistory {
    const cap = Math.max(1, Math.min(100, Math.trunc(limit)))
    const rows = this.db.all<{
      id: number
      game_id: string
      started_at: string
      ended_at: string | null
      duration_seconds: number | null
      tracking: string | null
    }>(
      'SELECT id, game_id, started_at, ended_at, duration_seconds, tracking FROM play_sessions WHERE game_id = ? ORDER BY started_at DESC, id DESC LIMIT ?',
      gameId,
      cap
    )
    const total = this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM play_sessions WHERE game_id = ?', gameId)
    return {
      sessions: rows.map((row) => ({
        id: Number(row.id),
        gameId: row.game_id,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        seconds: Number(row.duration_seconds ?? 0),
        tracking: (row.tracking as SessionTracking | null) ?? null
      })),
      totalSessions: Number(total?.n ?? 0)
    }
  }
}
