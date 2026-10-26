import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import {
  AVATAR_PRESETS,
  DEFAULT_PRIVACY_SETTINGS,
  DEFAULT_PROFILE_CUSTOMIZATION,
  FRIEND_CODE_REGEX,
  normalizeFriendCode,
  PROFILE_THEMES,
  sanitizeSafeImageUrl,
  sanitizeUserText,
  USERNAME_REGEX,
  type AvatarPresetId,
  type BlockedUserRecord,
  type ConversationSummary,
  type DirectMessage,
  type FeaturedCharacterEntry,
  type FeaturedVnEntry,
  type FriendCodeLookupResult,
  type FriendshipRecord,
  type LoginAccountInput,
  type PresenceState,
  type ProfileCustomization,
  type ProfileLayoutId,
  type ProfilePatchInput,
  type ProfilePrivacySettings,
  type ProfileThemeId,
  type ProfileVisibility,
  type PublicFriendSnippet,
  type PublicProfileView,
  type RegisterAccountInput,
  type ReportAbuseInput,
  type SendMessageInput,
  type SocialApi,
  type SocialBackendInfo,
  type SocialEvent,
  type SocialSessionState,
  type SupabaseConfigInput,
  type UserProfile
} from '@shared/social'
import type { Database } from '../db/sqlite'
import type { Fetcher } from '../metadata/http'
import type { SecretCipher } from '../steam/steamWebApi'
import { generateFriendCode, RateLimiter } from './friendCode'
import { assertNotServiceRoleKey, SupabaseRestClient } from './supabaseClient'

const KEY_SESSION = 'social.session_enc'
const KEY_LOCAL_AUTH = 'social.local_auth_enc'
const KEY_BACKEND_CFG = 'social.backend_cfg_enc'

interface StoredSession {
  userId: string
  email: string
  emailVerified: boolean
  accessToken?: string
  refreshToken?: string
}

interface LocalAuthEntry {
  userId: string
  email: string
  saltHex: string
  verifierHex: string
  emailVerified: boolean
}

interface StoredBackendConfig {
  url: string
  anonKey: string
  enabled: boolean
}

type ProfileRow = {
  user_id: string
  username: string
  display_name: string
  friend_code: string
  bio: string
  avatar_preset: AvatarPresetId
  avatar_url: string | null
  presence: PresenceState
  currently_playing: string | null
  customization_json: string
  privacy_json: string
  created_at: string
  updated_at: string
}

const VALID_AVATARS = new Set<string>(Object.keys(AVATAR_PRESETS))
const VALID_THEMES = new Set<string>(Object.keys(PROFILE_THEMES))
const VALID_LAYOUTS = new Set<ProfileLayoutId>(['myspace-classic', 'editorial-showcase', 'compact-console'])
const VALID_VISIBILITY = new Set<ProfileVisibility>(['public', 'friends', 'private'])
const VALID_PRESENCE = new Set<PresenceState>(['online', 'away', 'offline'])

function canonicalPair(userA: string, userB: string): [string, string] {
  return userA < userB ? [userA, userB] : [userB, userA]
}

function hashPasswordVerifier(password: string, saltHex?: string): { saltHex: string; verifierHex: string } {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : randomBytes(16)
  const derived = scryptSync(password, salt, 64)
  return { saltHex: salt.toString('hex'), verifierHex: derived.toString('hex') }
}

function verifyPasswordVerifier(password: string, saltHex: string, verifierHex: string): boolean {
  const { verifierHex: candidateHex } = hashPasswordVerifier(password, saltHex)
  const a = Buffer.from(candidateHex, 'hex')
  const b = Buffer.from(verifierHex, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

function sanitizeFeaturedVn(raw: unknown): FeaturedVnEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const title = sanitizeUserText(obj.title, 120)
  if (!title) return null
  return {
    vndbId: typeof obj.vndbId === 'string' && /^v\d+$/.test(obj.vndbId.trim()) ? obj.vndbId.trim() : null,
    title,
    developer: sanitizeUserText(obj.developer, 100) || null,
    coverUrl: sanitizeSafeImageUrl(obj.coverUrl),
    blurb: sanitizeUserText(obj.blurb, 240)
  }
}

function sanitizeFeaturedCharacter(raw: unknown): FeaturedCharacterEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const name = sanitizeUserText(obj.name, 100)
  const characterId = sanitizeUserText(obj.characterId, 32)
  const vndbId = sanitizeUserText(obj.vndbId, 32)
  if (!name || !characterId) return null
  return {
    characterId,
    vndbId,
    name,
    vnTitle: sanitizeUserText(obj.vnTitle, 120),
    portraitUrl: sanitizeSafeImageUrl(obj.portraitUrl),
    note: sanitizeUserText(obj.note, 200)
  }
}

function sanitizeCustomization(
  current: ProfileCustomization,
  patch?: Partial<ProfileCustomization>
): ProfileCustomization {
  if (!patch) return current
  const theme = typeof patch.theme === 'string' && VALID_THEMES.has(patch.theme) ? (patch.theme as ProfileThemeId) : current.theme
  const layout =
    typeof patch.layout === 'string' && VALID_LAYOUTS.has(patch.layout as ProfileLayoutId)
      ? (patch.layout as ProfileLayoutId)
      : current.layout
  const accentColor =
    typeof patch.accentColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(patch.accentColor.trim())
      ? patch.accentColor.trim().toLowerCase()
      : current.accentColor
  const backgroundUrl = patch.backgroundUrl !== undefined ? sanitizeSafeImageUrl(patch.backgroundUrl) : current.backgroundUrl
  const statusLine = patch.statusLine !== undefined ? sanitizeUserText(patch.statusLine, 120) : current.statusLine
  const nowListening = patch.nowListening !== undefined ? sanitizeUserText(patch.nowListening, 120) : current.nowListening
  const featuredVn = patch.featuredVn !== undefined ? sanitizeFeaturedVn(patch.featuredVn) : current.featuredVn
  const favoriteVns =
    patch.favoriteVns !== undefined && Array.isArray(patch.favoriteVns)
      ? patch.favoriteVns
          .map(sanitizeFeaturedVn)
          .filter((item): item is FeaturedVnEntry => item !== null)
          .slice(0, 6)
      : current.favoriteVns
  const featuredCharacter =
    patch.featuredCharacter !== undefined ? sanitizeFeaturedCharacter(patch.featuredCharacter) : current.featuredCharacter

  return {
    theme,
    layout,
    accentColor,
    backgroundUrl,
    statusLine,
    nowListening,
    featuredVn,
    favoriteVns,
    featuredCharacter
  }
}

function sanitizePrivacy(
  current: ProfilePrivacySettings,
  patch?: Partial<ProfilePrivacySettings>
): ProfilePrivacySettings {
  if (!patch) return current
  return {
    profileVisibility:
      typeof patch.profileVisibility === 'string' && VALID_VISIBILITY.has(patch.profileVisibility as ProfileVisibility)
        ? (patch.profileVisibility as ProfileVisibility)
        : current.profileVisibility,
    showOnlineStatus: typeof patch.showOnlineStatus === 'boolean' ? patch.showOnlineStatus : current.showOnlineStatus,
    showCurrentlyPlaying:
      typeof patch.showCurrentlyPlaying === 'boolean' ? patch.showCurrentlyPlaying : current.showCurrentlyPlaying,
    showFriendsList: typeof patch.showFriendsList === 'boolean' ? patch.showFriendsList : current.showFriendsList,
    featuredVnsVisibility:
      typeof patch.featuredVnsVisibility === 'string' &&
      VALID_VISIBILITY.has(patch.featuredVnsVisibility as ProfileVisibility)
        ? (patch.featuredVnsVisibility as ProfileVisibility)
        : current.featuredVnsVisibility,
    allowFriendRequestsByCode:
      typeof patch.allowFriendRequestsByCode === 'boolean'
        ? patch.allowFriendRequestsByCode
        : current.allowFriendRequestsByCode
  }
}

