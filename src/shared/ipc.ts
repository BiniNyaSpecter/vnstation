/**
 * Explicit allowlist of IPC channels. The preload script exposes typed functions
 * built on exactly these channels, and the main process registers a handler for
 * each one. Nothing else is reachable from the renderer.
 */
export const IPC = {
  app: {
    getInfo: 'app:get-info'
  },
  dialogs: {
    pickExecutable: 'dialogs:pick-executable',
    pickFolder: 'dialogs:pick-folder',
    scanFolder: 'dialogs:scan-folder'
  },
  library: {
    load: 'library:load',
    addGame: 'library:add-game',
    updateGame: 'library:update-game',
    removeGame: 'library:remove-game',
    createCollection: 'library:create-collection',
    updateCollection: 'library:update-collection',
    deleteCollection: 'library:delete-collection',
    setGameCollections: 'library:set-game-collections',
    verifyGame: 'library:verify-game',
    addSampleGames: 'library:add-sample-games',
    removeSampleGames: 'library:remove-sample-games'
  },
  metadata: {
    search: 'metadata:search',
    apply: 'metadata:apply',
    refresh: 'metadata:refresh',
    unlink: 'metadata:unlink',
    chooseArtwork: 'metadata:choose-artwork',
    resetArtwork: 'metadata:reset-artwork',
    cacheStats: 'metadata:cache-stats',
    clearCache: 'metadata:clear-cache',
    getCharacters: 'metadata:get-characters',
    openExternalVndb: 'metadata:open-external-vndb'
  },
  steam: {
    getStatus: 'steam:get-status',
    connect: 'steam:connect',
    disconnect: 'steam:disconnect',
    sync: 'steam:sync',
    listCatalog: 'steam:list-catalog',
    setClassificationOverride: 'steam:set-classification-override',
    linkCatalogVndb: 'steam:link-catalog-vndb',
    cleanupUnavailable: 'steam:cleanup-unavailable'
  },
  settings: {
    load: 'settings:load',
    save: 'settings:save'
  },
  launcher: {
    launch: 'launcher:launch',
    running: 'launcher:running',
    history: 'launcher:history',
    openFolder: 'launcher:open-folder',
    /** Main to renderer only: start, tracking and stop events. */
    events: 'launcher:event'
  },
  social: {
    getState: 'social:get-state',
    register: 'social:register',
    login: 'social:login',
    logout: 'social:logout',
    requestPasswordReset: 'social:request-password-reset',
    deleteAccount: 'social:delete-account',
    updateProfile: 'social:update-profile',
    getProfileView: 'social:get-profile-view',
    lookupFriendCode: 'social:lookup-friend-code',
    sendFriendRequest: 'social:send-friend-request',
    respondFriendRequest: 'social:respond-friend-request',
    removeFriend: 'social:remove-friend',
    blockUser: 'social:block-user',
    unblockUser: 'social:unblock-user',
    openDirectConversation: 'social:open-direct-conversation',
    listMessages: 'social:list-messages',
    sendMessage: 'social:send-message',
    markConversationRead: 'social:mark-conversation-read',
    setConversationMuted: 'social:set-conversation-muted',
    setConversationHidden: 'social:set-conversation-hidden',
    clearConversationHistory: 'social:clear-conversation-history',
    reportAbuse: 'social:report-abuse',
    configureBackend: 'social:configure-backend',
    events: 'social:event'
  }
} as const

/** Every handler replies with this envelope so the UI gets readable messages, not stack traces. */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; message: string }
