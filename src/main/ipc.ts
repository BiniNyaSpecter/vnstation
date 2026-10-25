import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron'
import { IPC } from '@shared/ipc'
import type { AppInfo, PickExecutableResult, PickFolderResult, ScanFolderResult } from '@shared/api'
import type { GameLauncher, LibraryRepository, PreferencesRepository, SteamApi } from '@shared/contracts'
import { InvalidExecutableError, validateDirectory, validateExecutable } from './executables'
import { scanFolderForExecutables } from './folderScanner'
import { toResult } from './ipcResult'
import type { MetadataService } from './metadata/metadataService'
import {
  parseApplyOptions,
  parseArtworkKind,
  parseCharactersOptions,
  parseClassificationOverride,
  parseExternalId,
  parseHistoryLimit,
  parseId,
  parseLaunchOptions,
  parseRefreshOptions,
  parseSearchOptions,
  parseSteamAppId,
  parseSteamConnectInput,
  parseSteamSyncOptions,
  parseVndbUrl
} from './validation'
import type { UrlGuard } from './security'

export interface IpcDependencies {
  isTrustedUrl: UrlGuard
  library: LibraryRepository
  settings: PreferencesRepository
  metadata: MetadataService
  steam?: SteamApi
  launcher: GameLauncher
  databasePath: string
}

function getAppInfo(databasePath: string): AppInfo {
  return {
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron ?? 'unknown',
    chrome: process.versions.chrome ?? 'unknown',
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    userDataPath: app.getPath('userData'),
    databasePath,
    isPackaged: app.isPackaged
  }
}

