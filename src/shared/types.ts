/**
 * Domain model shared by the main process (persistence, launching) and the
 * renderer (presentation).
 *
 * Provider-supplied metadata and user edits are stored in separate objects, so a
 * metadata refresh can never overwrite something the user customised. The UI
 * works with the merged `Game` view model produced by `resolveEntry`.
 */

export type ContentRating = 'unrated' | 'all-ages' | 'teen' | 'mature' | 'restricted'

export type MetadataProviderId = 'vndb' | 'sample'

export interface MetadataSource {
  provider: MetadataProviderId
  externalId: string
}

/** Procedural fallback artwork description (used when no real artwork exists). */
export type ArtMotif = 'moon' | 'skyline' | 'waves' | 'forest' | 'aurora' | 'petals'
export interface ArtStyle {
  motif: ArtMotif
  hue: number
}

export interface LaunchConfig {
  executablePath: string
  workingDirectory: string
  arguments: string
}

/** Everything a metadata provider returned. Never edited by the user. */
export interface ProviderMetadata {
  source: MetadataSource | null
  title: string | null
  originalTitle: string | null
  altTitles: string[]
  synopsis: string | null
  developer: string | null
  /** ISO date; partial dates ("2019", "2019-11") are valid. */
  releaseDate: string | null
  originalLanguage: string | null
  languages: string[]
  genres: string[]
  tags: string[]
  contentRating: ContentRating
  coverUrl: string | null
  backgroundUrl: string | null
  /** When this metadata was last downloaded (ISO), or null if it never came from a provider. */
  fetchedAt: string | null
}

/** User overrides. A `null` field means "use the provider value". */
export interface UserFields {
  title: string | null
  synopsis: string | null
  developer: string | null
  releaseDate: string | null
  coverUrl: string | null
  backgroundUrl: string | null
  notes: string
}

/** The stored record for one library entry. */
export interface GameEntry {
  id: string
  launch: LaunchConfig
  provider: ProviderMetadata
  user: UserFields
  art: ArtStyle | null
  favorite: boolean
  addedAt: string
  lastPlayedAt: string | null
  playtimeMinutes: number
  /** True for development preview data. Never set for real library entries. */
  isSample: boolean
}

/** Merged, display-ready view of an entry. */
export interface Game {
  id: string
  title: string
  originalTitle: string | null
  altTitles: string[]
  synopsis: string | null
  developer: string | null
  releaseDate: string | null
  originalLanguage: string | null
  languages: string[]
  genres: string[]
  tags: string[]
  contentRating: ContentRating
  coverUrl: string
  coverFallbackUrl: string
  backgroundUrl: string
  backgroundFallbackUrl: string
  favorite: boolean
  notes: string
  launch: LaunchConfig
  source: MetadataSource | null
  metadataFetchedAt: string | null
  hasCustomCover: boolean
  hasCustomBackground: boolean
  isSample: boolean
  addedAt: string
  lastPlayedAt: string | null
  playtimeMinutes: number
}

export interface Collection {
  id: string
  name: string
  description: string | null
  gameIds: string[]
}

export type SortKey = 'title' | 'releaseDate' | 'developer' | 'recentlyAdded' | 'recentlyPlayed'

export type AccentId = 'periwinkle' | 'sakura' | 'jade' | 'lantern' | 'coral'
export type ThemeId = 'midnight' | 'obsidian' | 'twilight' | 'daylight'
export type NavLayout = 'top' | 'rail'
export type TitleFont = 'console' | 'literary'
/** "system" follows the operating system's reduce-motion setting. */
export type MotionMode = 'full' | 'system' | 'reduced'
/** "south" = A / Cross confirms; "east" = B / Circle confirms. */
export type GamepadConfirm = 'south' | 'east'

export interface Preferences {
  theme: ThemeId
  accent: AccentId
  /** 'top' is the PlayStation-style category bar; 'rail' is the collapsible side rail. */
  navLayout: NavLayout
  titleFont: TitleFont
  railCollapsed: boolean
  motion: MotionMode
  /** Synthesised interface sounds (move, select, back). */
  soundEnabled: boolean
  /** 0 – 1. */
  soundVolume: number
  /** The user confirmed they are 18 or older. Required before adults-only entries can be shown. */
  adultConfirmed: boolean
  /** 0.4 – 1. Opacity of full-screen background artwork. */
  backdropStrength: number
  defaultSort: SortKey
  libraryLayout: 'grid' | 'shelf'
  /** Look up details and artwork online. Turn off to keep VNStation fully offline. */
  metadataEnabled: boolean
  /** Entries rated for adults stay hidden unless this is switched on. */
  showRestricted: boolean
  /** Minimize the VNStation window once a launched game has started. */
  minimizeOnLaunch: boolean
  /** Restore and focus VNStation when a launched game exits. */
  restoreOnExit: boolean
  /** Navigate the library with a connected controller (Xbox, PlayStation, Switch, XInput). */
  gamepadEnabled: boolean
  /** Which face button confirms selections ("south" = A/Cross, "east" = B/Circle). */
  gamepadConfirm: GamepadConfirm
}
