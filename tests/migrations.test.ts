import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { currentVersion, LATEST_VERSION, MIGRATIONS, migrate } from '../src/main/db/migrations'
import { openLibraryDatabase } from '../src/main/db/openLibraryDatabase'
import { Database } from '../src/main/db/sqlite'

const tableNames = (db: Database): string[] =>
  db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").map((r) => r.name)

describe('migrations', () => {
  it('builds the full schema on a fresh database', () => {
    const db = openLibraryDatabase(':memory:')
    expect(currentVersion(db)).toBe(LATEST_VERSION)
    for (const table of ['games', 'game_provider_metadata', 'game_user_fields', 'game_alt_titles', 'game_languages', 'tags', 'game_tags', 'collections', 'collection_games', 'settings', 'metadata_cache', 'play_sessions']) {
      expect(tableNames(db)).toContain(table)
    }
    db.close()
  })

  it('is a no-op when already up to date', () => {
    const db = openLibraryDatabase(':memory:')
    expect(migrate(db)).toEqual({ from: LATEST_VERSION, to: LATEST_VERSION })
    db.close()
  })

  it('refuses a database created by a newer app', () => {
    const db = new Database(':memory:')
    db.exec('PRAGMA user_version = 99')
    expect(() => migrate(db)).toThrow('newer version')
    db.close()
  })

  it('rolls back a failing migration completely', () => {
    const db = new Database(':memory:')
    const migrations = [
      MIGRATIONS[0],
      { version: 2, name: 'broken', sql: 'CREATE TABLE half_done (x INTEGER); SELECT * FROM table_that_does_not_exist;' }
    ]
    expect(() => migrate(db, migrations)).toThrow()
    expect(currentVersion(db)).toBe(1)
    expect(tableNames(db)).not.toContain('half_done')
    db.close()
  })

  it('rejects gaps in numbering', () => {
    const db = new Database(':memory:')
    expect(() => migrate(db, [{ version: 2, name: 'oops', sql: 'SELECT 1' }])).toThrow('without gaps')
    db.close()
  })

  it('enforces foreign keys', () => {
    const db = openLibraryDatabase(':memory:')
    expect(() => db.run("INSERT INTO game_user_fields (game_id) VALUES ('missing')")).toThrow()
    db.close()
  })

  it('nested transactions roll back only the inner work', () => {
    const db = openLibraryDatabase(':memory:')
    db.transaction(() => {
      db.run("INSERT INTO settings (key, value) VALUES ('a', '1')")
      expect(() => db.transaction(() => {
        db.run("INSERT INTO settings (key, value) VALUES ('b', '2')")
        throw new Error('inner failure')
      })).toThrow('inner failure')
    })
    expect(db.all('SELECT key FROM settings').map((r) => r.key)).toEqual(['a'])
    db.close()
  })
})

describe('upgrading an existing library file', () => {
  let dir: string
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'vnstation-db-')) })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  it('writes a backup of the old version before migrating', () => {
    const file = join(dir, 'library.db')
    const first = openLibraryDatabase(file)
    first.run("INSERT INTO settings (key, value) VALUES ('keep', 'me')")
    first.close()

    const next = { version: LATEST_VERSION + 1, name: 'add-note', sql: 'ALTER TABLE settings ADD COLUMN note TEXT' }
    const upgraded = openLibraryDatabase(file, [...MIGRATIONS, next])
    expect(currentVersion(upgraded)).toBe(LATEST_VERSION + 1)
    upgraded.close()

    const backupFile = `${file}.backup-v${LATEST_VERSION}`
    expect(existsSync(backupFile)).toBe(true)
    const backup = new Database(backupFile)
    expect(currentVersion(backup)).toBe(LATEST_VERSION)
    expect(backup.get<{ value: string }>("SELECT value FROM settings WHERE key = 'keep'")?.value).toBe('me')
    backup.close()
  })

  it('does not back up when nothing needs upgrading', () => {
    const file = join(dir, 'library.db')
    openLibraryDatabase(file).close()
    openLibraryDatabase(file).close()
    expect(existsSync(`${file}.backup-v${LATEST_VERSION}`)).toBe(false)
  })
})
