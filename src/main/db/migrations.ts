import type { Database } from './sqlite'

/**
 * Schema migrations. Rules:
 *  - Never edit a migration that has shipped; add a new one with the next version.
 *  - Each migration runs in a transaction together with the version bump, so a
 *    failure leaves the database exactly as it was.
 *  - The schema version lives in SQLite's `PRAGMA user_version`.
 */
export interface Migration {
  version: number
  name: string
  sql: string
}

const initialLibrary = `
CREATE TABLE games (
  id                TEXT PRIMARY KEY,
  executable_path   TEXT NOT NULL,
  working_directory TEXT NOT NULL,
  launch_arguments  TEXT NOT NULL DEFAULT '',
  favorite          INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  added_at          TEXT NOT NULL,
  last_played_at    TEXT,
  playtime_minutes  INTEGER NOT NULL DEFAULT 0 CHECK (playtime_minutes >= 0),
  is_sample         INTEGER NOT NULL DEFAULT 0 CHECK (is_sample IN (0, 1)),
  art_motif         TEXT,
  art_hue           INTEGER
);
CREATE INDEX idx_games_last_played ON games (last_played_at);

-- What a metadata provider said. Replaced wholesale on refresh; never edited by the user.
CREATE TABLE game_provider_metadata (
  game_id           TEXT PRIMARY KEY REFERENCES games (id) ON DELETE CASCADE,
  provider          TEXT,
  external_id       TEXT,
  title             TEXT,
  original_title    TEXT,
  synopsis          TEXT,
  developer         TEXT,
  release_date      TEXT,
  original_language TEXT,
  content_rating    TEXT NOT NULL DEFAULT 'unrated'
                    CHECK (content_rating IN ('unrated', 'all-ages', 'teen', 'mature', 'restricted')),
  cover_url         TEXT,
  background_url    TEXT,
  CHECK ((provider IS NULL) = (external_id IS NULL))
);

-- The user's own edits. A NULL field means "use the provider value".
CREATE TABLE game_user_fields (
  game_id        TEXT PRIMARY KEY REFERENCES games (id) ON DELETE CASCADE,
  title          TEXT,
  synopsis       TEXT,
  developer      TEXT,
  release_date   TEXT,
  cover_url      TEXT,
  background_url TEXT,
  notes          TEXT NOT NULL DEFAULT ''
);

CREATE TABLE game_alt_titles (
  game_id  TEXT NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  title    TEXT NOT NULL,
  PRIMARY KEY (game_id, position)
);

CREATE TABLE game_languages (
  game_id  TEXT NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  language TEXT NOT NULL,
  PRIMARY KEY (game_id, language)
);

CREATE TABLE tags (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('genre', 'tag')),
  UNIQUE (name, kind)
);

CREATE TABLE game_tags (
  game_id  TEXT NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (game_id, tag_id)
);
CREATE INDEX idx_game_tags_tag ON game_tags (tag_id);

CREATE TABLE collections (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL COLLATE NOCASE UNIQUE,
  description TEXT,
  position    INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  is_sample   INTEGER NOT NULL DEFAULT 0 CHECK (is_sample IN (0, 1))
);

CREATE TABLE collection_games (
  collection_id TEXT NOT NULL REFERENCES collections (id) ON DELETE CASCADE,
  game_id       TEXT NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,
  added_at      TEXT NOT NULL,
  PRIMARY KEY (collection_id, game_id)
);
CREATE INDEX idx_collection_games_game ON collection_games (game_id);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

const metadataSupport = `
-- Raw provider responses, so repeated lookups never hit the network twice.
CREATE TABLE metadata_cache (
  cache_key  TEXT PRIMARY KEY,
  response   TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

ALTER TABLE game_provider_metadata ADD COLUMN fetched_at TEXT;
`

const playSessions = `
-- One row per launch. ended_at stays NULL while the game runs; a row still open at start-up
-- means VNStation stopped unexpectedly, and it is closed as 'interrupted' (not counted).
CREATE TABLE play_sessions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id          TEXT NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  started_at       TEXT NOT NULL,
  ended_at         TEXT,
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  tracking         TEXT CHECK (tracking IS NULL OR tracking IN ('process', 'folder', 'handoff', 'app-closed', 'interrupted'))
);
CREATE INDEX idx_play_sessions_game ON play_sessions (game_id, started_at);
CREATE INDEX idx_play_sessions_open ON play_sessions (ended_at) WHERE ended_at IS NULL;

