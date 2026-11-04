import type { GameLauncher, LibraryRepository, MetadataApi, PreferencesRepository, SocialApi, SteamApi } from '@shared/contracts'
import { createSampleSnapshot } from '@shared/sampleLibrary'
import {
  DEFAULT_SUPABASE_ANON_KEY,
  DEFAULT_SUPABASE_URL,
  type ResetPasswordInput,
  type SocialSessionState
} from '@shared/social'
import { LocalStoragePreferences } from '@renderer/lib/prefs'
import { bridge } from './bridge'
import { InMemoryLibraryRepository } from './inMemoryLibraryRepository'
import { StubGameLauncher } from './stubGameLauncher'
import { unavailableMetadata } from './unavailableMetadata'
import { unavailableSocial } from './unavailableSocial'
import { unavailableSteam } from './unavailableSteam'

async function fallbackResetPasswordViaCloud(
  socialBridge: SocialApi,
  input: ResetPasswordInput
): Promise<SocialSessionState> {
  const cleanEmail = (input.email ?? '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new Error('Please enter a valid email address.')
  }
  const newPassword = input.newPassword ?? ''
  if (newPassword.length < 8 || newPassword.length > 128) {
    throw new Error('Password must be between 8 and 128 characters.')
  }

  const currentState = await socialBridge.getState().catch(() => null)
  const supabaseUrl = (
    currentState?.backendInfo?.supabaseUrl || DEFAULT_SUPABASE_URL
  ).replace(/\/+$/, '')
  const anonKey = DEFAULT_SUPABASE_ANON_KEY

  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/reset_account_password`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      p_email: cleanEmail,
      p_new_password: newPassword,
      p_verification: input.verification?.trim() || null
    })
  })

  if (!res.ok) {
    const errData = (await res.json().catch(() => ({}))) as Record<string, unknown>
    const msg =
      (errData.message as string) ||
      (errData.details as string) ||
      'Could not reset password.'
    throw new Error(msg)
  }

  return socialBridge.login({ email: cleanEmail, password: newPassword })
}

function createResilientSocialService(socialBridge: SocialApi): SocialApi {
  return {
    ...socialBridge,
    getState: () => socialBridge.getState(),
    register: (input) => socialBridge.register(input),
    login: (input) => socialBridge.login(input),
    logout: () => socialBridge.logout(),
    requestPasswordReset: (email) => socialBridge.requestPasswordReset(email),
    resetPassword: async (input) => {
      if (typeof socialBridge.resetPassword === 'function') {
        try {
          return await socialBridge.resetPassword(input)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (
            !msg.includes('No handler registered') &&
            !msg.includes('is not a function')
          ) {
            throw err
          }
        }
      }
      return fallbackResetPasswordViaCloud(socialBridge, input)
    },
    deleteAccount: () => socialBridge.deleteAccount(),
    updateProfile: (patch) => socialBridge.updateProfile(patch),
    getProfileView: (targetUserId, viewAs) =>
      socialBridge.getProfileView(targetUserId, viewAs),
    lookupFriendCode: (code) => socialBridge.lookupFriendCode(code),
    sendFriendRequest: (friendCode) => socialBridge.sendFriendRequest(friendCode),
    respondFriendRequest: (friendshipId, action) =>
      socialBridge.respondFriendRequest(friendshipId, action),
    removeFriend: (friendUserId) => socialBridge.removeFriend(friendUserId),
    blockUser: (targetUserId) => socialBridge.blockUser(targetUserId),
    unblockUser: (targetUserId) => socialBridge.unblockUser(targetUserId),
    openDirectConversation: (friendUserId) =>
      socialBridge.openDirectConversation(friendUserId),
    listMessages: (conversationId, options) =>
      socialBridge.listMessages(conversationId, options),
    sendMessage: (input) => socialBridge.sendMessage(input),
    markConversationRead: (conversationId) =>
      socialBridge.markConversationRead(conversationId),
    setConversationMuted: (conversationId, muted) =>
      socialBridge.setConversationMuted(conversationId, muted),
    setConversationHidden: (conversationId, hidden) =>
      socialBridge.setConversationHidden(conversationId, hidden),
    clearConversationHistory: (conversationId) =>
      socialBridge.clearConversationHistory(conversationId),
    reportAbuse: (input) => socialBridge.reportAbuse(input),
    configureBackend: (input) => socialBridge.configureBackend(input),
    subscribe: (listener) => socialBridge.subscribe(listener)
  }
}

/**
 * Composition root for side-effectful services. In Electron the library, metadata,
 * launcher and settings are backed by the main process over IPC; in a plain browser
 * they fall back to in-memory sample data so the interface can still be developed.
 */
export const services: {
  library: LibraryRepository
  metadata: MetadataApi
  steam: SteamApi
  social: SocialApi
  launcher: GameLauncher
  preferences: PreferencesRepository
} = bridge
  ? {
      library: bridge.library,
      metadata: bridge.metadata,
      steam: bridge.steam,
      social: createResilientSocialService(bridge.social),
      launcher: bridge.launcher,
      preferences: bridge.settings
    }
  : {
      library: new InMemoryLibraryRepository(createSampleSnapshot()),
      metadata: unavailableMetadata,
      steam: unavailableSteam,
      social: unavailableSocial,
      launcher: new StubGameLauncher(),
      preferences: new LocalStoragePreferences()
    }
