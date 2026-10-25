import type { Game, GameEntry } from '@shared/types'
import { deriveArtStyle, fallbackBackgroundUrl, fallbackCoverUrl } from './art'

/**
 * Merges provider metadata with the user's own edits (user wins) and attaches
 * artwork, falling back to generated art when none exists.
 */
export function resolveEntry(entry: GameEntry): Game {
  const { provider, user } = entry
  const title = user.title ?? provider.title ?? 'Untitled game'
  const style = entry.art ?? deriveArtStyle(entry.id)
  const coverFallbackUrl = fallbackCoverUrl(title, style)
  const backgroundFallbackUrl = fallbackBackgroundUrl(style)

  return {
    id: entry.id,
    title,
    originalTitle: provider.originalTitle,
    altTitles: provider.altTitles,
    synopsis: user.synopsis ?? provider.synopsis,
    developer: user.developer ?? provider.developer,
    releaseDate: user.releaseDate ?? provider.releaseDate,
    originalLanguage: provider.originalLanguage,
    languages: provider.languages,
    genres: provider.genres,
    tags: provider.tags,
    contentRating: provider.contentRating,
    coverUrl: user.coverUrl ?? provider.coverUrl ?? coverFallbackUrl,
    coverFallbackUrl,
    backgroundUrl: user.backgroundUrl ?? provider.backgroundUrl ?? backgroundFallbackUrl,
    backgroundFallbackUrl,
    favorite: entry.favorite,
    notes: user.notes,
    launch: entry.launch,
    source: provider.source,
    metadataFetchedAt: provider.fetchedAt,
    hasCustomCover: user.coverUrl !== null,
    hasCustomBackground: user.backgroundUrl !== null,
    librarySource: entry.librarySource ?? 'manual',
    steamAppId: entry.steamAppId ?? null,
    steamInstalled: entry.steamInstalled ?? null,
    steamAvailable: entry.steamAvailable ?? true,
    isSample: entry.isSample,
    addedAt: entry.addedAt,
    lastPlayedAt: entry.lastPlayedAt,
    playtimeMinutes: entry.playtimeMinutes
  }
}

const cache = new WeakMap<GameEntry, Game>()

/** Resolves a list, reusing the previous result for unchanged entries (stable identity). */
export function resolveEntries(entries: readonly GameEntry[]): Game[] {
  return entries.map((entry) => {
    const hit = cache.get(entry)
    if (hit) return hit
    const game = resolveEntry(entry)
    cache.set(entry, game)
    return game
  })
}
