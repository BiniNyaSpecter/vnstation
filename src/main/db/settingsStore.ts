import type { PreferencesRepository } from '@shared/contracts'
import type { Preferences } from '@shared/types'
import { UserFacingError } from '../errors'
import type { Database } from './sqlite'

const KEY = 'preferences'
const MAX_BYTES = 10_000

export class SettingsStore implements PreferencesRepository {
  constructor(private readonly db: Database) {}

  async load(): Promise<unknown | null> {
    const row = this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', KEY)
    if (!row) return null
    try {
      return JSON.parse(row.value) as unknown
    } catch {
      return null
    }
  }

  async save(prefs: Preferences): Promise<void> {
    if (typeof prefs !== 'object' || prefs === null || Array.isArray(prefs)) {
      throw new UserFacingError('Invalid settings.')
    }
    const json = JSON.stringify(prefs)
    if (json.length > MAX_BYTES) throw new UserFacingError('Settings are too large.')
    this.db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      KEY,
      json
    )
  }
}
