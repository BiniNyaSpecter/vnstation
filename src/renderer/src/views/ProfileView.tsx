import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import {
  AVATAR_PRESETS,
  PROFILE_THEMES,
  sanitizeSafeImageUrl,
  type AvatarPresetId,
  type FeaturedCharacterEntry,
  type FeaturedVnEntry,
  type ProfileLayoutId,
  type ProfilePatchInput,
  type ProfilePrivacySettings,
  type ProfileThemeId,
  type ProfileVisibility,
  type PublicProfileView,
  type UserProfile
} from '@shared/social'
import { AuthPanel } from '@renderer/components/social/AuthPanel'
import { Avatar } from '@renderer/components/social/Avatar'
import { Badge } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { Icon } from '@renderer/components/ui/Icon'
import { Select } from '@renderer/components/ui/Select'
import { Switch } from '@renderer/components/ui/Switch'
import { cx } from '@renderer/lib/cx'
import { services } from '@renderer/services'
import { useAppStore } from '@renderer/state/appStore'

const THEME_ENTRIES = Object.values(PROFILE_THEMES)
const PRESET_ENTRIES = Object.entries(AVATAR_PRESETS) as Array<
  [AvatarPresetId, { label: string; gradient: string; monogram: string }]
>

const LAYOUT_OPTIONS: Array<{ value: ProfileLayoutId; label: string }> = [
  { value: 'myspace-classic', label: 'MySpace Classic (2-Column)' },
  { value: 'editorial-showcase', label: 'Editorial Showcase' },
  { value: 'compact-console', label: 'Compact Console' }
]

const VISIBILITY_OPTIONS: Array<{ value: ProfileVisibility; label: string }> = [
  { value: 'public', label: 'Public (Anyone with Friend Code)' },
  { value: 'friends', label: 'Friends Only' },
  { value: 'private', label: 'Only Me (Private)' }
]

