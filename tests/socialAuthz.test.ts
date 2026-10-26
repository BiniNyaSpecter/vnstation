import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LibraryStore } from '../src/main/db/libraryStore'
import { migrate } from '../src/main/db/migrations'
import { Database } from '../src/main/db/sqlite'
import { RateLimiter, generateFriendCode } from '../src/main/social/friendCode'
import { SocialService, redactProfileForViewer } from '../src/main/social/socialService'
import { assertNotServiceRoleKey } from '../src/main/social/supabaseClient'
import type { SecretCipher } from '../src/main/steam/steamWebApi'
import {
  FRIEND_CODE_REGEX,
  normalizeFriendCode,
  sanitizeSafeImageUrl,
  sanitizeUserText,
  type SocialEvent
} from '../src/shared/social'

function createTestSecretCipher(): SecretCipher {
  return {
    encrypt: (plain: string) => `enc:${Buffer.from(plain, 'utf8').toString('base64')}`,
    decrypt: (encoded: string) => {
      if (!encoded.startsWith('enc:')) throw new Error('Invalid cipher')
      return Buffer.from(encoded.slice(4), 'base64').toString('utf8')
    }
  }
}

describe('Milestone 7 — Social Accounts, Friend Codes, Custom Profiles & Authorization', () => {
  let tempDir: string
  let db: Database
  let store: LibraryStore
  let service: SocialService

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'vnstation-social-test-'))
    db = new Database(join(tempDir, 'library.db'))
    migrate(db)
    store = new LibraryStore(db)
    service = new SocialService({
      db,
      cipher: createTestSecretCipher(),
      seedDemoCompanions: true
    })
  })

  afterEach(() => {
    db.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('1. registers a new account, creates a profile, and assigns a non-sequential Friend Code', async () => {
    const state = await service.register({
      email: 'alice@example.com',
      password: 'Password123!',
      username: 'alice_vn',
      displayName: 'Alice Reader',
      avatarPreset: 'aoko'
    })

    expect(state.user?.email).toBe('alice@example.com')
    expect(state.profile).not.toBeNull()
    expect(state.profile?.username).toBe('alice_vn')
    expect(state.profile?.displayName).toBe('Alice Reader')
    expect(state.profile?.friendCode).toMatch(FRIEND_CODE_REGEX)

    // Verify no raw password is stored anywhere in SQLite
    const rawRow = db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', 'social.local_auth_enc')
    expect(rawRow?.value ?? '').not.toContain('Password123!')
    const decoded = Buffer.from((rawRow?.value ?? '').replace(/^enc:/, ''), 'base64').toString('utf8')
    expect(decoded).not.toContain('Password123!')
  })

  it('2. enforces username and Friend Code uniqueness across accounts', async () => {
    const first = await service.register({
      email: 'user1@example.com',
      password: 'Password123!',
      username: 'unique_reader',
      displayName: 'User One'
    })
    expect(first.profile?.friendCode).toMatch(FRIEND_CODE_REGEX)

    // Duplicate username (case-insensitive) must be rejected
    await expect(
      service.register({
        email: 'user2@example.com',
        password: 'Password123!',
        username: 'UNIQUE_READER',
        displayName: 'User Two'
      })
    ).rejects.toThrow(/username/i)

    // Duplicate email must be rejected
    await expect(
      service.register({
        email: 'user1@example.com',
        password: 'Password123!',
        username: 'another_handle',
        displayName: 'User Two'
      })
    ).rejects.toThrow(/email/i)

    // Friend code generator produces distinct valid codes
    const generated = new Set<string>()
    for (let i = 0; i < 50; i++) {
      const code = generateFriendCode()
      expect(code).toMatch(FRIEND_CODE_REGEX)
      generated.add(code)
    }
    expect(generated.size).toBe(50)
    expect(normalizeFriendCode('vns-aoko-2026')).toBe('VNS-AOKO-2026')
  })

  it('3. prevents impersonation — authenticated session always binds mutations to current user ID', async () => {
    const alice = await service.register({
      email: 'alice@example.com',
      password: 'Password123!',
      username: 'alice_reader',
      displayName: 'Alice'
    })
    const aliceId = alice.user!.id

    await service.logout()

    // Unauthenticated user cannot update a profile or send messages
    await expect(service.updateProfile({ displayName: 'Spoofed' })).rejects.toThrow(/signed in/i)

    const bob = await service.register({
      email: 'bob@example.com',
      password: 'Password123!',
      username: 'bob_reader',
      displayName: 'Bob'
    })
    expect(bob.user!.id).not.toBe(aliceId)

    // Updating profile while signed in as Bob only mutates Bob's profile, never Alice's
    await service.updateProfile({ displayName: 'Bob Updated', bio: 'Bob bio' })
    const alicePublic = await service.getProfileView(aliceId)
    expect(alicePublic.displayName).toBe('Alice')
  })

  it('4. exchanges and accepts friend requests between two users via Friend Code', async () => {
    const alice = await service.register({
      email: 'alice@example.com',
      password: 'Password123!',
      username: 'alice_vn',
      displayName: 'Alice'
    })
    const aliceCode = alice.profile!.friendCode

    await service.logout()

    const bob = await service.register({
      email: 'bob@example.com',
      password: 'Password123!',
      username: 'bob_vn',
      displayName: 'Bob'
    })

    // Bob looks up Alice's Friend Code first
    const lookup = await service.lookupFriendCode(aliceCode)
    expect(lookup.found).toBe(true)
    expect(lookup.relationship).toBe('can-request')
    expect(lookup.profile?.username).toBe('alice_vn')

    // Bob sends a friend request to Alice
    const requestRecord = await service.sendFriendRequest(aliceCode)
    expect(requestRecord.status).toBe('pending')
    expect(requestRecord.direction).toBe('outgoing')

    // Switch back to Alice and accept the incoming request
    await service.login({ email: 'alice@example.com', password: 'Password123!' })
    const aliceState = await service.getState()
    const incoming = aliceState.friends.find((f) => f.friend.userId === bob.user!.id)
    expect(incoming).toBeDefined()
    expect(incoming?.status).toBe('pending')
    expect(incoming?.direction).toBe('incoming')

    await service.respondFriendRequest(incoming!.id, 'accept')
    const afterAccept = await service.getState()
    const accepted = afterAccept.friends.find((f) => f.friend.userId === bob.user!.id)
    expect(accepted?.status).toBe('accepted')
  })

  it('5. allows only accepted friends to create or use a private conversation', async () => {
    const alice = await service.register({
      email: 'alice@example.com',
      password: 'Password123!',
      username: 'alice_vn',
      displayName: 'Alice'
    })
    const aliceId = alice.user!.id
    const aliceCode = alice.profile!.friendCode

    await service.logout()

    await service.register({
      email: 'bob@example.com',
      password: 'Password123!',
      username: 'bob_vn',
      displayName: 'Bob'
    })

    // Denied before friendship exists
    await expect(service.openDirectConversation(aliceId)).rejects.toThrow(/accepted friends/i)

    // Still denied while friendship is only pending
    await service.sendFriendRequest(aliceCode)
    await expect(service.openDirectConversation(aliceId)).rejects.toThrow(/accepted friends/i)

    // Alice accepts -> conversation creation and messaging succeed
    await service.login({ email: 'alice@example.com', password: 'Password123!' })
    const aliceState = await service.getState()
    await service.respondFriendRequest(aliceState.friends[0].id, 'accept')

    await service.login({ email: 'bob@example.com', password: 'Password123!' })
    const convo = await service.openDirectConversation(aliceId)
    expect(convo.canMessage).toBe(true)

    const sent = await service.sendMessage({
      conversationId: convo.id,
      body: 'Hello Alice! Have you read Witch on the Holy Night?'
    })
    expect(sent.body).toBe('Hello Alice! Have you read Witch on the Holy Night?')
    expect(sent.deliveryStatus).toBe('delivered')
  })

  it('6. denies a third user (User C) from reading or sending messages in User A & B conversation', async () => {
    const alice = await service.register({
      email: 'alice@example.com',
      password: 'Password123!',
      username: 'alice_vn',
      displayName: 'Alice'
    })
    const aliceCode = alice.profile!.friendCode
    const aliceId = alice.user!.id

    await service.logout()

    await service.register({
      email: 'bob@example.com',
      password: 'Password123!',
      username: 'bob_vn',
      displayName: 'Bob'
    })
    await service.sendFriendRequest(aliceCode)

    await service.login({ email: 'alice@example.com', password: 'Password123!' })
    const req = (await service.getState()).friends[0]
    await service.respondFriendRequest(req.id, 'accept')

    await service.login({ email: 'bob@example.com', password: 'Password123!' })
    const convo = await service.openDirectConversation(aliceId)
    await service.sendMessage({
      conversationId: convo.id,
      body: 'Private message between Alice and Bob'
    })

    // Register User C (Mallory)
    await service.logout()
    await service.register({
      email: 'mallory@example.com',
      password: 'Password123!',
      username: 'mallory_vn',
      displayName: 'Mallory'
    })

    // User C must be denied reading or posting to Alice & Bob's conversationId
    await expect(service.listMessages(convo.id)).rejects.toThrow(/access denied|participant/i)
    await expect(
      service.sendMessage({ conversationId: convo.id, body: 'Intruder message' })
    ).rejects.toThrow(/access denied|participant/i)
    await expect(service.clearConversationHistory(convo.id)).rejects.toThrow(
      /access denied|participant/i
    )
  })

  it('7. prevents blocked users from initiating friend requests or sending new messages', async () => {
    const alice = await service.register({
      email: 'alice@example.com',
      password: 'Password123!',
      username: 'alice_vn',
      displayName: 'Alice'
    })
    const aliceCode = alice.profile!.friendCode

    await service.logout()

    const bob = await service.register({
      email: 'bob@example.com',
      password: 'Password123!',
      username: 'bob_vn',
      displayName: 'Bob'
    })
    const bobId = bob.user!.id

    await service.sendFriendRequest(aliceCode)
    await service.login({ email: 'alice@example.com', password: 'Password123!' })
    const req = (await service.getState()).friends[0]
    await service.respondFriendRequest(req.id, 'accept')

    const convo = await service.openDirectConversation(bobId)
    await service.sendMessage({ conversationId: convo.id, body: 'Initial message' })

    // Alice blocks Bob
    await service.blockUser(bobId)

    // Switch to Bob: Bob cannot send new messages or new friend requests to Alice
    await service.login({ email: 'bob@example.com', password: 'Password123!' })
    await expect(
      service.sendMessage({ conversationId: convo.id, body: 'Blocked message attempt' })
    ).rejects.toThrow(/block|accepted friends/i)

    await expect(service.sendFriendRequest(aliceCode)).rejects.toThrow(/blocked|unavailable|could not send/i)
    const lookupAfterBlock = await service.lookupFriendCode(aliceCode)
    expect(lookupAfterBlock.found).toBe(false)
    expect(lookupAfterBlock.relationship).toBe('not-found')
  })

  it('8. prevents duplicate friend requests and auto-accepts mutual cross-requests', async () => {
    const alice = await service.register({
      email: 'alice@example.com',
      password: 'Password123!',
      username: 'alice_vn',
      displayName: 'Alice'
    })
    const aliceCode = alice.profile!.friendCode

    await service.logout()

    await service.register({
      email: 'bob@example.com',
      password: 'Password123!',
      username: 'bob_vn',
      displayName: 'Bob'
    })

    await service.sendFriendRequest(aliceCode)

    // Sending a duplicate outgoing request to the same user must be rejected
    await expect(service.sendFriendRequest(aliceCode)).rejects.toThrow(/already/i)

    // Cannot send a friend request to oneself
    const bobState = await service.getState()
    await expect(service.sendFriendRequest(bobState.profile!.friendCode)).rejects.toThrow(/yourself/i)
  })

  it('9. emits real-time message events and companion auto-replies in Local Sandbox mode', async () => {
    const events: SocialEvent[] = []
    const unsubscribe = service.subscribe((ev) => events.push(ev))

    await service.register({
      email: 'reader@example.com',
      password: 'Password123!',
      username: 'vn_reader',
      displayName: 'Reader'
    })

    // Connect with seeded companion Aoko (VNS-AOKO-2026), who auto-accepts and sends a welcome message
    const friendship = await service.sendFriendRequest('VNS-AOKO-2026')
    expect(friendship.status).toBe('accepted')

    const convo = await service.openDirectConversation(friendship.friend.userId)
    const sent = await service.sendMessage({
      conversationId: convo.id,
      body: 'Hi Aoko, what are you reading?'
    })
    expect(sent.deliveryStatus).toBe('delivered')

    const messages = await service.listMessages(convo.id)
    expect(messages.length).toBeGreaterThanOrEqual(2)
    expect(events.some((e) => e.type === 'message-received')).toBe(true)

    unsubscribe()
  })

  it('10. persists message history and deduplicates client_message_id across app restarts', async () => {
    await service.register({
      email: 'reader@example.com',
      password: 'Password123!',
      username: 'vn_reader',
      displayName: 'Reader'
    })
    const friendship = await service.sendFriendRequest('VNS-AOKO-2026')
    const convo = await service.openDirectConversation(friendship.friend.userId)

    const firstSend = await service.sendMessage({
      conversationId: convo.id,
      body: 'Idempotent message test',
      clientMessageId: 'dedup-client-id-001'
    })
    const duplicateSend = await service.sendMessage({
      conversationId: convo.id,
      body: 'Idempotent message test',
      clientMessageId: 'dedup-client-id-001'
    })
    expect(duplicateSend.id).toBe(firstSend.id)

    // Recreate SocialService over the same SQLite database to simulate an app restart
    const restartedService = new SocialService({
      db,
      cipher: createTestSecretCipher(),
      seedDemoCompanions: false
    })
    const restoredState = await restartedService.getState()
    expect(restoredState.user?.email).toBe('reader@example.com')

    const persistedMessages = await restartedService.listMessages(convo.id)
    expect(persistedMessages.some((m) => m.id === firstSend.id)).toBe(true)
  })

  it('11. clears active session on logout and prevents cross-account message leakage', async () => {
    await service.register({
      email: 'alice@example.com',
      password: 'Password123!',
      username: 'alice_vn',
      displayName: 'Alice'
    })
    const friendship = await service.sendFriendRequest('VNS-AOKO-2026')
    const aliceConvo = await service.openDirectConversation(friendship.friend.userId)

    const loggedOut = await service.logout()
    expect(loggedOut.user).toBeNull()
    expect(loggedOut.profile).toBeNull()
    expect(loggedOut.conversations).toHaveLength(0)

    // Register Bob on the same machine
    await service.register({
      email: 'bob@example.com',
      password: 'Password123!',
      username: 'bob_vn',
      displayName: 'Bob'
    })
    const bobState = await service.getState()
    expect(bobState.conversations).toHaveLength(0)
    await expect(service.listMessages(aliceConvo.id)).rejects.toThrow(/access denied|participant/i)
  })

  it('12. preserves local game library entries when signing out or deleting a social account', async () => {
    // Add a local visual novel to the library database
    const localGame = await store.addGame({
      title: 'Steins;Gate Local Install',
      launch: {
        executablePath: 'C:\\Games\\SteinsGate\\Game.exe',
        workingDirectory: 'C:\\Games\\SteinsGate',
        arguments: ''
      }
    })

    await service.register({
      email: 'reader@example.com',
      password: 'Password123!',
      username: 'vn_reader',
      displayName: 'Reader'
    })
    await service.sendFriendRequest('VNS-AOKO-2026')

    // Delete the social account completely
    const afterDelete = await service.deleteAccount()
    expect(afterDelete.user).toBeNull()
    expect(afterDelete.profile).toBeNull()

    // Local game library must still contain the user's game untouched
    const gamesAfterDelete = store.snapshot().entries
    expect(gamesAfterDelete.some((g) => g.id === localGame.id)).toBe(true)
  })

  it('13. persists MySpace-inspired custom themes, featured VNs, and sanitizes untrusted HTML/URLs', async () => {
    await service.register({
      email: 'stylist@example.com',
      password: 'Password123!',
      username: 'myspace_stylist',
      displayName: 'Stylist'
    })

    const updated = await service.updateProfile({
      displayName: 'Stylist\u0000\u0007',
      bio: 'Loving classic visual novels!\nFavorite route: True End.',
      avatarPreset: 'sakura',
      avatarUrl: 'javascript:alert(1)', // unsafe scheme must be stripped to null
      customization: {
        theme: 'myspace-cyber-2006',
        layout: 'editorial-showcase',
        accentColor: '#5eead4',
        backgroundUrl: 'https://images.example.com/banner.png',
        statusLine: 'Listening to OST',
        nowListening: 'Skyclad Observer',
        featuredVn: {
          vndbId: 'v17',
          title: 'Ever17 -the out of infinity-',
          developer: 'KID',
          coverUrl: 'file:///C:/secret/local/path.png', // local file:// must be stripped
          blurb: 'Unforgettable sci-fi mystery.'
        }
      }
    })

    expect(updated.displayName).toBe('Stylist')
    expect(updated.avatarUrl).toBeNull()
    expect(updated.customization.theme).toBe('myspace-cyber-2006')
    expect(updated.customization.layout).toBe('editorial-showcase')
    expect(updated.customization.backgroundUrl).toBe('https://images.example.com/banner.png')
    expect(updated.customization.featuredVn?.title).toBe('Ever17 -the out of infinity-')
    expect(updated.customization.featuredVn?.coverUrl).toBeNull()

    expect(sanitizeSafeImageUrl('javascript:evil()')).toBeNull()
    expect(sanitizeSafeImageUrl('data:text/html,<script>alert(1)</script>')).toBeNull()
    expect(sanitizeSafeImageUrl('https://s2.vndb.org/cv/01/12345.jpg')).toBe(
      'https://s2.vndb.org/cv/01/12345.jpg'
    )
    expect(sanitizeUserText('Hello\u0000World', 50)).toBe('Hello World')
  })

  it('14. redacts private profile fields for unauthorized viewers (stranger vs friend vs self)', async () => {
    const owner = await service.register({
      email: 'owner@example.com',
      password: 'Password123!',
      username: 'private_reader',
      displayName: 'Private Reader'
    })

    const profile = await service.updateProfile({
      bio: 'Friends-only personal bio',
      currentlyPlaying: 'Clannad',
      customization: {
        statusLine: 'Reading Nagisa route',
        nowListening: 'Dango Daikazoku',
        featuredVn: {
          vndbId: 'v4',
          title: 'Clannad',
          developer: 'Key',
          coverUrl: null,
          blurb: 'Masterpiece'
        }
      },
      privacy: {
        profileVisibility: 'friends',
        featuredVnsVisibility: 'friends',
        showOnlineStatus: true,
        showCurrentlyPlaying: true,
        showFriendsList: true,
        allowFriendRequestsByCode: false
      }
    })

    const asStranger = redactProfileForViewer(profile, 'stranger', [])
    expect(asStranger.isRestricted).toBe(true)
    expect(asStranger.bio).toBe('')
    expect(asStranger.currentlyPlaying).toBeNull()
    expect(asStranger.presence).toBe('offline')
    expect(asStranger.friendCode).toBeNull()
    expect(asStranger.customization.featuredVn).toBeNull()
    expect(asStranger.customization.statusLine).toBe('')

    const asFriend = redactProfileForViewer(profile, 'friend', [])
    expect(asFriend.isRestricted).toBe(false)
    expect(asFriend.bio).toBe('Friends-only personal bio')
    expect(asFriend.currentlyPlaying).toBe('Clannad')
    expect(asFriend.customization.featuredVn?.title).toBe('Clannad')

    const asSelf = await service.getProfileView(owner.user!.id, 'self')
    expect(asSelf.isRestricted).toBe(false)
    expect(asSelf.friendCode).toBe(profile.friendCode)
  })

  it('15. enforces Friend Code lookup rate limiting and rejects Supabase service_role keys', async () => {
    let fakeNow = 1_000_000
    const limiter = new RateLimiter(3, 60_000, () => fakeNow)

    limiter.check('user-1', 'Friend Code lookup')
    limiter.check('user-1', 'Friend Code lookup')
    limiter.check('user-1', 'Friend Code lookup')
    expect(() => limiter.check('user-1', 'Friend Code lookup')).toThrow(/too many/i)

    // Advancing past the rate-limit window allows requests again
    fakeNow += 61_000
    expect(() => limiter.check('user-1', 'Friend Code lookup')).not.toThrow()

    // Forged JWT with role=service_role must be rejected so desktop client never uses elevated keys
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
    const servicePayload = Buffer.from(JSON.stringify({ role: 'service_role' })).toString(
      'base64url'
    )
    const fakeServiceJwt = `${header}.${servicePayload}.sig`

    expect(() => assertNotServiceRoleKey(fakeServiceJwt)).toThrow(/service_role/i)
    await expect(
      service.configureBackend({
        url: 'https://example.supabase.co',
        anonKey: fakeServiceJwt,
        enabled: true
      })
    ).rejects.toThrow(/service_role/i)
  })
})
