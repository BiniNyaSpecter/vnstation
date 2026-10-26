import type { AppInfo } from '@shared/api'
import type { ApplyMetadataOptions, CollectionInput, GameEntryPatch, NewGameDraft, VerifyResult } from '@shared/contracts'
import type { LauncherEvent, RunningGame } from '@shared/launcher'
import type { ArtworkKind } from '@shared/metadata'
import type { SocialEvent, SocialSessionState } from '@shared/social'
import type { Collection, Game, GameEntry, Preferences } from '@shared/types'
import { createStore } from '@renderer/lib/store'
import { useStore } from '@renderer/lib/useStore'
import { DEFAULT_PREFS, readLegacyPrefs, sanitizePrefs } from '@renderer/lib/prefs'
import { recentlyPlayed } from '@renderer/lib/query'
import { playSound } from '@renderer/lib/sound'
import { resolveEntries } from '@renderer/lib/resolve'
import { bridge } from '@renderer/services/bridge'
import { services } from '@renderer/services'

export type Route =
  | { name: 'home' }
  | { name: 'library' }
  | { name: 'recent' }
  | { name: 'favorites' }
  | { name: 'collections'; collectionId: string | null }
  | { name: 'friends' }
  | { name: 'messages'; conversationId?: string | null }
  | { name: 'profile'; userId?: string | null }
  | { name: 'settings' }
  | { name: 'details'; gameId: string }

export interface Toast {
  id: number
  message: string
  tone: 'info' | 'success' | 'error'
}

export type DialogState =
  | { type: 'add-game' }
  | { type: 'remove-game'; gameId: string }
  | { type: 'edit-game'; gameId: string }
  | { type: 'match-game'; gameId: string }
  | { type: 'age-gate' }
  | { type: 'game-collections'; gameId: string }
  | { type: 'collection-form'; collectionId: string | null }
  | { type: 'delete-collection'; collectionId: string }
  | null

interface AppState {
  status: 'loading' | 'ready' | 'error'
  entries: GameEntry[]
  games: Game[]
  collections: Collection[]
  route: Route
  history: Route[]
  /** Survives view changes so the same game stays in focus. */
  selectedGameId: string | null
  search: string
  prefs: Preferences
  appInfo: AppInfo | null
  dialog: DialogState
  toast: Toast | null
  launchingId: string | null
  runningGames: Record<string, RunningGame>
  inputMode: 'keyboard' | 'gamepad'
  gamepadName: string | null
  social: SocialSessionState
  activeConversationId: string | null
  draftMessages: Record<string, string>
}

