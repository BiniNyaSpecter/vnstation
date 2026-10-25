import type { MetadataCandidate, MetadataDetails } from '@shared/metadata'
import type { ContentRating } from '@shared/types'
import { UserFacingError } from '../errors'
import type { Fetcher } from './http'
import type { MetadataProvider } from './provider'
import type { RequestScheduler } from './scheduler'

/**
 * VNDB "Kana" API v2 (https://api.vndb.org/kana). No key is needed for public
 * queries. Free for non-commercial use; data is under the Open Database License
 * (attribution is shown in the app). Limits: 200 requests per 5 minutes, 1 second
 * of server time per minute, requests over 3 seconds are aborted.
 */
export const VNDB_API = 'https://api.vndb.org/kana'
export const VNDB_ID = /^v\d{1,9}$/

const SEARCH_FIELDS = 'title, alttitle, olang, released, languages, developers{name}, image{url,thumbnail,sexual,violence,dims}'
const DETAIL_FIELDS =
  'title, alttitle, titles{title,latin}, aliases, olang, released, languages, description, ' +
  'image{url,sexual,violence,dims}, screenshots{url,sexual,violence,dims}, developers{name}, ' +
  'tags{name,category,rating,spoiler}'

// ---- content safety -------------------------------------------------------------------------
// VNDB flags every image with averaged votes: sexual 0 (safe) to 2 (explicit), violence 0 to 2 (brutal).

/**
 * What may be downloaded and shown.
 *  - "family" (default): only clearly safe images; adults-only games get no description or artwork.
 *  - "adult": the user confirmed they are 18 or older and switched adult entries on. Covers and
 *    descriptions are kept for every game. Full-screen backgrounds still skip screenshots flagged
 *    explicit or brutal, since those would sit behind the interface text.
 */
export type ContentPolicy = 'family' | 'adult'

/** In family mode, images flagged at or above these are never downloaded; generated art is used instead. */
export const IMAGE_LIMITS = { sexual: 0.5, violence: 1.5 } as const
/** In adult mode, backgrounds skip screenshots flagged at or above these. */
export const ADULT_BACKGROUND_LIMITS = { sexual: 1.5, violence: 2 } as const

export interface ImageFlags {
  sexual: number
  violence: number
}

export const isImageSafe = (flags: ImageFlags): boolean =>
  flags.sexual < IMAGE_LIMITS.sexual && flags.violence < IMAGE_LIMITS.violence

const RANK: Record<ContentRating, number> = { unrated: 0, 'all-ages': 1, teen: 2, mature: 3, restricted: 4 }

/** The more restrictive of two ratings. "Unrated" never overrides a known rating. */
export const strictest = (a: ContentRating, b: ContentRating): ContentRating => (RANK[a] >= RANK[b] ? a : b)

/** From the release age ratings (VNDB `minage`). The strictest release decides. */
export function ratingFromMinAge(minAges: readonly number[]): ContentRating {
  const known = minAges.filter((age) => Number.isFinite(age))
  if (known.length === 0) return 'unrated'
  const age = Math.max(...known)
  if (age >= 18) return 'restricted'
  if (age >= 15) return 'mature'
  if (age >= 12) return 'teen'
  return 'all-ages'
}

export interface ParsedTag {
  name: string
  category: string
  rating: number
  spoiler: number
}

/** From the cover flags and sexual-content ("ero") tags, for games with no usable age rating. */
export function ratingFromSignals(image: ImageFlags | null, tags: readonly ParsedTag[]): ContentRating {
  const ero = tags.filter((tag) => tag.category === 'ero' && tag.spoiler === 0)
  if ((image && image.sexual >= 1.5) || ero.some((tag) => tag.rating >= 1.5)) return 'restricted'
  if ((image && image.sexual >= 0.5) || ero.some((tag) => tag.rating >= 0.8)) return 'mature'
  return 'unrated'
}

// ---- parsing ---------------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null)
const num = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

const unreadable = (): never => {
  throw new UserFacingError('VNDB sent a response VNStation could not read.')
}

/** Only https images hosted by VNDB are ever fetched, whatever the API returns. */
export function isVndbImageUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && (url.hostname === 'vndb.org' || url.hostname.endsWith('.vndb.org'))
  } catch {
    return false
  }
}

export interface ParsedImage extends ImageFlags {
  url: string
  thumbnail: string | null
  width: number
  height: number
}

