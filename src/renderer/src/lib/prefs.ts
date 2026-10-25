import type { PreferencesRepository } from '@shared/contracts'
import type { AccentId, Preferences, SortKey, ThemeId } from '@shared/types'

export const THEMES: Record<ThemeId, { label: string }> = {
  midnight: { label: 'Midnight (Console Blue)' },
  obsidian: { label: 'Obsidian (OLED Black)' },
  twilight: { label: 'Twilight (Warm Dusk)' },
  daylight: { label: 'Daylight (Warm Paper)' }
}

export const ACCENTS: Record<AccentId, { label: string; value: string }> = {
  periwinkle: { label: 'Periwinkle', value: '#9db4ff' },
  sakura: { label: 'Sakura', value: '#f2a0bd' },
  jade: { label: 'Jade', value: '#6fd6b4' },
  lantern: { label: 'Lantern', value: '#f0b765' },
  coral: { label: 'Coral', value: '#ff8f7a' }
}

export const DEFAULT_PREFS: Preferences = {
  theme: 'midnight',
  accent: 'periwinkle',
  navLayout: 'top',
  titleFont: 'console',
  railCollapsed: false,
  motion: 'full',
  soundEnabled: true,
  soundVolume: 0.5,
  adultConfirmed: false,
  backdropStrength: 0.9,
  defaultSort: 'title',
  libraryLayout: 'grid',
  metadataEnabled: true,
  showRestricted: false,
  minimizeOnLaunch: false,
  restoreOnExit: true,
  gamepadEnabled: true,
  gamepadConfirm: 'south'
}

const SORT_KEYS: readonly SortKey[] = ['title', 'releaseDate', 'developer', 'recentlyAdded', 'recentlyPlayed']

/** Validates untrusted stored data and falls back to defaults field by field. */
export function sanitizePrefs(raw: unknown): Preferences {
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const strength = input.backdropStrength
  return {
    theme: typeof input.theme === 'string' && input.theme in THEMES ? (input.theme as ThemeId) : DEFAULT_PREFS.theme,
    accent: typeof input.accent === 'string' && input.accent in ACCENTS ? (input.accent as AccentId) : DEFAULT_PREFS.accent,
    navLayout: input.navLayout === 'rail' ? 'rail' : 'top',
    titleFont: input.titleFont === 'literary' ? 'literary' : 'console',
    railCollapsed: typeof input.railCollapsed === 'boolean' ? input.railCollapsed : DEFAULT_PREFS.railCollapsed,
    // Older versions stored a plain "reduce motion" switch.
    motion:
      input.motion === 'full' || input.motion === 'system' || input.motion === 'reduced'
        ? input.motion
        : input.reduceMotion === true
          ? 'reduced'
          : DEFAULT_PREFS.motion,
    soundEnabled: typeof input.soundEnabled === 'boolean' ? input.soundEnabled : DEFAULT_PREFS.soundEnabled,
    soundVolume:
      typeof input.soundVolume === 'number' && Number.isFinite(input.soundVolume)
        ? Math.min(1, Math.max(0, input.soundVolume))
        : DEFAULT_PREFS.soundVolume,
    adultConfirmed: input.adultConfirmed === true,
    backdropStrength:
      typeof strength === 'number' && Number.isFinite(strength)
        ? Math.min(1, Math.max(0.4, strength))
        : DEFAULT_PREFS.backdropStrength,
    defaultSort: SORT_KEYS.includes(input.defaultSort as SortKey) ? (input.defaultSort as SortKey) : DEFAULT_PREFS.defaultSort,
    libraryLayout: input.libraryLayout === 'shelf' ? 'shelf' : 'grid',
    metadataEnabled: typeof input.metadataEnabled === 'boolean' ? input.metadataEnabled : DEFAULT_PREFS.metadataEnabled,
    // Adults-only entries can only ever be shown after the age confirmation.
    showRestricted: input.adultConfirmed === true && input.showRestricted === true,
    minimizeOnLaunch: typeof input.minimizeOnLaunch === 'boolean' ? input.minimizeOnLaunch : DEFAULT_PREFS.minimizeOnLaunch,
    restoreOnExit: typeof input.restoreOnExit === 'boolean' ? input.restoreOnExit : DEFAULT_PREFS.restoreOnExit,
    gamepadEnabled: typeof input.gamepadEnabled === 'boolean' ? input.gamepadEnabled : DEFAULT_PREFS.gamepadEnabled,
    gamepadConfirm: input.gamepadConfirm === 'east' ? 'east' : 'south'
  }
}

const STORAGE_KEY = 'vnstation.preferences.v1'

/**
 * Browser-only storage, used in the plain-browser design preview. In Electron,
 * preferences live in the library database and `readLegacyPrefs` lets the app
 * carry over anything saved by Milestone 1 the first time it runs.
 */
export class LocalStoragePreferences implements PreferencesRepository {
  async load(): Promise<unknown | null> {
    return readLegacyPrefs()
  }

  async save(prefs: Preferences): Promise<void> {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
    } catch {
      // Storage can be unavailable; preferences then last for the session only.
    }
  }
}

export function readLegacyPrefs(): unknown | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored ? (JSON.parse(stored) as unknown) : null
  } catch {
    return null
  }
}
