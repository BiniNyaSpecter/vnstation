import type { Database } from './sqlite'

/** Stores parsed provider responses in the library database so repeat lookups send no requests. */
export class MetadataCache {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date()
  ) {}

  get<T>(key: string, maxAgeMs: number): T | null {
    const row = this.db.get<{ response: string; fetched_at: string }>('SELECT response, fetched_at FROM metadata_cache WHERE cache_key = ?', key)
    if (!row) return null
    if (this.now().getTime() - Date.parse(row.fetched_at) > maxAgeMs) return null
    try {
      return JSON.parse(row.response) as T
    } catch {
      return null
    }
  }

  set(key: string, value: unknown): void {
    this.db.run(
      'INSERT INTO metadata_cache (cache_key, response, fetched_at) VALUES (?, ?, ?) ON CONFLICT (cache_key) DO UPDATE SET response = excluded.response, fetched_at = excluded.fetched_at',
      key,
      JSON.stringify(value),
      this.now().toISOString()
    )
  }

  /** Drops entries older than `maxAgeMs`. Called at start-up so the table cannot grow forever. */
  prune(maxAgeMs: number): void {
    this.db.run('DELETE FROM metadata_cache WHERE fetched_at < ?', new Date(this.now().getTime() - maxAgeMs).toISOString())
  }
}
