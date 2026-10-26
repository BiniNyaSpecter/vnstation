import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type IpcResult } from '@shared/ipc'
import type { VNStationApi } from '@shared/api'
import type { LauncherEvent } from '@shared/launcher'
import type { SocialEvent } from '@shared/social'

/** Calls one allowlisted channel and unwraps the envelope, turning failures into plain Errors. */
async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  if (!result.ok) throw new Error(result.message)
  return result.value
}

/**
 * The renderer's entire window onto the system. Each function wraps exactly one
 * allowlisted channel; `ipcRenderer` itself is never exposed.
 */
const api: VNStationApi = {
  app: {
    getInfo: () => call(IPC.app.getInfo)
  },
  dialogs: {
    pickExecutable: () => call(IPC.dialogs.pickExecutable),
    pickFolder: () => call(IPC.dialogs.pickFolder),
    scanFolder: () => call(IPC.dialogs.scanFolder)
  },
  library: {
    load: () => call(IPC.library.load),
    addGame: (draft) => call(IPC.library.addGame, draft),
    updateGame: (id, patch) => call(IPC.library.updateGame, id, patch),
    removeGame: (id) => call(IPC.library.removeGame, id),
    createCollection: (input) => call(IPC.library.createCollection, input),
    updateCollection: (id, input) => call(IPC.library.updateCollection, id, input),
    deleteCollection: (id) => call(IPC.library.deleteCollection, id),
    setGameCollections: (gameId, collectionIds) => call(IPC.library.setGameCollections, gameId, collectionIds),
    verifyGame: (id) => call(IPC.library.verifyGame, id),
    addSampleGames: () => call(IPC.library.addSampleGames),
    removeSampleGames: () => call(IPC.library.removeSampleGames)
  },
  metadata: {
    search: (query, options) => call(IPC.metadata.search, query, options),
    apply: (gameId, externalId, options) => call(IPC.metadata.apply, gameId, externalId, options),
    refresh: (gameId, options) => call(IPC.metadata.refresh, gameId, options),
    unlink: (gameId) => call(IPC.metadata.unlink, gameId),
    chooseArtwork: (gameId, kind) => call(IPC.metadata.chooseArtwork, gameId, kind),
    resetArtwork: (gameId, kind) => call(IPC.metadata.resetArtwork, gameId, kind),
    cacheStats: () => call(IPC.metadata.cacheStats),
    clearCache: () => call(IPC.metadata.clearCache),
    getCharacters: (gameId, options) => call(IPC.metadata.getCharacters, gameId, options),
    openExternalVndb: (vndbUrl) => call(IPC.metadata.openExternalVndb, vndbUrl)
  },
  steam: {
    getStatus: () => call(IPC.steam.getStatus),
    connect: (input) => call(IPC.steam.connect, input),
    disconnect: () => call(IPC.steam.disconnect),
    sync: (options) => call(IPC.steam.sync, options),
    listCatalog: () => call(IPC.steam.listCatalog),
    setClassificationOverride: (appId, override, options) =>
      call(IPC.steam.setClassificationOverride, appId, override, options),
    linkCatalogVndb: (appId, externalId, options) =>
      call(IPC.steam.linkCatalogVndb, appId, externalId, options),
    cleanupUnavailable: () => call(IPC.steam.cleanupUnavailable)
  },
  social: {
    getState: () => call(IPC.social.getState),
    register: (input) => call(IPC.social.register, input),
    login: (input) => call(IPC.social.login, input),
    logout: () => call(IPC.social.logout),
    requestPasswordReset: (email) => call(IPC.social.requestPasswordReset, email),
    deleteAccount: () => call(IPC.social.deleteAccount),
    updateProfile: (patch) => call(IPC.social.updateProfile, patch),
    getProfileView: (targetUserId, viewAs) => call(IPC.social.getProfileView, targetUserId, viewAs),
    lookupFriendCode: (code) => call(IPC.social.lookupFriendCode, code),
    sendFriendRequest: (friendCode) => call(IPC.social.sendFriendRequest, friendCode),
    respondFriendRequest: (friendshipId, action) => call(IPC.social.respondFriendRequest, friendshipId, action),
    removeFriend: (friendUserId) => call(IPC.social.removeFriend, friendUserId),
    blockUser: (targetUserId) => call(IPC.social.blockUser, targetUserId),
    unblockUser: (targetUserId) => call(IPC.social.unblockUser, targetUserId),
    openDirectConversation: (friendUserId) => call(IPC.social.openDirectConversation, friendUserId),
    listMessages: (conversationId, options) => call(IPC.social.listMessages, conversationId, options),
    sendMessage: (input) => call(IPC.social.sendMessage, input),
    markConversationRead: (conversationId) => call(IPC.social.markConversationRead, conversationId),
    setConversationMuted: (conversationId, muted) => call(IPC.social.setConversationMuted, conversationId, muted),
    setConversationHidden: (conversationId, hidden) => call(IPC.social.setConversationHidden, conversationId, hidden),
    clearConversationHistory: (conversationId) => call(IPC.social.clearConversationHistory, conversationId),
    reportAbuse: (input) => call(IPC.social.reportAbuse, input),
    configureBackend: (input) => call(IPC.social.configureBackend, input),
    subscribe: (listener) => {
      const handler = (_event: IpcRendererEvent, payload: SocialEvent): void => listener(payload)
      ipcRenderer.on(IPC.social.events, handler)
      return () => {
        ipcRenderer.removeListener(IPC.social.events, handler)
      }
    }
  },
  settings: {
    load: () => call(IPC.settings.load),
    save: (prefs) => call(IPC.settings.save, prefs)
  },
  launcher: {
    launch: (gameId, options) => call(IPC.launcher.launch, gameId, options),
    running: () => call(IPC.launcher.running),
    history: (gameId, limit) => call(IPC.launcher.history, gameId, limit),
    openFolder: (gameId) => call(IPC.launcher.openFolder, gameId),
    subscribe: (listener) => {
      const handler = (_event: IpcRendererEvent, payload: LauncherEvent): void => listener(payload)
      ipcRenderer.on(IPC.launcher.events, handler)
      return () => {
        ipcRenderer.removeListener(IPC.launcher.events, handler)
      }
    }
  }
}

contextBridge.exposeInMainWorld('vnstation', api)