export function parseImage(value: unknown): ParsedImage | null {
  if (!isRecord(value)) return null
  const url = str(value.url)
  if (!url || !isVndbImageUrl(url)) return null
  const dims = list(value.dims)
  const thumbnail = str(value.thumbnail)
  return {
    url,
    thumbnail: thumbnail && isVndbImageUrl(thumbnail) ? thumbnail : null,
    width: num(dims[0], 0),
    height: num(dims[1], 0),
    // A missing flag is treated as unsafe, never as safe.
    sexual: num(value.sexual, 2),
    violence: num(value.violence, 2)
  }
}

const displayNames = new Intl.DisplayNames(['en'], { type: 'language' })
export function languageName(code: string): string {
  try {
    return displayNames.of(code) ?? code
  } catch {
    return code
  }
}

/** VNDB dates are YYYY, YYYY-MM or YYYY-MM-DD; "TBA" and "unknown" become null. */
export const normalizeDate = (value: unknown): string | null =>
  typeof value === 'string' && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(value) ? value : null

/** Turns VNDB's formatting codes into plain text and removes spoiler blocks entirely. */
export function stripVndbFormatting(text: string): string {
  return text
    .replace(/\[spoiler\][\s\S]*?\[\/spoiler\]/gi, '')
    .replace(/\[spoiler\][\s\S]*$/i, '')
    .replace(/\[url=[^\]]*\]([\s\S]*?)\[\/url\]/gi, '$1')
    .replace(/\[\/?(?:b|i|u|s|raw|code|quote|url)\]/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Highest-rated, non-spoiler content tags. Sexual-content and technical tags are left out. */
export function pickTags(tags: readonly ParsedTag[]): string[] {
  return tags
    .filter((tag) => tag.category === 'cont' && tag.spoiler === 0 && tag.rating >= 1.2)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 10)
    .map((tag) => tag.name)
}

/** The widest screenshot that passes the content filter, if any is big enough to be a background. */
export function pickBackground(shots: readonly ParsedImage[], policy: ContentPolicy = 'family'): ParsedImage | null {
  const allowed = (shot: ParsedImage): boolean =>
    policy === 'adult'
      ? shot.sexual < ADULT_BACKGROUND_LIMITS.sexual && shot.violence < ADULT_BACKGROUND_LIMITS.violence
      : isImageSafe(shot)
  const usable = shots.filter((shot) => allowed(shot) && shot.width >= 800)
  return usable.reduce<ParsedImage | null>((best, shot) => (best === null || shot.width > best.width ? shot : best), null)
}

function parseTags(value: unknown): ParsedTag[] {
  return list(value).flatMap((raw) => {
    if (!isRecord(raw)) return []
    const name = str(raw.name)
    return name ? [{ name, category: str(raw.category) ?? '', rating: num(raw.rating, 0), spoiler: num(raw.spoiler, 2) }] : []
  })
}

const resultsOf = (response: unknown): unknown[] => (isRecord(response) && Array.isArray(response.results) ? response.results : unreadable())

export function parseSearchResponse(response: unknown, policy: ContentPolicy = 'family'): MetadataCandidate[] {
  return resultsOf(response).flatMap((raw): MetadataCandidate[] => {
    if (!isRecord(raw)) return []
    const id = str(raw.id)
    const title = str(raw.title)
    if (!id || !VNDB_ID.test(id) || !title) return []
    const image = parseImage(raw.image)
    const shown = image !== null && (policy === 'adult' || isImageSafe(image))
    return [
      {
        provider: 'vndb',
        externalId: id,
        title,
        originalTitle: str(raw.alttitle),
        releaseDate: normalizeDate(raw.released),
        developers: list(raw.developers).flatMap((d) => (isRecord(d) && str(d.name) ? [str(d.name) as string] : [])).slice(0, 3),
        languages: list(raw.languages).flatMap((l) => (typeof l === 'string' ? [languageName(l)] : [])),
        thumbnailUrl: shown ? (image.thumbnail ?? image.url) : null,
        contentRating: ratingFromSignals(image, [])
      }
    ]
  })
}

/**
 * Builds the details for one game. With the "family" policy, adults-only entries keep their
 * title, developer and dates but never get a synopsis or artwork: those are dropped here, so
 * they are not downloaded, stored, cached or displayed anywhere. With "adult", they are kept.
 */