interface AppActions {
  init: () => Promise<void>
  reloadLibrary: () => Promise<void>
  refreshSocial: () => Promise<void>
  setActiveConversation: (conversationId: string | null) => void
  setDraftMessage: (conversationId: string, text: string) => void
  clearSocialCache: () => void
  /** Top-level navigation (rail). Resets the back stack. */
  navigate: (route: Route) => void
  /** Cycles through the top-level categories (LB / RB on a controller, [ / ] on a keyboard). */
  cycleCategory: (step: 1 | -1) => void
  setInputState: (patch: { inputMode?: 'keyboard' | 'gamepad'; gamepadName?: string | null }) => void
  /** Drill-down navigation. Adds to the back stack. */
  push: (route: Route) => void
  goBack: () => void
  openDetails: (gameId: string) => void
  selectGame: (id: string) => void
  setSearch: (search: string) => void
  toggleFavorite: (id: string) => Promise<void>
  updateNotes: (id: string, notes: string) => Promise<void>
  addGame: (draft: NewGameDraft) => Promise<void>
  /** Batch-imports multiple discovered executables from a scanned folder. Returns the count added. */
  addGames: (drafts: NewGameDraft[]) => Promise<number>
  /** Returns true when the change was saved. Errors are shown as a toast. */
  updateGame: (id: string, patch: GameEntryPatch) => Promise<boolean>
  removeGame: (id: string) => Promise<void>
  createCollection: (input: CollectionInput) => Promise<Collection | null>
  updateCollection: (id: string, input: CollectionInput) => Promise<boolean>
  deleteCollection: (id: string) => Promise<void>
  setGameCollections: (gameId: string, collectionIds: string[]) => Promise<boolean>
  addSampleGames: () => Promise<void>
  removeSampleGames: () => Promise<void>
  verifyGame: (id: string) => Promise<VerifyResult | null>
  /** Downloads details for a search result and saves them on the game. Returns true on success. */
  applyMetadata: (gameId: string, externalId: string, options: ApplyMetadataOptions) => Promise<boolean>
  refreshMetadata: (gameId: string) => Promise<boolean>
  unlinkMetadata: (gameId: string) => Promise<boolean>
  chooseArtwork: (gameId: string, kind: ArtworkKind) => Promise<void>
  resetArtwork: (gameId: string, kind: ArtworkKind) => Promise<void>
  clearArtworkCache: () => Promise<void>
  launchGame: (id: string) => Promise<void>
  openGameFolder: (id: string) => Promise<void>
  setPref: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void
  /** Changes several preferences at once (one save). */
  updatePrefs: (patch: Partial<Preferences>) => void
  /** The user confirmed they are 18 or older: remember it and switch adults-only entries on. */
  confirmAdult: () => void
  openDialog: (dialog: Exclude<DialogState, null>) => void
  /** Closes the open dialog, but only if it is still of `type`, so a dialog that is closing cannot dismiss the next one. */
  closeDialog: (type?: NonNullable<DialogState>['type']) => void
  showToast: (message: string, tone?: Toast['tone']) => void
  dismissToast: (id: number) => void
}

export type AppStore = AppState & AppActions

const EMPTY_SOCIAL_STATE: SocialSessionState = {
  mode: 'local-sandbox',
  backendInfo: {
    mode: 'local-sandbox',
    supabaseUrl: '',
    hasAnonKey: false,
    enabled: false
  },
  connectionState: 'connected',
  user: null,
  profile: null,
  friends: [],
  blockedUsers: [],
  conversations: [],
  totalUnreadCount: 0
}

let toastSeq = 0
const HOME: Route = { name: 'home' }
const CATEGORY_ROUTES: readonly Route[] = [
  { name: 'home' },
  { name: 'library' },
  { name: 'recent' },
  { name: 'favorites' },
  { name: 'collections', collectionId: null },
  { name: 'friends' },
  { name: 'messages', conversationId: null },
  { name: 'profile', userId: null },
  { name: 'settings' }
]

/** Case- and separator-insensitive, so D:\VN\a.exe and d:/vn/A.EXE count as the same file. */
export const samePath = (a: string, b: string): boolean =>
  a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()

async function loadPreferences(): Promise<Preferences> {
  try {
    const stored = await services.preferences.load()
    if (stored !== null) return sanitizePrefs(stored)
    // First run with the database: carry over anything Milestone 1 kept in localStorage.
    const legacy = readLegacyPrefs()
    const prefs = sanitizePrefs(legacy)
    if (legacy !== null) await services.preferences.save(prefs).catch(() => undefined)
    return prefs
  } catch {
    return DEFAULT_PREFS
  }
}

const firstVisible = (games: Game[]): Game | undefined =>
  recentlyPlayed(games.filter((g) => g.contentRating !== 'restricted'), 1)[0] ??
  games.find((g) => g.contentRating !== 'restricted')

