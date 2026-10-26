import { useState } from 'react'
import type { PresenceState, ProfilePrivacySettings, ProfileVisibility } from '@shared/social'
import { Badge } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { Select } from '@renderer/components/ui/Select'
import { Switch } from '@renderer/components/ui/Switch'
import { services } from '@renderer/services'
import { useAppStore } from '@renderer/state/appStore'

const VISIBILITY_OPTIONS: Array<{ value: ProfileVisibility; label: string }> = [
  { value: 'public', label: 'Public (Anyone with Friend Code)' },
  { value: 'friends', label: 'Friends Only' },
  { value: 'private', label: 'Only Me (Private)' }
]

const PRESENCE_OPTIONS: Array<{ value: PresenceState; label: string }> = [
  { value: 'online', label: 'Online' },
  { value: 'away', label: 'Away' },
  { value: 'offline', label: 'Appear Offline' }
]

export function SocialSection() {
  const social = useAppStore((state) => state.social)
  const refreshSocial = useAppStore((state) => state.refreshSocial)
  const clearSocialCache = useAppStore((state) => state.clearSocialCache)
  const navigate = useAppStore((state) => state.navigate)
  const showToast = useAppStore((state) => state.showToast)

  const [showBackendForm, setShowBackendForm] = useState(false)
  const [supabaseUrl, setSupabaseUrl] = useState(social.backendInfo.supabaseUrl || '')
  const [anonKey, setAnonKey] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  const profile = social.profile

  const handlePrivacyUpdate = async (patch: Partial<ProfilePrivacySettings>) => {
    if (!profile) return
    try {
      await services.social.updateProfile({ privacy: patch })
      await refreshSocial()
      showToast('Privacy settings updated.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update privacy settings.', 'error')
    }
  }

  const handlePresenceUpdate = async (presence: PresenceState) => {
    if (!profile) return
    try {
      await services.social.updateProfile({ presence })
      await refreshSocial()
      showToast(`Status set to ${presence}.`, 'info')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update status.', 'error')
    }
  }

  const handleLogout = async () => {
    setBusy(true)
    try {
      await services.social.logout()
      clearSocialCache()
      await refreshSocial()
      showToast('Signed out of social account. Your local game library is unchanged.', 'info')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not sign out.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteAccount = async () => {
    setBusy(true)
    try {
      await services.social.deleteAccount()
      clearSocialCache()
      await refreshSocial()
      setConfirmDelete(false)
      showToast('Social account deleted. Your local game library remains intact.', 'info')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not delete account.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleConfigureBackend = async (enabled: boolean) => {
    setBusy(true)
    try {
      await services.social.configureBackend({
        url: supabaseUrl.trim(),
        anonKey: anonKey.trim(),
        enabled
      })
      setAnonKey('')
      setShowBackendForm(false)
      await refreshSocial()
      showToast(
        enabled ? 'Connected to Supabase Cloud backend.' : 'Switched to Local Sandbox social mode.',
        'success'
      )
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Invalid Supabase configuration.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings__section">
      <h2 className="section-title">Social Account & Privacy</h2>
      <div className="settings__panel">
        <div className="setting">
          <div className="setting__text">
            <div className="setting__label">
              Account status{' '}
              <Badge tone={social.user ? 'accent' : 'neutral'}>
                {social.user ? 'Signed in' : 'Signed out'}
              </Badge>{' '}
              <Badge tone="neutral">
                {social.mode === 'supabase' ? 'Supabase Cloud' : 'Local Sandbox'}
              </Badge>
            </div>
            <div className="setting__description">
              {social.user && profile
                ? `Signed in as ${profile.displayName} (@${profile.username}) · ${social.user.email} · Friend Code ${profile.friendCode}`
                : 'Sign in or create an account to use Friend Codes, custom profiles, and 1-to-1 messaging. Your local library works offline either way.'}
            </div>
          </div>
          <div className="setting__control">
            {social.user && profile ? (
              <div className="steam-actions-inline">
                <Button onClick={() => navigate({ name: 'profile' })}>Open Profile</Button>
                <Button disabled={busy} onClick={() => void handleLogout()}>
                  Sign Out
                </Button>
              </div>
            ) : (
              <Button variant="primary" onClick={() => navigate({ name: 'profile' })}>
                Sign In / Register
              </Button>
            )}
          </div>
        </div>

        {social.user && profile && (
          <>
            <div className="setting">
              <div className="setting__text">
                <div className="setting__label">Presence status</div>
                <div className="setting__description">
                  Control whether friends see you as Online, Away, or Offline.
                </div>
              </div>
              <div className="setting__control">
                <Select
                  label="Presence status"
                  value={profile.presence}
                  onChange={(val) => void handlePresenceUpdate(val as PresenceState)}
                  options={PRESENCE_OPTIONS}
                />
              </div>
            </div>

            <div className="setting">
              <div className="setting__text">
                <div className="setting__label">Profile visibility</div>
                <div className="setting__description">
                  Choose who can view your bio, status, and custom profile sections. Defaults to Friends Only.
                </div>
              </div>
              <div className="setting__control">
                <Select
                  label="Profile visibility"
                  value={profile.privacy.profileVisibility}
                  onChange={(val) =>
                    void handlePrivacyUpdate({ profileVisibility: val as ProfileVisibility })
                  }
                  options={VISIBILITY_OPTIONS}
                />
              </div>
            </div>

            <div className="setting">
              <div className="setting__text">
                <div className="setting__label">Featured & Favorite VNs visibility</div>
                <div className="setting__description">
                  Choose who can see the visual novels and characters you showcase on your profile.
                </div>
              </div>
              <div className="setting__control">
                <Select
                  label="Featured VNs visibility"
                  value={profile.privacy.featuredVnsVisibility}
                  onChange={(val) =>
                    void handlePrivacyUpdate({ featuredVnsVisibility: val as ProfileVisibility })
                  }
                  options={VISIBILITY_OPTIONS}
                />
              </div>
            </div>

            <div className="setting">
              <div className="setting__text">
                <div className="setting__label">Share currently playing VN with friends</div>
                <div className="setting__description">
                  When enabled, launching a visual novel updates your status with its title. Local executable paths are
                  never shared.
                </div>
              </div>
              <div className="setting__control">
                <Switch
                  label="Share currently playing VN with friends"
                  checked={profile.privacy.showCurrentlyPlaying}
                  onChange={(val) => void handlePrivacyUpdate({ showCurrentlyPlaying: val })}
                />
              </div>
            </div>

            <div className="setting">
              <div className="setting__text">
                <div className="setting__label">Allow friend requests via Friend Code</div>
                <div className="setting__description">
                  Turn off to temporarily stop new incoming requests via your Friend Code ({profile.friendCode}).
                </div>
              </div>
              <div className="setting__control">
                <Switch
                  label="Allow friend requests via Friend Code"
                  checked={profile.privacy.allowFriendRequestsByCode}
                  onChange={(val) =>
                    void handlePrivacyUpdate({ allowFriendRequestsByCode: val })
                  }
                />
              </div>
            </div>

            <div className="setting">
              <div className="setting__text">
                <div className="setting__label">Delete social account</div>
                <div className="setting__description">
                  Permanently deletes your social profile, Friend Code, friendships, and messages. Your local game
                  library and playtimes on this PC are never deleted.
                </div>
              </div>
              <div className="setting__control">
                {!confirmDelete ? (
                  <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                    Delete Account…
                  </Button>
                ) : (
                  <div className="steam-actions-inline">
                    <Button
                      variant="danger"
                      disabled={busy}
                      onClick={() => void handleDeleteAccount()}
                    >
                      Confirm Permanent Delete
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        <div className="setting">
          <div className="setting__text">
            <div className="setting__label">Social backend server</div>
            <div className="setting__description">
              Connect a Supabase project (PostgreSQL + Auth + Row-Level Security) for live cross-PC accounts and
              messaging, or use the built-in Local Sandbox mode for offline and single-PC testing. Service-role keys
              are automatically rejected.
            </div>
          </div>
          <div className="setting__control">
            <Button onClick={() => setShowBackendForm((prev) => !prev)}>
              {showBackendForm ? 'Hide Configuration' : 'Configure Backend'}
            </Button>
          </div>
        </div>

        {showBackendForm && (
          <div className="steam-config-box">
            <div className="social-auth__row">
              <label className="field">
                <span className="field__label">Supabase Project URL (https://...)</span>
                <input
                  type="url"
                  className="input"
                  placeholder="https://your-project.supabase.co"
                  value={supabaseUrl}
                  data-nav=""
                  onChange={(e) => setSupabaseUrl(e.target.value)}
                />
              </label>
              <label className="field">
                <span className="field__label">Supabase Public Anon Key (Encrypted via OS DPAPI)</span>
                <input
                  type="password"
                  className="input"
                  placeholder={
                    social.backendInfo.hasAnonKey ? '•••••••• (saved)' : 'eyJhbGciOiJIUzI1NiIs...'
                  }
                  value={anonKey}
                  data-nav=""
                  onChange={(e) => setAnonKey(e.target.value)}
                />
              </label>
            </div>
            <div className="steam-actions-inline">
              <Button
                variant="primary"
                disabled={busy || !supabaseUrl.trim()}
                onClick={() => void handleConfigureBackend(true)}
              >
                Use Supabase Cloud
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void handleConfigureBackend(false)}
              >
                Use Local Sandbox Mode
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
