import { app, BrowserWindow, dialog, Menu, net, protocol, shell } from 'electron'
import { join } from 'node:path'
import { APP_CONFIG } from '@shared/app-config'
import { IPC } from '@shared/ipc'
import { LibraryStore } from './db/libraryStore'
import { MetadataCache } from './db/metadataCache'
import { openLibraryDatabase } from './db/openLibraryDatabase'
import { SettingsStore } from './db/settingsStore'
import type { Database } from './db/sqlite'
import { registerIpcHandlers } from './ipc'
import { probeWindowsFolderActivity } from './launcher/folderWatcher'
import { ProcessGameLauncher } from './launcher/gameLauncher'
import { LibraryService } from './libraryService'
import { handleArtRequest } from './metadata/artProtocol'
import { ArtworkCache } from './metadata/artworkCache'
import type { Fetcher } from './metadata/http'
import { MetadataService } from './metadata/metadataService'
import { RequestScheduler } from './metadata/scheduler'
import { VndbProvider } from './metadata/vndb'
import { createTrustedUrlGuard, hardenWebContents } from './security'

const isDev = !app.isPackaged
const devServerUrl = isDev ? process.env['ELECTRON_RENDERER_URL'] : undefined
const isTrustedUrl = createTrustedUrlGuard(join(__dirname, '../renderer'), devServerUrl)

app.setName(APP_CONFIG.name)

// Locally cached artwork is served from our own scheme. This must run before the app is ready.
protocol.registerSchemesAsPrivileged([{ scheme: 'vnstation-art', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

let database: Database | null = null
let launcher: ProcessGameLauncher | null = null

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: APP_CONFIG.name,
    backgroundColor: '#0c0e1c',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Renderer isolation: no Node.js, no direct IPC, sandboxed.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      // Interface sounds are played in response to keys and clicks, but the first key press
      // should never be silent because of the browser autoplay rule.
      autoplayPolicy: 'no-user-gesture-required',
      // Keep compositor textures warm when switching windows (Alt+Tab) so artwork never flashes.
      backgroundThrottling: false
    }
  })

  hardenWebContents(window.webContents, isTrustedUrl)
  window.once('ready-to-show', () => window.show())

  // Console-style full-screen toggle.
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      window.setFullScreen(!window.isFullScreen())
      event.preventDefault()
    }
  })

  if (devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return window
}

async function start(): Promise<void> {
  await app.whenReady()
  app.setAppUserModelId(APP_CONFIG.appId)
  if (!isDev) Menu.setApplicationMenu(null)

  const databasePath = join(app.getPath('userData'), 'library.db')
  try {
    database = openLibraryDatabase(databasePath)
  } catch (error) {
    // Never continue with a library we could not open: that would risk overwriting it.
    dialog.showErrorBox(
      `${APP_CONFIG.name} could not open its library`,
      `${error instanceof Error ? error.message : String(error)}\n\nYour library file was not changed:\n${databasePath}`
    )
    app.quit()
    return
  }

  // Metadata: requests go out from this process only, spaced and cached.
  const store = new LibraryStore(database)
  store.closeOrphanSessions()
  const fetcher: Fetcher = (url, init) => net.fetch(url, init)
  const artwork = new ArtworkCache(join(app.getPath('userData'), 'artwork'), fetcher)
  const responseCache = new MetadataCache(database)
  responseCache.prune(30 * 24 * 60 * 60_000)
  const metadata = new MetadataService({
    provider: new VndbProvider(fetcher, new RequestScheduler(), `${APP_CONFIG.name}/${app.getVersion()}`),
    store,
    cache: responseCache,
    art: artwork
  })
  protocol.handle('vnstation-art', (request) => handleArtRequest(artwork, request.url))

  launcher = new ProcessGameLauncher({
    store,
    probeFolder: probeWindowsFolderActivity,
    revealInFolder: async (executablePath, workingDirectory) => {
      if (executablePath) {
        shell.showItemInFolder(executablePath)
        return true
      }
      if (workingDirectory) {
        const err = await shell.openPath(workingDirectory)
        return err === ''
      }
      return false
    },
    window: {
      minimize: () => {
        const [win] = BrowserWindow.getAllWindows()
        if (win && !win.isDestroyed()) win.minimize()
      },
      restoreAndFocus: () => {
        const [win] = BrowserWindow.getAllWindows()
        if (win && !win.isDestroyed()) {
          if (win.isMinimized()) win.restore()
          win.show()
          win.focus()
        }
      }
    }
  })
  launcher.subscribe((event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send(IPC.launcher.events, event)
      }
    }
  })

  registerIpcHandlers({
    isTrustedUrl,
    library: new LibraryService(store),
    settings: new SettingsStore(database),
    metadata,
    launcher,
    databasePath
  })
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [existing] = BrowserWindow.getAllWindows()
    if (existing) {
      if (existing.isMinimized()) existing.restore()
      existing.focus()
    }
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('will-quit', () => {
    launcher?.closeAllRunning()
    launcher = null
    database?.close()
    database = null
  })
  void start()
}
