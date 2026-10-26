import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { DirectMessage, ReportCategory } from '@shared/social'
import { AuthPanel } from '@renderer/components/social/AuthPanel'
import { Avatar } from '@renderer/components/social/Avatar'
import { Badge } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { Icon } from '@renderer/components/ui/Icon'
import { Select } from '@renderer/components/ui/Select'
import { cx } from '@renderer/lib/cx'
import { services } from '@renderer/services'
import { useAppStore } from '@renderer/state/appStore'

const PAGE_SIZE = 40

function formatTimeShort(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export function MessagesView({ conversationId }: { conversationId?: string | null }) {
  const social = useAppStore((state) => state.social)
  const activeConversationId = useAppStore((state) => state.activeConversationId)
  const setActiveConversation = useAppStore((state) => state.setActiveConversation)
  const draftMessages = useAppStore((state) => state.draftMessages)
  const setDraftMessage = useAppStore((state) => state.setDraftMessage)
  const refreshSocial = useAppStore((state) => state.refreshSocial)
  const navigate = useAppStore((state) => state.navigate)
  const showToast = useAppStore((state) => state.showToast)

  const [filterText, setFilterText] = useState('')
  const [messages, setMessages] = useState<DirectMessage[]>([])
  const [hasOlder, setHasOlder] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportCategory, setReportCategory] = useState<ReportCategory>('harassment')
  const [reportDetails, setReportDetails] = useState('')

  const threadEndRef = useRef<HTMLDivElement>(null)

  const visibleConversations = useMemo(() => {
    const q = filterText.trim().toLowerCase()
    return social.conversations.filter((c) => {
      if (c.hidden && c.id !== activeConversationId && c.id !== conversationId) return false
      if (!q) return true
      return (
        c.participant.displayName.toLowerCase().includes(q) ||
        c.participant.username.toLowerCase().includes(q) ||
        (c.lastMessage?.body.toLowerCase().includes(q) ?? false)
      )
    })
  }, [social.conversations, filterText, activeConversationId, conversationId])

  const selectedId =
    conversationId ?? activeConversationId ?? visibleConversations[0]?.id ?? null

  const activeConvo = useMemo(
    () => social.conversations.find((c) => c.id === selectedId) ?? null,
    [social.conversations, selectedId]
  )

  useEffect(() => {
    if (conversationId && conversationId !== activeConversationId) {
      setActiveConversation(conversationId)
    } else if (!activeConversationId && visibleConversations[0]) {
      setActiveConversation(visibleConversations[0].id)
    }
  }, [conversationId, activeConversationId, visibleConversations, setActiveConversation])

  const loadMessages = useCallback(
    async (convoId: string) => {
      setLoadingMessages(true)
      try {
        const list = await services.social.listMessages(convoId, { limit: PAGE_SIZE })
        setMessages(list)
        setHasOlder(list.length >= PAGE_SIZE)
        await services.social.markConversationRead(convoId)
        await refreshSocial()
      } catch {
        setMessages([])
      } finally {
        setLoadingMessages(false)
      }
    },
    [refreshSocial]
  )

  useEffect(() => {
    if (!selectedId || !social.user) {
      setMessages([])
      return
    }
    void loadMessages(selectedId)
  }, [selectedId, social.user, loadMessages])

  // Real-time incoming message subscription for the active thread
  useEffect(() => {
    if (!selectedId || !social.user) return
    return services.social.subscribe((event) => {
      if (event.type === 'message-received' && event.conversationId === selectedId) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === event.message.id)) return prev
          return [...prev, event.message]
        })
        void services.social.markConversationRead(selectedId).then(() => refreshSocial())
      } else if (event.type === 'state-changed' && selectedId) {
        void services.social.listMessages(selectedId, { limit: PAGE_SIZE }).then((list) => {
          setMessages(list)
        })
      }
    })
  }, [selectedId, social.user, refreshSocial])

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, selectedId])

  if (!social.user || !social.profile) {
    return (
      <div className="lib">
        <div className="lib__scroll" data-scroll-y="">
          <AuthPanel subtitle="Sign in or create an account to exchange private 1-to-1 messages with your friends." />
        </div>
      </div>
    )
  }

  const currentDraft = selectedId ? (draftMessages[selectedId] ?? '') : ''

  const handleLoadOlder = async () => {
    if (!selectedId || messages.length === 0) return
    const oldest = messages[0]
    try {
      const older = await services.social.listMessages(selectedId, {
        limit: PAGE_SIZE,
        before: oldest.createdAt
      })
      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id))
        return [...older.filter((m) => !existingIds.has(m.id)), ...prev]
      })
      setHasOlder(older.length >= PAGE_SIZE)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not load older messages.', 'error')
    }
  }

  const handleSend = async (retryMessage?: DirectMessage) => {
    if (!selectedId || !activeConvo) return
    const body = (retryMessage ? retryMessage.body : currentDraft).trim()
    if (!body || sending) return

    const clientMessageId =
      retryMessage?.clientMessageId ??
      `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

    const optimistic: DirectMessage = {
      id: retryMessage?.id ?? `temp-${clientMessageId}`,
      conversationId: selectedId,
      senderId: social.user!.id,
      clientMessageId,
      body,
      createdAt: new Date().toISOString(),
      deliveryStatus: 'sending'
    }

    if (!retryMessage) {
      setDraftMessage(selectedId, '')
      setMessages((prev) => [...prev, optimistic])
    } else {
      setMessages((prev) =>
        prev.map((m) => (m.id === retryMessage.id ? { ...m, deliveryStatus: 'sending' } : m))
      )
    }

    setSending(true)
    try {
      const delivered = await services.social.sendMessage({
        conversationId: selectedId,
        body,
        clientMessageId
      })
      setMessages((prev) =>
        prev.map((m) =>
          m.clientMessageId === clientMessageId || m.id === optimistic.id ? delivered : m
        )
      )
      await refreshSocial()
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.clientMessageId === clientMessageId || m.id === optimistic.id
            ? { ...m, deliveryStatus: 'failed' }
            : m
        )
      )
      showToast(err instanceof Error ? err.message : 'Message failed to send.', 'error')
    } finally {
      setSending(false)
    }
  }

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void handleSend()
    }
  }

  const handleToggleMute = async () => {
    if (!activeConvo) return
    try {
      await services.social.setConversationMuted(activeConvo.id, !activeConvo.muted)
      await refreshSocial()
      showToast(
        activeConvo.muted ? 'Conversation notifications unmuted.' : 'Conversation notifications muted.',
        'info'
      )
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update mute setting.', 'error')
    }
  }

  const handleClearHistory = async () => {
    if (!activeConvo) return
    try {
      await services.social.clearConversationHistory(activeConvo.id)
      setMessages([])
      await refreshSocial()
      showToast('Local conversation history cleared.', 'info')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not clear history.', 'error')
    }
  }

  const handleHideConversation = async () => {
    if (!activeConvo) return
    try {
      await services.social.setConversationHidden(activeConvo.id, true)
      await refreshSocial()
      setActiveConversation(null)
      showToast('Conversation hidden from list.', 'info')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not hide conversation.', 'error')
    }
  }

  const handleBlockParticipant = async () => {
    if (!activeConvo) return
    try {
      await services.social.blockUser(activeConvo.participant.userId)
      await refreshSocial()
      showToast(`Blocked ${activeConvo.participant.displayName}.`, 'info')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not block user.', 'error')
    }
  }

  const handleSubmitReport = async () => {
    if (!activeConvo) return
    try {
      await services.social.reportAbuse({
        targetUserId: activeConvo.participant.userId,
        category: reportCategory,
        details: reportDetails || 'Reported from direct messenger'
      })
      setReportOpen(false)
      setReportDetails('')
      showToast('Report submitted. You can also block this user at any time.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not submit report.', 'error')
    }
  }

  return (
    <div className="lib social-messages-view">
      <div className="messenger">
        {/* Left Sidebar: Conversation List */}
        <aside className="messenger__sidebar" aria-label="Conversations">
          <div className="messenger__sidebar-head">
            <h1 className="messenger__title">Messages</h1>
            <Button size="sm" icon="users" onClick={() => navigate({ name: 'friends' })}>
              Friends
            </Button>
          </div>

          <div className="messenger__search">
            <Icon name="search" size={16} />
            <input
              type="search"
              placeholder="Filter conversations…"
              value={filterText}
              data-nav=""
              onChange={(e) => setFilterText(e.target.value)}
            />
          </div>

          <div className="messenger__convo-list" data-scroll-y="">
            {visibleConversations.length > 0 ? (
              visibleConversations.map((convo, index) => {
                const isSelected = convo.id === activeConvo?.id
                return (
                  <button
                    key={convo.id}
                    type="button"
                    data-nav=""
                    data-entry-point={index === 0 ? '' : undefined}
                    className={cx('messenger__convo-item', isSelected && 'is-active')}
                    onClick={() => {
                      setActiveConversation(convo.id)
                      navigate({ name: 'messages', conversationId: convo.id })
                    }}
                  >
                    <Avatar
                      displayName={convo.participant.displayName}
                      username={convo.participant.username}
                      preset={convo.participant.avatarPreset}
                      avatarUrl={convo.participant.avatarUrl}
                      presence={convo.participant.presence}
                      currentlyPlaying={convo.participant.currentlyPlaying}
                      size="md"
                    />
                    <div className="messenger__convo-body">
                      <div className="messenger__convo-top">
                        <span className="messenger__convo-name">
                          {convo.participant.displayName}
                        </span>
                        {convo.lastMessage && (
                          <time className="messenger__convo-time">
                            {formatTimeShort(convo.lastMessage.createdAt)}
                          </time>
                        )}
                      </div>
                      <div className="messenger__convo-bottom">
                        <span className="messenger__convo-preview">
                          {convo.participant.currentlyPlaying
                            ? `▶ Reading ${convo.participant.currentlyPlaying}`
                            : convo.lastMessage?.body || 'Start a conversation…'}
                        </span>
                        {convo.unreadCount > 0 && (
                          <span className="messenger__unread-badge">{convo.unreadCount}</span>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })
            ) : (
              <div className="messenger__sidebar-empty">
                <p>No active conversations yet.</p>
                <Button size="sm" onClick={() => navigate({ name: 'friends' })}>
                  Message a Friend
                </Button>
              </div>
            )}
          </div>
        </aside>

        {/* Right Pane: Active 1-to-1 Thread */}
        <section className="messenger__main" aria-label="Direct conversation">
          {activeConvo ? (
            <>
              <header className="messenger__header">
                <div className="messenger__header-partner">
                  <Avatar
                    displayName={activeConvo.participant.displayName}
                    username={activeConvo.participant.username}
                    preset={activeConvo.participant.avatarPreset}
                    avatarUrl={activeConvo.participant.avatarUrl}
                    presence={activeConvo.participant.presence}
                    currentlyPlaying={activeConvo.participant.currentlyPlaying}
                    size="md"
                  />
                  <div>
                    <div className="messenger__partner-title">
                      <strong>{activeConvo.participant.displayName}</strong>
                      <span className="messenger__partner-handle">
                        @{activeConvo.participant.username}
                      </span>
                      {activeConvo.muted && <Badge tone="neutral">Muted</Badge>}
                    </div>
                    <div className="messenger__partner-status">
                      {activeConvo.participant.currentlyPlaying
                        ? `Reading ${activeConvo.participant.currentlyPlaying}`
                        : activeConvo.participant.presence === 'online'
                          ? 'Online'
                          : activeConvo.participant.presence === 'away'
                            ? 'Away'
                            : 'Offline'}
                    </div>
                  </div>
                </div>

                <div className="messenger__header-actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      navigate({ name: 'profile', userId: activeConvo.participant.userId })
                    }
                  >
                    Profile
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void handleToggleMute()}>
                    {activeConvo.muted ? 'Unmute' : 'Mute'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void handleClearHistory()}>
                    Clear
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void handleHideConversation()}>
                    Hide
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setReportOpen((prev) => !prev)}
                  >
                    Report
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => void handleBlockParticipant()}
                  >
                    Block
                  </Button>
                </div>
              </header>

              {reportOpen && (
                <div className="messenger__report-bar" role="region" aria-label="Report abuse">
                  <div className="messenger__report-fields">
                    <Select
                      label="Report Reason"
                      value={reportCategory}
                      onChange={(val) => setReportCategory(val as ReportCategory)}
                      options={[
                        { value: 'harassment', label: 'Harassment' },
                        { value: 'spam', label: 'Spam' },
                        { value: 'inappropriate', label: 'Inappropriate content' },
                        { value: 'impersonation', label: 'Impersonation' },
                        { value: 'other', label: 'Other' }
                      ]}
                    />
                    <input
                      type="text"
                      placeholder="Optional details…"
                      value={reportDetails}
                      data-nav=""
                      onChange={(e) => setReportDetails(e.target.value)}
                    />
                    <Button size="sm" variant="danger" onClick={() => void handleSubmitReport()}>
                      Submit Report
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setReportOpen(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              <div className="messenger__thread" data-scroll-y="">
                {hasOlder && (
                  <div className="messenger__load-older">
                    <Button size="sm" variant="ghost" onClick={() => void handleLoadOlder()}>
                      Load older messages
                    </Button>
                  </div>
                )}

                {loadingMessages && messages.length === 0 ? (
                  <div className="messenger__empty-thread">Loading messages…</div>
                ) : messages.length > 0 ? (
                  messages.map((msg) => {
                    const isMine = msg.senderId === social.user?.id
                    return (
                      <div
                        key={msg.id}
                        className={cx('messenger__msg', isMine ? 'is-mine' : 'is-theirs')}
                      >
                        <div className="messenger__bubble">
                          <p className="messenger__body">{msg.body}</p>
                          <div className="messenger__meta">
                            <time>{formatTimeShort(msg.createdAt)}</time>
                            {isMine && (
                              <span
                                className={cx(
                                  'messenger__delivery',
                                  `is-${msg.deliveryStatus}`
                                )}
                              >
                                {msg.deliveryStatus === 'sending'
                                  ? '· Sending…'
                                  : msg.deliveryStatus === 'failed'
                                    ? '· Failed'
                                    : '· Sent'}
                              </span>
                            )}
                            {msg.deliveryStatus === 'failed' && (
                              <button
                                type="button"
                                className="messenger__retry"
                                data-nav=""
                                onClick={() => void handleSend(msg)}
                              >
                                Retry
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })
                ) : (
                  <div className="messenger__empty-thread">
                    <p>
                      Say hello to <strong>{activeConvo.participant.displayName}</strong>! Only you
                      and {activeConvo.participant.displayName} can read messages in this
                      conversation.
                    </p>
                  </div>
                )}
                <div ref={threadEndRef} />
              </div>

              <footer className="messenger__composer">
                {activeConvo.canMessage ? (
                  <div className="messenger__composer-row">
                    <textarea
                      rows={2}
                      maxLength={2000}
                      placeholder={`Message ${activeConvo.participant.displayName}… (Enter to send, Shift+Enter for new line)`}
                      value={currentDraft}
                      data-nav=""
                      onChange={(e) =>
                        selectedId && setDraftMessage(selectedId, e.target.value)
                      }
                      onKeyDown={handleComposerKeyDown}
                    />
                    <Button
                      variant="primary"
                      icon="send"
                      disabled={!currentDraft.trim() || sending}
                      onClick={() => void handleSend()}
                    >
                      Send
                    </Button>
                  </div>
                ) : (
                  <div className="messenger__disabled-banner">
                    {activeConvo.blockReason ??
                      'You can only send messages to accepted friends who have not blocked you.'}
                  </div>
                )}
              </footer>
            </>
          ) : (
            <div className="messenger__no-selection">
              <Icon name="message" size={32} />
              <h2>Select a Friend to Message</h2>
              <p>
                Direct conversations are private 1-to-1 threads between mutually accepted friends.
              </p>
              <Button variant="primary" icon="users" onClick={() => navigate({ name: 'friends' })}>
                Open Friends List
              </Button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
