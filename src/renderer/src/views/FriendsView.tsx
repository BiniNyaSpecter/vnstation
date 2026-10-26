import { useState, type FormEvent } from 'react'
import { normalizeFriendCode, type FriendCodeLookupResult } from '@shared/social'
import { AuthPanel } from '@renderer/components/social/AuthPanel'
import { Avatar } from '@renderer/components/social/Avatar'
import { Badge } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { cx } from '@renderer/lib/cx'
import { services } from '@renderer/services'
import { useAppStore } from '@renderer/state/appStore'

type FriendsTab = 'friends' | 'incoming' | 'outgoing' | 'blocked'

export function FriendsView() {
  const social = useAppStore((state) => state.social)
  const refreshSocial = useAppStore((state) => state.refreshSocial)
  const navigate = useAppStore((state) => state.navigate)
  const setActiveConversation = useAppStore((state) => state.setActiveConversation)
  const showToast = useAppStore((state) => state.showToast)

  const [tab, setTab] = useState<FriendsTab>('friends')
  const [codeInput, setCodeInput] = useState('')
  const [lookupResult, setLookupResult] = useState<FriendCodeLookupResult | null>(null)
  const [busy, setBusy] = useState(false)

  if (!social.user || !social.profile) {
    return (
      <div className="lib">
        <div className="lib__scroll" data-scroll-y="">
          <AuthPanel subtitle="Sign in or create an account to exchange Friend Codes and connect with fellow readers." />
        </div>
      </div>
    )
  }

  const acceptedFriends = social.friends.filter((f) => f.status === 'accepted')
  const incomingRequests = social.friends.filter((f) => f.status === 'pending' && f.direction === 'incoming')
  const outgoingRequests = social.friends.filter((f) => f.status === 'pending' && f.direction === 'outgoing')
  const blockedUsers = social.blockedUsers

  const handleLookup = async (event?: FormEvent, overrideCode?: string) => {
    event?.preventDefault()
    const targetCode = normalizeFriendCode(overrideCode ?? codeInput)
    if (!targetCode) return
    setCodeInput(targetCode)
    setBusy(true)
    try {
      const result = await services.social.lookupFriendCode(targetCode)
      setLookupResult(result)
      if (!result.found) {
        showToast(result.message, 'info')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lookup failed.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleSendRequest = async (friendCode: string) => {
    setBusy(true)
    try {
      const record = await services.social.sendFriendRequest(friendCode)
      await refreshSocial()
      setLookupResult(null)
      setCodeInput('')
      if (record.status === 'accepted') {
        showToast(`You and ${record.friend.displayName} are now friends!`, 'success')
      } else {
        showToast(`Friend request sent to ${record.friend.displayName}.`, 'success')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not send friend request.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleRespond = async (friendshipId: string, action: 'accept' | 'decline' | 'cancel') => {
    setBusy(true)
    try {
      await services.social.respondFriendRequest(friendshipId, action)
      await refreshSocial()
      showToast(
        action === 'accept'
          ? 'Friend request accepted!'
          : action === 'decline'
            ? 'Friend request declined.'
            : 'Friend request cancelled.',
        'info'
      )
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Action failed.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleOpenChat = async (friendUserId: string) => {
    try {
      const convo = await services.social.openDirectConversation(friendUserId)
      await refreshSocial()
      setActiveConversation(convo.id)
      navigate({ name: 'messages', conversationId: convo.id })
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not open conversation.', 'error')
    }
  }

  const handleRemoveFriend = async (friendUserId: string, name: string) => {
    try {
      await services.social.removeFriend(friendUserId)
      await refreshSocial()
      showToast(`Removed ${name} from your friends list.`, 'info')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not remove friend.', 'error')
    }
  }

  const handleBlockUser = async (targetUserId: string, name: string) => {
    try {
      await services.social.blockUser(targetUserId)
      await refreshSocial()
      setLookupResult(null)
      showToast(`Blocked ${name}. They can no longer message you or send friend requests.`, 'info')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not block user.', 'error')
    }
  }

  const handleUnblockUser = async (targetUserId: string, name: string) => {
    try {
      await services.social.unblockUser(targetUserId)
      await refreshSocial()
      showToast(`Unblocked ${name}.`, 'info')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not unblock user.', 'error')
    }
  }

  const handleCopyMyCode = async () => {
    const code = social.profile?.friendCode
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      showToast(`Copied your Friend Code (${code}) to clipboard.`, 'success')
    } catch {
      showToast(`Your Friend Code: ${code}`, 'info')
    }
  }

  return (
    <div className="lib social-friends-view">
      <div className="lib__scroll" data-scroll-y="">
        <header className="lib__head">
          <div className="lib__heading">
            <h1 className="lib__title">Friends & Friend Codes</h1>
            <span className="lib__count">
              {acceptedFriends.length} {acceptedFriends.length === 1 ? 'friend' : 'friends'}
            </span>
          </div>
          <div className="social-my-code-banner">
            <span className="social-my-code-banner__label">Your Friend Code:</span>
            <code className="social-my-code-banner__code">{social.profile.friendCode}</code>
            <Button size="sm" onClick={() => void handleCopyMyCode()}>
              Copy Code
            </Button>
          </div>
        </header>

        {/* Add Friend by Friend Code Panel */}
        <section className="social-card social-lookup-card" aria-label="Add Friend by Code">
          <div className="social-lookup-card__head">
            <div>
              <h2 className="social-card__title">Add a Friend by Friend Code</h2>
              <p className="social-card__desc">
                Enter a friend’s unique code (<code>VNS-XXXX-XXXX</code>) to preview their profile and send a request.
              </p>
            </div>
            {social.mode === 'local-sandbox' && (
              <div className="social-demo-codes">
                <span className="social-demo-codes__label">Try Companion Codes:</span>
                <button
                  type="button"
                  className="social-pill-btn"
                  data-nav=""
                  onClick={() => void handleLookup(undefined, 'VNS-AOKO-2026')}
                >
                  VNS-AOKO-2026 (Aoko)
                </button>
                <button
                  type="button"
                  className="social-pill-btn"
                  data-nav=""
                  onClick={() => void handleLookup(undefined, 'VNS-LABM-2048')}
                >
                  VNS-LABM-2048 (Kurisu)
                </button>
              </div>
            )}
          </div>

          <form className="social-lookup-form" onSubmit={(e) => void handleLookup(e)}>
            <input
              type="text"
              className="social-code-input"
              placeholder="VNS-XXXX-XXXX"
              maxLength={15}
              value={codeInput}
              data-nav=""
              data-entry-point=""
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
            />
            <Button variant="primary" type="submit" disabled={busy || !codeInput.trim()}>
              {busy ? 'Looking up…' : 'Look Up Code'}
            </Button>
            {lookupResult && (
              <Button variant="ghost" type="button" onClick={() => setLookupResult(null)}>
                Clear
              </Button>
            )}
          </form>

          {/* Lookup Confirmation Preview Card */}
          {lookupResult && (
            <div className="social-lookup-preview" role="region" aria-label="Friend code lookup result">
              {lookupResult.found && lookupResult.profile ? (
                <div className="social-friend-row">
                  <div className="social-friend-row__main">
                    <Avatar
                      displayName={lookupResult.profile.displayName}
                      username={lookupResult.profile.username}
                      preset={lookupResult.profile.avatarPreset}
                      avatarUrl={lookupResult.profile.avatarUrl}
                      presence={lookupResult.profile.presence}
                      currentlyPlaying={lookupResult.profile.currentlyPlaying}
                      size="lg"
                    />
                    <div className="social-friend-row__info">
                      <div className="social-friend-row__title">
                        <strong>{lookupResult.profile.displayName}</strong>
                        <span className="social-friend-row__handle">@{lookupResult.profile.username}</span>
                        {lookupResult.profile.friendCode && (
                          <Badge tone="neutral">{lookupResult.profile.friendCode}</Badge>
                        )}
                      </div>
                      <p className="social-friend-row__sub">{lookupResult.message}</p>
                    </div>
                  </div>
                  <div className="social-friend-row__actions">
                    <Button
                      variant="ghost"
                      onClick={() => navigate({ name: 'profile', userId: lookupResult.profile!.userId })}
                    >
                      View Profile
                    </Button>
                    {lookupResult.relationship === 'can-request' && (
                      <Button
                        variant="primary"
                        disabled={busy}
                        onClick={() => void handleSendRequest(codeInput)}
                      >
                        Send Friend Request
                      </Button>
                    )}
                    {lookupResult.relationship === 'pending-incoming' && (
                      <Button
                        variant="primary"
                        disabled={busy}
                        onClick={() => void handleSendRequest(codeInput)}
                      >
                        Accept Request
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="social-lookup-empty">{lookupResult.message}</div>
              )}
            </div>
          )}
        </section>

        {/* Relationship Tabs */}
        <div className="social-tabs" role="tablist" aria-label="Friend lists">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'friends'}
            className={cx('social-tab', tab === 'friends' && 'is-active')}
            data-nav=""
            onClick={() => setTab('friends')}
          >
            Friends ({acceptedFriends.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'incoming'}
            className={cx('social-tab', tab === 'incoming' && 'is-active')}
            data-nav=""
            onClick={() => setTab('incoming')}
          >
            Incoming Requests ({incomingRequests.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'outgoing'}
            className={cx('social-tab', tab === 'outgoing' && 'is-active')}
            data-nav=""
            onClick={() => setTab('outgoing')}
          >
            Outgoing ({outgoingRequests.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'blocked'}
            className={cx('social-tab', tab === 'blocked' && 'is-active')}
            data-nav=""
            onClick={() => setTab('blocked')}
          >
            Blocked ({blockedUsers.length})
          </button>
        </div>

        {/* Tab Body */}
        <div className="social-list">
          {tab === 'friends' &&
            (acceptedFriends.length > 0 ? (
              acceptedFriends.map((record) => (
                <div key={record.id} className="social-friend-row">
                  <div className="social-friend-row__main">
                    <Avatar
                      displayName={record.friend.displayName}
                      username={record.friend.username}
                      preset={record.friend.avatarPreset}
                      avatarUrl={record.friend.avatarUrl}
                      presence={record.friend.presence}
                      currentlyPlaying={record.friend.currentlyPlaying}
                      size="lg"
                    />
                    <div className="social-friend-row__info">
                      <div className="social-friend-row__title">
                        <strong>{record.friend.displayName}</strong>
                        <span className="social-friend-row__handle">@{record.friend.username}</span>
                        {record.friend.currentlyPlaying ? (
                          <Badge tone="accent">Reading {record.friend.currentlyPlaying}</Badge>
                        ) : (
                          <Badge tone="neutral">{record.friend.presence}</Badge>
                        )}
                      </div>
                      <p className="social-friend-row__sub">
                        {record.friend.customization.statusLine || record.friend.bio || 'Visual novel reader'}
                      </p>
                    </div>
                  </div>
                  <div className="social-friend-row__actions">
                    <Button
                      variant="primary"
                      icon="message"
                      onClick={() => void handleOpenChat(record.friend.userId)}
                    >
                      Message
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => navigate({ name: 'profile', userId: record.friend.userId })}
                    >
                      Profile
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => void handleRemoveFriend(record.friend.userId, record.friend.displayName)}
                    >
                      Remove
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => void handleBlockUser(record.friend.userId, record.friend.displayName)}
                    >
                      Block
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <div className="social-empty">
                <p>No accepted friends yet. Enter a Friend Code above to connect with a reader!</p>
              </div>
            ))}

          {tab === 'incoming' &&
            (incomingRequests.length > 0 ? (
              incomingRequests.map((record) => (
                <div key={record.id} className="social-friend-row">
                  <div className="social-friend-row__main">
                    <Avatar
                      displayName={record.friend.displayName}
                      username={record.friend.username}
                      preset={record.friend.avatarPreset}
                      avatarUrl={record.friend.avatarUrl}
                      size="lg"
                    />
                    <div className="social-friend-row__info">
                      <div className="social-friend-row__title">
                        <strong>{record.friend.displayName}</strong>
                        <span className="social-friend-row__handle">@{record.friend.username}</span>
                        <Badge tone="accent">Incoming Request</Badge>
                      </div>
                      <p className="social-friend-row__sub">Wants to connect and exchange messages.</p>
                    </div>
                  </div>
                  <div className="social-friend-row__actions">
                    <Button
                      variant="primary"
                      disabled={busy}
                      onClick={() => void handleRespond(record.id, 'accept')}
                    >
                      Accept
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void handleRespond(record.id, 'decline')}
                    >
                      Decline
                    </Button>
                    <Button
                      variant="danger"
                      disabled={busy}
                      onClick={() => void handleBlockUser(record.friend.userId, record.friend.displayName)}
                    >
                      Block
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <div className="social-empty">
                <p>No incoming friend requests right now.</p>
              </div>
            ))}

          {tab === 'outgoing' &&
            (outgoingRequests.length > 0 ? (
              outgoingRequests.map((record) => (
                <div key={record.id} className="social-friend-row">
                  <div className="social-friend-row__main">
                    <Avatar
                      displayName={record.friend.displayName}
                      username={record.friend.username}
                      preset={record.friend.avatarPreset}
                      avatarUrl={record.friend.avatarUrl}
                      size="lg"
                    />
                    <div className="social-friend-row__info">
                      <div className="social-friend-row__title">
                        <strong>{record.friend.displayName}</strong>
                        <span className="social-friend-row__handle">@{record.friend.username}</span>
                        <Badge tone="neutral">Pending Acceptance</Badge>
                      </div>
                      <p className="social-friend-row__sub">
                        Sent friend request — you can message each other once accepted.
                      </p>
                    </div>
                  </div>
                  <div className="social-friend-row__actions">
                    <Button
                      variant="ghost"
                      onClick={() => navigate({ name: 'profile', userId: record.friend.userId })}
                    >
                      Profile
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void handleRespond(record.id, 'cancel')}
                    >
                      Cancel Request
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <div className="social-empty">
                <p>No outgoing friend requests pending.</p>
              </div>
            ))}

          {tab === 'blocked' &&
            (blockedUsers.length > 0 ? (
              blockedUsers.map((blocked) => (
                <div key={blocked.userId} className="social-friend-row">
                  <div className="social-friend-row__main">
                    <Avatar
                      displayName={blocked.displayName}
                      username={blocked.username}
                      preset={blocked.avatarPreset}
                      size="md"
                    />
                    <div className="social-friend-row__info">
                      <div className="social-friend-row__title">
                        <strong>{blocked.displayName}</strong>
                        <span className="social-friend-row__handle">@{blocked.username}</span>
                        <Badge tone="danger">Blocked</Badge>
                      </div>
                      <p className="social-friend-row__sub">
                        Cannot send you friend requests or messages.
                      </p>
                    </div>
                  </div>
                  <div className="social-friend-row__actions">
                    <Button
                      variant="ghost"
                      onClick={() => void handleUnblockUser(blocked.userId, blocked.displayName)}
                    >
                      Unblock
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <div className="social-empty">
                <p>You have not blocked any users.</p>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}
