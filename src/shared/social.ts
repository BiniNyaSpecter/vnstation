/**
 * Milestone 7 — Social Accounts, Custom Profiles, Friend Codes & Private Messaging.
 *
 * Shared contracts, data structures, theme/avatar catalogs, privacy defaults,
 * and strict text/URL sanitization helpers used by both main and renderer.
 */

export type ProfileThemeId =
  | 'midnight-console'
  | 'myspace-cyber-2006'
  | 'sakura-reverie'
  | 'crimson-velvet'
  | 'golden-hour-library'
  | 'dreamcast-ice'

export type ProfileLayoutId = 'myspace-classic' | 'editorial-showcase' | 'compact-console'

export type ProfileVisibility = 'public' | 'friends' | 'private'

export type PresenceState = 'online' | 'away' | 'offline'

export type AvatarPresetId = 'aoko' | 'stella' | 'kurisu' | 'sakura' | 'nocturne' | 'ember'

export interface ProfileThemeDefinition {
  id: ProfileThemeId
  label: string
  tagline: string
  surfaceBg: string
  cardBg: string
  borderColor: string
  defaultAccent: string
  bannerGradient: string
}

export const PROFILE_THEMES: Record<ProfileThemeId, ProfileThemeDefinition> = {
  'midnight-console': {
    id: 'midnight-console',
    label: 'Midnight Console',
    tagline: 'Deep twilight slate with soft periwinkle console glow.',
    surfaceBg: 'rgba(14, 18, 38, 0.88)',
    cardBg: 'rgba(22, 27, 56, 0.76)',
    borderColor: 'rgba(157, 180, 255, 0.22)',
    defaultAccent: '#9db4ff',
    bannerGradient: 'linear-gradient(135deg, rgba(24, 34, 78, 0.95) 0%, rgba(12, 16, 36, 0.92) 60%, rgba(45, 62, 130, 0.75) 100%)'
  },
  'myspace-cyber-2006': {
    id: 'myspace-cyber-2006',
    label: 'MySpace Cyber ’06',
    tagline: 'Classic 2000s personal space with electric cyan borders and retro bulletin energy.',
    surfaceBg: 'rgba(10, 18, 34, 0.9)',
    cardBg: 'rgba(16, 28, 52, 0.82)',
    borderColor: 'rgba(94, 234, 212, 0.32)',
    defaultAccent: '#5eead4',
    bannerGradient: 'linear-gradient(135deg, rgba(13, 48, 74, 0.95) 0%, rgba(16, 24, 48, 0.92) 55%, rgba(20, 92, 118, 0.82) 100%)'
  },
  'sakura-reverie': {
    id: 'sakura-reverie',
    label: 'Sakura Reverie',
    tagline: 'Warm dusk plum and cherry blossom highlights for romance & nakige readers.',
    surfaceBg: 'rgba(32, 18, 38, 0.88)',
    cardBg: 'rgba(46, 26, 54, 0.78)',
    borderColor: 'rgba(242, 160, 189, 0.28)',
    defaultAccent: '#f2a0bd',
    bannerGradient: 'linear-gradient(135deg, rgba(68, 28, 62, 0.94) 0%, rgba(28, 16, 36, 0.92) 60%, rgba(112, 44, 82, 0.78) 100%)'
  },
  'crimson-velvet': {
    id: 'crimson-velvet',
    label: 'Crimson Velvet',
    tagline: 'Gothic manor crimson and candlelit gold for mystery & occult visual novels.',
    surfaceBg: 'rgba(30, 12, 18, 0.9)',
    cardBg: 'rgba(46, 18, 26, 0.8)',
    borderColor: 'rgba(255, 140, 150, 0.28)',
    defaultAccent: '#ff8c96',
    bannerGradient: 'linear-gradient(135deg, rgba(76, 18, 30, 0.95) 0%, rgba(24, 10, 16, 0.94) 60%, rgba(108, 28, 42, 0.8) 100%)'
  },
  'golden-hour-library': {
    id: 'golden-hour-library',
    label: 'Golden Hour Library',
    tagline: 'Amber study lamp warmth with literary serif charm.',
    surfaceBg: 'rgba(30, 22, 14, 0.9)',
    cardBg: 'rgba(44, 32, 20, 0.8)',
    borderColor: 'rgba(243, 194, 126, 0.28)',
    defaultAccent: '#f3c27e',
    bannerGradient: 'linear-gradient(135deg, rgba(72, 48, 22, 0.94) 0%, rgba(26, 18, 12, 0.92) 60%, rgba(104, 68, 28, 0.78) 100%)'
  },
  'dreamcast-ice': {
    id: 'dreamcast-ice',
    label: 'Dreamcast Ice',
    tagline: 'Crisp glacier blue and silver inspired by late-90s visual novel ports.',
    surfaceBg: 'rgba(12, 24, 38, 0.88)',
    cardBg: 'rgba(18, 36, 56, 0.78)',
    borderColor: 'rgba(125, 211, 252, 0.28)',
    defaultAccent: '#7dd3fc',
    bannerGradient: 'linear-gradient(135deg, rgba(18, 52, 84, 0.94) 0%, rgba(10, 20, 34, 0.92) 60%, rgba(32, 84, 128, 0.8) 100%)'
  }
}

