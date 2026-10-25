import type { Collection, Game, SortKey } from '@shared/types'

export const SORT_OPTIONS: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: 'title', label: 'Title' },
  { key: 'releaseDate', label: 'Release date' },
  { key: 'developer', label: 'Developer' },
  { key: 'recentlyAdded', label: 'Recently added' },
  { key: 'recentlyPlayed', label: 'Recently played' }
]

export interface LibraryFilter {
  search?: string
  genre?: string | null
  language?: string | null
  favoritesOnly?: boolean
  playedOnly?: boolean
  /** Entries rated for adults are excluded unless this is true. */
  showRestricted: boolean
  /** Restrict to these ids (used for collections). */
  gameIds?: ReadonlySet<string> | null
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

export const normalizeSearch = (value: string): string => value.normalize('NFKC').toLocaleLowerCase().trim()

export function matchesSearch(game: Game, needle: string): boolean {
  if (!needle) return true
  const haystack = [game.title, game.originalTitle ?? '', game.developer ?? '', ...game.altTitles]
  return haystack.some((text) => normalizeSearch(text).includes(needle))
}

export function filterGames(games: readonly Game[], filter: LibraryFilter): Game[] {
  const needle = normalizeSearch(filter.search ?? '')
  return games.filter((game) => {
    if (!filter.showRestricted && game.contentRating === 'restricted') return false
    if (filter.gameIds && !filter.gameIds.has(game.id)) return false
    if (filter.favoritesOnly && !game.favorite) return false
    if (filter.playedOnly && game.lastPlayedAt === null) return false
    if (filter.genre && !game.genres.includes(filter.genre) && !game.tags.includes(filter.genre)) return false
    if (filter.language && !game.languages.includes(filter.language)) return false
    return matchesSearch(game, needle)
  })
}

/** Compares nullable strings; missing values always sort last. */
const compareNullable = (a: string | null, b: string | null, direction: 1 | -1): number => {
  if (a === b) return 0
  if (a === null || a === '') return 1
  if (b === null || b === '') return -1
  return a < b ? -direction : direction
}

export function sortGames(games: readonly Game[], key: SortKey): Game[] {
  const byTitle = (a: Game, b: Game): number => collator.compare(a.title, b.title)
  const compare: Record<SortKey, (a: Game, b: Game) => number> = {
    title: byTitle,
    releaseDate: (a, b) => compareNullable(a.releaseDate, b.releaseDate, -1) || byTitle(a, b),
    developer: (a, b) =>
      compareNullable(a.developer?.toLocaleLowerCase() ?? null, b.developer?.toLocaleLowerCase() ?? null, 1) ||
      byTitle(a, b),
    recentlyAdded: (a, b) => compareNullable(a.addedAt, b.addedAt, -1) || byTitle(a, b),
    recentlyPlayed: (a, b) => compareNullable(a.lastPlayedAt, b.lastPlayedAt, -1) || byTitle(a, b)
  }
  return [...games].sort(compare[key])
}

export const queryGames = (games: readonly Game[], filter: LibraryFilter, sort: SortKey): Game[] =>
  sortGames(filterGames(games, filter), sort)

export function recentlyPlayed(games: readonly Game[], limit: number): Game[] {
  return sortGames(
    games.filter((game) => game.lastPlayedAt !== null),
    'recentlyPlayed'
  ).slice(0, limit)
}

const MAX_GENRE_OPTIONS = 40

/**
 * Filter choices for the current list. VNDB gives each game many tags, so the genre list is
 * limited to the most common ones (shown alphabetically, with how many games have each).
 */
export function collectFacets(games: readonly Game[]): { genres: string[]; genreCounts: Record<string, number>; languages: string[] } {
  const counts = new Map<string, number>()
  const languages = new Set<string>()
  for (const game of games) {
    for (const name of new Set([...game.genres, ...game.tags])) counts.set(name, (counts.get(name) ?? 0) + 1)
    game.languages.forEach((language) => languages.add(language))
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0]))
    .slice(0, MAX_GENRE_OPTIONS)
    .map(([name]) => name)
    .sort(collator.compare)
  return {
    genres: top,
    genreCounts: Object.fromEntries(counts),
    languages: [...languages].sort(collator.compare)
  }
}

/** Collections with their member lists reduced to the games that are currently visible. */
export function visibleCollections(collections: readonly Collection[], visible: readonly Game[]): Collection[] {
  const ids = new Set(visible.map((game) => game.id))
  return collections.map((collection) => ({
    ...collection,
    gameIds: collection.gameIds.filter((id) => ids.has(id))
  }))
}
