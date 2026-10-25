import type { GameLauncher, LaunchResult } from '@shared/contracts'
import type { PlayHistory, RunningGame } from '@shared/launcher'

/**
 * Plain-browser fallback when the UI is opened outside Electron (for design work)
 * and the default in-memory launcher for store tests that do not supply their own.
 */
export class StubGameLauncher implements GameLauncher {
  async launch(): Promise<LaunchResult> {
    return {
      ok: false,
      reason: 'unavailable',
      message: 'Launching games is only available in the desktop app.'
    }
  }

  async running(): Promise<RunningGame[]> {
    return []
  }

  async history(): Promise<PlayHistory> {
    return { sessions: [], totalSessions: 0 }
  }

  async openFolder(): Promise<boolean> {
    return false
  }

  subscribe(): () => void {
    return () => undefined
  }
}