-- Seconds are the source of truth, so many short sessions add up correctly.
-- playtime_minutes is kept in step for older readers.
ALTER TABLE games ADD COLUMN playtime_seconds INTEGER NOT NULL DEFAULT 0 CHECK (playtime_seconds >= 0);
UPDATE games SET playtime_seconds = playtime_minutes * 60;
`

const steamAndCharacters = `
ALTER TABLE games ADD COLUMN library_source TEXT NOT NULL DEFAULT 'manual'
  CHECK (library_source IN ('manual', 'steam-api', 'steam-local'));
ALTER TABLE games ADD COLUMN steam_app_id INTEGER;
ALTER TABLE games ADD COLUMN steam_installed INTEGER
  CHECK (steam_installed IS NULL OR steam_installed IN (0, 1));
ALTER TABLE games ADD COLUMN steam_available INTEGER NOT NULL DEFAULT 1
  CHECK (steam_available IN (0, 1));
CREATE UNIQUE INDEX idx_games_steam_app_id ON games (steam_app_id) WHERE steam_app_id IS NOT NULL;

-- Full Steam evaluation catalog so non-VN games stay excluded across syncs,
-- uncertain matches stay isolated in the review queue, and manual overrides persist.
CREATE TABLE steam_catalog (
  steam_app_id      INTEGER PRIMARY KEY,
  name              TEXT NOT NULL,
  source            TEXT NOT NULL CHECK (source IN ('steam-api', 'steam-local')),
  installed         INTEGER NOT NULL DEFAULT 0 CHECK (installed IN (0, 1)),
  install_dir       TEXT,
  playtime_minutes  INTEGER NOT NULL DEFAULT 0 CHECK (playtime_minutes >= 0),
  last_played_at    TEXT,
  classification    TEXT NOT NULL CHECK (classification IN ('vn', 'review', 'excluded')),
  confidence        TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low', 'manual')),
  reason            TEXT NOT NULL DEFAULT '',
  manual_override   TEXT CHECK (manual_override IS NULL OR manual_override IN ('include', 'exclude')),
  vndb_id           TEXT,
  vndb_title        TEXT,
  candidates_json   TEXT NOT NULL DEFAULT '[]',
  game_id           TEXT REFERENCES games (id) ON DELETE SET NULL,
  available         INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1)),
  synced_at         TEXT NOT NULL
);
CREATE INDEX idx_steam_catalog_classification ON steam_catalog (classification);

-- Cached VNDB character profiles per visual novel (vndb_id = "v17", etc.).
CREATE TABLE vn_characters (
  vndb_id        TEXT NOT NULL,
  character_id   TEXT NOT NULL,
  position       INTEGER NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('main', 'primary', 'side', 'appears')),
  spoiler        INTEGER NOT NULL DEFAULT 0 CHECK (spoiler IN (0, 1, 2)),
  name           TEXT NOT NULL,
  original_name  TEXT,
  aliases_json   TEXT NOT NULL DEFAULT '[]',
  description    TEXT,
  portrait_url   TEXT,
  details_json   TEXT NOT NULL DEFAULT '{}',
  fetched_at     TEXT NOT NULL,
  PRIMARY KEY (vndb_id, character_id)
);
CREATE INDEX idx_vn_characters_vndb ON vn_characters (vndb_id, position);
`

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'initial-library', sql: initialLibrary },
  { version: 2, name: 'metadata-support', sql: metadataSupport },
  { version: 3, name: 'play-sessions', sql: playSessions },
  { version: 4, name: 'steam-and-characters', sql: steamAndCharacters }
]

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version

export const currentVersion = (db: Database): number =>
  Number(db.get<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0)

/** Applies every pending migration in order. Refuses to touch a database from a newer app. */
export function migrate(db: Database, migrations: readonly Migration[] = MIGRATIONS): { from: number; to: number } {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) throw new Error('Migrations must be numbered 1, 2, 3 without gaps.')
  })
  const latest = migrations.length
  const from = currentVersion(db)
  if (from > latest) {
    throw new Error(
      `This library was created by a newer version of the app (schema ${from}, this build understands ${latest}). ` +
        'Update the app instead of opening it with this version.'
    )
  }
  for (const migration of migrations.slice(from)) {
    db.transaction(() => {
      db.exec(migration.sql)
      db.exec(`PRAGMA user_version = ${migration.version}`)
    })
  }
  return { from, to: latest }
}
