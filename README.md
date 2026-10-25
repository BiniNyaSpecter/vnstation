# VNStation

A console-style personal library and launcher for visual novels you already own.
It links to your existing installs and launches the original executables; it is not a
visual novel engine and never copies, modifies or uploads your game files.

> **Status: Milestone 6 of 6 (Complete).** Your library is saved locally in SQLite, games can be
> matched to VNDB for titles, descriptions, artwork and full character cast compendiums, Steam libraries
> can be synchronized (via Steam Web API or local Steam installation) with automatic Visual Novel
> classification and review queue isolation, executables and Steam entries launch directly with playtime
> and session tracking, and both keyboard and controller navigation are built in. See
> [Status](#status) for details.

## Prerequisites

- Windows 10/11 (the target; the UI also runs on macOS/Linux for development)
- [Node.js](https://nodejs.org) **22.12 or newer** (22 LTS recommended)
- Git is optional

## Install and run

```bash
npm install        # downloads Electron (~100 MB) on first run
npm run dev        # starts the app with hot reload
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Electron + Vite dev server with hot reload |
| `npm run build` | Production build into `out/` |
| `npm run preview` | Runs the production build locally |
| `npm run typecheck` | Type-checks the main/preload/shared code and the renderer |
| `npm test` | Runs the unit and integration tests (Vitest) |
| `npm run verify` | typecheck, then tests, then build |

## Build the Windows executable

```bash
npm run pack   # fast: release/win-unpacked/VNStation.exe (run it directly, no installer)
npm run dist   # installer: release/VNStation-Setup-1.0.0.exe
```

Notes: the app is unsigned (`signAndEditExecutable: false` in `electron-builder.yml` so local builds
never fail on missing code-signing certificates or symbolic-link permissions), so Windows SmartScreen
may warn on first run ("More info", then "Run anyway").

## Keyboard and controller navigation

| Keyboard | Controller (Xbox / PlayStation) | Action |
| --- | --- | --- |
| Arrow keys | D-Pad or Left Stick | Move focus spatially through tiles, rows, buttons, categories and dialogs |
| Enter | `A` / `✕` (or `B` / `○` in Settings) | Open game details, or activate the focused control |
| Esc | `B` / `○` (or `A` / `✕` in Settings) | Go back, or close an open dialog |
| `[` / `]` | `LB` / `RB` (`L1` / `R1`) | Switch between top-level categories |
| `F` | `Y` / `△` | Toggle favorite on the selected game |
| — | `Start` / `Options` or `X` / `□` | Launch the selected game |
| `/` | — | Focus search |
| Ctrl+B | — | Collapse or expand the side rail |
| F11 | — | Toggle full screen |

Selecting a game (by focus or click) updates the hero; the selection is kept when you
switch between views. Controller input automatically pauses whenever VNStation is in the
background so playing a visual novel with a gamepad never triggers actions in the launcher.

## Configuration

- **App name:** `src/shared/app-config.ts` (`APP_CONFIG.name`) and `productName` in `package.json`.
- **Theme and accent:** Settings. New themes are a `[data-theme="..."]` block in
  `src/renderer/src/styles/tokens.css`.
- **Metadata (VNDB):** Uses the official VNDB Kana v2 HTTP API (`https://api.vndb.org/kana/vn` and
  `/release`) from the Electron main process. No API key is required for public metadata lookups.
  Turn online lookups on or off at any time in **Settings → Metadata**.

## Status

| Area | State |
| --- | --- |
| Add game: native `.exe` picker, batch folder scanner (up to 2 subfolder levels, filters out helpers/uninstallers), validation, title suggestion, working directory, arguments | Working, saved |
| Library saved between runs (SQLite), favorites, notes, last played / playtime fields | Working |
| Edit a game (title, executable, working directory, arguments); repair a moved executable; open game folder in Explorer | Working |
| Missing-file detection on the Details page | Working |
| Remove from library (never touches game files) | Working |
| Collections: create, rename, delete, add/remove games | Working |
| Search, sort, genre/language filters, grid and shelf layouts | Working |
| Settings (4 themes: Midnight / Obsidian / Twilight / Daylight, 5 accents, artwork strength, motion, rail, sort, adults-only filter, launch & controller options) | Working, saved in the database |
| Adults-only entries hidden by default | Working |
| Find details on VNDB: search, pick the right match, official title, description, tags, release date, cover and background | Working (needs internet; your library works fully offline) |
| Refresh or remove downloaded details; type your own details; choose your own cover/background | Working; your edits are kept separately and never overwritten |
| Artwork cache with size shown and a Clear button; repeat lookups served from a local cache | Working |
| Adults-only (18+) games: hidden by default; shown only after an "are you 18 or older?" confirmation, then their details and artwork download like any other game's, with an 18+ badge and caution | Working |
| Interface sounds (generated by the app, adjustable volume) and a Motion setting (Full / Follow system / Reduced) | Working |
| PlayStation-style top category bar, ambient waves, glide-to-anchor rows, pre-decoded backdrop crossfades, dynamic hints bar; side rail still available | Working (Settings → Appearance) |
| **Executable launcher & playtime tracking** | Working: spawns the original `.exe` with its working directory and arguments (`shell: false`), or launches Steam entries via `steam://rungameid/<appId>`, tracks `play_sessions` and cumulative playtime, follows same-folder child processes when a launcher exits, and optionally minimizes/restores VNStation |
| **Keyboard & controller navigation + Windows packaging** | Working: spatial keyboard + W3C Gamepad navigation (`npm run pack` / `npm run dist`) |
| **Steam library integration & Visual Novel classification** | Working: connect via Steam Web API (`GetOwnedGames` + `GetPlayerSummaries` with OS-encrypted API key storage) or scan local Steam installation (`libraryfolders.vdf` + `appmanifest_*.acf`), automatically classify Visual Novels via VNDB release `extlink` and title matching, isolate ambiguous matches in a review queue, and support persistent manual include/exclude overrides |
| **VNDB character profiles & spoiler protection** | Working: fetches and caches character portraits, roles (`main`, `primary`, `side`, `appears`), biographies, and grouped traits per VNDB visual novel (`POST /character`), hides spoiler characters, spoiler traits, and `[spoiler]` biography segments by default until explicitly revealed, and works offline once cached |

**Where your data lives:** `library.db` in the app's data folder (on Windows,
`%APPDATA%\VNStation`; the exact path is shown in Settings, under Storage). Dev and packaged
builds share it. Before a future version changes the database layout, a backup is written next
to it as `library.db.backup-v<N>`. To start over, close the app and delete `library.db`.

