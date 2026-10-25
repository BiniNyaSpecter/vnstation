import { createRequire } from 'node:module'
import type { DatabaseSync, StatementSync } from 'node:sqlite'

/**
 * Thin wrapper over Node's built-in SQLite (`node:sqlite`, available in Electron 44's
 * Node 24). Built in means no native module to compile or rebuild per Electron
 * version. It is loaded through createRequire so bundlers and test runners never
 * try to resolve the `node:sqlite` specifier. This is the only file that touches the
 * driver, so switching to another one later is a one-file change.
 */
const nodeRequire = createRequire(`${process.cwd()}/`)

/** Loaded on first use, so a missing driver becomes a readable startup error instead of a crash on import. */
let driver: typeof import('node:sqlite') | null = null
function loadDriver(): typeof import('node:sqlite') {
  if (driver) return driver
  try {
    driver = nodeRequire('node:sqlite') as typeof import('node:sqlite')
    return driver
  } catch {
    throw new Error('This build of Electron does not include built-in SQLite support (node:sqlite). Use Electron 44 or newer.')
  }
}

export type SqlValue = string | number | bigint | null
export type Row = Record<string, SqlValue>

export class Database {
  private readonly db: DatabaseSync
  private readonly statements = new Map<string, StatementSync>()
  private depth = 0

  constructor(path: string) {
    this.db = new (loadDriver().DatabaseSync)(path)
    this.db.exec('PRAGMA foreign_keys = ON')
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  run(sql: string, ...params: SqlValue[]): { changes: number; lastInsertRowid: number } {
    const result = this.statement(sql).run(...params)
    return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) }
  }

  get<T extends Row = Row>(sql: string, ...params: SqlValue[]): T | undefined {
    return this.statement(sql).get(...params) as unknown as T | undefined
  }

  all<T extends Row = Row>(sql: string, ...params: SqlValue[]): T[] {
    return this.statement(sql).all(...params) as unknown as T[]
  }

  /** Runs `fn` atomically. Nested calls use savepoints, so inner failures roll back cleanly. */
  transaction<T>(fn: () => T): T {
    const name = `sp_${this.depth}`
    this.exec(this.depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${name}`)
    this.depth++
    try {
      const result = fn()
      this.depth--
      this.exec(this.depth === 0 ? 'COMMIT' : `RELEASE ${name}`)
      return result
    } catch (error) {
      this.depth--
      this.exec(this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`)
      throw error
    }
  }

  close(): void {
    this.statements.clear()
    this.db.close()
  }

  private statement(sql: string): StatementSync {
    let statement = this.statements.get(sql)
    if (!statement) {
      statement = this.db.prepare(sql)
      this.statements.set(sql, statement)
    }
    return statement
  }
}