async function showOpenDialog(event: IpcMainInvokeEvent, options: OpenDialogOptions): Promise<string | null> {
  const parent = BrowserWindow.fromWebContents(event.sender)
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

async function pickExecutable(event: IpcMainInvokeEvent): Promise<PickExecutableResult> {
  const selected = await showOpenDialog(event, {
    title: 'Choose a visual novel executable',
    properties: ['openFile'],
    filters: [{ name: 'Windows executable', extensions: ['exe'] }]
  })
  if (!selected) return { status: 'canceled' }
  try {
    return { status: 'picked', file: await validateExecutable(selected) }
  } catch (error) {
    if (error instanceof InvalidExecutableError) return { status: 'invalid', message: error.message }
    throw error
  }
}

async function pickFolder(event: IpcMainInvokeEvent): Promise<PickFolderResult> {
  const selected = await showOpenDialog(event, { title: 'Choose a folder', properties: ['openDirectory'] })
  if (!selected) return { status: 'canceled' }
  try {
    return { status: 'picked', path: await validateDirectory(selected) }
  } catch (error) {
    if (error instanceof InvalidExecutableError) return { status: 'invalid', message: error.message }
    throw error
  }
}

async function scanFolder(event: IpcMainInvokeEvent): Promise<ScanFolderResult> {
  const selected = await showOpenDialog(event, {
    title: 'Choose a folder containing your visual novels',
    properties: ['openDirectory']
  })
  if (!selected) return { status: 'canceled' }
  try {
    const { folder, candidates } = await scanFolderForExecutables(selected)
    return { status: 'scanned', folder, candidates }
  } catch (error) {
    if (error instanceof InvalidExecutableError) return { status: 'invalid', message: error.message }
    throw error
  }
}

/** Registers every allowlisted IPC handler. Add new channels to `shared/ipc.ts` first. */
export function registerIpcHandlers({ isTrustedUrl, library, settings, metadata, steam, launcher, databasePath }: IpcDependencies): void {
  /** Registers one channel: checks the sender, runs the handler, returns the envelope. */
  const handle = <Args extends unknown[], R>(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: Args) => R | Promise<R>
  ): void => {
    ipcMain.handle(channel, (event, ...args) =>
      toResult(() => {
        if (!isTrustedUrl(event.senderFrame?.url ?? '')) throw new Error('Blocked an IPC call from an untrusted page.')
        return handler(event, ...(args as Args))
      })
    )
  }

  handle(IPC.app.getInfo, () => getAppInfo(databasePath))
  handle(IPC.dialogs.pickExecutable, (event) => pickExecutable(event))
  handle(IPC.dialogs.pickFolder, (event) => pickFolder(event))
  handle(IPC.dialogs.scanFolder, (event) => scanFolder(event))

  handle(IPC.library.load, () => library.load())
  handle(IPC.library.addGame, (_e, draft: never) => library.addGame(draft))
  handle(IPC.library.updateGame, (_e, id: never, patch: never) => library.updateGame(id, patch))
  handle(IPC.library.removeGame, (_e, id: never) => library.removeGame(id))
  handle(IPC.library.createCollection, (_e, input: never) => library.createCollection(input))
  handle(IPC.library.updateCollection, (_e, id: never, input: never) => library.updateCollection(id, input))
  handle(IPC.library.deleteCollection, (_e, id: never) => library.deleteCollection(id))
  handle(IPC.library.setGameCollections, (_e, gameId: never, ids: never) => library.setGameCollections(gameId, ids))
  handle(IPC.library.verifyGame, (_e, id: never) => library.verifyGame(id))
  handle(IPC.library.addSampleGames, () => library.addSampleGames())
  handle(IPC.library.removeSampleGames, () => library.removeSampleGames())

  handle(IPC.metadata.search, (_e, query: never, options: never) => metadata.search(query, parseSearchOptions(options)))
  handle(IPC.metadata.apply, (_e, gameId: never, externalId: never, options: never) =>
    metadata.apply(parseId(gameId, 'game'), parseExternalId(externalId), parseApplyOptions(options))
  )
  handle(IPC.metadata.refresh, (_e, gameId: never, options: never) => metadata.refresh(parseId(gameId, 'game'), parseRefreshOptions(options)))
  handle(IPC.metadata.unlink, (_e, gameId: never) => metadata.unlink(parseId(gameId, 'game')))
  handle(IPC.metadata.chooseArtwork, async (event, gameId: never, kind: never) => {
    const id = parseId(gameId, 'game')
    const artworkKind = parseArtworkKind(kind)
    const file = await showOpenDialog(event, {
      title: artworkKind === 'cover' ? 'Choose a cover image' : 'Choose a background image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }]
    })
    return file ? metadata.setUserArtwork(id, artworkKind, file) : null
  })
  handle(IPC.metadata.resetArtwork, (_e, gameId: never, kind: never) => metadata.resetArtwork(parseId(gameId, 'game'), parseArtworkKind(kind)))
  handle(IPC.metadata.cacheStats, () => metadata.cacheStats())
  handle(IPC.metadata.clearCache, () => metadata.clearCache())
  handle(IPC.metadata.getCharacters, (_e, gameId: never, options: never) =>
    metadata.getCharacters(parseId(gameId, 'game'), parseCharactersOptions(options))
  )
  handle(IPC.metadata.openExternalVndb, async (_e, vndbUrl: never) => {
    const safeUrl = parseVndbUrl(vndbUrl)
    await shell.openExternal(safeUrl)
    return true
  })

  if (steam) {
    handle(IPC.steam.getStatus, () => steam.getStatus())
    handle(IPC.steam.connect, (_e, input: never) => steam.connect(parseSteamConnectInput(input)))
    handle(IPC.steam.disconnect, () => steam.disconnect())
    handle(IPC.steam.sync, (_e, options: never) => steam.sync(parseSteamSyncOptions(options)))
    handle(IPC.steam.listCatalog, () => steam.listCatalog())
    handle(IPC.steam.setClassificationOverride, (_e, appId: never, override: never, options: never) =>
      steam.setClassificationOverride(parseSteamAppId(appId), parseClassificationOverride(override), parseRefreshOptions(options))
    )
    handle(IPC.steam.linkCatalogVndb, (_e, appId: never, externalId: never, options: never) =>
      steam.linkCatalogVndb(parseSteamAppId(appId), parseExternalId(externalId), parseRefreshOptions(options))
    )
    handle(IPC.steam.cleanupUnavailable, () => steam.cleanupUnavailable())
  }

  handle(IPC.settings.load, () => settings.load())
  handle(IPC.settings.save, (_e, prefs: never) => settings.save(prefs))

  handle(IPC.launcher.launch, (_e, gameId: never, options: never) =>
    launcher.launch(parseId(gameId, 'game'), parseLaunchOptions(options))
  )
  handle(IPC.launcher.running, () => launcher.running())
  handle(IPC.launcher.history, (_e, gameId: never, limit: never) =>
    launcher.history(parseId(gameId, 'game'), parseHistoryLimit(limit))
  )
  handle(IPC.launcher.openFolder, (_e, gameId: never) => launcher.openFolder(parseId(gameId, 'game')))
}