function parseProfileRow(row: ProfileRow): UserProfile {
  let rawCustom: Partial<ProfileCustomization> = {}
  let rawPrivacy: Partial<ProfilePrivacySettings> = {}
  try {
    rawCustom = JSON.parse(row.customization_json || '{}') as Partial<ProfileCustomization>
  } catch {
    rawCustom = {}
  }
  try {
    rawPrivacy = JSON.parse(row.privacy_json || '{}') as Partial<ProfilePrivacySettings>
  } catch {
    rawPrivacy = {}
  }
  return {
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    friendCode: row.friend_code,
    bio: row.bio,
    avatarPreset: VALID_AVATARS.has(row.avatar_preset) ? row.avatar_preset : 'aoko',
    avatarUrl: sanitizeSafeImageUrl(row.avatar_url),
    presence: VALID_PRESENCE.has(row.presence) ? row.presence : 'online',
    currentlyPlaying: row.currently_playing ? sanitizeUserText(row.currently_playing, 120) : null,
    customization: sanitizeCustomization(DEFAULT_PROFILE_CUSTOMIZATION, rawCustom),
    privacy: sanitizePrivacy(DEFAULT_PRIVACY_SETTINGS, rawPrivacy),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/**
 * Redacts a UserProfile according to the viewer's relationship ('self' | 'friend' | 'stranger')
 * and the profile owner's privacy settings. Never leaks private settings or unauthorized fields.
 */
export function redactProfileForViewer(
  profile: UserProfile,
  relationship: 'self' | 'friend' | 'stranger',
  friendsPreview: PublicFriendSnippet[]
): PublicProfileView {
  const { privacy, customization } = profile

  const canViewProfile =
    relationship === 'self' ||
    privacy.profileVisibility === 'public' ||
    (privacy.profileVisibility === 'friends' && relationship === 'friend')

  const canViewVns =
    canViewProfile &&
    (relationship === 'self' ||
      privacy.featuredVnsVisibility === 'public' ||
      (privacy.featuredVnsVisibility === 'friends' && relationship === 'friend'))

  const canViewOnline =
    relationship === 'self' || (relationship === 'friend' && privacy.showOnlineStatus)

  const canViewPlaying =
    relationship === 'self' || (relationship === 'friend' && privacy.showCurrentlyPlaying && canViewOnline)

  const canViewFriends =
    canViewProfile && (relationship === 'self' || (relationship === 'friend' && privacy.showFriendsList))

  const canSeeFriendCode =
    relationship === 'self' || relationship === 'friend' || privacy.allowFriendRequestsByCode

  return {
    userId: profile.userId,
    username: profile.username,
    displayName: profile.displayName,
    friendCode: canSeeFriendCode ? profile.friendCode : null,
    bio: canViewProfile ? profile.bio : '',
    avatarPreset: profile.avatarPreset,
    avatarUrl: profile.avatarUrl,
    presence: canViewOnline ? profile.presence : 'offline',
    currentlyPlaying: canViewPlaying ? profile.currentlyPlaying : null,
    customization: {
      theme: customization.theme,
      layout: customization.layout,
      accentColor: customization.accentColor,
      backgroundUrl: canViewProfile ? customization.backgroundUrl : null,
      statusLine: canViewProfile ? customization.statusLine : '',
      nowListening: canViewProfile ? customization.nowListening : '',
      featuredVn: canViewVns ? customization.featuredVn : null,
      favoriteVns: canViewVns ? customization.favoriteVns : [],
      featuredCharacter: canViewVns ? customization.featuredCharacter : null
    },
    createdAt: profile.createdAt,
    viewerRelationship: relationship,
    isRestricted: !canViewProfile,
    friendsPreview: canViewFriends ? friendsPreview : []
  }
}

export interface SocialServiceOptions {
  db: Database
  cipher: SecretCipher
  fetcher?: Fetcher
  seedDemoCompanions?: boolean
  now?: () => number
}

export class SocialService implements SocialApi {
  private readonly db: Database
  private readonly cipher: SecretCipher
  private readonly fetcher: Fetcher
  private readonly now: () => number
  private readonly listeners = new Set<(event: SocialEvent) => void>()
  private readonly lookupLimiter: RateLimiter
  private readonly requestLimiter: RateLimiter
  private readonly messageLimiter: RateLimiter
  private activeSession: StoredSession | null = null

  constructor(options: SocialServiceOptions) {
    this.db = options.db
    this.cipher = options.cipher
    this.fetcher = options.fetcher ?? ((url, init) => fetch(url, init))
    this.now = options.now ?? (() => Date.now())
    this.lookupLimiter = new RateLimiter(15, 60_000, this.now)
    this.requestLimiter = new RateLimiter(10, 60_000, this.now)
    this.messageLimiter = new RateLimiter(30, 60_000, this.now)

    this.restorePersistedSession()
    if (options.seedDemoCompanions !== false) {
      this.ensureDemoCompanions()
    }
  }

  subscribe(listener: (event: SocialEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(event: SocialEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // Ignore listener errors
      }
    }
  }

  private readEncryptedSetting<T>(key: string): T | null {
    const row = this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key)
    if (!row?.value) return null
    try {
      const json = this.cipher.decrypt(row.value)
      return JSON.parse(json) as T
    } catch {
      return null
    }
  }

  private writeEncryptedSetting(key: string, value: unknown | null): void {
    if (value === null) {
      this.db.run('DELETE FROM settings WHERE key = ?', key)
      return
    }
    const encrypted = this.cipher.encrypt(JSON.stringify(value))
    this.db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      encrypted
    )
  }

  private getBackendConfig(): StoredBackendConfig {
    const stored = this.readEncryptedSetting<StoredBackendConfig>(KEY_BACKEND_CFG)
    const envUrl = process.env['VNSTATION_SUPABASE_URL'] ?? process.env['VITE_SUPABASE_URL'] ?? ''
    const envKey = process.env['VNSTATION_SUPABASE_ANON_KEY'] ?? process.env['VITE_SUPABASE_ANON_KEY'] ?? ''
    if (stored && stored.url && stored.anonKey) return stored
    if (envUrl && envKey) return { url: envUrl, anonKey: envKey, enabled: true }
    return { url: stored?.url ?? '', anonKey: stored?.anonKey ?? '', enabled: Boolean(stored?.enabled) }
  }

  private getBackendInfo(): SocialBackendInfo {
    const cfg = this.getBackendConfig()
    const isSupabase = Boolean(cfg.enabled && cfg.url && cfg.anonKey)
    return {
      mode: isSupabase ? 'supabase' : 'local-sandbox',
      supabaseUrl: cfg.url,
      hasAnonKey: Boolean(cfg.anonKey),
      enabled: cfg.enabled
    }
  }

  private restorePersistedSession(): void {
    const saved = this.readEncryptedSetting<StoredSession>(KEY_SESSION)
    if (!saved || !saved.userId) {
      this.activeSession = null
      return
    }
    const profileExists = this.db.get<{ user_id: string }>(
      'SELECT user_id FROM social_profiles WHERE user_id = ?',
      saved.userId
    )
    if (!profileExists) {
      this.writeEncryptedSetting(KEY_SESSION, null)
      this.activeSession = null
      return
    }
    this.activeSession = saved
  }

  private saveActiveSession(session: StoredSession | null): void {
    this.activeSession = session
    this.writeEncryptedSetting(KEY_SESSION, session)
  }

  private requireAuthUserId(): string {
    if (!this.activeSession?.userId) {
      throw new Error('You must be signed in to perform this action.')
    }
    return this.activeSession.userId
  }

  /**
   * Seeds two friendly companion profiles in Local Sandbox mode so users can test
   * Friend Code lookup (`VNS-AOKO-2026` and `VNS-LABM-2048`), friend requests,
   * MySpace profile themes, and live 1-to-1 messaging out of the box.
   */
  private ensureDemoCompanions(): void {
    const nowIso = new Date(this.now()).toISOString()
    const companions: Array<{
      userId: string
      username: string
      displayName: string
      friendCode: string
      bio: string
      avatarPreset: AvatarPresetId
      presence: PresenceState
      currentlyPlaying: string | null
      customization: ProfileCustomization
      privacy: ProfilePrivacySettings
    }> = [
      {
        userId: 'companion-aoko-2026',
        username: 'aoko_reader',
        displayName: 'Aoko Aozaki',
        friendCode: 'VNS-AOKO-2026',
        bio: 'Night-owl visual novel reader & collector. Always happy to talk about TYPE-MOON classics, mystery routes, and soundtrack favorites!',
        avatarPreset: 'aoko',
        presence: 'online',
        currentlyPlaying: 'Witch on the Holy Night',
        customization: {
          theme: 'myspace-cyber-2006',
          layout: 'myspace-classic',
          accentColor: '#5eead4',
          backgroundUrl: null,
          statusLine: 'Reading Chapter 8 — Five Star',
          nowListening: 'Five (Mahoutsukai no Yoru OST)',
          featuredVn: {
            vndbId: 'v777',
            title: 'Witch on the Holy Night',
            developer: 'TYPE-MOON',
            coverUrl: null,
            blurb: 'Unmatched cinematography, atmosphere, and winter-night magic in Misaki Town.'
          },
          favoriteVns: [
            { vndbId: 'v777', title: 'Witch on the Holy Night', developer: 'TYPE-MOON', coverUrl: null, blurb: '' },
            { vndbId: 'v17', title: 'Ever17 -The Out of Infinity-', developer: 'KID', coverUrl: null, blurb: '' },
            { vndbId: 'v24', title: 'Umineko When They Cry', developer: '07th Expansion', coverUrl: null, blurb: '' }
          ],
          featuredCharacter: {
            characterId: 'c1',
            vndbId: 'v777',
            name: 'Aoko Aozaki',
            vnTitle: 'Witch on the Holy Night',
            portraitUrl: null,
            note: 'Apprentice magician of Misaki Hill.'
          }
        },
        privacy: {
          profileVisibility: 'public',
          showOnlineStatus: true,
          showCurrentlyPlaying: true,
          showFriendsList: true,
          featuredVnsVisibility: 'public',
          allowFriendRequestsByCode: true
        }
      },
      {
        userId: 'companion-kurisu-2048',
        username: 'kurisu_lab004',
        displayName: 'Kurisu Makise',
        friendCode: 'VNS-LABM-2048',
        bio: 'Future Gadget Lab Member 004. Reading sci-fi & time-loop visual novels between experiments. El Psy Kongroo.',
        avatarPreset: 'kurisu',
        presence: 'away',
        currentlyPlaying: 'Steins;Gate',
        customization: {
          theme: 'crimson-velvet',
          layout: 'editorial-showcase',
          accentColor: '#ff8c96',
          backgroundUrl: null,
          statusLine: 'At the lab — D-Mail testing in progress',
          nowListening: 'Gate of Steiner (Piano ver.)',
          featuredVn: {
            vndbId: 'v2002',
            title: 'Steins;Gate',
            developer: '5pb. / Nitroplus',
            coverUrl: null,
            blurb: 'The 1% divergence barrier is only the beginning.'
          },
          favoriteVns: [
            { vndbId: 'v2002', title: 'Steins;Gate', developer: '5pb. / Nitroplus', coverUrl: null, blurb: '' }
          ],
          featuredCharacter: null
        },
        privacy: {
          profileVisibility: 'friends',
          showOnlineStatus: true,
          showCurrentlyPlaying: true,
          showFriendsList: true,
          featuredVnsVisibility: 'friends',
          allowFriendRequestsByCode: true
        }
      }
    ]

    for (const c of companions) {
      this.db.run(
        `INSERT OR IGNORE INTO social_profiles (
          user_id, username, display_name, friend_code, bio, avatar_preset, avatar_url,
          presence, currently_playing, customization_json, privacy_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
        c.userId,
        c.username,
        c.displayName,
        c.friendCode,
        c.bio,
        c.avatarPreset,
        c.presence,
        c.currentlyPlaying,
        JSON.stringify(c.customization),
        JSON.stringify(c.privacy),
        nowIso,
        nowIso
      )
    }
  }

  private allocateUniqueFriendCode(): string {
    for (let attempt = 0; attempt < 25; attempt++) {
      const candidate = generateFriendCode()
      const existing = this.db.get<{ user_id: string }>(
        'SELECT user_id FROM social_profiles WHERE friend_code = ?',
        candidate
      )
      if (!existing) return candidate
    }
    throw new Error('Could not generate a unique Friend Code. Please try again.')
  }

  private loadProfileById(userId: string): UserProfile | null {
    const row = this.db.get<ProfileRow>('SELECT * FROM social_profiles WHERE user_id = ?', userId)
    return row ? parseProfileRow(row) : null
  }

  private isBlockedBetween(userA: string, userB: string): boolean {
    const row = this.db.get<{ blocker_id: string }>(
      `SELECT blocker_id FROM social_blocks
       WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)
       LIMIT 1`,
      userA,
      userB,
      userB,
      userA
    )
    return Boolean(row)
  }

  private getViewerRelationship(viewerId: string | null, targetUserId: string): 'self' | 'friend' | 'stranger' {
    if (!viewerId) return 'stranger'
    if (viewerId === targetUserId) return 'self'
    if (this.isBlockedBetween(viewerId, targetUserId)) return 'stranger'
    const [low, high] = canonicalPair(viewerId, targetUserId)
    const row = this.db.get<{ status: string }>(
      'SELECT status FROM social_friendships WHERE pair_low = ? AND pair_high = ?',
      low,
      high
    )
    return row?.status === 'accepted' ? 'friend' : 'stranger'
  }

  private getAcceptedFriendSnippets(userId: string, limit = 8): PublicFriendSnippet[] {
    const rows = this.db.all<{ requester_id: string; recipient_id: string }>(
      `SELECT requester_id, recipient_id FROM social_friendships
       WHERE (requester_id = ? OR recipient_id = ?) AND status = 'accepted'
       ORDER BY accepted_at DESC, updated_at DESC
       LIMIT ?`,
      userId,
      userId,
      limit
    )
    const snippets: PublicFriendSnippet[] = []
    for (const r of rows) {
      const friendId = r.requester_id === userId ? r.recipient_id : r.requester_id
      if (this.isBlockedBetween(userId, friendId)) continue
      const profile = this.loadProfileById(friendId)
      if (!profile) continue
      snippets.push({
        userId: profile.userId,
        username: profile.username,
        displayName: profile.displayName,
        avatarPreset: profile.avatarPreset,
        avatarUrl: profile.avatarUrl,
        presence: profile.privacy.showOnlineStatus ? profile.presence : 'offline'
      })
    }
    return snippets
  }

  private buildPublicProfileView(
    targetProfile: UserProfile,
    viewerId: string | null,
    overrideRelationship?: 'self' | 'friend' | 'stranger'
  ): PublicProfileView {
    const relationship = overrideRelationship ?? this.getViewerRelationship(viewerId, targetProfile.userId)
    const friendsPreview = this.getAcceptedFriendSnippets(targetProfile.userId)
    return redactProfileForViewer(targetProfile, relationship, friendsPreview)
  }

  async getState(): Promise<SocialSessionState> {
    const backendInfo = this.getBackendInfo()
    if (!this.activeSession) {
      return {
        mode: backendInfo.mode,
        backendInfo,
        connectionState: 'connected',
        user: null,
        profile: null,
        friends: [],
        blockedUsers: [],
        conversations: [],
        totalUnreadCount: 0
      }
    }

    const userId = this.activeSession.userId
    const profile = this.loadProfileById(userId)
    if (!profile) {
      this.saveActiveSession(null)
      return {
        mode: backendInfo.mode,
        backendInfo,
        connectionState: 'connected',
        user: null,
        profile: null,
        friends: [],
        blockedUsers: [],
        conversations: [],
        totalUnreadCount: 0
      }
    }

    const friends = this.listFriendshipsForUser(userId)
    const blockedUsers = this.listBlockedForUser(userId)
    const conversations = this.listConversationsForUser(userId)
    const totalUnreadCount = conversations.reduce((sum, conv) => sum + (conv.hidden ? 0 : conv.unreadCount), 0)

    return {
      mode: backendInfo.mode,
      backendInfo,
      connectionState: 'connected',
      user: {
        id: this.activeSession.userId,
        email: this.activeSession.email,
        emailVerified: this.activeSession.emailVerified
      },
      profile,
      friends,
      blockedUsers,
      conversations,
      totalUnreadCount
    }
  }

  async register(input: RegisterAccountInput): Promise<SocialSessionState> {
    const email = sanitizeUserText(input.email, 160).toLowerCase()
    const password = typeof input.password === 'string' ? input.password : ''
    const username = sanitizeUserText(input.username, 24)
    const displayName = sanitizeUserText(input.displayName || username, 48)
    const avatarPreset: AvatarPresetId =
      input.avatarPreset && VALID_AVATARS.has(input.avatarPreset) ? input.avatarPreset : 'aoko'

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('Please enter a valid email address.')
    }
    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters long.')
    }
    if (!USERNAME_REGEX.test(username)) {
      throw new Error('Username must be 3–24 characters using only letters, numbers, or underscores.')
    }
    if (!displayName) {
      throw new Error('Display name is required.')
    }

    const existingUsername = this.db.get<{ user_id: string }>(
      'SELECT user_id FROM social_profiles WHERE lower(username) = lower(?)',
      username
    )
    if (existingUsername) {
      throw new Error(`The username “@${username}” is already taken.`)
    }

    const backendCfg = this.getBackendConfig()
    let userId: string = randomUUID()
    let emailVerified = true
    let accessToken: string | undefined
    let refreshToken: string | undefined

    if (backendCfg.enabled && backendCfg.url && backendCfg.anonKey) {
      const client = new SupabaseRestClient(backendCfg.url, backendCfg.anonKey, this.fetcher)
      const result = await client.signUp(email, password)
      if (result.userId) userId = result.userId
      emailVerified = result.emailVerified
      accessToken = result.session?.accessToken
      refreshToken = result.session?.refreshToken
    } else {
      const registry = this.readEncryptedSetting<Record<string, LocalAuthEntry>>(KEY_LOCAL_AUTH) ?? {}
      if (registry[email]) {
        throw new Error('An account with that email address already exists. Please sign in instead.')
      }
      const { saltHex, verifierHex } = hashPasswordVerifier(password)
      registry[email] = { userId, email, saltHex, verifierHex, emailVerified: true }
      this.writeEncryptedSetting(KEY_LOCAL_AUTH, registry)
    }

    const nowIso = new Date(this.now()).toISOString()
    const friendCode = this.allocateUniqueFriendCode()

    this.db.run(
      `INSERT INTO social_profiles (
        user_id, username, display_name, friend_code, bio, avatar_preset, avatar_url,
        presence, currently_playing, customization_json, privacy_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, '', ?, NULL, 'online', NULL, ?, ?, ?, ?)`,
      userId,
      username,
      displayName,
      friendCode,
      avatarPreset,
      JSON.stringify(DEFAULT_PROFILE_CUSTOMIZATION),
      JSON.stringify(DEFAULT_PRIVACY_SETTINGS),
      nowIso,
      nowIso
    )

    this.saveActiveSession({ userId, email, emailVerified, accessToken, refreshToken })
    this.emit({ type: 'state-changed' })
    return this.getState()
  }

  async login(input: LoginAccountInput): Promise<SocialSessionState> {
    const email = sanitizeUserText(input.email, 160).toLowerCase()
    const password = typeof input.password === 'string' ? input.password : ''
    if (!email || !password) {
      throw new Error('Please enter both your email address and password.')
    }

    const backendCfg = this.getBackendConfig()
    let userId: string
    let emailVerified = true
    let accessToken: string | undefined
    let refreshToken: string | undefined

    if (backendCfg.enabled && backendCfg.url && backendCfg.anonKey) {
      const client = new SupabaseRestClient(backendCfg.url, backendCfg.anonKey, this.fetcher)
      const session = await client.signInWithPassword(email, password)
      userId = session.user.id
      emailVerified = Boolean(session.user.emailConfirmedAt)
      accessToken = session.accessToken
      refreshToken = session.refreshToken

      // Ensure local profile mirror exists for this Supabase user
      const existing = this.loadProfileById(userId)
      if (!existing) {
        const baseUsername = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 18) || 'reader'
        const candidateUsername = `${baseUsername}_${userId.slice(0, 4)}`
        const nowIso = new Date(this.now()).toISOString()
        this.db.run(
          `INSERT INTO social_profiles (
            user_id, username, display_name, friend_code, bio, avatar_preset, avatar_url,
            presence, currently_playing, customization_json, privacy_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, '', 'aoko', NULL, 'online', NULL, ?, ?, ?, ?)`,
          userId,
          candidateUsername,
          baseUsername,
          this.allocateUniqueFriendCode(),
          JSON.stringify(DEFAULT_PROFILE_CUSTOMIZATION),
          JSON.stringify(DEFAULT_PRIVACY_SETTINGS),
          nowIso,
          nowIso
        )
      }
    } else {
      const registry = this.readEncryptedSetting<Record<string, LocalAuthEntry>>(KEY_LOCAL_AUTH) ?? {}
      const entry = registry[email]
      if (!entry || !verifyPasswordVerifier(password, entry.saltHex, entry.verifierHex)) {
        throw new Error('Invalid email address or password.')
      }
      userId = entry.userId
      emailVerified = entry.emailVerified
    }

    this.saveActiveSession({ userId, email, emailVerified, accessToken, refreshToken })
    this.emit({ type: 'state-changed' })
    return this.getState()
  }

  async logout(): Promise<SocialSessionState> {
    const current = this.activeSession
    const backendCfg = this.getBackendConfig()
    if (current?.accessToken && backendCfg.enabled && backendCfg.url && backendCfg.anonKey) {
      const client = new SupabaseRestClient(backendCfg.url, backendCfg.anonKey, this.fetcher)
      await client.signOut(current.accessToken)
    }
    this.saveActiveSession(null)
    this.emit({ type: 'state-changed' })
    return this.getState()
  }

  async requestPasswordReset(email: string): Promise<{ message: string }> {
    const cleanEmail = sanitizeUserText(email, 160).toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      throw new Error('Please enter a valid email address.')
    }
    const backendCfg = this.getBackendConfig()
    if (backendCfg.enabled && backendCfg.url && backendCfg.anonKey) {
      const client = new SupabaseRestClient(backendCfg.url, backendCfg.anonKey, this.fetcher)
      await client.recoverPassword(cleanEmail)
    }
    return {
      message: `If an account exists for ${cleanEmail}, password reset instructions have been sent.`
    }
  }

  async deleteAccount(): Promise<SocialSessionState> {
    const userId = this.requireAuthUserId()
    const email = this.activeSession?.email

    this.db.transaction(() => {
      this.db.run('DELETE FROM social_profiles WHERE user_id = ?', userId)
      if (email) {
        const registry = this.readEncryptedSetting<Record<string, LocalAuthEntry>>(KEY_LOCAL_AUTH) ?? {}
        delete registry[email]
        this.writeEncryptedSetting(KEY_LOCAL_AUTH, registry)
      }
      this.saveActiveSession(null)
    })

    this.emit({ type: 'state-changed' })
    return this.getState()
  }

  async updateProfile(patch: ProfilePatchInput): Promise<UserProfile> {
    const userId = this.requireAuthUserId()
    const current = this.loadProfileById(userId)
    if (!current) throw new Error('Profile not found.')

    const displayName =
      patch.displayName !== undefined ? sanitizeUserText(patch.displayName, 48) : current.displayName
    if (!displayName) throw new Error('Display name cannot be empty.')

    const bio = patch.bio !== undefined ? sanitizeUserText(patch.bio, 600, true) : current.bio
    const avatarPreset =
      patch.avatarPreset !== undefined && VALID_AVATARS.has(patch.avatarPreset)
        ? patch.avatarPreset
        : current.avatarPreset
    const avatarUrl =
      patch.avatarUrl !== undefined ? sanitizeSafeImageUrl(patch.avatarUrl) : current.avatarUrl
    const presence =
      patch.presence !== undefined && VALID_PRESENCE.has(patch.presence)
        ? patch.presence
        : current.presence
    const currentlyPlaying =
      patch.currentlyPlaying !== undefined
        ? patch.currentlyPlaying
          ? sanitizeUserText(patch.currentlyPlaying, 120)
          : null
        : current.currentlyPlaying

    const customization = sanitizeCustomization(current.customization, patch.customization)
    const privacy = sanitizePrivacy(current.privacy, patch.privacy)
    const nowIso = new Date(this.now()).toISOString()

    this.db.run(
      `UPDATE social_profiles
       SET display_name = ?, bio = ?, avatar_preset = ?, avatar_url = ?,
           presence = ?, currently_playing = ?, customization_json = ?, privacy_json = ?, updated_at = ?
       WHERE user_id = ?`,
      displayName,
      bio,
      avatarPreset,
      avatarUrl,
      presence,
      currentlyPlaying,
      JSON.stringify(customization),
      JSON.stringify(privacy),
      nowIso,
      userId
    )

    const updated = this.loadProfileById(userId)!
    this.emit({ type: 'state-changed' })
    return updated
  }

  /**
   * Synchronizes the currently running visual novel title to the user's social profile
   * only if the user is signed in and has `showCurrentlyPlaying` enabled.
   */
  setCurrentlyPlayingTitle(title: string | null): void {
    if (!this.activeSession?.userId) return
    const current = this.loadProfileById(this.activeSession.userId)
    if (!current) return
    const nextTitle = current.privacy.showCurrentlyPlaying && title ? sanitizeUserText(title, 120) : null
    if (current.currentlyPlaying === nextTitle) return
    this.db.run(
      'UPDATE social_profiles SET currently_playing = ?, updated_at = ? WHERE user_id = ?',
      nextTitle,
      new Date(this.now()).toISOString(),
      current.userId
    )
    this.emit({ type: 'state-changed' })
  }

  async getProfileView(
    targetUserId: string,
    viewAs?: 'self' | 'friend' | 'stranger'
  ): Promise<PublicProfileView> {
    const viewerId = this.activeSession?.userId ?? null
    if (viewerId && viewerId !== targetUserId && this.isBlockedBetween(viewerId, targetUserId)) {
      throw new Error('This profile is unavailable.')
    }
    const target = this.loadProfileById(targetUserId)
    if (!target) throw new Error('Profile not found.')

    // Only the profile owner can preview their own profile as 'friend' or 'stranger'.
    const effectiveOverride = viewerId === targetUserId && viewAs ? viewAs : undefined
    return this.buildPublicProfileView(target, viewerId, effectiveOverride)
  }

  async lookupFriendCode(rawCode: string): Promise<FriendCodeLookupResult> {
    const viewerId = this.requireAuthUserId()
    this.lookupLimiter.check(viewerId, 'Friend Code lookup')

    const code = normalizeFriendCode(rawCode)
    if (!FRIEND_CODE_REGEX.test(code)) {
      return {
        found: false,
        profile: null,
        relationship: 'not-found',
        message: 'Enter a valid Friend Code in the format VNS-XXXX-XXXX.'
      }
    }

    const row = this.db.get<ProfileRow>('SELECT * FROM social_profiles WHERE friend_code = ?', code)
    if (!row) {
      return {
        found: false,
        profile: null,
        relationship: 'not-found',
        message: 'No account matched that Friend Code.'
      }
    }

    const target = parseProfileRow(row)
    if (target.userId === viewerId) {
      return {
        found: true,
        profile: this.buildPublicProfileView(target, viewerId),
        relationship: 'self',
        message: 'This is your own Friend Code.'
      }
    }

    // Do not reveal profile details if blocked in either direction
    if (this.isBlockedBetween(viewerId, target.userId)) {
      return {
        found: false,
        profile: null,
        relationship: 'not-found',
        message: 'No account matched that Friend Code.'
      }
    }

    const [low, high] = canonicalPair(viewerId, target.userId)
    const existing = this.db.get<{ requester_id: string; recipient_id: string; status: string }>(
      'SELECT requester_id, recipient_id, status FROM social_friendships WHERE pair_low = ? AND pair_high = ?',
      low,
      high
    )

    if (existing?.status === 'accepted') {
      return {
        found: true,
        profile: this.buildPublicProfileView(target, viewerId),
        relationship: 'already-friends',
        message: `You and ${target.displayName} are already friends.`
      }
    }
    if (existing?.status === 'pending') {
      const outgoing = existing.requester_id === viewerId
      return {
        found: true,
        profile: this.buildPublicProfileView(target, viewerId),
        relationship: outgoing ? 'pending-outgoing' : 'pending-incoming',
        message: outgoing
          ? `You already have a pending request to ${target.displayName}.`
          : `${target.displayName} has already sent you a friend request.`
      }
    }

    if (!target.privacy.allowFriendRequestsByCode) {
      return {
        found: true,
        profile: this.buildPublicProfileView(target, viewerId),
        relationship: 'requests-disabled',
        message: `${target.displayName} is not accepting new friend requests via Friend Code right now.`
      }
    }

    return {
      found: true,
      profile: this.buildPublicProfileView(target, viewerId),
      relationship: 'can-request',
      message: `Found ${target.displayName} (@${target.username}).`
    }
  }

  async sendFriendRequest(rawCode: string): Promise<FriendshipRecord> {
    const requesterId = this.requireAuthUserId()
    this.requestLimiter.check(requesterId, 'friend request')

    const code = normalizeFriendCode(rawCode)
    if (!FRIEND_CODE_REGEX.test(code)) {
      throw new Error('Invalid Friend Code format. Expected VNS-XXXX-XXXX.')
    }

    const targetRow = this.db.get<ProfileRow>('SELECT * FROM social_profiles WHERE friend_code = ?', code)
    if (!targetRow) {
      throw new Error('Could not find an account with that Friend Code.')
    }
    const target = parseProfileRow(targetRow)

    if (target.userId === requesterId) {
      throw new Error('You cannot send a friend request to yourself.')
    }
    if (this.isBlockedBetween(requesterId, target.userId)) {
      throw new Error('Could not send a friend request to that user.')
    }
    if (!target.privacy.allowFriendRequestsByCode) {
      throw new Error('This user has disabled incoming friend requests by Friend Code.')
    }

    const [low, high] = canonicalPair(requesterId, target.userId)
    const existing = this.db.get<{ id: string; status: string }>(
      'SELECT id, status FROM social_friendships WHERE pair_low = ? AND pair_high = ?',
      low,
      high
    )
    if (existing) {
      if (existing.status === 'accepted') throw new Error('You are already friends with this user.')
      throw new Error('A friend request is already pending between you and this user.')
    }

    const id = randomUUID()
    const nowIso = new Date(this.now()).toISOString()
    // Companion Aoko auto-accepts so single-machine users can immediately test friendship & messaging!
    const autoAccept = target.userId === 'companion-aoko-2026'
    const status: 'pending' | 'accepted' = autoAccept ? 'accepted' : 'pending'
    const acceptedAt = autoAccept ? nowIso : null

    this.db.run(
      `INSERT INTO social_friendships (
        id, requester_id, recipient_id, pair_low, pair_high, status, created_at, updated_at, accepted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      requesterId,
      target.userId,
      low,
      high,
      status,
      nowIso,
      nowIso,
      acceptedAt
    )

    if (autoAccept) {
      // Seed a welcome conversation & message from Aoko
      const conv = this.ensureConversationRow(requesterId, target.userId)
      const welcomeBody = `Hey! Thanks for adding my Friend Code on VNStation. What visual novel are you reading right now?`
      this.db.run(
        `INSERT OR IGNORE INTO social_messages (id, conversation_id, sender_id, client_message_id, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        randomUUID(),
        conv.id,
        target.userId,
        `welcome-${requesterId}`,
        welcomeBody,
        nowIso
      )
      this.db.run('UPDATE social_conversations SET updated_at = ? WHERE id = ?', nowIso, conv.id)
    }

    this.emit({ type: 'state-changed' })
    return {
      id,
      requesterId,
      recipientId: target.userId,
      status,
      direction: status === 'accepted' ? 'accepted' : 'outgoing',
      friend: this.buildPublicProfileView(target, requesterId),
      createdAt: nowIso,
      updatedAt: nowIso,
      acceptedAt
    }
  }

  async respondFriendRequest(
    friendshipId: string,
    action: 'accept' | 'decline' | 'cancel'
  ): Promise<void> {
    const userId = this.requireAuthUserId()
    const row = this.db.get<{
      id: string
      requester_id: string
      recipient_id: string
      status: string
    }>('SELECT id, requester_id, recipient_id, status FROM social_friendships WHERE id = ?', friendshipId)

    if (!row) throw new Error('Friend request not found.')
    if (row.status !== 'pending') throw new Error('This friend request is no longer pending.')

    if (action === 'accept') {
      if (row.recipient_id !== userId) {
        throw new Error('Only the recipient of a friend request can accept it.')
      }
      if (this.isBlockedBetween(row.requester_id, row.recipient_id)) {
        throw new Error('Cannot accept a friend request while a block is active.')
      }
      const nowIso = new Date(this.now()).toISOString()
      this.db.run(
        "UPDATE social_friendships SET status = 'accepted', accepted_at = ?, updated_at = ? WHERE id = ?",
        nowIso,
        nowIso,
        friendshipId
      )
    } else if (action === 'decline') {
      if (row.recipient_id !== userId) {
        throw new Error('Only the recipient of a friend request can decline it.')
      }
      this.db.run('DELETE FROM social_friendships WHERE id = ?', friendshipId)
    } else if (action === 'cancel') {
      if (row.requester_id !== userId) {
        throw new Error('Only the sender of a friend request can cancel it.')
      }
      this.db.run('DELETE FROM social_friendships WHERE id = ?', friendshipId)
    }

    this.emit({ type: 'state-changed' })
  }

  async removeFriend(friendUserId: string): Promise<void> {
    const userId = this.requireAuthUserId()
    const [low, high] = canonicalPair(userId, friendUserId)
    this.db.run('DELETE FROM social_friendships WHERE pair_low = ? AND pair_high = ?', low, high)
    this.emit({ type: 'state-changed' })
  }

  async blockUser(targetUserId: string): Promise<void> {
    const userId = this.requireAuthUserId()
    if (userId === targetUserId) throw new Error('You cannot block yourself.')
    const target = this.loadProfileById(targetUserId)
    if (!target) throw new Error('User not found.')

    const nowIso = new Date(this.now()).toISOString()
    const [low, high] = canonicalPair(userId, targetUserId)

    this.db.transaction(() => {
      // Remove any friendship or pending request immediately
      this.db.run('DELETE FROM social_friendships WHERE pair_low = ? AND pair_high = ?', low, high)
      this.db.run(
        'INSERT OR IGNORE INTO social_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)',
        userId,
        targetUserId,
        nowIso
      )
    })

    this.emit({ type: 'state-changed' })
  }

  async unblockUser(targetUserId: string): Promise<void> {
    const userId = this.requireAuthUserId()
    this.db.run('DELETE FROM social_blocks WHERE blocker_id = ? AND blocked_id = ?', userId, targetUserId)
    this.emit({ type: 'state-changed' })
  }

  private ensureConversationRow(userA: string, userB: string): { id: string; pairLow: string; pairHigh: string } {
    const [pairLow, pairHigh] = canonicalPair(userA, userB)
    const existing = this.db.get<{ id: string }>(
      'SELECT id FROM social_conversations WHERE pair_low = ? AND pair_high = ?',
      pairLow,
      pairHigh
    )
    if (existing) {
      // Ensure participant rows exist and unhide for the caller
      this.db.run(
        'INSERT OR IGNORE INTO social_participants (conversation_id, user_id) VALUES (?, ?), (?, ?)',
        existing.id,
        pairLow,
        existing.id,
        pairHigh
      )
      return { id: existing.id, pairLow, pairHigh }
    }

    const id = randomUUID()
    const nowIso = new Date(this.now()).toISOString()
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO social_conversations (id, type, pair_low, pair_high, created_at, updated_at)
         VALUES (?, 'direct', ?, ?, ?, ?)`,
        id,
        pairLow,
        pairHigh,
        nowIso,
        nowIso
      )
      this.db.run(
        `INSERT INTO social_participants (conversation_id, user_id, last_read_at, muted, hidden, cleared_before)
         VALUES (?, ?, ?, 0, 0, NULL), (?, ?, NULL, 0, 0, NULL)`,
        id,
        userA,
        nowIso,
        id,
        userB
      )
    })
    return { id, pairLow, pairHigh }
  }

  private assertCanMessageBetween(userA: string, userB: string): void {
    if (userA === userB) {
      throw new Error('Cannot open a conversation with yourself.')
    }
    if (this.isBlockedBetween(userA, userB)) {
      throw new Error('Messaging is unavailable because a block is active between these accounts.')
    }
    const [low, high] = canonicalPair(userA, userB)
    const friendship = this.db.get<{ status: string }>(
      'SELECT status FROM social_friendships WHERE pair_low = ? AND pair_high = ?',
      low,
      high
    )
    if (friendship?.status !== 'accepted') {
      throw new Error('Only mutually accepted friends can exchange private messages.')
    }
  }

  private assertConversationParticipant(conversationId: string, userId: string): {
    pairLow: string
    pairHigh: string
    otherUserId: string
    clearedBefore: string | null
  } {
    const conv = this.db.get<{ id: string; pair_low: string; pair_high: string }>(
      'SELECT id, pair_low, pair_high FROM social_conversations WHERE id = ?',
      conversationId
    )
    if (!conv || (conv.pair_low !== userId && conv.pair_high !== userId)) {
      throw new Error('Access denied: you are not a participant in this conversation.')
    }
    const part = this.db.get<{ cleared_before: string | null }>(
      'SELECT cleared_before FROM social_participants WHERE conversation_id = ? AND user_id = ?',
      conversationId,
      userId
    )
    const otherUserId = conv.pair_low === userId ? conv.pair_high : conv.pair_low
    return {
      pairLow: conv.pair_low,
      pairHigh: conv.pair_high,
      otherUserId,
      clearedBefore: part?.cleared_before ?? null
    }
  }

  async openDirectConversation(friendUserId: string): Promise<ConversationSummary> {
    const userId = this.requireAuthUserId()
    this.assertCanMessageBetween(userId, friendUserId)

    const { id } = this.ensureConversationRow(userId, friendUserId)
    this.db.run(
      'UPDATE social_participants SET hidden = 0 WHERE conversation_id = ? AND user_id = ?',
      id,
      userId
    )

    this.emit({ type: 'state-changed' })
    const summary = this.listConversationsForUser(userId).find((c) => c.id === id)
    if (!summary) throw new Error('Could not open conversation.')
    return summary
  }

  async listMessages(
    conversationId: string,
    options?: { limit?: number; before?: string }
  ): Promise<DirectMessage[]> {
    const userId = this.requireAuthUserId()
    const { clearedBefore } = this.assertConversationParticipant(conversationId, userId)
    const limit = Math.max(1, Math.min(200, options?.limit ?? 80))

    const rows = this.db.all<{
      id: string
      conversation_id: string
      sender_id: string
      client_message_id: string
      body: string
      created_at: string
    }>(
      `SELECT id, conversation_id, sender_id, client_message_id, body, created_at
       FROM social_messages
       WHERE conversation_id = ?
         AND (? IS NULL OR created_at > ?)
         AND (? IS NULL OR created_at < ?)
       ORDER BY created_at DESC, rowid DESC
       LIMIT ?`,
      conversationId,
      clearedBefore,
      clearedBefore,
      options?.before ?? null,
      options?.before ?? null,
      limit
    )

    return rows.reverse().map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      senderId: row.sender_id,
      clientMessageId: row.client_message_id,
      body: row.body,
      createdAt: row.created_at,
      deliveryStatus: 'delivered'
    }))
  }

  async sendMessage(input: SendMessageInput): Promise<DirectMessage> {
    const senderId = this.requireAuthUserId()
    this.messageLimiter.check(senderId, 'message')

    const { otherUserId } = this.assertConversationParticipant(input.conversationId, senderId)
    this.assertCanMessageBetween(senderId, otherUserId)

    const body = sanitizeUserText(input.body, 2000, true)
    if (!body) throw new Error('Message cannot be empty.')

    const clientMessageId = sanitizeUserText(input.clientMessageId || randomUUID(), 64) || randomUUID()

    // Deduplicate if the same clientMessageId was already stored
    const existing = this.db.get<{
      id: string
      conversation_id: string
      sender_id: string
      client_message_id: string
      body: string
      created_at: string
    }>(
      `SELECT id, conversation_id, sender_id, client_message_id, body, created_at
       FROM social_messages
       WHERE conversation_id = ? AND sender_id = ? AND client_message_id = ?`,
      input.conversationId,
      senderId,
      clientMessageId
    )
    if (existing) {
      return {
        id: existing.id,
        conversationId: existing.conversation_id,
        senderId: existing.sender_id,
        clientMessageId: existing.client_message_id,
        body: existing.body,
        createdAt: existing.created_at,
        deliveryStatus: 'delivered'
      }
    }

    const id = randomUUID()
    const nowIso = new Date(this.now()).toISOString()

    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO social_messages (id, conversation_id, sender_id, client_message_id, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        id,
        input.conversationId,
        senderId,
        clientMessageId,
        body,
        nowIso
      )
      this.db.run('UPDATE social_conversations SET updated_at = ? WHERE id = ?', nowIso, input.conversationId)
      this.db.run(
        'UPDATE social_participants SET hidden = 0 WHERE conversation_id = ?',
        input.conversationId
      )
      this.db.run(
        'UPDATE social_participants SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?',
        nowIso,
        input.conversationId,
        senderId
      )
    })

    const sent: DirectMessage = {
      id,
      conversationId: input.conversationId,
      senderId,
      clientMessageId,
      body,
      createdAt: nowIso,
      deliveryStatus: 'delivered'
    }

    // In Local Sandbox mode, if the recipient is a companion, generate a contextual reply!
    if (otherUserId === 'companion-aoko-2026' || otherUserId === 'companion-kurisu-2048') {
      const replyIso = new Date(this.now() + 1).toISOString()
      const replyBody =
        otherUserId === 'companion-aoko-2026'
          ? `Nice! I just bookmarked that in my VNStation library too. Have you checked out the character compendium tab yet?`
          : `Interesting hypothesis. I'll log that route note in the lab archives — let me know when you reach the true ending.`
      const replyId = randomUUID()
      this.db.run(
        `INSERT INTO social_messages (id, conversation_id, sender_id, client_message_id, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        replyId,
        input.conversationId,
        otherUserId,
        `auto-reply-${id}`,
        replyBody,
        replyIso
      )
      this.db.run('UPDATE social_conversations SET updated_at = ? WHERE id = ?', replyIso, input.conversationId)
      this.emit({
        type: 'message-received',
        conversationId: input.conversationId,
        message: {
          id: replyId,
          conversationId: input.conversationId,
          senderId: otherUserId,
          clientMessageId: `auto-reply-${id}`,
          body: replyBody,
          createdAt: replyIso,
          deliveryStatus: 'delivered'
        }
      })
    }

    this.emit({ type: 'state-changed' })
    return sent
  }

  async markConversationRead(conversationId: string): Promise<void> {
    const userId = this.requireAuthUserId()
    this.assertConversationParticipant(conversationId, userId)
    const nowIso = new Date(this.now() + 2).toISOString()
    this.db.run(
      'UPDATE social_participants SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?',
      nowIso,
      conversationId,
      userId
    )
    this.emit({ type: 'state-changed' })
  }

  async setConversationMuted(conversationId: string, muted: boolean): Promise<void> {
    const userId = this.requireAuthUserId()
    this.assertConversationParticipant(conversationId, userId)
    this.db.run(
      'UPDATE social_participants SET muted = ? WHERE conversation_id = ? AND user_id = ?',
      muted ? 1 : 0,
      conversationId,
      userId
    )
    this.emit({ type: 'state-changed' })
  }

  async setConversationHidden(conversationId: string, hidden: boolean): Promise<void> {
    const userId = this.requireAuthUserId()
    this.assertConversationParticipant(conversationId, userId)
    this.db.run(
      'UPDATE social_participants SET hidden = ? WHERE conversation_id = ? AND user_id = ?',
      hidden ? 1 : 0,
      conversationId,
      userId
    )
    this.emit({ type: 'state-changed' })
  }

  async clearConversationHistory(conversationId: string): Promise<void> {
    const userId = this.requireAuthUserId()
    this.assertConversationParticipant(conversationId, userId)
    const nowIso = new Date(this.now() + 2).toISOString()
    this.db.run(
      'UPDATE social_participants SET cleared_before = ?, last_read_at = ? WHERE conversation_id = ? AND user_id = ?',
      nowIso,
      nowIso,
      conversationId,
      userId
    )
    this.emit({ type: 'state-changed' })
  }

  async reportAbuse(input: ReportAbuseInput): Promise<{ reportId: string }> {
    const reporterId = this.requireAuthUserId()
    if (reporterId === input.targetUserId) {
      throw new Error('You cannot submit a report against yourself.')
    }
    const target = this.loadProfileById(input.targetUserId)
    if (!target) throw new Error('Reported user not found.')

    const validCategories = new Set(['spam', 'harassment', 'inappropriate', 'impersonation', 'other'])
    const category = validCategories.has(input.category) ? input.category : 'other'
    const details = sanitizeUserText(input.details, 1000, true)
    const reportId = randomUUID()
    const nowIso = new Date(this.now()).toISOString()

    this.db.run(
      `INSERT INTO social_reports (id, reporter_id, target_user_id, message_id, category, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      reportId,
      reporterId,
      input.targetUserId,
      input.messageId ?? null,
      category,
      details,
      nowIso
    )
    return { reportId }
  }

  async configureBackend(input: SupabaseConfigInput): Promise<SocialSessionState> {
    const url = input.url.trim()
    const anonKey = input.anonKey.trim()
    if (url) {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
        throw new Error('Supabase project URL must use https://.')
      }
    }
    if (anonKey) {
      assertNotServiceRoleKey(anonKey)
    }
    const previousCfg = this.getBackendConfig()
    const nextCfg: StoredBackendConfig = {
      url,
      anonKey: anonKey || previousCfg.anonKey,
      enabled: Boolean(input.enabled && url && (anonKey || previousCfg.anonKey))
    }
    this.writeEncryptedSetting(KEY_BACKEND_CFG, nextCfg)
    this.emit({ type: 'state-changed' })
    return this.getState()
  }

  private listFriendshipsForUser(userId: string): FriendshipRecord[] {
    const rows = this.db.all<{
      id: string
      requester_id: string
      recipient_id: string
      status: 'pending' | 'accepted'
      created_at: string
      updated_at: string
      accepted_at: string | null
    }>(
      `SELECT id, requester_id, recipient_id, status, created_at, updated_at, accepted_at
       FROM social_friendships
       WHERE requester_id = ? OR recipient_id = ?
       ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, updated_at DESC`,
      userId,
      userId
    )

    const result: FriendshipRecord[] = []
    for (const row of rows) {
      const otherId = row.requester_id === userId ? row.recipient_id : row.requester_id
      if (this.isBlockedBetween(userId, otherId)) continue
      const otherProfile = this.loadProfileById(otherId)
      if (!otherProfile) continue
      const direction: 'incoming' | 'outgoing' | 'accepted' =
        row.status === 'accepted'
          ? 'accepted'
          : row.recipient_id === userId
            ? 'incoming'
            : 'outgoing'
      result.push({
        id: row.id,
        requesterId: row.requester_id,
        recipientId: row.recipient_id,
        status: row.status,
        direction,
        friend: this.buildPublicProfileView(otherProfile, userId),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        acceptedAt: row.accepted_at
      })
    }
    return result
  }

  private listBlockedForUser(userId: string): BlockedUserRecord[] {
    const rows = this.db.all<{ blocked_id: string; created_at: string }>(
      'SELECT blocked_id, created_at FROM social_blocks WHERE blocker_id = ? ORDER BY created_at DESC',
      userId
    )
    const list: BlockedUserRecord[] = []
    for (const r of rows) {
      const profile = this.loadProfileById(r.blocked_id)
      if (!profile) continue
      list.push({
        userId: profile.userId,
        username: profile.username,
        displayName: profile.displayName,
        avatarPreset: profile.avatarPreset,
        createdAt: r.created_at
      })
    }
    return list
  }

  private listConversationsForUser(userId: string): ConversationSummary[] {
    const rows = this.db.all<{
      id: string
      pair_low: string
      pair_high: string
      updated_at: string
      last_read_at: string | null
      muted: number
      hidden: number
      cleared_before: string | null
    }>(
      `SELECT c.id, c.pair_low, c.pair_high, c.updated_at,
              p.last_read_at, p.muted, p.hidden, p.cleared_before
       FROM social_conversations c
       JOIN social_participants p ON p.conversation_id = c.id AND p.user_id = ?
       ORDER BY c.updated_at DESC`,
      userId
    )

    const summaries: ConversationSummary[] = []
    for (const row of rows) {
      const otherId = row.pair_low === userId ? row.pair_high : row.pair_low
      const otherProfile = this.loadProfileById(otherId)
      if (!otherProfile) continue

      const blocked = this.isBlockedBetween(userId, otherId)
      const [low, high] = canonicalPair(userId, otherId)
      const friendship = this.db.get<{ status: string }>(
        'SELECT status FROM social_friendships WHERE pair_low = ? AND pair_high = ?',
        low,
        high
      )
      const isFriend = friendship?.status === 'accepted'
      const canMessage = !blocked && isFriend
      const blockReason = blocked
        ? 'Messaging is disabled because one of the participants is blocked.'
        : !isFriend
          ? 'Messaging requires an active accepted friendship.'
          : null

      const lastMsgRow = this.db.get<{
        id: string
        conversation_id: string
        sender_id: string
        client_message_id: string
        body: string
        created_at: string
      }>(
        `SELECT id, conversation_id, sender_id, client_message_id, body, created_at
         FROM social_messages
         WHERE conversation_id = ?
           AND (? IS NULL OR created_at > ?)
         ORDER BY created_at DESC, rowid DESC
         LIMIT 1`,
        row.id,
        row.cleared_before,
        row.cleared_before
      )

      const unreadRow = this.db.get<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt
         FROM social_messages
         WHERE conversation_id = ?
           AND sender_id <> ?
           AND (? IS NULL OR created_at > ?)
           AND (? IS NULL OR created_at > ?)`,
        row.id,
        userId,
        row.cleared_before,
        row.cleared_before,
        row.last_read_at,
        row.last_read_at
      )

      summaries.push({
        id: row.id,
        participant: this.buildPublicProfileView(otherProfile, userId),
        lastMessage: lastMsgRow
          ? {
              id: lastMsgRow.id,
              conversationId: lastMsgRow.conversation_id,
              senderId: lastMsgRow.sender_id,
              clientMessageId: lastMsgRow.client_message_id,
              body: lastMsgRow.body,
              createdAt: lastMsgRow.created_at,
              deliveryStatus: 'delivered'
            }
          : null,
        unreadCount: Number(unreadRow?.cnt ?? 0),
        muted: Boolean(row.muted),
        hidden: Boolean(row.hidden),
        canMessage,
        blockReason,
        updatedAt: row.updated_at
      })
    }
    return summaries
  }
}