export const appStore = createStore<AppStore>((set, get) => {
  const applyEntries = (entries: GameEntry[]): void => set({ entries, games: resolveEntries(entries) })

  const replaceEntry = (updated: GameEntry): void =>
    applyEntries(get().entries.map((entry) => (entry.id === updated.id ? updated : entry)))

  /** Re-reads everything from the repository (cheap: two queries sets) and repairs the selection. */
  const reload = async (): Promise<void> => {
    const snapshot = await services.library.load()
    applyEntries(snapshot.entries)
    const { games, selectedGameId } = get()
    set({
      collections: snapshot.collections,
      selectedGameId: games.some((g) => g.id === selectedGameId) ? selectedGameId : (firstVisible(games)?.id ?? null)
    })
  }

  const fail = (error: unknown, fallback: string): void =>
    get().showToast(error instanceof Error && error.message ? error.message : fallback, 'error')

  let unsubscribeLauncher: (() => void) | null = null
  let unsubscribeSocial: (() => void) | null = null

  const onSocialEvent = (event: SocialEvent): void => {
    void get().refreshSocial()
    if (event.type === 'message-received') {
      const current = get()
      const conv = current.social?.conversations.find((c) => c.id === event.conversationId)
      const isViewingConv =
        current.route.name === 'messages' && current.activeConversationId === event.conversationId
      if (!isViewingConv && !conv?.muted) {
        const senderName = conv?.participant.displayName ?? 'A friend'
        current.showToast(`New message from ${senderName}`, 'info')
      }
    }
  }

  const onLauncherEvent = (event: LauncherEvent): void => {
    if (event.type === 'started') {
      if (event.entry) replaceEntry(event.entry)
      set((state) => ({ runningGames: { ...state.runningGames, [event.game.gameId]: event.game } }))
    } else if (event.type === 'tracking') {
      set((state) => ({ runningGames: { ...state.runningGames, [event.game.gameId]: event.game } }))
    } else if (event.type === 'stopped') {
      if (event.entry) replaceEntry(event.entry)
      set((state) => {
        const next = { ...state.runningGames }
        delete next[event.gameId]
        return { runningGames: next }
      })
      if (event.session.tracking === 'handoff') {
        get().showToast(
          'The launcher closed after a few seconds. If the game opened in another program (such as Steam), VNStation could only count the launcher time.',
          'info'
        )
      }
    }
  }

  return {
    status: 'loading',
    entries: [],
    games: [],
    collections: [],
    route: HOME,
    history: [HOME],
    selectedGameId: null,
    search: '',
    prefs: DEFAULT_PREFS,
    appInfo: null,
    dialog: null,
    toast: null,
    launchingId: null,
    runningGames: {},
    inputMode: 'keyboard',
    gamepadName: null,
    social: EMPTY_SOCIAL_STATE,
    activeConversationId: null,
    draftMessages: {},

    async init() {
      set({ status: 'loading' })
      unsubscribeLauncher?.()
      unsubscribeLauncher = services.launcher.subscribe(onLauncherEvent)
      unsubscribeSocial?.()
      unsubscribeSocial = services.social.subscribe(onSocialEvent)
      try {
        const [snapshot, appInfo, prefs, runningList, socialState] = await Promise.all([
          services.library.load(),
          bridge ? bridge.app.getInfo().catch(() => null) : Promise.resolve(null),
          loadPreferences(),
          services.launcher.running().catch(() => []),
          services.social.getState().catch(() => EMPTY_SOCIAL_STATE)
        ])
        const games = resolveEntries(snapshot.entries)
        const runningGames: Record<string, RunningGame> = {}
        for (const item of runningList) runningGames[item.gameId] = item
        set({
          status: 'ready',
          entries: snapshot.entries,
          games,
          collections: snapshot.collections,
          appInfo,
          prefs,
          runningGames,
          social: socialState,
          selectedGameId: firstVisible(games)?.id ?? null
        })
      } catch {
        set({ status: 'error' })
      }
    },

    async reloadLibrary() {
      try {
        await reload()
      } catch (error) {
        fail(error, 'Could not refresh the library.')
      }
    },

    async refreshSocial() {
      try {
        const prevUserId = get().social?.user?.id ?? null
        const next = await services.social.getState()
        const nextUserId = next.user?.id ?? null
        if (prevUserId !== nextUserId) {
          // Account changed or signed out: wipe cached conversation state immediately.
          set({ social: next, activeConversationId: null, draftMessages: {} })
        } else {
          set({ social: next })
        }
      } catch {
        // Keep existing state if social service is temporarily unreachable
      }
    },

    setActiveConversation(conversationId) {
      set({ activeConversationId: conversationId })
    },

    setDraftMessage(conversationId, text) {
      set((state) => ({
        draftMessages: { ...state.draftMessages, [conversationId]: text }
      }))
    },

    clearSocialCache() {
      set({ activeConversationId: null, draftMessages: {} })
    },

    navigate(route) {
      playSound('select')
      set({ route, history: [route] })
    },

    cycleCategory(step) {
      const currentName = get().history[0]?.name ?? 'home'
      const index = Math.max(0, CATEGORY_ROUTES.findIndex((r) => r.name === currentName))
      const next = CATEGORY_ROUTES[(index + step + CATEGORY_ROUTES.length) % CATEGORY_ROUTES.length]
      get().navigate(next)
    },

    setInputState(patch) {
      const state = get()
      const inputMode = patch.inputMode ?? state.inputMode
      const gamepadName = patch.gamepadName !== undefined ? patch.gamepadName : state.gamepadName
      if (inputMode !== state.inputMode || gamepadName !== state.gamepadName) {
        set({ inputMode, gamepadName })
      }
    },

    push(route) {
      set((state) => ({ route, history: [...state.history, route] }))
    },

    goBack() {
      const { history } = get()
      if (history.length < 2) return
      playSound('back')
      const next = history.slice(0, -1)
      set({ history: next, route: next[next.length - 1] })
    },

    openDetails(gameId) {
      playSound('select')
      get().push({ name: 'details', gameId })
      set({ selectedGameId: gameId })
    },

    selectGame(id) {
      if (get().selectedGameId !== id) set({ selectedGameId: id })
    },

    setSearch(search) {
      set({ search })
      // Searching always happens in the library, wherever the user started typing.
      const { route } = get()
      if (search && route.name !== 'library' && route.name !== 'favorites' && route.name !== 'recent') {
        get().navigate({ name: 'library' })
      }
    },

    async toggleFavorite(id) {
      const game = get().games.find((g) => g.id === id)
      if (!game) return
      try {
        replaceEntry(await services.library.updateGame(id, { favorite: !game.favorite }))
      } catch (error) {
        fail(error, 'Could not update favorites.')
      }
    },

    async updateNotes(id, notes) {
      try {
        replaceEntry(await services.library.updateGame(id, { user: { notes } }))
      } catch (error) {
        fail(error, 'Could not save your notes.')
      }
    },

    async updateGame(id, patch) {
      try {
        replaceEntry(await services.library.updateGame(id, patch))
        return true
      } catch (error) {
        fail(error, 'Could not save your changes.')
        return false
      }
    },

    async addGame(draft) {
      const existing = get().games.find((g) => samePath(g.launch.executablePath, draft.launch.executablePath))
      if (existing) {
        // Same file twice is almost always a mistake; take the user to the existing entry instead.
        set({ dialog: null, selectedGameId: existing.id })
        get().showToast(`That file is already in your library as “${existing.title}”.`, 'info')
        return
      }
      try {
        const entry = await services.library.addGame(draft)
        applyEntries([entry, ...get().entries])
        // The game is saved and playable already; matching details is the optional next step.
        set({ selectedGameId: entry.id, dialog: get().prefs.metadataEnabled ? { type: 'match-game', gameId: entry.id } : null })
        get().navigate({ name: 'library' })
        get().showToast(`Added “${draft.title.trim()}” to your library.`, 'success')
      } catch (error) {
        fail(error, 'Could not add that game.')
      }
    },

    async addGames(drafts) {
      const added: GameEntry[] = []
      for (const draft of drafts) {
        const exists =
          get().games.some((g) => samePath(g.launch.executablePath, draft.launch.executablePath)) ||
          added.some((e) => samePath(e.launch.executablePath, draft.launch.executablePath))
        if (exists) continue
        try {
          const entry = await services.library.addGame(draft)
          added.push(entry)
        } catch {
          // Continue importing remaining valid entries.
        }
      }
      if (added.length === 0) {
        get().showToast('No new games were added.', 'info')
        return 0
      }
      applyEntries([...added.reverse(), ...get().entries])
      const first = added[0]
      if (added.length === 1) {
        set({
          selectedGameId: first.id,
          dialog: get().prefs.metadataEnabled ? { type: 'match-game', gameId: first.id } : null
        })
        get().navigate({ name: 'library' })
        get().showToast(`Added “${first.user.title ?? 'game'}” to your library.`, 'success')
      } else {
        set({ selectedGameId: first.id, dialog: null })
        get().navigate({ name: 'library' })
        get().showToast(`Imported ${added.length} games into your library.`, 'success')
      }
      return added.length
    },

    async removeGame(id) {
      try {
        const onItsDetails = get().route.name === 'details' && (get().route as { gameId: string }).gameId === id
        await services.library.removeGame(id)
        set({ dialog: null })
        await reload()
        if (onItsDetails) get().navigate({ name: 'library' })
        get().showToast('Removed from your library. The game files were not touched.', 'success')
      } catch (error) {
        fail(error, 'Could not remove that game.')
      }
    },

    async createCollection(input) {
      try {
        const collection = await services.library.createCollection(input)
        await reload()
        return collection
      } catch (error) {
        fail(error, 'Could not create the collection.')
        return null
      }
    },

    async updateCollection(id, input) {
      try {
        await services.library.updateCollection(id, input)
        await reload()
        return true
      } catch (error) {
        fail(error, 'Could not save the collection.')
        return false
      }
    },

    async deleteCollection(id) {
      try {
        await services.library.deleteCollection(id)
        set({ dialog: null })
        await reload()
        const { route } = get()
        if (route.name === 'collections' && route.collectionId === id) get().navigate({ name: 'collections', collectionId: null })
        get().showToast('Collection deleted. Its games are still in your library.', 'success')
      } catch (error) {
        fail(error, 'Could not delete the collection.')
      }
    },

    async setGameCollections(gameId, collectionIds) {
      try {
        await services.library.setGameCollections(gameId, collectionIds)
        await reload()
        return true
      } catch (error) {
        fail(error, 'Could not update the collections.')
        return false
      }
    },

    async addSampleGames() {
      try {
        await services.library.addSampleGames()
        await reload()
        get().showToast('Sample games added. They are invented, for previewing the interface.', 'info')
      } catch (error) {
        fail(error, 'Could not add the sample games.')
      }
    },

    async removeSampleGames() {
      try {
        await services.library.removeSampleGames()
        await reload()
        get().showToast('Sample games removed.', 'success')
      } catch (error) {
        fail(error, 'Could not remove the sample games.')
      }
    },

    async verifyGame(id) {
      try {
        return await services.library.verifyGame(id)
      } catch {
        return null
      }
    },

    async applyMetadata(gameId, externalId, options) {
      try {
        replaceEntry(await services.metadata.apply(gameId, externalId, options))
        get().showToast('Details and artwork saved.', 'success')
        return true
      } catch (error) {
        fail(error, 'Could not download the details.')
        return false
      }
    },

    async refreshMetadata(gameId) {
      try {
        replaceEntry(await services.metadata.refresh(gameId, { allowAdult: get().prefs.showRestricted }))
        get().showToast('Details refreshed.', 'success')
        return true
      } catch (error) {
        fail(error, 'Could not refresh the details.')
        return false
      }
    },

    async unlinkMetadata(gameId) {
      try {
        replaceEntry(await services.metadata.unlink(gameId))
        get().showToast('Downloaded details removed. Your own edits are kept.', 'success')
        return true
      } catch (error) {
        fail(error, 'Could not remove the details.')
        return false
      }
    },

    async chooseArtwork(gameId, kind) {
      try {
        const entry = await services.metadata.chooseArtwork(gameId, kind)
        if (entry) {
          replaceEntry(entry)
          get().showToast(kind === 'cover' ? 'Cover updated.' : 'Background updated.', 'success')
        }
      } catch (error) {
        fail(error, 'Could not use that image.')
      }
    },

    async resetArtwork(gameId, kind) {
      try {
        replaceEntry(await services.metadata.resetArtwork(gameId, kind))
      } catch (error) {
        fail(error, 'Could not reset the artwork.')
      }
    },

    async clearArtworkCache() {
      try {
        await services.metadata.clearCache()
        await reload()
        get().showToast('Downloaded artwork cleared. Use “Refresh details” on a game to download it again.', 'success')
      } catch (error) {
        fail(error, 'Could not clear the artwork cache.')
      }
    },

    async launchGame(id) {
      // Ignore rapid repeated clicks while a launch is in flight or the game is already running.
      if (get().launchingId || get().runningGames[id]) return
      set({ launchingId: id })
      try {
        const { minimizeOnLaunch, restoreOnExit } = get().prefs
        const result = await services.launcher.launch(id, { minimizeOnLaunch, restoreOnExit })
        if (result.ok) {
          playSound('open')
          set((state) => ({
            runningGames: state.runningGames[id]
              ? state.runningGames
              : { ...state.runningGames, [id]: { gameId: id, startedAt: result.startedAt, mode: 'process' } }
          }))
        } else {
          const tone = result.reason === 'unavailable' || result.reason === 'sample' || result.reason === 'already-running' ? 'info' : 'error'
          get().showToast(result.message, tone)
        }
      } catch (error) {
        fail(error, 'The game could not be started.')
      } finally {
        set({ launchingId: null })
      }
    },

    async openGameFolder(id) {
      const game = get().games.find((g) => g.id === id)
      if (!game) return
      if (game.isSample) {
        get().showToast('Sample games do not have an installation folder on disk.', 'info')
        return
      }
      try {
        const ok = await services.launcher.openFolder(id)
        if (!ok) get().showToast('Could not open this game’s folder. Check its path in Edit game.', 'error')
      } catch (error) {
        fail(error, 'Could not open this game’s folder.')
      }
    },

    setPref(key, value) {
      get().updatePrefs({ [key]: value } as Partial<Preferences>)
    },

    updatePrefs(patch) {
      const prefs = { ...get().prefs, ...patch }
      // Adults-only entries can never be visible without the age confirmation.
      if (!prefs.adultConfirmed) prefs.showRestricted = false
      set({ prefs })
      services.preferences.save(prefs).catch(() => get().showToast('Could not save your settings.', 'error'))
    },

    confirmAdult() {
      get().updatePrefs({ adultConfirmed: true, showRestricted: true })
      set({ dialog: get().dialog?.type === 'age-gate' ? null : get().dialog })
      get().showToast('Adults-only (18+) games are now shown. Turn this off any time in Settings.', 'info')
    },

    openDialog(dialog) {
      set({ dialog })
    },

    closeDialog(type) {
      const open = get().dialog
      if (open && (type === undefined || open.type === type)) set({ dialog: null })
    },

    showToast(message, tone = 'info') {
      if (tone === 'error') playSound('error')
      else if (tone === 'success') playSound('success')
      set({ toast: { id: ++toastSeq, message, tone } })
    },

    dismissToast(id) {
      if (get().toast?.id === id) set({ toast: null })
    }
  }
})

export const useAppStore = <U,>(selector: (state: AppStore) => U): U => useStore(appStore, selector)
