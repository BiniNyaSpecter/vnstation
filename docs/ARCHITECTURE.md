# Architecture

## Decisions

**Electron + React + TypeScript + Vite (via electron-vite).** Matches the brief, and the
team ships one language across main, preload and UI. Tauri would give a smaller binary,
but launching and watching child processes, Windows paths and the SQLite/native-module
story are all well-trodden in Node, and nothing here needs Tauri's footprint. Revisit only
if install size becomes a real complaint.

**Pinned versions** (checked against current docs, Oct 2026):
- Electron 44.x, the current stable line.
- electron-vite 5, which declares a Vite peer range of 5, 6 or 7, so **Vite is pinned to 7**,
  not 8. `@vitejs/plugin-react` is pinned to 5.x for the same reason.
- Node 22.12+ for tooling.

**CommonJS main/preload** (no `"type": "module"`): sandboxed preload scripts must be CommonJS.

**Built-in SQLite (`node:sqlite`), not a native module.** Electron 44 bundles Node 24, which
includes SQLite. That avoids compiling `better-sqlite3` for Electron's ABI on every user's
machine (Python, Visual Studio build tools, rebuilds on each Electron upgrade) and lets the whole
data layer be tested against a real database. Trade-off: Node still labels the API experimental,
so it is isolated behind one file (`main/db/sqlite.ts`); moving to `better-sqlite3` later means
rewriting only that wrapper.

**No router and no state library yet.** Navigation is a small route stack in the store;
state is a ~30-line Zustand-shaped store (`lib/store.ts`) bound with `useSyncExternalStore`.
Swapping in Zustand later is a one-file change.

**Procedural artwork.** With no network and no licensed art, sample games and games without
metadata get generated SVG covers/backgrounds (`lib/art.ts`). This doubles as the permanent
fallback for missing or corrupt artwork.

## Structure

```
src/
  shared/      Types and contracts used by both processes. No Node or DOM code.
    types.ts       Domain model (GameEntry = provider data + user edits; Game = merged view)
    contracts.ts   LibraryRepository, GameLauncher: the seams for Milestones 2 and 4
    ipc.ts         Allowlist of IPC channels
    api.ts         The only API the renderer can call (window.vnstation)
    suggestTitle.ts
  main/        Electron main process: window, security, IPC handlers, executable validation
    db/            sqlite wrapper, migrations, open+backup, LibraryStore (SQL), SettingsStore
    validation.ts  Parsers for everything that arrives over IPC
    libraryService.ts  Validates input and checks paths, then calls the store
    ipcResult.ts   { ok, value | message } envelope; unexpected errors become a generic message
  preload/     contextBridge wrapper over the allowlisted channels
  renderer/src/
    lib/           Pure logic: query/sort/filter, formatting, store, spatial navigation, art
    services/      Composition root. In-memory repository and stub launcher for now
    state/         App store, hooks
    components/    ui (design system), game (tiles, rows, hero), layout, dialogs
    views/         Home, Library, Collections, Details, Settings
    styles/        tokens, base, ui, game, shell, views
tests/         Unit and integration tests
```

## Security model

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- The preload exposes two functions (app info, file picker). `ipcRenderer` is never exposed.
- Every IPC handler checks the sender frame URL against the app's own pages.
- The picker result is validated in main (absolute path, `.exe`, existing file, no NULs) and
  nothing is executed when a game is added.
- Navigation and `window.open` are blocked; all permissions are denied except clipboard write.
- Production builds get a strict CSP `<meta>` (injected at build time; dev skips it because
  React Fast Refresh needs inline scripts).

## Data layer (Milestone 2)

```
renderer  --IPC-->  ipc.ts  -->  LibraryService  -->  LibraryStore  -->  SQLite (library.db)
          (preload)  envelope    parse + path checks    SQL only
```

