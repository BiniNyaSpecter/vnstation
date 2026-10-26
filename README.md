<div align="center">

# VNStation

**A console-grade visual novel launcher, library manager, and social platform for Windows.**

[![Version](https://img.shields.io/badge/version-1.0.0--beta.1%20Closed%20Beta-indigo?style=for-the-badge)](https://github.com/BiniNyaSpecter/vnstation/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-blue?style=for-the-badge&logo=windows)](https://github.com/BiniNyaSpecter/vnstation)
[![Tests](https://img.shields.io/badge/tests-275%20passing-brightgreen?style=for-the-badge)](https://github.com/BiniNyaSpecter/vnstation)
[![Electron](https://img.shields.io/badge/Electron-44.0-cyan?style=for-the-badge&logo=electron)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19.2-61DAFB?style=for-the-badge&logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![SQLite](https://img.shields.io/badge/Database-SQLite-003B57?style=for-the-badge&logo=sqlite)](https://sqlite.org/)

<p align="center">
  <a href="#key-features">Key Features</a> •
  <a href="#getting-started">Getting Started</a> •
  <a href="#controller--keyboard-navigation">Controls</a> •
  <a href="#steam-integration">Steam Integration</a> •
  <a href="#social-platform--profiles">Social & Profiles</a> •
  <a href="#architecture--privacy">Architecture & Privacy</a>
</p>

</div>

---

## Overview

**VNStation** is a modern, living-room-ready desktop visual novel hub designed for enthusiasts who cherish both literary depth and console polish.

It connects to your existing visual novels and launches the original executables directly without altering, moving, or tampering with your game files. Whether your library consists of standalone retail releases, fan translations, or Steam downloads, VNStation consolidates them into an elegant console interface with automated VNDB metadata, full character compendiums, process tree playtime tracking, and an optional nostalgic MySpace-inspired community layer.

---

## Key Features

### 🎮 Console-Style Fluid Interface
- **PlayStation / Xbox Inspired Experience:** Designed from the ground up for big screens, monitors, and handhelds with smooth shelf carousels, top category tabs, and optional collapsible side rail.
- **Dynamic Backdrop Crossfading:** High-resolution visual novel artwork seamlessly transitions with velvety gradient scrims as you browse.
- **Procedural Audio & Micro-interactions:** Soft, synthesized interface ticks and chimes generated in real time via Web Audio with zero bulky asset dependencies.
- **First-Class Gamepad & Keyboard Navigation:** Native spatial navigation with full support for Xbox, PlayStation DualSense/DualShock, Switch Pro, and standard XInput controllers.

### 📚 VNDB Metadata & Character Compendiums
- **Official VNDB Kana v2 Integration:** Instantly query titles, release dates, synopses, developers, and official artwork.
- **Rich Character Profiles:** Browse character casts with high-res portraits, voice actors, role classifications (`main`, `primary`, `side`), and personality traits.
- **Granular Spoiler Protection:** Spoiler characters, sensitive traits, and spoiler-tagged biographies remain safely shielded until you explicitly reveal them.
- **Content Ratings & Adult Filters:** Restrict explicit 18+ visual novels behind an age-gate confirmation with discreet backdrop filtering.

### ⚙️ Dual-Mode Steam Integration
- **Smart Visual Novel Classification:** Automatically inspects your Steam games and VNDB databases to import only actual Visual Novels, preventing library clutter.
- **Web API & Local Folder Scans:** Synchronize your Steam catalog either via the official Steam Web API or offline by scanning local `libraryfolders.vdf` manifests.
- **Ambiguous Match Review Queue:** Games with uncertain classifications are safely staged in an interactive review drawer with 1-click manual overrides.

### ⏱️ True Process-Tree Playtime Tracking
- **Child Process Monitoring:** Follows launcher wrapper executables to their real game processes (e.g., Kirikiri, Unity, Ren'Py, CatSystem2, SiglusEngine).
- **Session History:** Records cumulative playtime, last-played timestamps, and detailed session logs in local SQLite storage.
- **Window State Automation:** Automatically minimizes VNStation on game startup and restores it when the visual novel closes.

### 🌐 MySpace-Inspired Social & Profiles
- **Expressive Profile Studio:** Curate your taste with 6 nostalgic themes (e.g., *Midnight Console*, *Sakura Memory*, *Tsukihime Crimson*), customizable banners, avatars, mood status lines, and "Now Reading" widgets.
- **Visual Novel & Character Showcase:** Spotlight your all-time favorite visual novels and waifu/husbando characters directly on your profile.
- **Friend Codes & Direct Messaging:** Connect using non-sequential alphanumeric codes (`VNS-XXXX-XXXX`), manage friend requests, and chat in real-time with delivery receipts.
- **Granular Privacy & "Preview As":** Instant preview toggle lets you verify how your profile appears to *Self*, *Friends*, or *Strangers*.

### 🔒 Local-First Privacy & Optional Supabase Cloud
- **100% Offline Capability:** All games, collections, playtime logs, and offline companion profiles live in your local encrypted SQLite database.
- **Zero Mandatory Logins:** Use the full visual novel library and launcher offline without creating any account.
- **Seamless Cloud Backend:** Pre-configured with Supabase PostgreSQL cloud sync for cross-device friend synchronization, real-time presence, and messaging.

---

## Getting Started

### Windows Closed Beta Executables

Download the latest release from the [Releases](https://github.com/BiniNyaSpecter/vnstation/releases) page:
- **Installer:** `VNStation-Setup-1.0.0-beta.1.exe`
- **Portable Unpacked:** `VNStation-1.0.0-beta.1-win-x64.zip`

> [!NOTE]
> Since this is a community Closed Beta build, Windows SmartScreen may present an untrusted publisher dialog. Click **More info** → **Run anyway**.

---

### Building from Source

#### Prerequisites
- **Node.js:** 22.12.0 or newer (Node 22 LTS recommended)
- **OS:** Windows 10/11 (UI also builds on macOS / Linux)

#### Installation & Development
```bash
# Clone repository
git clone https://github.com/BiniNyaSpecter/vnstation.git
cd vnstation

# Install dependencies (fetches Electron runtime)
npm install

# Start development app with Hot Module Replacement (HMR)
npm run dev
```

#### Verification & Packaging
```bash
# Run complete verification (typecheck + test suite + build)
npm run verify

# Build unpacked local Windows binary (release/win-unpacked/VNStation.exe)
npm run pack

# Build standalone Windows NSIS installer (release/VNStation-Setup-*.exe)
npm run dist
```

---

## Controller & Keyboard Navigation

VNStation is engineered for seamless couch navigation with no mouse required:

| Action | Keyboard | Gamepad (Xbox / PlayStation) |
| :--- | :--- | :--- |
| **Move Focus** | `Arrow Keys` | `D-Pad` / `Left Analog Stick` |
| **Select / Confirm** | `Enter` | `A` (Cross) / `B` (Circle in Japanese layout) |
| **Back / Dismiss** | `Escape` | `B` (Circle) / `A` (Cross in Japanese layout) |
| **Quick Launch Game** | — | `X` / `Square` or `Start` / `Options` |
| **Toggle Favorite** | `F` | `Y` / `Triangle` |
| **Cycle Categories** | `[` and `]` | `LB` / `RB` (`L1` / `R1`) |
| **Cycle Select Options** | `Left` / `Right` | `D-Pad Left` / `D-Pad Right` |
| **Global Search** | `/` | — |
| **Toggle Side Rail** | `Ctrl + B` | — |
| **Fullscreen Toggle** | `F11` | — |

> [!TIP]
> Gamepad input automatically sleeps whenever a visual novel executable takes focus, preventing accidental background inputs while reading.

---

## Steam Integration

Connect your Steam account in **Settings → Integrations · Steam**:
1. **Option A · Steam Web API:** Reads public owned games and playtime using your 17-digit `SteamID64` and an optional Steam Web API key. API keys are encrypted at rest using Windows DPAPI (`safeStorage`).
2. **Option B · Local Steam Installation:** Scans your local `steamapps` folder and `appmanifest_*.acf` without needing an API key or public profile.

VNStation runs all entries through its VNDB classification heuristics. Any non-visual-novel games (FPS, RTS, RPGs) are omitted from your shelf, while borderline titles can be inspected in the **Review Queue**.

---

## Social Platform & Profiles

VNStation includes an optional social layer with zero telemetry:
- **Local Sandbox Mode:** Ready out-of-the-box with local SQLite messaging and companion profiles (`VNS-AOKO-2026` and `VNS-LABM-2048`) to test friend requests and chat offline.
- **Supabase Cloud Sync:** Connect to the pre-configured live Supabase backend or host your own using `supabase/migrations/20261026000000_social_platform.sql`.
- **Safe Image Uploads:** Profile avatars and custom header banners are compressed and sanitized client-side to prevent network bloat or broken external URLs.
- **Absolute Privacy:** Local executable paths (e.g. `D:\VisualNovels\...`) and personal game notes are strictly local and are never transmitted to friends or servers.

---

## Architecture & Privacy

```
┌────────────────────────────────────────────────────────┐
│                   VNStation Desktop                    │
│                                                        │
│  ┌─────────────────────────┐  ┌─────────────────────┐  │
│  │   Renderer Process      │  │     Main Process    │  │
│  │  (React 19 + TypeScript)│  │   (Node 22 runtime) │  │
│  │                         │  │                     │  │
│  │  • Spatial Nav Engine   │  │  • SQLite Storage   │  │
│  │  • Web Audio Synths     │  │  • Process Tracker  │  │
│  │  • Profile Studio UI    │  │  • DPAPI Encryption │  │
│  └───────────┬─────────────┘  └──────────┬──────────┘  │
│              │ ContextBridge IPC         │             │
└──────────────┼───────────────────────────┼─────────────┘
               │                           │
               ▼                           ▼
        VNDB Kana API              Supabase Cloud
     (api.vndb.org/kana)       (PostgreSQL + RLS + DM)
```

- **Local Database:** `%APPDATA%\VNStation\library.db` (SQLite with automatic schema migrations).
- **Artwork Cache:** Caches VNDB covers and character portraits on disk for instant offline access.
- **Security:** Strict Electron context isolation, CSP headers enabled, and OS-level DPAPI credential encryption. Elevated Supabase service keys are explicitly blocked from client runtimes.

---

## License & Attribution

- Built with [Electron](https://www.electronjs.org/), [React](https://react.dev/), [Vite](https://vite.dev/), and [TypeScript](https://www.typescriptlang.org/).
- Visual novel metadata and character data provided by [VNDB](https://vndb.org/) under the [Open Database License (ODbL)](https://vndb.org/d17).
- Visual novel titles, cover artwork, and character assets belong to their respective creators and publishers.

---

<div align="center">
  <sub>Built for visual novel readers with ❤️ · Closed Beta v1.0.0</sub>
</div>
