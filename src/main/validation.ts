import type { CollectionInput, GameEntryPatch, NewGameDraft } from '@shared/contracts'
import type { LaunchOptions } from '@shared/launcher'
import { ART_URL_PREFIX, type ArtworkKind } from '@shared/metadata'
import type { UserFields } from '@shared/types'
import { UserFacingError } from './errors'

/**
 * Everything that crosses the IPC boundary is untrusted. These parsers accept only
 * the exact shapes the app sends, trim and bound every string, reject NUL bytes,
 * and ignore unknown keys. Existence checks for paths live in the library service.
 */
const LIMITS = {
  id: 200,
  title: 300,
  path: 32_767,
  arguments: 8_192,
  synopsis: 20_000,
  short: 300,
  url: 4_096,
  notes: 20_000,
  collectionName: 120,
  collectionDescription: 500,
  idList: 500
} as const

const invalid = (what = 'request'): never => {
  throw new UserFacingError(`That ${what} was not valid.`)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function text(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string' || value.includes('\0')) return invalid(label)
  if (value.length > max) throw new UserFacingError(`The ${label} is too long.`)
  return value
}

export function parseId(value: unknown, label = 'item'): string {
  const id = text(value, LIMITS.id, label)
  if (!/^[\w.-]+$/.test(id)) return invalid(label)
  return id
}

export function parseIdList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > LIMITS.idList) return invalid('list')
  return [...new Set(value.map((id) => parseId(id, 'collection')))]
}

export function parseNewGameDraft(value: unknown): NewGameDraft {
  if (!isRecord(value) || !isRecord(value.launch)) return invalid('game')
  const title = text(value.title, LIMITS.title, 'title').trim()
  if (!title) throw new UserFacingError('Give the game a title.')
  return {
    title,
    launch: {
      executablePath: text(value.launch.executablePath, LIMITS.path, 'file path'),
      workingDirectory: text(value.launch.workingDirectory, LIMITS.path, 'folder path'),
      arguments: text(value.launch.arguments ?? '', LIMITS.arguments, 'launch arguments').trim()
    }
  }
}

/** Optional text: trimmed, and blank becomes null ("use the provider value"). */
const optional = (value: unknown, max: number, label: string): string | null => {
  if (value === null) return null
  const trimmed = text(value, max, label).trim()
  return trimmed === '' ? null : trimmed
}

/** Artwork overrides may only point into the local artwork cache (or be cleared); never at a web address. */
function localArtUrl(value: unknown, label: string): string | null {
  const url = optional(value, LIMITS.url, label)
  if (url !== null && !url.startsWith(ART_URL_PREFIX)) return invalid(label)
  return url
}

export function parseGamePatch(value: unknown): GameEntryPatch {
  if (!isRecord(value)) return invalid('change')
  const patch: GameEntryPatch = {}

  if ('favorite' in value) {
    if (typeof value.favorite !== 'boolean') return invalid('change')
    patch.favorite = value.favorite
  }
  if ('lastPlayedAt' in value) {
    const at = value.lastPlayedAt
    if (at !== null && (typeof at !== 'string' || Number.isNaN(Date.parse(at)))) return invalid('date')
    patch.lastPlayedAt = at as string | null
  }
  if ('playtimeMinutes' in value) {
    const minutes = value.playtimeMinutes
    if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 0 || minutes > 10_000_000) return invalid('playtime')
    patch.playtimeMinutes = minutes
  }
  if (isRecord(value.launch)) {
    patch.launch = {}
    if ('executablePath' in value.launch) patch.launch.executablePath = text(value.launch.executablePath, LIMITS.path, 'file path')
    if ('workingDirectory' in value.launch) patch.launch.workingDirectory = text(value.launch.workingDirectory, LIMITS.path, 'folder path')
    if ('arguments' in value.launch) patch.launch.arguments = text(value.launch.arguments, LIMITS.arguments, 'launch arguments').trim()
  }
  if (isRecord(value.user)) {
    const user: Partial<UserFields> = {}
    const u = value.user
    if ('title' in u) user.title = optional(u.title, LIMITS.title, 'title')
    if ('synopsis' in u) user.synopsis = optional(u.synopsis, LIMITS.synopsis, 'description')
    if ('developer' in u) user.developer = optional(u.developer, LIMITS.short, 'developer')
    if ('releaseDate' in u) {
      const date = optional(u.releaseDate, 10, 'release date')
      if (date !== null && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(date)) return invalid('release date')
      user.releaseDate = date
    }
    if ('coverUrl' in u) user.coverUrl = localArtUrl(u.coverUrl, 'cover')
    if ('backgroundUrl' in u) user.backgroundUrl = localArtUrl(u.backgroundUrl, 'background')
    if ('notes' in u) user.notes = text(u.notes ?? '', LIMITS.notes, 'notes')
    patch.user = user
  }
  return patch
}

export function parseCollectionInput(value: unknown): CollectionInput {
  if (!isRecord(value)) return invalid('collection')
  const name = text(value.name, LIMITS.collectionName, 'name').trim()
  if (!name) throw new UserFacingError('Give the collection a name.')
  return { name, description: optional(value.description ?? null, LIMITS.collectionDescription, 'description') }
}

export function parseExternalId(value: unknown): string {
  if (typeof value !== 'string' || !/^v\d{1,9}$/.test(value)) return invalid('VNDB ID')
  return value
}

export function parseSearchOptions(value: unknown): { includeRestricted: boolean } {
  if (!isRecord(value) || typeof value.includeRestricted !== 'boolean') return invalid('search')
  return { includeRestricted: value.includeRestricted }
}

export function parseApplyOptions(value: unknown): { replaceTitle: boolean; allowAdult: boolean } {
  if (!isRecord(value) || typeof value.replaceTitle !== 'boolean' || typeof value.allowAdult !== 'boolean') return invalid('request')
  return { replaceTitle: value.replaceTitle, allowAdult: value.allowAdult }
}

export function parseRefreshOptions(value: unknown): { allowAdult: boolean } {
  if (!isRecord(value) || typeof value.allowAdult !== 'boolean') return invalid('request')
  return { allowAdult: value.allowAdult }
}

export function parseArtworkKind(value: unknown): ArtworkKind {
  if (value !== 'cover' && value !== 'background') return invalid('artwork type')
  return value
}

export function parseLaunchOptions(value: unknown): LaunchOptions {
  if (!isRecord(value) || typeof value.minimizeOnLaunch !== 'boolean' || typeof value.restoreOnExit !== 'boolean') {
    return invalid('launch request')
  }
  return { minimizeOnLaunch: value.minimizeOnLaunch, restoreOnExit: value.restoreOnExit }
}

export function parseHistoryLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 100) return invalid('request')
  return value
}
