import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { UserFacingError } from '../errors'
import { pathExists } from '../executables'
import { parseAppManifestAcf, parseLibraryFoldersVdf } from './vdf'

/** Built-in Steam tools/redistributables that are never user games. */
const IGNORED_STEAM_APP_IDS = new Set<number>([
  228980, // Steamworks Common Redistributables
  250820, // SteamVR
  1070560, // Steam Linux Runtime
  1391110, // Steam Linux Runtime - Soldier
  1628350 // Steam Linux Runtime - Sniper
])

export interface DiscoveredLocalSteamApp {
  steamAppId: number
  name: string
  installDir: string | null
  lastPlayedAt: string | null
}

const DEFAULT_STEAM_PATHS = [
  'C:\\Program Files (x86)\\Steam',
  'C:\\Program Files\\Steam',
  'D:\\Steam',
  'E:\\Steam'
]

/** Checks common Windows Steam installation locations and returns the first valid one, or null. */
export function detectLocalSteamPath(candidates: readonly string[] = DEFAULT_STEAM_PATHS): string | null {
  for (const candidate of candidates) {
    try {
      if (
        existsSync(join(candidate, 'steam.exe')) ||
        existsSync(join(candidate, 'steamapps', 'libraryfolders.vdf'))
      ) {
        return resolve(candidate)
      }
    } catch {
      // Ignore inaccessible paths.
    }
  }
  return null
}

/**
 * Scans a local Steam installation directory (and all library folders listed in its
 * `steamapps/libraryfolders.vdf`) for installed `appmanifest_*.acf` entries.
 */
export async function scanLocalSteamInstallation(steamRootPath: string): Promise<DiscoveredLocalSteamApp[]> {
  const root = steamRootPath.trim()
  if (!root || !(await pathExists(root, 'directory'))) {
    throw new UserFacingError('That Steam folder could not be found. Choose your main Steam folder (for example C:\\Program Files (x86)\\Steam).')
  }

  // Accept either the Steam root (`C:\Program Files (x86)\Steam`) or `steamapps` directly.
  const mainSteamApps = (await pathExists(join(root, 'steamapps'), 'directory'))
    ? join(root, 'steamapps')
    : (await pathExists(join(root, 'libraryfolders.vdf'), 'file'))
      ? root
      : null

  if (!mainSteamApps) {
    throw new UserFacingError('Could not find a “steamapps” folder inside that directory. Choose your Steam installation folder.')
  }

  const librarySteamAppsDirs = new Set<string>([resolve(mainSteamApps)])
  const vdfPath = join(mainSteamApps, 'libraryfolders.vdf')
  if (await pathExists(vdfPath, 'file')) {
    try {
      const vdfContent = await readFile(vdfPath, 'utf8')
      for (const libRoot of parseLibraryFoldersVdf(vdfContent)) {
        const candidateSteamApps = join(libRoot, 'steamapps')
        if (await pathExists(candidateSteamApps, 'directory')) {
          librarySteamAppsDirs.add(resolve(candidateSteamApps))
        }
      }
    } catch {
      // Continue with the primary steamapps folder if libraryfolders.vdf cannot be read.
    }
  }

  const byAppId = new Map<number, DiscoveredLocalSteamApp>()

  for (const steamAppsDir of librarySteamAppsDirs) {
    const entries = await readdir(steamAppsDir).catch(() => [] as string[])
    const manifestFiles = entries.filter((file) => /^appmanifest_\d+\.acf$/i.test(file)).sort()
    for (const file of manifestFiles) {
      try {
        const text = await readFile(join(steamAppsDir, file), 'utf8')
        const parsed = parseAppManifestAcf(text)
        if (!parsed || IGNORED_STEAM_APP_IDS.has(parsed.appId)) continue

        const commonDir = parsed.installDir ? join(steamAppsDir, 'common', parsed.installDir) : null
        const installDir = commonDir && (await pathExists(commonDir, 'directory')) ? resolve(commonDir) : null

        byAppId.set(parsed.appId, {
          steamAppId: parsed.appId,
          name: parsed.name,
          installDir,
          lastPlayedAt: parsed.lastPlayedAt
        })
      } catch {
        // Skip unreadable or malformed manifest files without aborting the rest of the scan.
      }
    }
  }

  return [...byAppId.values()].sort((a, b) => a.name.localeCompare(b.name))
}