- **Schema:** `games`, `game_provider_metadata` (provider data), `game_user_fields` (user edits,
  NULL = use provider value), `game_alt_titles`, `game_languages`, `tags` + `game_tags`,
  `collections` + `collection_games`, `settings`. Tags, languages and collection membership are
  real relations, and foreign keys cascade so removing a game removes everything attached to it.
- **Migrations:** numbered, applied in order inside a transaction together with the
  `PRAGMA user_version` bump. A failure rolls back completely. A database from a newer app is
  refused. Before upgrading an existing file, `VACUUM INTO` writes `library.db.backup-v<N>`.
  Never edit a shipped migration; add the next number.
- **Trust boundary:** every IPC argument is parsed and bounded in `validation.ts`; a chosen
  executable or folder must exist before it is saved; the renderer never sends SQL, column
  names or raw paths to anything but those checks. File existence checks for the Details page
  run in the main process against the saved path, not a path supplied by the UI.
- **Sample data** lives in `shared/sampleLibrary.ts`, is flagged `is_sample`, and is only
  inserted when the user asks. Removing it never touches real games.
- **Not in the schema yet (by design):** `play_sessions` (Milestone 4) and `metadata_cache`
  (Milestone 3) arrive as migrations 2 and 3.

## Metadata (Milestone 3)

```
renderer --search text--> ipc --> MetadataService --> VndbProvider --> RequestScheduler --> net.fetch --> api.vndb.org
                                       |                  parse + content rules (pure, tested)
                                       +--> MetadataCache (SQLite)     +--> ArtworkCache (files) --> vnstation-art:// protocol
```

- **Provider interface:** `MetadataProvider { search, getDetails }`. VNDB is the first implementation, so another
  source is a new class, not a rewrite. Provider output is validated field by field; anything unexpected is
  dropped or reported as a readable error, never trusted.
- **Content rules live in pure functions** (`isImageSafe`, `ratingFromMinAge`, `ratingFromSignals`, `parseVnDetails`)
  and depend on a `ContentPolicy`:
  - `family` (default): only clearly safe images (sexual below 0.5, violence below 1.5). Adults-only games keep title,
    developer and dates but are stripped of description and artwork *at parse time*, so those never reach the cache, the
    database or the screen. Adult search results are hidden.
  - `adult`: used only after the user confirmed they are 18 or older and switched adults-only entries on. Covers and
    descriptions are kept for every game; full-screen backgrounds still skip screenshots flagged explicit (1.5) or
    brutal (2).
  The policy is part of the cache keys, so the two never mix. Ratings come from release `minage` (strictest wins) and
  sexual-content tags. `showRestricted` can never be true without `adultConfirmed` (enforced when preferences are
  loaded and whenever they change).
- **Requests:** one at a time, at least 500 ms apart, at most 120 per 5 minutes; every failure (offline, timeout, 429,
  5xx, unreadable response) becomes a plain-language message. The age rating lookup is part of the same operation:
  if it fails, the whole lookup fails rather than guessing.
- **Artwork:** downloaded only from https `*.vndb.org`, size-capped, identified by file signature (not by name or
  content type), written atomically into `artwork/vndb/`. Images the user picks are validated the same way and kept in
  `artwork/user/`, which "Clear cache" never touches. The renderer only ever sees `vnstation-art://art/...` URLs; the
  protocol handler can serve nothing outside that folder.
- **Data separation:** provider data replaces `game_provider_metadata` wholesale; the user's edits live in
  `game_user_fields`, which refresh, relink and unlink never touch. The only exception is the title, and only when the
  user ticks "Use the official title".
- **Schema:** migration 2 adds `metadata_cache` and `game_provider_metadata.fetched_at`.
- **CSP (packaged builds):** images may come from `self`, `data:`, `blob:`, `vnstation-art:` and `https://*.vndb.org`
  (match-result thumbnails only). The renderer cannot make network requests (`connect-src 'self'`).

## Interface and motion (PlayStation-style)

