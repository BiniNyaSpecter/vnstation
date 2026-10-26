import type { SocialApi, SocialSessionState } from '@shared/social'

const emptyState: SocialSessionState = {
  mode: 'local-sandbox',
  backendInfo: {
    mode: 'local-sandbox',
    supabaseUrl: '',
    hasAnonKey: false,
    enabled: false
  },
  connectionState: 'offline',
  user: null,
  profile: null,
  friends: [],
  blockedUsers: [],
  conversations: [],
  totalUnreadCount: 0
}

const rejectUnavailable = (): Promise<never> =>
  Promise.reject(new Error('Social accounts and messaging require the VNStation desktop application.'))

export const unavailableSocial: SocialApi = {
  getState: async () => emptyState,
  register: rejectUnavailable,
  login: rejectUnavailable,
  logout: async () => emptyState,
  requestPasswordReset: rejectUnavailable,
  deleteAccount: rejectUnavailable,
  updateProfile: rejectUnavailable,
  getProfileView: rejectUnavailable,
  lookupFriendCode: rejectUnavailable,
  sendFriendRequest: rejectUnavailable,
  respondFriendRequest: rejectUnavailable,
  removeFriend: rejectUnavailable,
  blockUser: rejectUnavailable,
  unblockUser: rejectUnavailable,
  openDirectConversation: rejectUnavailable,
  listMessages: rejectUnavailable,
  sendMessage: rejectUnavailable,
  markConversationRead: rejectUnavailable,
  setConversationMuted: rejectUnavailable,
  setConversationHidden: rejectUnavailable,
  clearConversationHistory: rejectUnavailable,
  reportAbuse: rejectUnavailable,
  configureBackend: rejectUnavailable,
  subscribe: () => () => undefined
}
