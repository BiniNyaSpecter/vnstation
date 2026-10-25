import { execFile } from 'node:child_process'
import { isAbsolute } from 'node:path'

/**
 * Checks whether any running process was started from inside `folderPath`.
 * Used when a visual novel's initial executable is a launcher or wrapper that
 * starts the real game from the same installation folder and then exits.
 */
export type FolderProbe = (folderPath: string) => Promise<boolean>

const PROBE_SCRIPT = [
  "$dir = $env:VNSTATION_WATCH_DIR",
  "if (-not $dir) { exit 1 }",
  "$root = [IO.Path]::GetFullPath($dir).TrimEnd('\\', '/') + '\\'",
  "$found = Get-Process -ErrorAction SilentlyContinue | Where-Object {",
  "  $_.Path -and [IO.Path]::GetFullPath($_.Path).StartsWith($root, [StringComparison]::OrdinalIgnoreCase)",
  "} | Select-Object -First 1",
  "if ($found) { exit 0 } else { exit 1 }"
].join('\n')

/**
 * Windows implementation of `FolderProbe`. Passes the folder path through an
 * environment variable to a fixed script with `shell: false`, so user-controlled
 * paths are never interpolated into a command string.
 */
export const probeWindowsFolderActivity: FolderProbe = (folderPath: string): Promise<boolean> => {
  if (process.platform !== 'win32' || !folderPath || folderPath.includes('\0') || !isAbsolute(folderPath)) {
    return Promise.resolve(false)
  }
  return new Promise<boolean>((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', PROBE_SCRIPT],
      {
        env: { ...process.env, VNSTATION_WATCH_DIR: folderPath },
        windowsHide: true,
        timeout: 4_000
      },
      (error) => resolve(error === null)
    )
  })
}
