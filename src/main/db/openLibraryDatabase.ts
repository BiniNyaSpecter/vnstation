import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { currentVersion, MIGRATIONS, migrate, type Migration } from './migrations'
import { Database } from './sqlite'

const quote = (text: string): string => `'${text.replace(/'/g, "''")}'`

/**
 * Opens (creating if needed) the library database and brings it up to date.
 * Before upgrading an existing database it writes a consistent backup next to it
 * (`library.db.backup-v<old version>`), so a bad migration never costs the library.
 */
export function openLibraryDatabase(file: string, migrations: readonly Migration[] = MIGRATIONS): Database {
  const inMemory = file === ':memory:'
  if (!inMemory) mkdirSync(dirname(file), { recursive: true })
  const hadData = !inMemory && existsSync(file) && statSync(file).size > 0

  const db = new Database(file)
  try {
    if (!inMemory) db.exec('PRAGMA journal_mode = WAL')

    const from = currentVersion(db)
    if (hadData && from > 0 && from < migrations.length) {
      const backup = `${file}.backup-v${from}`
      rmSync(backup, { force: true })
      db.exec(`VACUUM INTO ${quote(backup)}`)
    }
    migrate(db, migrations)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}