- **Navigation:** a top category bar (default) with an accent line that slides between categories, or the side rail.
  Switching happens on click/Enter, never on focus, so arrow keys can pass over categories.
- **Rows:** the selected tile glides (eased, cancellable, 380 ms) to the left margin so tile, label and hero text align.
  Positions come from nominal widths, so the result is exact even while the tile is still growing. Rows without the
  selection dim. The focused tile is lifted and its frame pulses slowly.
- **Ambient layer:** three bands of thin wave lines and two soft glows, pure CSS transforms on compositor layers (no
  blur filters), behind library/settings screens; hero artwork covers it.
- **Screen changes:** short fade-and-rise; hero text arrives staggered; new artwork fades in while easing from a slight
  zoom; the details page artwork drifts very slowly.
- **Motion modes:** Full (default), Follow system, Reduced. Windows' "animation effects off" is reported to apps as
  reduced motion, which previously froze everything; now only "Follow system" honours it.
- **Sound:** `lib/sound.ts` synthesises short tones with the Web Audio API (no files, no licensing): a soft tick on
  selection moves, a two-note confirm, a falling back, plus open/success/error. Notes are quiet, throttled so held keys
  do not buzz, and every call is wrapped so audio failure can never affect the UI. Volume and an on/off switch are in
  Settings. The window allows audio without a prior gesture (`autoplayPolicy`).

## Launching and playtime (Milestone 4)

```
renderer --launch(gameId, opts)--> ipc --> ProcessGameLauncher --> spawn(exe, args, { cwd, shell: false })
   ^                                             |
   +-- launcher:event (started/tracking/stopped) +--> LibraryStore (play_sessions + games.playtime_seconds)
```

- **No shell:** launch arguments are split with Windows `CommandLineToArgvW` rules (`main/launcher/args.ts`) and passed as an array to `child_process.spawn` with `shell: false` and `stdio: 'ignore'`. User-controlled paths and arguments are never concatenated into a shell command.
- **Play sessions (Migration 3):** each launch opens a row in `play_sessions` and stamps `games.last_played_at` immediately. When the session ends, elapsed seconds are added to `games.playtime_seconds` (and `playtime_minutes = playtime_seconds / 60`), so multiple short sessions accumulate accurately.
- **Launcher & child-process handling:** when the initial process exits, `ProcessGameLauncher` checks (via `main/launcher/folderWatcher.ts`) whether another executable inside the game's folder is running. If so, the session switches to `folder` tracking and polls until the folder is quiet. If the initial process exits within 10 seconds with nothing left running in the game folder (e.g. a wrapper that hands off to Steam), the session is marked `handoff` and the UI notes that only launcher time could be measured.
- **Crash & shutdown safety:** closing VNStation while a game is running leaves the game running and records the session up to that point (`app-closed`). Any session still open at next start-up is closed as `interrupted` with 0 seconds added.

## Controller and polish (Milestone 5)

- **Gamepad:** `renderer/src/lib/gamepad.ts` polls W3C standard gamepads (`navigator.getGamepads`) while the window is visible and focused, feeding the same spatial navigation (`moveFocus`) as the keyboard. Polling pauses and resyncs whenever the window loses focus so controller input inside a running visual novel never triggers background actions in VNStation.
- **Backdrop crossfades:** `Backdrop.tsx` pre-decodes incoming background images off the main thread (`HTMLImageElement.decode()`) before mounting the fade-in layer, and applies `--backdrop-strength` to the layer stack container rather than individual `<img>` elements so outgoing and incoming backgrounds never bleed through each other.

## Known limitations

- VNDB has tags rather than genres, so the Genre filter lists genres and tags together.
- Cover images are stored at VNDB's size; very large covers are not resized.
- Playtime will be measured from the launched process. Games that start a launcher and exit, or spawn a child, will
  under-report; this will be documented in Milestone 4.
- Only `.exe` is supported. Paths are compared case-insensitively to detect duplicates (right for Windows).
- The database is opened by one app instance only (single-instance lock).