export const AVATAR_PRESETS: Record<AvatarPresetId, { label: string; gradient: string; monogram: string }> = {
  aoko: {
    label: 'Blue Magician',
    gradient: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 50%, #0f172a 100%)',
    monogram: '✦'
  },
  stella: {
    label: 'Starlight Observer',
    gradient: 'linear-gradient(135deg, #8b5cf6 0%, #4c1d95 55%, #0f172a 100%)',
    monogram: '☾'
  },
  kurisu: {
    label: 'Worldline Lab',
    gradient: 'linear-gradient(135deg, #ef4444 0%, #991b1b 55%, #1e1b4b 100%)',
    monogram: 'λ'
  },
  sakura: {
    label: 'Spring Petal',
    gradient: 'linear-gradient(135deg, #f472b6 0%, #be185d 55%, #1f122b 100%)',
    monogram: '❀'
  },
  nocturne: {
    label: 'Silver Key',
    gradient: 'linear-gradient(135deg, #2dd4bf 0%, #0f766e 55%, #091526 100%)',
    monogram: '❖'
  },
  ember: {
    label: 'Amber Bookmark',
    gradient: 'linear-gradient(135deg, #f59e0b 0%, #b45309 55%, #1c1917 100%)',
    monogram: '◈'
  }
}

/**
 * Explicitly selected game metadata shared on a user's profile.
 * Never contains local executable paths, working directories, or private user notes.
 */
export interface FeaturedVnEntry {
  vndbId: string | null
  title: string
  developer: string | null
  coverUrl: string | null
  blurb: string
}

export interface FeaturedCharacterEntry {
  characterId: string
  vndbId: string
  name: string
  vnTitle: string
  portraitUrl: string | null
  note: string
}

export interface ProfilePrivacySettings {
  /** Who can view the user's full profile page. Default: 'friends' (privacy-preserving). */
  profileVisibility: ProfileVisibility
  /** Whether online/away status is visible to friends. Default: true. */
  showOnlineStatus: boolean
  /** Whether currently playing VN title is visible to friends. Default: true. */
  showCurrentlyPlaying: boolean
  /** Whether the user's Top Friends list is displayed on their profile. Default: true. */
  showFriendsList: boolean
  /** Who can see featured/favorite visual novels & characters on the profile. Default: 'friends'. */
  featuredVnsVisibility: ProfileVisibility
  /** Whether other users can look up and send a friend request using this user's Friend Code. Default: true. */
  allowFriendRequestsByCode: boolean
}

export const DEFAULT_PRIVACY_SETTINGS: ProfilePrivacySettings = {
  profileVisibility: 'friends',
  showOnlineStatus: true,
  showCurrentlyPlaying: true,
  showFriendsList: true,
  featuredVnsVisibility: 'friends',
  allowFriendRequestsByCode: true
}

export interface ProfileCustomization {
  theme: ProfileThemeId
  layout: ProfileLayoutId
  accentColor: string
  backgroundUrl: string | null
  statusLine: string
  nowListening: string
  featuredVn: FeaturedVnEntry | null
  favoriteVns: FeaturedVnEntry[]
  featuredCharacter: FeaturedCharacterEntry | null
}