export function parseVnDetails(response: unknown, releaseMinAges: readonly number[], policy: ContentPolicy = 'family'): MetadataDetails {
  const vn = resultsOf(response)[0]
  if (!isRecord(vn)) throw new UserFacingError('VNDB has no entry with that ID.')
  const id = str(vn.id)
  const title = str(vn.title)
  if (!id || !VNDB_ID.test(id) || !title) return unreadable()

  const image = parseImage(vn.image)
  const tags = parseTags(vn.tags)
  const contentRating = strictest(ratingFromMinAge(releaseMinAges), ratingFromSignals(image, tags))
  const withhold = contentRating === 'restricted' && policy === 'family'

  const original = str(vn.alttitle)
  const seen = new Set([title.toLowerCase(), (original ?? '').toLowerCase()])
  const altTitles: string[] = []
  const consider = (value: unknown): void => {
    const text = str(value)
    if (text && !seen.has(text.toLowerCase())) {
      seen.add(text.toLowerCase())
      altTitles.push(text)
    }
  }
  for (const t of list(vn.titles)) if (isRecord(t)) (consider(t.title), consider(t.latin))
  for (const alias of list(vn.aliases)) consider(alias)

  const description = str(vn.description)
  const shots = list(vn.screenshots).flatMap((s) => parseImage(s) ?? [])
  const olang = str(vn.olang)

  return {
    source: { provider: 'vndb', externalId: id },
    title,
    originalTitle: original,
    altTitles: altTitles.slice(0, 12),
    synopsis: withhold || !description ? null : stripVndbFormatting(description) || null,
    developer:
      list(vn.developers)
        .flatMap((d) => (isRecord(d) && str(d.name) ? [str(d.name) as string] : []))
        .slice(0, 3)
        .join(', ') || null,
    releaseDate: normalizeDate(vn.released),
    originalLanguage: olang ? languageName(olang) : null,
    languages: list(vn.languages).flatMap((l) => (typeof l === 'string' ? [languageName(l)] : [])),
    genres: [], // VNDB has tags, not genres
    tags: pickTags(tags),
    contentRating,
    coverRemoteUrl: !withhold && image && (policy === 'adult' || isImageSafe(image)) ? image.url : null,
    backgroundRemoteUrl: withhold ? null : (pickBackground(shots, policy)?.url ?? null)
  }
}

export function parseReleaseMinAges(response: unknown): number[] {
  return resultsOf(response).flatMap((release) => (isRecord(release) && typeof release.minage === 'number' ? [release.minage] : []))
}

// ---- the provider ----------------------------------------------------------------------------

function networkError(error: unknown): UserFacingError {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return new UserFacingError('VNDB took too long to answer. Try again in a moment.')
  }
  return new UserFacingError('Could not reach VNDB. Check your internet connection. Your library still works offline.')
}

export class VndbProvider implements MetadataProvider {
  readonly id = 'vndb' as const

  constructor(
    private readonly fetcher: Fetcher,
    private readonly scheduler: RequestScheduler,
    private readonly userAgent = 'VNStation'
  ) {}

  async search(query: string, policy: ContentPolicy = 'family'): Promise<MetadataCandidate[]> {
    const response = await this.post('/vn', { filters: ['search', '=', query], fields: SEARCH_FIELDS, sort: 'searchrank', results: 10 })
    return parseSearchResponse(response, policy)
  }

  async getDetails(externalId: string, policy: ContentPolicy = 'family'): Promise<MetadataDetails> {
    if (!VNDB_ID.test(externalId)) throw new UserFacingError('That VNDB ID is not valid.')
    const vn = await this.post('/vn', { filters: ['id', '=', externalId], fields: DETAIL_FIELDS, results: 1 })
    // The age rating decides what may be shown, so a failure here fails the whole lookup.
    const releases = await this.post('/release', { filters: ['vn', '=', ['id', '=', externalId]], fields: 'minage', results: 100 })
    return parseVnDetails(vn, parseReleaseMinAges(releases), policy)
  }

  private post(path: string, body: unknown): Promise<unknown> {
    return this.scheduler.run(async () => {
      let response
      try {
        response = await this.fetcher(`${VNDB_API}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': this.userAgent },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15_000)
        })
      } catch (error) {
        throw networkError(error)
      }
      if (response.status === 429) throw new UserFacingError('VNDB asked VNStation to slow down. Wait a minute and try again.')
      if (response.status >= 500) throw new UserFacingError('VNDB is having trouble right now. Try again later. Your library still works offline.')
      if (!response.ok) throw new UserFacingError(`VNDB could not process that request (error ${response.status}).`)
      try {
        return await response.json()
      } catch {
        return unreadable()
      }
    })
  }
}
