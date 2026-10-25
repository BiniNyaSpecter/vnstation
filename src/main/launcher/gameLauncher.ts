import { spawn } from 'node:child_process'
import { dirname } from 'node:path'
import type { GameLauncher } from '@shared/contracts'
import {
  HANDOFF_SECONDS,
  type LauncherEvent,
  type LaunchOptions,
  type LaunchResult,
  type PlayHistory,
  type RunningGame,
  type SessionTracking
} from '@shared/launcher'
import type { LibraryStore } from '../db/libraryStore'
import { validateDirectory, validateExecutable } from '../executables'
import { isSteamLaunchUri, parseId } from '../validation'
import { splitArguments } from './args'
import type { FolderProbe } from './folderWatcher'

export interface SpawnedProcess {
  on(event: 'spawn', listener: () => void): this
  on(event: 'error', listener: (error: NodeJS.ErrnoException) => void): this
  on(event: 'exit', listener: (code: number | null) => void): this
}

export type ProcessSpawner = (
  executablePath: string,
  args: readonly string[],
  options: { cwd: string }
) => SpawnedProcess

/** Spawns the executable directly with an argument array and `shell: false`. */
export const defaultSpawner: ProcessSpawner = (executablePath, args, { cwd }) =>
  spawn(executablePath, args, {
    cwd,
    shell: false,
    windowsHide: false,
    stdio: 'ignore'
  })

export interface LauncherWindowController {
  minimize(): void
  restoreAndFocus(): void
}

export interface ProcessGameLauncherOptions {
  store: LibraryStore
  spawnProcess?: ProcessSpawner
  probeFolder?: FolderProbe
  revealInFolder?: (executablePath: string, workingDirectory: string) => Promise<boolean> | boolean
  /** Launches a Steam game via `steam://rungameid/<appId>`. Returns true if Steam accepted the launch. */
  launchSteamUri?: (steamUri: string, appId: number) => Promise<boolean> | boolean
  window?: LauncherWindowController
  now?: () => Date
  /** How often to check whether a folder-tracked game is still running. */
  folderPollMs?: number
}

interface ActiveSession {
  gameId: string
  sessionId: number
  startedAt: string
  startedAtMs: number
  mode: 'process' | 'folder'
  restoreOnExit: boolean
  watchFolders: string[]
  pollTimer: ReturnType<typeof setInterval> | null
  polling: boolean
  closed: boolean
}

const sameFolder = (a: string, b: string): boolean =>
  a.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === b.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

function translateSpawnError(error: unknown): LaunchResult {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  const message = error instanceof Error ? error.message : String(error)
  if (code === 'EACCES' || code === 'EPERM' || /elevation|740/i.test(message)) {
    return {
      ok: false,
      reason: 'needs-admin',
      message:
        'Windows blocked starting this executable because it asks for administrator permissions. Run it from Explorer if you trust it, or pick the main game executable in Edit game.'
    }
  }
  if (code === 'ENOENT') {
    return {
      ok: false,
      reason: 'missing-executable',
      message: 'VNStation could not find this game’s executable. It may have been moved or deleted.'
    }
  }
  return {
    ok: false,
    reason: 'failed',
    message: 'Windows could not start this executable. Check the executable path and working directory in Edit game.'
  }
}

export class ProcessGameLauncher implements GameLauncher {
  private readonly store: LibraryStore
  private readonly spawnProcess: ProcessSpawner
  private readonly probeFolder: FolderProbe
  private readonly revealInFolder?: (executablePath: string, workingDirectory: string) => Promise<boolean> | boolean
  private readonly launchSteamUri?: (steamUri: string, appId: number) => Promise<boolean> | boolean
  private readonly window?: LauncherWindowController
  private readonly now: () => Date
  private readonly folderPollMs: number

  private readonly starting = new Set<string>()
  private readonly active = new Map<string, ActiveSession>()
  private readonly listeners = new Set<(event: LauncherEvent) => void>()

  constructor(options: ProcessGameLauncherOptions) {
    this.store = options.store
    this.spawnProcess = options.spawnProcess ?? defaultSpawner
    this.probeFolder = options.probeFolder ?? (async () => false)
    this.revealInFolder = options.revealInFolder
    this.launchSteamUri = options.launchSteamUri
    this.window = options.window
    this.now = options.now ?? (() => new Date())
    this.folderPollMs = options.folderPollMs ?? 5_000
  }

