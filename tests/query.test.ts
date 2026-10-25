import { describe, expect, it } from 'vitest'
import type { Collection, Game } from '@shared/types'
import { collectFacets, filterGames, queryGames, recentlyPlayed, sortGames, visibleCollections } from '@renderer/lib/query'

function game(overrides: Partial<Game> & { id: string; title: string }): Game {
  return {
    originalTitle: null,
    altTitles: [],
    synopsis: null,
    developer: null,
    releaseDate: null,
    originalLanguage: null,
    languages: [],
    genres: [],
    tags: [],
    contentRating: 'all-ages',
    coverUrl: '',
    coverFallbackUrl: '',
    backgroundUrl: '',
    backgroundFallbackUrl: '',
    favorite: false,
    notes: '',
    launch: { executablePath: '', workingDirectory: '', arguments: '' },
    source: null,
    metadataFetchedAt: null,
    hasCustomCover: false,
    hasCustomBackground: false,
    isSample: false,
    addedAt: '2026-01-01T00:00:00.000Z',
    lastPlayedAt: null,
    playtimeMinutes: 0,
    ...overrides
  }
}

const library: Game[] = [
  game({ id: 'a', title: 'Clockwork Tides', developer: 'Northgate Works', releaseDate: '2023-09-29', genres: ['Mystery'], languages: ['English'], lastPlayedAt: '2026-10-01T10:00:00.000Z', addedAt: '2026-02-01T00:00:00.000Z' }),
  game({ id: 'b', title: 'Lanterns of Hollowmere', originalTitle: 'ホロウメアの灯', developer: 'Paper Lantern Studio', releaseDate: '2022-10-28', genres: ['Mystery', 'Supernatural'], tags: ['Ghosts'], languages: ['Japanese', 'English'], favorite: true, lastPlayedAt: '2026-10-17T10:00:00.000Z', addedAt: '2026-03-01T00:00:00.000Z' }),
  game({ id: 'c', title: 'Nine Windows', releaseDate: null, genres: ['Thriller'], languages: ['English'], addedAt: '2026-04-01T00:00:00.000Z' }),
  game({ id: 'd', title: 'Velvet Static', contentRating: 'restricted', developer: 'Sample Studio', releaseDate: '2020-01-10' }),
  game({ id: 'e', title: 'Episode 10', releaseDate: '2021-01-01' }),
  game({ id: 'f', title: 'Episode 2', releaseDate: '2021-06-01' })
]

const ids = (games: Game[]): string[] => games.map((g) => g.id)

describe('filterGames', () => {
  it('hides restricted entries unless asked', () => {
    expect(ids(filterGames(library, { showRestricted: false }))).not.toContain('d')
    expect(ids(filterGames(library, { showRestricted: true }))).toContain('d')
  })

  it('searches title, original title and developer, ignoring case', () => {
    expect(ids(filterGames(library, { showRestricted: false, search: 'CLOCKWORK' }))).toEqual(['a'])
    expect(ids(filterGames(library, { showRestricted: false, search: 'ホロウメア' }))).toEqual(['b'])
    expect(ids(filterGames(library, { showRestricted: false, search: 'paper lantern' }))).toEqual(['b'])
  })

  it('normalises full-width characters when searching', () => {
    expect(ids(filterGames(library, { showRestricted: false, search: 'ＮＩＮＥ' }))).toEqual(['c'])
  })

  it('filters by genre or tag, language and favorites', () => {
    expect(ids(filterGames(library, { showRestricted: false, genre: 'Mystery' }))).toEqual(['a', 'b'])
    expect(ids(filterGames(library, { showRestricted: false, genre: 'Ghosts' }))).toEqual(['b'])
    expect(ids(filterGames(library, { showRestricted: false, language: 'Japanese' }))).toEqual(['b'])
    expect(ids(filterGames(library, { showRestricted: false, favoritesOnly: true }))).toEqual(['b'])
  })

  it('restricts to a set of ids and to played games', () => {
    expect(ids(filterGames(library, { showRestricted: false, gameIds: new Set(['c', 'a']) }))).toEqual(['a', 'c'])
    expect(ids(filterGames(library, { showRestricted: false, playedOnly: true }))).toEqual(['a', 'b'])
  })
})

describe('sortGames', () => {
  it('sorts titles naturally (Episode 2 before Episode 10)', () => {
    const sorted = ids(sortGames(library, 'title'))
    expect(sorted.indexOf('f')).toBeLessThan(sorted.indexOf('e'))
  })

  it('puts newest releases first and unknown dates last', () => {
    const sorted = ids(sortGames(library, 'releaseDate'))
    expect(sorted[0]).toBe('a')
    expect(sorted[sorted.length - 1]).toBe('c')
  })

  it('sorts by most recently played, never-played last', () => {
    const sorted = ids(sortGames(library, 'recentlyPlayed'))
    expect(sorted.slice(0, 2)).toEqual(['b', 'a'])
  })

  it('sorts by recently added and by developer (missing last)', () => {
    expect(ids(sortGames(library, 'recentlyAdded'))[0]).toBe('c')
    const byDeveloper = ids(sortGames(library, 'developer'))
    expect(byDeveloper[0]).toBe('a')
    // Games without a developer come last, ordered by title (natural order: Episode 2 before Episode 10).
    expect(byDeveloper.slice(-3)).toEqual(['f', 'e', 'c'])
  })

  it('does not mutate its input', () => {
    const before = ids(library)
    sortGames(library, 'title')
    expect(ids(library)).toEqual(before)
  })
})

describe('library helpers', () => {
  it('combines filtering and sorting', () => {
    expect(ids(queryGames(library, { showRestricted: false, genre: 'Mystery' }, 'title'))).toEqual(['a', 'b'])
  })

  it('lists recently played games, newest first, up to a limit', () => {
    expect(ids(recentlyPlayed(library, 1))).toEqual(['b'])
  })

  it('collects facets with counts', () => {
    const facets = collectFacets(library)
    expect(facets.genres).toContain('Supernatural')
    expect(facets.genres).toContain('Ghosts') // tags are listed too
    expect(facets.genreCounts.Mystery).toBe(2)
    expect(facets.languages).toEqual(['English', 'Japanese'])
  })

  it('limits the genre list to the most common entries, alphabetically', () => {
    const many = Array.from({ length: 80 }, (_, i) =>
      game({ id: `g${i}`, title: `Game ${i}`, tags: [`Tag ${String(i).padStart(2, '0')}`, 'Common'] })
    )
    const facets = collectFacets(many)
    expect(facets.genres).toHaveLength(40)
    expect(facets.genres).toContain('Common')
    expect([...facets.genres]).toEqual([...facets.genres].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })))
  })

  it('reduces collections to visible games', () => {
    const collections: Collection[] = [{ id: 'x', name: 'X', description: null, gameIds: ['a', 'd'] }]
    const visible = filterGames(library, { showRestricted: false })
    expect(visibleCollections(collections, visible)[0].gameIds).toEqual(['a'])
  })
})