export const DEFAULT_PROFILE_CUSTOMIZATION: ProfileCustomization = {
  theme: 'midnight-console',
  layout: 'myspace-classic',
  accentColor: '#9db4ff',
  backgroundUrl: null,
  statusLine: 'Reading visual novels on VNStation',
  nowListening: '',
  featuredVn: null,
  favoriteVns: [],
  featuredCharacter: null
}

export interface UserProfile {
  userId: string
  username: string
  displayName: string
  friendCode: string
  bio: string
  avatarPreset: AvatarPresetId
  avatarUrl: string | null
  presence: PresenceState
  currentlyPlaying: string | null
  customization: ProfileCustomization
  privacy: ProfilePrivacySettings
  createdAt: string
  updatedAt: string
}

export interface PublicFriendSnippet {
  userId: string
  username: string
  displayName: string
  avatarPreset: AvatarPresetId
  avatarUrl: string | null
  presence: PresenceState
}

export interface PublicProfileView {
  userId: string
  username: string
  displayName: string
  /** Friend code is shown to self and accepted friends; hidden from strangers when requests are disabled. */
  friendCode: string | null
  bio: string
  avatarPreset: AvatarPresetId
  avatarUrl: string | null
  presence: PresenceState
  currentlyPlaying: string | null
  customization: ProfileCustomization
  createdAt: string
  viewerRelationship: 'self' | 'friend' | 'stranger'
  /** True when the profile's body is restricted by the owner's privacy settings for this viewer. */
  isRestricted: boolean
  friendsPreview: PublicFriendSnippet[]
}

export type FriendshipStatus = 'pending' | 'accepted' | 'declined' | 'blocked'

export interface FriendshipRecord {
  id: string
  requesterId: string
  recipientId: string
  status: 'pending' | 'accepted'
  direction: 'incoming' | 'outgoing' | 'accepted'
  friend: PublicProfileView
  createdAt: string
  updatedAt: string
  acceptedAt: string | null
}

export interface FriendCodeLookupResult {
  found: boolean
  profile: PublicProfileView | null
  relationship:
    | 'self'
    | 'already-friends'
    | 'pending-outgoing'
    | 'pending-incoming'
    | 'blocked'
    | 'can-request'
    | 'requests-disabled'
    | 'not-found'
  message: string
}

export interface DirectMessage {
  id: string
  conversationId: string
  senderId: string
  clientMessageId: string
  body: string
  createdAt: string
  deliveryStatus: 'sending' | 'delivered' | 'failed'
}

export interface ConversationSummary {
  id: string
  participant: PublicProfileView
  lastMessage: DirectMessage | null
  unreadCount: number
  muted: boolean
  hidden: boolean
  canMessage: boolean
  blockReason: string | null
  updatedAt: string
}

export interface BlockedUserRecord {
  userId: string
  username: string
  displayName: string
  avatarPreset: AvatarPresetId
  createdAt: string
}

export interface RegisterAccountInput {
  email: string
  password: string
  username: string
  displayName: string
  avatarPreset?: AvatarPresetId
}

export interface LoginAccountInput {
  email: string
  password: string
}

export interface ProfilePatchInput {
  displayName?: string
  bio?: string
  avatarPreset?: AvatarPresetId
  avatarUrl?: string | null
  presence?: PresenceState
  currentlyPlaying?: string | null
  customization?: Partial<ProfileCustomization>
  privacy?: Partial<ProfilePrivacySettings>
}

export interface SendMessageInput {
  conversationId: string
  body: string
  clientMessageId?: string
}

export type ReportCategory = 'spam' | 'harassment' | 'inappropriate' | 'impersonation' | 'other'

export interface ReportAbuseInput {
  targetUserId: string
  messageId?: string | null
  category: ReportCategory
  details: string
}

export interface SupabaseConfigInput {
  url: string
  anonKey: string
  enabled: boolean
}

export interface SocialBackendInfo {
  mode: 'supabase' | 'local-sandbox'
  supabaseUrl: string
  hasAnonKey: boolean
  enabled: boolean
}

