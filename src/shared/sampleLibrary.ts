import type { LibrarySnapshot } from './contracts'
import type { ArtMotif, Collection, ContentRating, GameEntry } from './types'

/**
 * DEVELOPMENT PREVIEW DATA. Every title, studio, synopsis and date below is
 * invented for UI development; none of it came from a metadata provider.
 * Entries are flagged `isSample: true` and the UI labels them accordingly.
 */

interface SampleSpec {
  id: string
  title: string
  original?: string
  synopsis: string
  developer: string
  release: string
  originalLanguage: string
  languages: string[]
  genres: string[]
  tags: string[]
  rating: ContentRating
  motif: ArtMotif
  hue: number
  playtimeMinutes: number
  playedDaysAgo: number | null
  addedDaysAgo: number
  favorite?: boolean
}

const isoDaysAgo = (days: number, hour = 21): string => {
  const date = new Date()
  date.setDate(date.getDate() - days)
  date.setHours(hour, 12, 0, 0)
  return date.toISOString()
}

const SPECS: SampleSpec[] = [
  {
    id: 'sample-lanterns-of-hollowmere',
    title: 'Lanterns of Hollowmere',
    original: 'ホロウメアの灯',
    synopsis:
      'Every autumn the lanterns of Hollowmere are lit for the drowned. This year one refuses to burn. A tide-warden’s apprentice follows the dark lantern from the harbour to the flooded chapel and learns who the village has really been lighting them for.',
    developer: 'Paper Lantern Studio',
    release: '2022-10-28',
    originalLanguage: 'Japanese',
    languages: ['Japanese', 'English', 'Korean'],
    genres: ['Mystery', 'Supernatural'],
    tags: ['Atmospheric', 'Multiple endings', 'Ghosts'],
    rating: 'teen',
    motif: 'moon',
    hue: 262,
    playtimeMinutes: 926,
    playedDaysAgo: 2,
    addedDaysAgo: 140,
    favorite: true
  },
  {
    id: 'sample-last-train-to-meridian',
    title: 'The Last Train to Meridian',
    synopsis:
      'A night train crosses a city that no longer appears on any map. Seven passengers, one conductor, and a timetable that rewrites itself at every station.',
    developer: 'Northgate Works',
    release: '2021-06-17',
    originalLanguage: 'Japanese',
    languages: ['Japanese', 'English'],
    genres: ['Science fiction', 'Drama'],
    tags: ['Time loop', 'Ensemble cast'],
    rating: 'teen',
    motif: 'skyline',
    hue: 206,
    playtimeMinutes: 1868,
    playedDaysAgo: 6,
    addedDaysAgo: 310,
    favorite: true
  },
  {
    id: 'sample-salt-and-ceremony',
    title: 'Salt & Ceremony',
    synopsis:
      'A rain-soaked inn, a chef who has forgotten how to taste, and a guest who stays one night too long. Cook, listen, and decide what the house will remember.',
    developer: 'Studio Tidewater',
    release: '2023-04-14',
    originalLanguage: 'English',
    languages: ['English', 'Japanese', 'Spanish'],
    genres: ['Slice of life', 'Romance'],
    tags: ['Cooking', 'Seaside town'],
    rating: 'all-ages',
    motif: 'waves',
    hue: 186,
    playtimeMinutes: 492,
    playedDaysAgo: 1,
    addedDaysAgo: 95
  },
  {
    id: 'sample-quiet-hours-at-the-observatory',
    title: 'Quiet Hours at the Observatory',
    synopsis:
      'Mina keeps the night shift at a mountain observatory. When a faint signal begins to repeat every eleven minutes, she starts answering it.',
    developer: 'Blue Hour Collective',
    release: '2024-02-02',
    originalLanguage: 'English',
    languages: ['English'],
    genres: ['Science fiction', 'Slice of life'],
    tags: ['Stargazing', 'Short story'],
    rating: 'all-ages',
    motif: 'aurora',
    hue: 158,
    playtimeMinutes: 220,
    playedDaysAgo: 12,
    addedDaysAgo: 60,
    favorite: true
  },
  {
    id: 'sample-ashfall-letters',
    title: 'Ashfall Letters',
    synopsis:
      'Forty-one letters, none of them delivered. A postal clerk in a mountain village sorts the dead letters of a long winter and begins to suspect they were never meant for the living.',
    developer: 'Marrow & Moth',
    release: '2019-11-08',
    originalLanguage: 'Japanese',
    languages: ['Japanese', 'English'],
    genres: ['Historical', 'Mystery'],
    tags: ['Epistolary', 'Post-war'],
    rating: 'mature',
    motif: 'forest',
    hue: 28,
    playtimeMinutes: 720,
    playedDaysAgo: 20,
    addedDaysAgo: 400
  },
  {
    id: 'sample-starlit-detour',
    title: 'Starlit Detour',
    synopsis:
      'A broken-down van, two rivals pretending to be friends, and a three-day drive to a wedding neither of them wants to attend.',
    developer: 'Hanami Notebook',
    release: '2020-08-21',
    originalLanguage: 'English',
    languages: ['English', 'Japanese'],
    genres: ['Comedy', 'Romance'],
    tags: ['Road trip', 'Heartwarming'],
    rating: 'all-ages',
    motif: 'petals',
    hue: 330,
    playtimeMinutes: 0,
    playedDaysAgo: null,
    addedDaysAgo: 3
  },
  {
    id: 'sample-orchard-of-paper-moons',
    title: 'Orchard of Paper Moons',
    original: '紙月の果樹園',
    synopsis:
      'Each harvest, the orchard keepers fold a paper moon for every promise the village has broken. The trees have started to count.',
    developer: 'Kōhaku Circle',
    release: '2022-03-03',
    originalLanguage: 'Japanese',
    languages: ['Japanese', 'English'],
    genres: ['Fantasy', 'Drama'],
    tags: ['Folklore', 'Choices matter'],
    rating: 'teen',
    motif: 'moon',
    hue: 38,
    playtimeMinutes: 1105,
    playedDaysAgo: 35,
    addedDaysAgo: 220
  },
  {
    id: 'sample-clockwork-tides',
    title: 'Clockwork Tides',
    synopsis:
      'In a harbour city run by tide-engines, an inspector discovers that someone has been quietly slowing the sea.',
    developer: 'Northgate Works',
    release: '2023-09-29',
    originalLanguage: 'English',
    languages: ['English'],
    genres: ['Science fiction', 'Mystery'],
    tags: ['Steampunk', 'Detective'],
    rating: 'teen',
    motif: 'waves',
    hue: 228,
    playtimeMinutes: 0,
    playedDaysAgo: null,
    addedDaysAgo: 18
  },
  {
    id: 'sample-nine-windows',
    title: 'Nine Windows',
    synopsis:
      'Nine apartments face the same courtyard. Each night one light stays on after midnight, and each night it is a different one.',
    developer: 'Marrow & Moth',
    release: '2021-10-31',
    originalLanguage: 'Japanese',
    languages: ['Japanese', 'English'],
    genres: ['Thriller', 'Psychological'],
    tags: ['Dark atmosphere', 'Unreliable narrator'],
    rating: 'mature',
    motif: 'skyline',
    hue: 300,
    playtimeMinutes: 380,
    playedDaysAgo: 58,
    addedDaysAgo: 260
  },
  {
    id: 'sample-the-cartographers-apprentice',
    title: 'The Cartographer’s Apprentice',
    synopsis:
      'The old maps are wrong in small, deliberate ways. An apprentice sets out to redraw the valley and finds out who has been editing it.',
    developer: 'Lighthouse Row',
    release: '2018-05-19',
    originalLanguage: 'English',
    languages: ['English'],
    genres: ['Fantasy', 'Adventure'],
    tags: ['Exploration', 'Worldbuilding'],
    rating: 'all-ages',
    motif: 'forest',
    hue: 142,
    playtimeMinutes: 640,
    playedDaysAgo: 90,
    addedDaysAgo: 500
  },
  {
    id: 'sample-midnight-at-kitsune-bay',
    title: 'Midnight at Kitsune Bay',
    original: '狐ヶ浦の真夜中',
    synopsis:
      'The last ferry leaves at midnight, and so does something else. A summer job at a seaside shrine turns into a long conversation with the tide.',
    developer: 'Studio Tidewater',
    release: '2024-07-12',
    originalLanguage: 'Japanese',
    languages: ['Japanese', 'English'],
    genres: ['Romance', 'Supernatural'],
    tags: ['Folklore', 'Seaside town'],
    rating: 'teen',
    motif: 'aurora',
    hue: 350,
    playtimeMinutes: 95,
    playedDaysAgo: 4,
    addedDaysAgo: 30
  },
  {
    id: 'sample-hanabi-season',
    title: 'Hanabi Season',
    synopsis:
      'Four friends, one summer festival, and a promise to watch the fireworks together that none of them has kept for years.',
    developer: 'Hanami Notebook',
    release: '2021-07-23',
    originalLanguage: 'Japanese',
    languages: ['Japanese', 'English'],
    genres: ['Slice of life', 'Drama'],
    tags: ['Festival', 'Friendship'],
    rating: 'all-ages',
    motif: 'petals',
    hue: 196,
    playtimeMinutes: 310,
    playedDaysAgo: 48,
    addedDaysAgo: 180
  },
  {
    id: 'sample-velvet-static',
    title: 'Velvet Static',
    synopsis: 'Restricted-rating sample entry, used only to test the content filter.',
    developer: 'Sample Studio',
    release: '2020-01-10',
    originalLanguage: 'English',
    languages: ['English'],
    genres: ['Drama'],
    tags: ['Sample'],
    rating: 'restricted',
    motif: 'moon',
    hue: 280,
    playtimeMinutes: 0,
    playedDaysAgo: null,
    addedDaysAgo: 10
  }
]

