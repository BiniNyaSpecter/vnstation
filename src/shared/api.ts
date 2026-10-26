import type { GameLauncher, LibraryRepository, MetadataApi, PreferencesRepository, SocialApi, SteamApi } from './contracts'

/** The only API surface the renderer can reach (exposed as `window.vnstation`). */

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  arch: string
  /** Where settings, the library database and the artwork cache live. */
  userDataPath: string
  /** Full path of the library database file. */
  databasePath: string
  isPackaged: boolean
}

export interface PickedExecutable {
  /** Absolute path to the selected file. */
  path: string
  /** Folder containing the file; the default working directory. */
  directory: string
  fileName: string
}

export type PickExecutableResult =
  | { status: 'picked'; file: PickedExecutable }
  | { status: 'canceled' }
  | { status: 'invalid'; message: string }

export type PickFolderResult =
  | { status: 'picked'; path: string }
  | { status: 'canceled' }
  | { status: 'invalid'; message: string }

export interface ScannedExecutable extends PickedExecutable {
  suggestedTitle: string
}

export type ScanFolderResult =
  | { status: 'scanned'; folder: string; candidates: ScannedExecutable[] }
  | { status: 'canceled' }
  | { status: 'invalid'; message: string }

export interface VNStationApi {
  app: {
    getInfo(): Promise<AppInfo>
  }
  dialogs: {
    /** Opens the native file picker and validates the selection in the main process. */
    pickExecutable(): Promise<PickExecutableResult>
    pickFolder(): Promise<PickFolderResult>
    /** Opens a folder picker and scans up to 2 subfolder levels for visual novel executables. */
    scanFolder(): Promise<ScanFolderResult>
  }
  library: LibraryRepository
  metadata: MetadataApi
  steam: SteamApi
  social: SocialApi
  settings: PreferencesRepository
  launcher: GameLauncher
}