**Sample games** (invented titles, generated artwork) are never added automatically. Use
Settings, then Library, then "Add sample games" to preview the interface, and remove them at any
time without affecting your own games.

## Troubleshooting

- **Electron download fails or hangs:** set a mirror, e.g. `ELECTRON_MIRROR` (see the
  [Electron docs](https://www.electronjs.org/docs/latest/tutorial/installation)), then reinstall.
- **`electron-vite` complains about the Node version:** upgrade to Node 22.12+.
- **Blank window in `npm run dev`:** check the terminal for a renderer build error.
- **Nothing animates:** Windows may be telling apps to reduce motion (Settings, Accessibility, Visual effects,
  Animation effects; battery saver can also turn it off). Set Settings, then Appearance, then Motion to **Full**.
- **No sound:** check Settings, then Sound (on, volume above 0) and your Windows output device. If a sound is
  too loud, too quiet or unpleasant, tell me which one and I will retune it.
- **"Could not reach VNDB":** you are offline or something blocks api.vndb.org. Nothing is lost; try again
  later, or type the details yourself in Edit game.
- **"could not open its library" at start-up:** the message says why. Your library file is left
  untouched. Send me the message if it is not obvious.
- **Fonts look different:** titles use Palatino/Yu Mincho and the UI uses Segoe UI on
  Windows. Other systems fall back to their defaults.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for design decisions, structure and the roadmap.

## Online lookups and privacy

- Lookups go to VNDB (api.vndb.org) from the app's main process. **Only the text you search for, or a
  VNDB game ID, is sent.** Your library, file paths and play history never leave your computer.
- Requests are spaced out and capped (VNDB allows 200 per 5 minutes; VNStation stays well under),
  and responses are cached in the library database so repeat lookups send nothing.
- Turn lookups off completely in Settings, then Metadata.
- Games rated 18+ stay hidden until you confirm you are 18 or older (Settings, or the "Show 18+ results"
  button in the match screen). After that their description and artwork download like any other game's, and
  they carry an 18+ badge and a caution on their details page. Full-screen backgrounds still skip screenshots
  VNDB flags as explicit or brutal. You can hide them again at any time; your confirmation is remembered.
- VNDB data is used under the [Open Database License](https://vndb.org/d17); that attribution is shown
  on each game's details page and in Settings. Images and descriptions remain the property of their owners.