export function ProfileView({ userId }: { userId?: string | null }) {
  const social = useAppStore((state) => state.social)
  const games = useAppStore((state) => state.games)
  const refreshSocial = useAppStore((state) => state.refreshSocial)
  const navigate = useAppStore((state) => state.navigate)
  const setActiveConversation = useAppStore((state) => state.setActiveConversation)
  const showToast = useAppStore((state) => state.showToast)

  const selfProfile = social.profile
  const isViewingOther = Boolean(userId && selfProfile && userId !== selfProfile.userId)

  const [profileView, setProfileView] = useState<PublicProfileView | null>(null)
  const [loadingView, setLoadingView] = useState(false)
  const [previewRole, setPreviewRole] = useState<'self' | 'friend' | 'stranger'>('self')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  // Editor state
  const [displayName, setDisplayName] = useState('')
  const [statusLine, setStatusLine] = useState('')
  const [bio, setBio] = useState('')
  const [nowListening, setNowListening] = useState('')
  const [avatarPreset, setAvatarPreset] = useState<AvatarPresetId>('aoko')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [backgroundUrl, setBackgroundUrl] = useState('')
  const [theme, setTheme] = useState<ProfileThemeId>('midnight-console')
  const [layout, setLayout] = useState<ProfileLayoutId>('myspace-classic')
  const [accentColor, setAccentColor] = useState('#9db4ff')
  const [featuredVn, setFeaturedVn] = useState<FeaturedVnEntry | null>(null)
  const [favoriteVns, setFavoriteVns] = useState<FeaturedVnEntry[]>([])
  const [featuredCharName, setFeaturedCharName] = useState('')
  const [featuredCharVn, setFeaturedCharVn] = useState('')
  const [featuredCharNote, setFeaturedCharNote] = useState('')
  const [privacy, setPrivacy] = useState<ProfilePrivacySettings | null>(null)

  const syncEditorFromProfile = useCallback((p: UserProfile) => {
    setDisplayName(p.displayName)
    setStatusLine(p.customization.statusLine)
    setBio(p.bio)
    setNowListening(p.customization.nowListening)
    setAvatarPreset(p.avatarPreset)
    setAvatarUrl(p.avatarUrl ?? '')
    setBackgroundUrl(p.customization.backgroundUrl ?? '')
    setTheme(p.customization.theme)
    setLayout(p.customization.layout)
    setAccentColor(p.customization.accentColor)
    setFeaturedVn(p.customization.featuredVn)
    setFavoriteVns(p.customization.favoriteVns)
    setFeaturedCharName(p.customization.featuredCharacter?.name ?? '')
    setFeaturedCharVn(p.customization.featuredCharacter?.vnTitle ?? '')
    setFeaturedCharNote(p.customization.featuredCharacter?.note ?? '')
    setPrivacy({ ...p.privacy })
  }, [])

  useEffect(() => {
    if (selfProfile && !editing) {
      syncEditorFromProfile(selfProfile)
    }
  }, [selfProfile, editing, syncEditorFromProfile])

  const loadDisplayedProfile = useCallback(async () => {
    if (!selfProfile) {
      setProfileView(null)
      return
    }
    const targetId = isViewingOther && userId ? userId : selfProfile.userId
    const role = isViewingOther ? undefined : previewRole
    setLoadingView(true)
    try {
      const view = await services.social.getProfileView(targetId, role)
      setProfileView(view)
    } catch {
      setProfileView(null)
    } finally {
      setLoadingView(false)
    }
  }, [selfProfile, isViewingOther, userId, previewRole])

  useEffect(() => {
    void loadDisplayedProfile()
  }, [loadDisplayedProfile, social.friends])

  if (!social.user || !selfProfile) {
    return (
      <div className="lib">
        <div className="lib__scroll" data-scroll-y="">
          <AuthPanel subtitle="Sign in or create an account to customize your MySpace-inspired Visual Novel profile." />
        </div>
      </div>
    )
  }

  if (loadingView && !profileView) {
    return (
      <div className="lib">
        <div className="lib__scroll" data-scroll-y="">
          <div className="social-empty">Loading profile…</div>
        </div>
      </div>
    )
  }

  if (!profileView) {
    return (
      <div className="lib">
        <div className="lib__scroll" data-scroll-y="">
          <div className="social-empty">
            <p>Profile not found or not accessible.</p>
            <Button onClick={() => navigate({ name: 'profile' })}>Back to My Profile</Button>
          </div>
        </div>
      </div>
    )
  }

  const themeDef = PROFILE_THEMES[profileView.customization.theme] ?? PROFILE_THEMES['midnight-console']
  const safeBanner = sanitizeSafeImageUrl(profileView.customization.backgroundUrl)

  const handleCopyCode = async () => {
    const code = profileView.friendCode ?? selfProfile.friendCode
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      showToast(`Copied Friend Code ${code} to clipboard.`, 'success')
    } catch {
      showToast(`Friend Code: ${code}`, 'info')
    }
  }

  const handleSaveProfile = async () => {
    setSaving(true)
    try {
      const character: FeaturedCharacterEntry | null = featuredCharName.trim()
        ? {
            characterId: 'custom',
            vndbId: '',
            name: featuredCharName.trim(),
            vnTitle: featuredCharVn.trim() || 'Visual Novel',
            portraitUrl: null,
            note: featuredCharNote.trim()
          }
        : null

      const patch: ProfilePatchInput = {
        displayName,
        bio,
        avatarPreset,
        avatarUrl: avatarUrl.trim() || null,
        customization: {
          theme,
          layout,
          accentColor,
          backgroundUrl: backgroundUrl.trim() || null,
          statusLine,
          nowListening,
          featuredVn,
          favoriteVns,
          featuredCharacter: character
        },
        privacy: privacy ?? undefined
      }
      await services.social.updateProfile(patch)
      await refreshSocial()
      await loadDisplayedProfile()
      setEditing(false)
      showToast('Profile saved and updated.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save profile.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handlePickFeaturedFromLibrary = (gameId: string) => {
    if (!gameId) {
      setFeaturedVn(null)
      return
    }
    const g = games.find((item) => item.id === gameId)
    if (!g) return
    setFeaturedVn({
      title: g.title,
      vndbId: g.source?.externalId ?? null,
      developer: g.developer || null,
      coverUrl: sanitizeSafeImageUrl(g.coverUrl),
      blurb: featuredVn?.blurb ?? ''
    })
  }

  const handleToggleFavoriteVnFromLibrary = (gameId: string) => {
    const g = games.find((item) => item.id === gameId)
    if (!g) return
    const exists = favoriteVns.some((v) => v.title === g.title)
    if (exists) {
      setFavoriteVns(favoriteVns.filter((v) => v.title !== g.title))
    } else {
      if (favoriteVns.length >= 6) {
        showToast('You can showcase up to 6 favorite visual novels on your shelf.', 'info')
        return
      }
      setFavoriteVns([
        ...favoriteVns,
        {
          title: g.title,
          vndbId: g.source?.externalId ?? null,
          developer: g.developer || null,
          coverUrl: sanitizeSafeImageUrl(g.coverUrl),
          blurb: ''
        }
      ])
    }
  }

  const handleStartChatWithProfile = async (targetUserId: string) => {
    try {
      const convo = await services.social.openDirectConversation(targetUserId)
      await refreshSocial()
      setActiveConversation(convo.id)
      navigate({ name: 'messages', conversationId: convo.id })
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not start conversation.', 'error')
    }
  }

  return (
    <div className="lib social-profile-view">
      <div className="lib__scroll" data-scroll-y="">
        {/* Top Action Bar */}
        <div className="social-profile__toolbar">
          <div className="social-profile__toolbar-left">
            {isViewingOther ? (
              <Button icon="arrowLeft" entryPoint onClick={() => navigate({ name: 'profile' })}>
                Back to My Profile
              </Button>
            ) : (
              <div className="social-profile__preview-bar" role="group" aria-label="Preview profile as">
                <span className="social-profile__preview-label">Preview as:</span>
                {(['self', 'friend', 'stranger'] as const).map((role) => (
                  <button
                    key={role}
                    type="button"
                    data-nav=""
                    className={cx('social-pill-btn', previewRole === role && 'is-active')}
                    onClick={() => setPreviewRole(role)}
                  >
                    {role === 'self' ? 'Self' : role === 'friend' ? 'Friend' : 'Stranger (Public)'}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="social-profile__toolbar-right">
            {!isViewingOther ? (
              <>
                <Button
                  variant={editing ? 'ghost' : 'primary'}
                  icon="edit"
                  data-entry-point=""
                  onClick={() => {
                    if (editing && selfProfile) syncEditorFromProfile(selfProfile)
                    setEditing(!editing)
                  }}
                >
                  {editing ? 'Cancel Editing' : 'Customize Profile'}
                </Button>
                <Button variant="ghost" icon="users" onClick={() => navigate({ name: 'friends' })}>
                  Friends ({social.friends.filter((f) => f.status === 'accepted').length})
                </Button>
              </>
            ) : (
              <>
                {profileView.viewerRelationship === 'friend' && (
                  <Button
                    variant="primary"
                    icon="message"
                    onClick={() => void handleStartChatWithProfile(profileView.userId)}
                  >
                    Send Message
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Live Profile Editor Drawer */}
        {editing && !isViewingOther && (
          <section className="social-editor" aria-label="Customize Profile">
            <div className="social-editor__header">
              <div>
                <h2 className="social-editor__title">Profile Studio & Privacy Controls</h2>
                <p className="social-editor__subtitle">
                  Express your visual novel taste with curated themes, layouts, and shelves. Local file paths and
                  private notes are never shared.
                </p>
              </div>
              <div className="social-editor__actions">
                <Button variant="primary" disabled={saving} onClick={() => void handleSaveProfile()}>
                  {saving ? 'Saving…' : 'Save Changes'}
                </Button>
              </div>
            </div>

            <div className="social-editor__grid">
              {/* Column 1: Identity & Status */}
              <div className="social-editor__card">
                <h3 className="social-editor__section-title">Identity & Status</h3>
                <label className="field">
                  <span className="field__label">Display Name</span>
                  <input
                    type="text"
                    maxLength={40}
                    value={displayName}
                    data-nav=""
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="field__label">Mood / Status Line</span>
                  <input
                    type="text"
                    maxLength={100}
                    placeholder="Late-night visual novel reader & soundtrack collector"
                    value={statusLine}
                    data-nav=""
                    onChange={(e) => setStatusLine(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="field__label">Now Reading / Listening To</span>
                  <input
                    type="text"
                    maxLength={90}
                    placeholder="e.g. Mahoutsukai no Yoru OST — Five"
                    value={nowListening}
                    data-nav=""
                    onChange={(e) => setNowListening(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="field__label">About Me / Bio</span>
                  <textarea
                    rows={4}
                    maxLength={600}
                    placeholder="Tell friends about your favorite visual novels, writers, soundtracks, or reading habits…"
                    value={bio}
                    data-nav=""
                    onChange={(e) => setBio(e.target.value)}
                  />
                </label>
              </div>

              {/* Column 2: MySpace-Inspired Theme & Visuals */}
              <div className="social-editor__card">
                <h3 className="social-editor__section-title">Theme, Layout & Artwork</h3>
                <div className="field">
                  <span className="field__label">Profile Theme Preset</span>
                  <div className="social-theme-grid">
                    {THEME_ENTRIES.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        data-nav=""
                        className={cx('social-theme-card', theme === preset.id && 'is-selected')}
                        style={{ background: preset.bannerGradient }}
                        onClick={() => {
                          setTheme(preset.id)
                          setAccentColor(preset.defaultAccent)
                        }}
                      >
                        <span className="social-theme-card__name">{preset.label}</span>
                        <span className="social-theme-card__desc">{preset.tagline}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="social-auth__row">
                  <div className="field">
                    <span className="field__label">Page Layout</span>
                    <Select
                      label="Page Layout"
                      value={layout}
                      onChange={(val) => setLayout(val as ProfileLayoutId)}
                      options={LAYOUT_OPTIONS}
                    />
                  </div>
                  <label className="field">
                    <span className="field__label">Custom Accent Color</span>
                    <input
                      type="color"
                      value={accentColor}
                      data-nav=""
                      onChange={(e) => setAccentColor(e.target.value)}
                    />
                  </label>
                </div>

                <div className="field">
                  <span className="field__label">Avatar Emblem Preset</span>
                  <div className="social-auth__presets">
                    {PRESET_ENTRIES.map(([id, preset]) => (
                      <button
                        key={id}
                        type="button"
                        data-nav=""
                        className={cx('social-auth__preset', avatarPreset === id && 'is-selected')}
                        onClick={() => setAvatarPreset(id)}
                      >
                        <Avatar displayName={displayName} preset={id} size="sm" />
                        <span>{preset.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="social-auth__row">
                  <label className="field">
                    <span className="field__label">Custom Avatar Image URL (https://)</span>
                    <input
                      type="url"
                      placeholder="https://..."
                      value={avatarUrl}
                      data-nav=""
                      onChange={(e) => setAvatarUrl(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">Custom Banner Image URL (https://)</span>
                    <input
                      type="url"
                      placeholder="https://..."
                      value={backgroundUrl}
                      data-nav=""
                      onChange={(e) => setBackgroundUrl(e.target.value)}
                    />
                  </label>
                </div>
              </div>

              {/* Column 3: Visual Novel Showcase & Privacy */}
              <div className="social-editor__card">
                <h3 className="social-editor__section-title">Visual Novel Showcase</h3>
                <div className="field">
                  <span className="field__label">Featured Visual Novel (from your library)</span>
                  <Select
                    label="Featured Visual Novel"
                    value={games.find((g) => g.title === featuredVn?.title)?.id ?? ''}
                    onChange={(val) => handlePickFeaturedFromLibrary(val)}
                    options={[
                      { value: '', label: 'None selected' },
                      ...games.map((g) => ({ value: g.id, label: g.title }))
                    ]}
                  />
                </div>
                {featuredVn && (
                  <label className="field">
                    <span className="field__label">Featured VN Personal Note</span>
                    <input
                      type="text"
                      maxLength={220}
                      placeholder="Why this visual novel means a lot to you…"
                      value={featuredVn.blurb}
                      data-nav=""
                      onChange={(e) => setFeaturedVn({ ...featuredVn, blurb: e.target.value })}
                    />
                  </label>
                )}

                <div className="field">
                  <span className="field__label">
                    Favorite VNs Shelf ({favoriteVns.length}/6 selected — click to toggle)
                  </span>
                  <div className="social-library-picker">
                    {games.map((g) => {
                      const active = favoriteVns.some((v) => v.title === g.title)
                      return (
                        <button
                          key={g.id}
                          type="button"
                          data-nav=""
                          className={cx('social-pill-btn', active && 'is-active')}
                          onClick={() => handleToggleFavoriteVnFromLibrary(g.id)}
                        >
                          {active ? '★ ' : '+ '}
                          {g.title}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="social-auth__row">
                  <label className="field">
                    <span className="field__label">Featured Character Name</span>
                    <input
                      type="text"
                      maxLength={60}
                      placeholder="e.g. Aoko Aozaki"
                      value={featuredCharName}
                      data-nav=""
                      onChange={(e) => setFeaturedCharName(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">From Visual Novel</span>
                    <input
                      type="text"
                      maxLength={80}
                      placeholder="e.g. Witch on the Holy Night"
                      value={featuredCharVn}
                      data-nav=""
                      onChange={(e) => setFeaturedCharVn(e.target.value)}
                    />
                  </label>
                </div>
                <label className="field">
                  <span className="field__label">Character Quote / Note</span>
                  <input
                    type="text"
                    maxLength={180}
                    placeholder="Favorite quote or character note…"
                    value={featuredCharNote}
                    data-nav=""
                    onChange={(e) => setFeaturedCharNote(e.target.value)}
                  />
                </label>

                {privacy && (
                  <div className="social-editor__privacy">
                    <h4 className="social-editor__section-title">Privacy Visibility</h4>
                    <div className="social-privacy-row">
                      <span>Profile Bio & Sections</span>
                      <Select
                        label="Profile Visibility"
                        value={privacy.profileVisibility}
                        onChange={(v) => setPrivacy({ ...privacy, profileVisibility: v as ProfileVisibility })}
                        options={VISIBILITY_OPTIONS}
                      />
                    </div>
                    <div className="social-privacy-row">
                      <span>Featured & Favorite VNs</span>
                      <Select
                        label="Featured VNs Visibility"
                        value={privacy.featuredVnsVisibility}
                        onChange={(v) => setPrivacy({ ...privacy, featuredVnsVisibility: v as ProfileVisibility })}
                        options={VISIBILITY_OPTIONS}
                      />
                    </div>
                    <div className="social-privacy-row">
                      <span>Show Currently Playing Status</span>
                      <Switch
                        label="Show Currently Playing Status"
                        checked={privacy.showCurrentlyPlaying}
                        onChange={(v) => setPrivacy({ ...privacy, showCurrentlyPlaying: v })}
                      />
                    </div>
                    <div className="social-privacy-row">
                      <span>Show Top Friends Grid</span>
                      <Switch
                        label="Show Top Friends Grid"
                        checked={privacy.showFriendsList}
                        onChange={(v) => setPrivacy({ ...privacy, showFriendsList: v })}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* MySpace-Inspired Custom Profile Canvas */}
        <div
          className={cx(
            'myspace-canvas',
            `myspace-canvas--${profileView.customization.layout}`,
            `myspace-theme--${profileView.customization.theme}`
          )}
          style={
            {
              '--profile-accent': profileView.customization.accentColor || themeDef.defaultAccent,
              '--profile-surface': themeDef.surfaceBg,
              '--profile-card': themeDef.cardBg,
              '--profile-border': themeDef.borderColor
            } as CSSProperties
          }
        >
          {/* Profile Banner */}
          <div
            className="myspace-banner"
            style={{
              backgroundImage: safeBanner ? `url("${safeBanner}"), ${themeDef.bannerGradient}` : themeDef.bannerGradient
            }}
          >
            <div className="myspace-banner__overlay" />
            <div className="myspace-banner__content">
              <Avatar
                displayName={profileView.displayName}
                username={profileView.username}
                preset={profileView.avatarPreset}
                avatarUrl={profileView.avatarUrl}
                presence={profileView.presence}
                currentlyPlaying={profileView.currentlyPlaying}
                size="xl"
              />
              <div className="myspace-banner__identity">
                <div className="myspace-banner__name-row">
                  <h1 className="myspace-banner__name">{profileView.displayName}</h1>
                  <span className="myspace-banner__handle">@{profileView.username}</span>
                  <Badge tone="accent">{themeDef.label}</Badge>
                </div>
                {profileView.customization.statusLine && (
                  <p className="myspace-banner__headline">“{profileView.customization.statusLine}”</p>
                )}
                <div className="myspace-banner__chips">
                  <span className="myspace-chip">
                    <strong>Status:</strong>{' '}
                    {profileView.currentlyPlaying
                      ? `Reading ${profileView.currentlyPlaying}`
                      : profileView.presence === 'online'
                        ? 'Online'
                        : profileView.presence === 'away'
                          ? 'Away'
                          : 'Offline'}
                  </span>
                  {profileView.currentlyPlaying && (
                    <span className="myspace-chip myspace-chip--playing">
                      <Icon name="play" size={12} /> {profileView.currentlyPlaying}
                    </span>
                  )}
                </div>
              </div>

              {profileView.friendCode && (
                <div className="myspace-banner__code-box">
                  <span className="myspace-banner__code-label">Friend Code</span>
                  <code className="myspace-banner__code-value">{profileView.friendCode}</code>
                  <Button size="sm" onClick={() => void handleCopyCode()}>
                    Copy Code
                  </Button>
                </div>
              )}
            </div>
          </div>

          {profileView.isRestricted ? (
            <div className="myspace-restricted">
              <Icon name="shield" size={28} />
              <h3>This Profile Is Friends-Only</h3>
              <p>
                {profileView.displayName} shares their bio, favorite visual novels, and reading activity with accepted
                friends only.
              </p>
            </div>
          ) : (
            <div className="myspace-grid">
              {/* Left Column: Now Listening, Character Spotlight, Top Friends */}
              <aside className="myspace-col myspace-col--side">
                {profileView.customization.nowListening && (
                  <div className="myspace-box">
                    <h2 className="myspace-box__title">Now Reading / Listening</h2>
                    <div className="myspace-now-listening">
                      <span className="myspace-equalizer" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                      <span>{profileView.customization.nowListening}</span>
                    </div>
                  </div>
                )}

                {profileView.customization.featuredCharacter && (
                  <div className="myspace-box">
                    <h2 className="myspace-box__title">Character Spotlight</h2>
                    <div className="myspace-character">
                      <div className="myspace-character__name">
                        {profileView.customization.featuredCharacter.name}
                      </div>
                      <div className="myspace-character__vn">
                        {profileView.customization.featuredCharacter.vnTitle}
                      </div>
                      {profileView.customization.featuredCharacter.note && (
                        <blockquote className="myspace-character__quote">
                          “{profileView.customization.featuredCharacter.note}”
                        </blockquote>
                      )}
                    </div>
                  </div>
                )}

                <div className="myspace-box">
                  <div className="myspace-box__head">
                    <h2 className="myspace-box__title">
                      Top Friends ({profileView.friendsPreview.length})
                    </h2>
                    {!isViewingOther && (
                      <button
                        type="button"
                        className="myspace-link"
                        data-nav=""
                        onClick={() => navigate({ name: 'friends' })}
                      >
                        Manage
                      </button>
                    )}
                  </div>
                  {profileView.friendsPreview.length > 0 ? (
                    <div className="myspace-top-friends">
                      {profileView.friendsPreview.map((friend) => (
                        <button
                          key={friend.userId}
                          type="button"
                          className="myspace-friend-tile"
                          data-nav=""
                          onClick={() => navigate({ name: 'profile', userId: friend.userId })}
                        >
                          <Avatar
                            displayName={friend.displayName}
                            username={friend.username}
                            preset={friend.avatarPreset}
                            avatarUrl={friend.avatarUrl}
                            presence={friend.presence}
                            size="md"
                          />
                          <span className="myspace-friend-tile__name">{friend.displayName}</span>
                          <span className="myspace-friend-tile__handle">@{friend.username}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="myspace-muted">
                      No public Top Friends displayed yet. Add friends via Friend Code!
                    </p>
                  )}
                </div>
              </aside>

              {/* Right Column: About Me / Bio, Featured VN Spotlight, Favorite VNs Shelf */}
              <div className="myspace-col myspace-col--main">
                <div className="myspace-box">
                  <h2 className="myspace-box__title">About {profileView.displayName}</h2>
                  {profileView.bio ? (
                    <p className="myspace-bio">{profileView.bio}</p>
                  ) : (
                    <p className="myspace-muted">
                      No bio written yet. Click “Customize Profile” above to share your visual novel story.
                    </p>
                  )}
                </div>

                {profileView.customization.featuredVn && (
                  <div className="myspace-box myspace-box--spotlight">
                    <div className="myspace-box__head">
                      <h2 className="myspace-box__title">Featured Visual Novel</h2>
                      <Badge tone="accent">Spotlight</Badge>
                    </div>
                    <div className="myspace-spotlight">
                      <div className="myspace-spotlight__info">
                        <h3 className="myspace-spotlight__vn-title">
                          {profileView.customization.featuredVn.title}
                        </h3>
                        <div className="myspace-spotlight__meta">
                          {profileView.customization.featuredVn.developer && (
                            <span>{profileView.customization.featuredVn.developer}</span>
                          )}
                          {profileView.customization.featuredVn.vndbId && (
                            <span>VNDB {profileView.customization.featuredVn.vndbId}</span>
                          )}
                        </div>
                        {profileView.customization.featuredVn.blurb && (
                          <p className="myspace-spotlight__blurb">
                            “{profileView.customization.featuredVn.blurb}”
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className="myspace-box">
                  <h2 className="myspace-box__title">Favorite Visual Novels Shelf</h2>
                  {profileView.customization.favoriteVns.length > 0 ? (
                    <div className="myspace-shelf">
                      {profileView.customization.favoriteVns.map((vn, idx) => (
                        <div key={`${vn.title}-${idx}`} className="myspace-shelf__card">
                          <div className="myspace-shelf__spine" />
                          <div className="myspace-shelf__body">
                            <div className="myspace-shelf__title">{vn.title}</div>
                            {vn.developer && <div className="myspace-shelf__sub">{vn.developer}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="myspace-muted">
                      No favorite visual novels showcased yet. Choose up to 6 titles from your library in the Profile
                      Studio.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
