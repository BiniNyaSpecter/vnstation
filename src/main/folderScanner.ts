import { readdir } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import type { ScannedExecutable } from '@shared/api'
import { suggestTitle } from '@shared/suggestTitle'
import { InvalidExecutableError, validateDirectory } from './executables'

/**
 * Engine runtime, redistributable, and save/asset subdirectories that should never be
 * traversed when looking for top-level game executables inside a user-chosen folder.
 */
const IGNORED_DIRS = new Set([
  'lib',
  'renpy',
  'monobleedingedge',
  'engine',
  'redist',
  '_commonredist',
  'directx',
  'vcredist',
  'support',
  'tools',
  'savedata',
  'saves',
  'screenshots',
  'node_modules',
  '.git',
  '__macosx'
])

/**
 * Helper, installer, crash-reporter, and runtime binaries that commonly live beside
 * visual novel executables but are not the games themselves.
 */
const IGNORED_EXE_PATTERN =
  /^(?:unins\d*|uninstall.*|setup.*|install.*|vc_?redist.*|dxsetup.*|directx.*|unitycrashhandler.*|crashpad_handler.*|crashreporter.*|notification_helper.*|pythonw?(?:\d[\d._-]*)?|zsync(?:make)?|cef_?subprocess.*|updater.*|patcher.*|config(?:uration)?|settings)$/i

export const isFilesystemRoot = (dirPath: string): boolean => {
  const normalized = resolve(dirPath)
  return dirname(normalized) === normalized
}

export const isHelperExecutable = (fileName: string): boolean => {
  const stem = basename(fileName, extname(fileName)).trim()
  return !stem || IGNORED_EXE_PATTERN.test(stem)
}

/**
 * Scans a user-selected directory (up to `maxDepth` subfolder levels) for candidate
 * visual novel `.exe` files. Refuses filesystem roots and skips engine/helper binaries.
 */
export async function scanFolderForExecutables(
  rootInput: unknown,
  maxDepth = 2,
  maxResults = 60
): Promise<{ folder: string; candidates: ScannedExecutable[] }> {
  const folder = await validateDirectory(rootInput)
  if (isFilesystemRoot(folder)) {
    throw new InvalidExecutableError('Choose a specific games folder rather than an entire drive.')
  }

  const results: ScannedExecutable[] = []

  async function walk(currentDir: string, depth: number): Promise<void> {
    if (results.length >= maxResults) return
    const entries = await readdir(currentDir, { withFileTypes: true }).catch(() => [])

    const exeNames: string[] = []
    const subdirs: string[] = []

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      if (entry.isFile() && extname(entry.name).toLowerCase() === '.exe') {
        if (!isHelperExecutable(entry.name)) exeNames.push(entry.name)
      } else if (entry.isDirectory() && depth < maxDepth) {
        if (!IGNORED_DIRS.has(entry.name.toLowerCase())) {
          subdirs.push(entry.name)
        }
      }
    }

    // Ren'Py games ship both `Title.exe` (64-bit) and `Title-32.exe` (32-bit) in the same folder.
    // When the primary `.exe` is present in the same directory, skip the `-32.exe` companion.
    const lowerExeSet = new Set(exeNames.map((name) => name.toLowerCase()))
    const filteredExes = exeNames
      .filter((name) => {
        const match32 = /^(.+)-32\.exe$/i.exec(name)
        if (match32 && lowerExeSet.has(`${match32[1].toLowerCase()}.exe`)) return false
        return true
      })
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))

    for (const fileName of filteredExes) {
      if (results.length >= maxResults) break
      const fullPath = join(currentDir, fileName)
      results.push({
        path: fullPath,
        directory: currentDir,
        fileName,
        suggestedTitle: suggestTitle(fullPath)
      })
    }

    subdirs.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    for (const sub of subdirs) {
      if (results.length >= maxResults) break
      await walk(join(currentDir, sub), depth + 1)
    }
  }

  await walk(folder, 0)
  return { folder, candidates: results }
}