export interface SocialSessionState {
  mode: 'supabase' | 'local-sandbox'
  backendInfo: SocialBackendInfo
  connectionState: 'connected' | 'offline' | 'reconnecting'
  user: {
    id: string
    email: string
    emailVerified: boolean
  } | null
  profile: UserProfile | null
  friends: FriendshipRecord[]
  blockedUsers: BlockedUserRecord[]
  conversations: ConversationSummary[]
  totalUnreadCount: number
}

export type SocialEvent =
  | { type: 'state-changed' }
  | { type: 'message-received'; conversationId: string; message: DirectMessage }

export interface SocialApi {
  getState(): Promise<SocialSessionState>
  register(input: RegisterAccountInput): Promise<SocialSessionState>
  login(input: LoginAccountInput): Promise<SocialSessionState>
  logout(): Promise<SocialSessionState>
  requestPasswordReset(email: string): Promise<{ message: string }>
  deleteAccount(): Promise<SocialSessionState>
  updateProfile(patch: ProfilePatchInput): Promise<UserProfile>
  getProfileView(targetUserId: string, viewAs?: 'self' | 'friend' | 'stranger'): Promise<PublicProfileView>
  lookupFriendCode(code: string): Promise<FriendCodeLookupResult>
  sendFriendRequest(friendCode: string): Promise<FriendshipRecord>
  respondFriendRequest(friendshipId: string, action: 'accept' | 'decline' | 'cancel'): Promise<void>
  removeFriend(friendUserId: string): Promise<void>
  blockUser(targetUserId: string): Promise<void>
  unblockUser(targetUserId: string): Promise<void>
  openDirectConversation(friendUserId: string): Promise<ConversationSummary>
  listMessages(conversationId: string, options?: { limit?: number; before?: string }): Promise<DirectMessage[]>
  sendMessage(input: SendMessageInput): Promise<DirectMessage>
  markConversationRead(conversationId: string): Promise<void>
  setConversationMuted(conversationId: string, muted: boolean): Promise<void>
  setConversationHidden(conversationId: string, hidden: boolean): Promise<void>
  clearConversationHistory(conversationId: string): Promise<void>
  reportAbuse(input: ReportAbuseInput): Promise<{ reportId: string }>
  configureBackend(input: SupabaseConfigInput): Promise<SocialSessionState>
  subscribe(listener: (event: SocialEvent) => void): () => void
}

/**
 * Sanitizes untrusted user text (bios, display names, status lines, chat messages)
 * by stripping control characters and enforcing length limits. Never renders HTML.
 */
export function sanitizeUserText(raw: unknown, maxLength: number, allowNewlines = false): string {
  if (typeof raw !== 'string') return ''
  const normalized = raw.replace(/\r\n?/g, '\n')
  const stripped = allowNewlines
    ? normalized.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    : normalized.replace(/[\u0000-\u001F\u007F]/g, ' ')
  return stripped.trim().slice(0, maxLength)
}

/**
 * Validates that an optional image URL is safe (https://, vnstation-art://, or safe data:image/ base64).
 * Blocks javascript:, file://, http://, data:text/html, or arbitrary executable schemes.
 */
export function sanitizeSafeImageUrl(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('data:image/')) {
    const match = /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,/i.exec(trimmed)
    if (match) {
      const b64 = trimmed.slice(match[0].length).replace(/\s+/g, '')
      if (/^[A-Za-z0-9+/=]+$/.test(b64)) {
        return `${match[0]}${b64}`
      }
    }
    return null
  }
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol === 'https:' || parsed.protocol === 'vnstation-art:') {
      return parsed.toString()
    }
    return null
  } catch {
    return null
  }
}

/** Normalizes a Friend Code into canonical `VNS-XXXX-XXXX` uppercase format. */
export function normalizeFriendCode(raw: string): string {
  const alnum = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const body = alnum.startsWith('VNS') ? alnum.slice(3) : alnum
  if (body.length !== 8) return raw.trim().toUpperCase()
  return `VNS-${body.slice(0, 4)}-${body.slice(4, 8)}`
}

export const FRIEND_CODE_REGEX = /^VNS-[A-Z0-9]{4}-[A-Z0-9]{4}$/
export const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,24}$/