  async launch(rawGameId: string, options: LaunchOptions): Promise<LaunchResult> {
    const gameId = parseId(rawGameId, 'game')
    const entry = this.store.getEntry(gameId)
    const title = entry.user.title ?? entry.provider.title ?? 'This game'

    if (entry.isSample) {
      return {
        ok: false,
        reason: 'sample',
        message: 'This is a sample game for previewing the interface. Add one of your own games to launch it.'
      }
    }

    if (this.starting.has(gameId) || this.active.has(gameId)) {
      return {
        ok: false,
        reason: 'already-running',
        message: `“${title}” is already running.`
      }
    }

    this.starting.add(gameId)
    try {
      if (isSteamLaunchUri(entry.launch.executablePath)) {
        return await this.launchViaSteam(gameId, entry.launch.executablePath, entry.launch.workingDirectory, options)
      }

      const verifiedExe = await validateExecutable(entry.launch.executablePath).catch(() => null)
      if (!verifiedExe) {
        return {
          ok: false,
          reason: 'missing-executable',
          message: 'VNStation could not find this game’s executable. It may have been moved or deleted.'
        }
      }

      const verifiedDir = await validateDirectory(entry.launch.workingDirectory).catch(() => null)
      if (!verifiedDir) {
        return {
          ok: false,
          reason: 'missing-working-directory',
          message: 'This game’s working directory could not be found. Check its folder path in Edit game.'
        }
      }

      const args = splitArguments(entry.launch.arguments)
      const exeFolder = dirname(verifiedExe.path)
      const watchFolders = sameFolder(exeFolder, verifiedDir) ? [verifiedDir] : [exeFolder, verifiedDir]

      return await this.spawnAndTrack(gameId, verifiedExe.path, verifiedDir, args, watchFolders, options)
    } finally {
      this.starting.delete(gameId)
    }
  }

  private async launchViaSteam(
    gameId: string,
    steamUri: string,
    workingDirectory: string,
    options: LaunchOptions
  ): Promise<LaunchResult> {
    const appId = Number(steamUri.slice('steam://rungameid/'.length))
    if (!this.launchSteamUri || !Number.isInteger(appId) || appId <= 0) {
      return {
        ok: false,
        reason: 'steam-unavailable',
        message: 'Steam launching is not available on this computer. Install the Steam desktop app or pick a local executable in Edit game.'
      }
    }

    let launched = false
    try {
      launched = Boolean(await this.launchSteamUri(steamUri, appId))
    } catch {
      launched = false
    }

    if (!launched) {
      return {
        ok: false,
        reason: 'steam-unavailable',
        message: 'Steam could not start this game. Make sure the Steam desktop app is installed and signed in, or pick a local executable in Edit game.'
      }
    }

    const startedDate = this.now()
    const startedAt = startedDate.toISOString()
    const { sessionId, entry } = this.store.startPlaySession(gameId, startedAt)

    const verifiedDir = workingDirectory ? await validateDirectory(workingDirectory).catch(() => null) : null
    const watchFolders = verifiedDir ? [verifiedDir] : []

    if (options.minimizeOnLaunch) {
      try {
        this.window?.minimize()
      } catch {
        // Best-effort window state change.
      }
    }

    if (watchFolders.length > 0 && (await this.isAnyWatchFolderActive(watchFolders))) {
      const session: ActiveSession = {
        gameId,
        sessionId,
        startedAt,
        startedAtMs: startedDate.getTime(),
        mode: 'folder',
        restoreOnExit: options.restoreOnExit,
        watchFolders,
        pollTimer: null,
        polling: false,
        closed: false
      }
      this.active.set(gameId, session)
      this.emit({
        type: 'started',
        game: { gameId, startedAt, mode: 'folder' },
        entry
      })
      session.pollTimer = setInterval(() => {
        void this.pollFolderSession(session, 0)
      }, this.folderPollMs)
      return { ok: true, startedAt }
    }

    // Steam URI handoff: record the launch session immediately so lastPlayedAt and session history stay accurate.
    const { session: recorded, entry: finishedEntry } = this.store.finishPlaySession(sessionId, startedAt, 0, 'handoff')
    this.emit({
      type: 'started',
      game: { gameId, startedAt, mode: 'process' },
      entry: finishedEntry ?? entry
    })
    this.emit({
      type: 'stopped',
      gameId,
      session: recorded ?? {
        id: sessionId,
        gameId,
        startedAt,
        endedAt: startedAt,
        seconds: 0,
        tracking: 'handoff'
      },
      entry: finishedEntry ?? entry,
      exitCode: 0
    })
    return { ok: true, startedAt }
  }

  async running(): Promise<RunningGame[]> {
    return [...this.active.values()].map((session) => ({
      gameId: session.gameId,
      startedAt: session.startedAt,
      mode: session.mode
    }))
  }

  async history(rawGameId: string, limit = 10): Promise<PlayHistory> {
    return this.store.listPlaySessions(parseId(rawGameId, 'game'), limit)
  }

  async openFolder(rawGameId: string): Promise<boolean> {
    const entry = this.store.getEntry(parseId(rawGameId, 'game'))
    if (entry.isSample || !this.revealInFolder) return false
    const exeExists = await validateExecutable(entry.launch.executablePath).then(() => true, () => false)
    const dirExists = await validateDirectory(entry.launch.workingDirectory).then(() => true, () => false)
    if (!exeExists && !dirExists) return false
    return Boolean(await this.revealInFolder(exeExists ? entry.launch.executablePath : '', dirExists ? entry.launch.workingDirectory : ''))
  }

