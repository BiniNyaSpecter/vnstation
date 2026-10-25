import { stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute } from 'node:path'
import type { PickedExecutable } from '@shared/api'
import { UserFacingError } from './errors'

export class InvalidExecutableError extends UserFacingError {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidExecutableError'
  }
}

const MAX_PATH_LENGTH = 32_767

/**
 * Validates a path chosen for a library entry. Never executes the file: it only
 * checks that the path is absolute, is an .exe, and points at an existing file.
 */
export async function validateExecutable(filePath: unknown): Promise<PickedExecutable> {
  if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > MAX_PATH_LENGTH) {
    throw new InvalidExecutableError('No file was selected.')
  }
  if (filePath.includes('\0')) {
    throw new InvalidExecutableError('The selected path is not valid.')
  }
  if (!isAbsolute(filePath)) {
    throw new InvalidExecutableError('The selected path must be absolute.')
  }
  if (extname(filePath).toLowerCase() !== '.exe') {
    throw new InvalidExecutableError('Only .exe files are supported right now.')
  }
  const info = await stat(filePath).catch(() => null)
  if (!info || !info.isFile()) {
    throw new InvalidExecutableError('That file could not be found. It may have been moved or deleted.')
  }
  return { path: filePath, directory: dirname(filePath), fileName: basename(filePath) }
}

/** Validates a folder chosen as a game's working directory. */
export async function validateDirectory(dirPath: unknown): Promise<string> {
  if (typeof dirPath !== 'string' || dirPath.length === 0 || dirPath.length > MAX_PATH_LENGTH) {
    throw new InvalidExecutableError('No folder was selected.')
  }
  if (dirPath.includes('\0') || !isAbsolute(dirPath)) {
    throw new InvalidExecutableError('The folder path is not valid.')
  }
  const info = await stat(dirPath).catch(() => null)
  if (!info || !info.isDirectory()) {
    throw new InvalidExecutableError('That folder could not be found.')
  }
  return dirPath
}

export const pathExists = async (path: string, kind: 'file' | 'directory'): Promise<boolean> => {
  const info = await stat(path).catch(() => null)
  return Boolean(info && (kind === 'file' ? info.isFile() : info.isDirectory()))
}