function toEntry(spec: SampleSpec): GameEntry {
  return {
    id: spec.id,
    launch: {
      executablePath: `D:\\VisualNovels\\${spec.title}\\game.exe`,
      workingDirectory: `D:\\VisualNovels\\${spec.title}`,
      arguments: ''
    },
    provider: {
      source: { provider: 'sample', externalId: spec.id },
      title: spec.title,
      originalTitle: spec.original ?? null,
      altTitles: [],
      synopsis: spec.synopsis,
      developer: spec.developer,
      releaseDate: spec.release,
      originalLanguage: spec.originalLanguage,
      languages: spec.languages,
      genres: spec.genres,
      tags: spec.tags,
      contentRating: spec.rating,
      coverUrl: null,
      backgroundUrl: null,
      fetchedAt: null
    },
    user: { title: null, synopsis: null, developer: null, releaseDate: null, coverUrl: null, backgroundUrl: null, notes: '' },
    art: { motif: spec.motif, hue: spec.hue },
    favorite: spec.favorite ?? false,
    addedAt: isoDaysAgo(spec.addedDaysAgo),
    lastPlayedAt: spec.playedDaysAgo === null ? null : isoDaysAgo(spec.playedDaysAgo),
    playtimeMinutes: spec.playtimeMinutes,
    isSample: true
  }
}

const COLLECTIONS: Collection[] = [
  {
    id: 'sample-collection-mystery',
    name: 'Mystery and thrillers',
    description: 'Cold cases, dead letters and lights that should not be on.',
    gameIds: ['sample-lanterns-of-hollowmere', 'sample-ashfall-letters', 'sample-nine-windows', 'sample-clockwork-tides']
  },
  {
    id: 'sample-collection-cozy',
    name: 'Cozy evenings',
    description: 'Low stakes, warm light, good for the end of a long day.',
    gameIds: [
      'sample-salt-and-ceremony',
      'sample-starlit-detour',
      'sample-quiet-hours-at-the-observatory',
      'sample-hanabi-season',
      'sample-midnight-at-kitsune-bay'
    ]
  },
  {
    id: 'sample-collection-reading',
    name: 'Reading now',
    description: null,
    gameIds: ['sample-lanterns-of-hollowmere', 'sample-last-train-to-meridian', 'sample-salt-and-ceremony']
  }
]

export function createSampleSnapshot(): LibrarySnapshot {
  return { entries: SPECS.map(toEntry), collections: COLLECTIONS.map((c) => ({ ...c, gameIds: [...c.gameIds] })) }
}