  subscribe(listener: (event: LauncherEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Called when VNStation is closing. Running games are left untouched so the
   * player never loses unsaved progress, and their play sessions are recorded up
   * to this moment.
   */
  closeAllRunning(): void {
    for (const session of [...this.active.values()]) {
      this.finishSession(session, 'app-closed', null, false)
    }
  }

  private spawnAndTrack(
    gameId: string,
    executablePath: string,
    workingDirectory: string,
    args: string[],
    watchFolders: string[],
    options: LaunchOptions
  ): Promise<LaunchResult> {
    return new Promise<LaunchResult>((resolve) => {
      let settled = false
      let child: SpawnedProcess
      try {
        child = this.spawnProcess(executablePath, args, { cwd: workingDirectory })
      } catch (error) {
        resolve(translateSpawnError(error))
        return
      }

      child.on('error', (error) => {
        if (!settled) {
          settled = true
          resolve(translateSpawnError(error))
          return
        }
        const active = this.active.get(gameId)
        if (active) this.finishSession(active, 'process', null, active.restoreOnExit)
      })

      child.on('spawn', () => {
        if (settled) return
        settled = true
        const startedDate = this.now()
        const startedAt = startedDate.toISOString()
        const { sessionId, entry } = this.store.startPlaySession(gameId, startedAt)

        const session: ActiveSession = {
          gameId,
          sessionId,
          startedAt,
          startedAtMs: startedDate.getTime(),
          mode: 'process',
          restoreOnExit: options.restoreOnExit,
          watchFolders,
          pollTimer: null,
          polling: false,
          closed: false
        }
        this.active.set(gameId, session)

        if (options.minimizeOnLaunch) {
          try {
            this.window?.minimize()
          } catch {
            // Window state changes are best-effort.
          }
        }

        this.emit({
          type: 'started',
          game: { gameId, startedAt, mode: 'process' },
          entry
        })
        resolve({ ok: true, startedAt })
      })

      child.on('exit', (code) => {
        const session = this.active.get(gameId)
        if (!session || session.closed) return
        void this.handleProcessExit(session, code)
      })
    })
  }

  private async handleProcessExit(session: ActiveSession, exitCode: number | null): Promise<void> {
    if (session.closed) return
    const stillRunningInFolder = await this.isAnyWatchFolderActive(session.watchFolders)
    if (session.closed) return

    if (stillRunningInFolder) {
      session.mode = 'folder'
      this.emit({
        type: 'tracking',
        game: { gameId: session.gameId, startedAt: session.startedAt, mode: 'folder' }
      })
      session.pollTimer = setInterval(() => {
        void this.pollFolderSession(session, exitCode)
      }, this.folderPollMs)
      return
    }

    const elapsedSeconds = Math.max(0, Math.round((this.now().getTime() - session.startedAtMs) / 1000))
    const tracking: SessionTracking =
      elapsedSeconds < HANDOFF_SECONDS && (exitCode === 0 || exitCode === null) ? 'handoff' : 'process'
    this.finishSession(session, tracking, exitCode, session.restoreOnExit)
  }

  private async pollFolderSession(session: ActiveSession, exitCode: number | null): Promise<void> {
    if (session.closed || session.polling) return
    session.polling = true
    try {
      const alive = await this.isAnyWatchFolderActive(session.watchFolders)
      if (!session.closed && !alive) {
        this.finishSession(session, 'folder', exitCode, session.restoreOnExit)
      }
    } finally {
      session.polling = false
    }
  }

  private async isAnyWatchFolderActive(folders: readonly string[]): Promise<boolean> {
    for (const folder of folders) {
      try {
        if (await this.probeFolder(folder)) return true
      } catch {
        // Ignore probe failures and fall back to process exit timing.
      }
    }
    return false
  }

  private finishSession(
    session: ActiveSession,
    tracking: SessionTracking,
    exitCode: number | null,
    restoreWindow: boolean
  ): void {
    if (session.closed) return
    session.closed = true
    if (session.pollTimer !== null) {
      clearInterval(session.pollTimer)
      session.pollTimer = null
    }
    this.active.delete(session.gameId)

    const endedDate = this.now()
    const endedAt = endedDate.toISOString()
    const elapsedSeconds = Math.max(0, Math.round((endedDate.getTime() - session.startedAtMs) / 1000))
    const { session: recorded, entry } = this.store.finishPlaySession(session.sessionId, endedAt, elapsedSeconds, tracking)

    if (restoreWindow) {
      try {
        this.window?.restoreAndFocus()
      } catch {
        // Window state changes are best-effort.
      }
    }

    this.emit({
      type: 'stopped',
      gameId: session.gameId,
      session: recorded ?? {
        id: session.sessionId,
        gameId: session.gameId,
        startedAt: session.startedAt,
        endedAt,
        seconds: elapsedSeconds,
        tracking
      },
      entry,
      exitCode
    })
  }

  private emit(event: LauncherEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // One listener failing must never break others.
      }
    }
  }
}
