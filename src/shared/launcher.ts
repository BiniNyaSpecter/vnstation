import type { GameEntry } from './types'

/**
 * Launching games and tracking play sessions. Shared by the main process (which
 * starts processes and owns the database) and the renderer (which only asks).
 */

/** Window behaviour chosen in Settings, sent with each launch request. */
export interface LaunchOptions {
  /** Minimize VNStation once the game has started. */
  minimizeOnLaunch: boolean
  /** Bring VNStation back to the front when the game closes. */
  restoreOnExit: boolean
}

export type LaunchFailureReason =
  /** No launcher in this environment (the plain-browser design preview). */
  | 'unavailable'
  /** Development sample entries point at files that do not exist. */
  | 'sample'
  | 'already-running'
  | 'missing-executable'
  | 'missing-working-directory'
  /** Steam client is not available on this computer when launching a Steam entry. */
  | 'steam-unavailable'
  /** Windows refused to start the file: usually it asks for administrator rights. */
  | 'needs-admin'
  | 'failed'

export type LaunchResult =
  | { ok: true; startedAt: string }
  | { ok: false; reason: LaunchFailureReason; message: string }

/**
 * How a session's length was measured.
 * - `process`: the started program ran until it closed.
 * - `folder`: the started program closed, but another program from the game's own folder
 *   (a restart, or the real game behind a launcher) kept running and was followed until it closed.
 * - `handoff`: the started program closed within seconds and nothing from the game's folder
 *   kept running, so it probably handed over to something VNStation cannot see. Only the short
 *   time is known.
 * - `app-closed`: VNStation was closed while the game was running; counted until then.
 * - `interrupted`: VNStation stopped unexpectedly. The length is unknown and not counted.
 */
export type SessionTracking = 'process' | 'folder' | 'handoff' | 'app-closed' | 'interrupted'

export interface PlaySession {
  id: number
  gameId: string
  startedAt: string
  /** Null while the session is still running. */
  endedAt: string | null
  /** Counted seconds (0 for interrupted sessions). */
  seconds: number
  tracking: SessionTracking | null
}

export interface PlayHistory {
  /** Most recent first. */
  sessions: PlaySession[]
  totalSessions: number
}

export interface RunningGame {
  gameId: string
  startedAt: string
  /** `folder` once the started program has closed and VNStation follows the game's folder instead. */
  mode: 'process' | 'folder'
}

export type LauncherEvent =
  | { type: 'started'; game: RunningGame; entry: GameEntry | null }
  | { type: 'tracking'; game: RunningGame }
  | {
      type: 'stopped'
      gameId: string
      session: PlaySession
      /** The updated library entry (playtime, last played), or null if it was removed meanwhile. */
      entry: GameEntry | null
      /** Exit code of the started program, when Windows reported one. */
      exitCode: number | null
    }

/** Sessions shorter than this, with nothing left running, count as a hand-off to another program. */
export const HANDOFF_SECONDS = 10
