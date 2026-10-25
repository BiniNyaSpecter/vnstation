import type { IpcResult } from '@shared/ipc'
import { UserFacingError } from './errors'

/**
 * Runs a handler and wraps the outcome in the IPC envelope. Messages from
 * UserFacingError pass through; anything unexpected is logged here (main-process
 * console only) and replaced with a generic message so internals and file paths
 * never leak into the UI.
 */
export async function toResult<T>(fn: () => T | Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, value: await fn() }
  } catch (error) {
    if (error instanceof UserFacingError) return { ok: false, message: error.message }
    console.error('[ipc] unexpected error:', error instanceof Error ? error.message : error)
    return { ok: false, message: 'Something went wrong. Please try again.' }
  }
}
