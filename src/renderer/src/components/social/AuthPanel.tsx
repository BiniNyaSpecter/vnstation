import { useState, type FormEvent } from 'react'
import { AVATAR_PRESETS, type AvatarPresetId } from '@shared/social'
import { Avatar } from '@renderer/components/social/Avatar'
import { Badge } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { Icon } from '@renderer/components/ui/Icon'
import { cx } from '@renderer/lib/cx'
import { services } from '@renderer/services'
import { useAppStore } from '@renderer/state/appStore'

type AuthTab = 'login' | 'register' | 'reset'

const PRESET_ENTRIES = Object.entries(AVATAR_PRESETS) as Array<
  [AvatarPresetId, { label: string; gradient: string; monogram: string }]
>

export function AuthPanel({ subtitle }: { subtitle?: string }) {
  const social = useAppStore((state) => state.social)
  const refreshSocial = useAppStore((state) => state.refreshSocial)
  const showToast = useAppStore((state) => state.showToast)
  const navigate = useAppStore((state) => state.navigate)

  const [tab, setTab] = useState<AuthTab>('register')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [avatarPreset, setAvatarPreset] = useState<AvatarPresetId>('aoko')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (tab === 'register') {
        const next = await services.social.register({
          email,
          password,
          username,
          displayName: displayName || username,
          avatarPreset
        })
        await refreshSocial()
        showToast(
          `Welcome, ${next.profile?.displayName ?? username}! Your Friend Code is ${next.profile?.friendCode ?? ''}.`,
          'success'
        )
      } else if (tab === 'login') {
        const next = await services.social.login({ email, password })
        await refreshSocial()
        showToast(`Signed in as ${next.profile?.displayName ?? email}.`, 'success')
      } else {
        const res = await services.social.requestPasswordReset(email)
        showToast(res.message, 'info')
        setTab('login')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed.'
      setError(message)
      showToast(message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="social-auth">
      <div className="social-auth__card">
        <div className="social-auth__header">
          <div className="social-auth__brand">
            <Icon name="users" size={24} />
            <div>
              <h1 className="social-auth__title">VNStation Social Network</h1>
              <p className="social-auth__subtitle">
                {subtitle ??
                  'Create a personal visual novel profile, share your Friend Code, and message friends directly.'}
              </p>
            </div>
          </div>
          <Badge tone={social.mode === 'supabase' ? 'accent' : 'neutral'}>
            {social.mode === 'supabase' ? 'Supabase Cloud' : 'Local Sandbox Mode'}
          </Badge>
        </div>

        <div className="social-auth__tabs" role="tablist" aria-label="Account actions">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'register'}
            className={cx('social-auth__tab', tab === 'register' && 'is-active')}
            data-nav=""
            data-entry-point={tab === 'register' ? '' : undefined}
            data-nav-default={tab === 'register' ? '' : undefined}
            onClick={() => {
              setTab('register')
              setError(null)
            }}
          >
            Create Account
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'login'}
            className={cx('social-auth__tab', tab === 'login' && 'is-active')}
            data-nav=""
            data-entry-point={tab === 'login' ? '' : undefined}
            data-nav-default={tab === 'login' ? '' : undefined}
            onClick={() => {
              setTab('login')
              setError(null)
            }}
          >
            Sign In
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'reset'}
            className={cx('social-auth__tab', tab === 'reset' && 'is-active')}
            data-nav=""
            onClick={() => {
              setTab('reset')
              setError(null)
            }}
          >
            Reset Password
          </button>
        </div>

        <form className="social-auth__form" onSubmit={(e) => void handleSubmit(e)}>
          <label className="field">
            <span className="field__label">Email address</span>
            <input
              type="email"
              required
              placeholder="reader@example.com"
              value={email}
              data-nav=""
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          {tab !== 'reset' && (
            <label className="field">
              <span className="field__label">Password (at least 8 characters)</span>
              <input
                type="password"
                required
                minLength={8}
                placeholder="••••••••"
                value={password}
                data-nav=""
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}

          {tab === 'register' && (
            <>
              <div className="social-auth__row">
                <label className="field">
                  <span className="field__label">Unique username</span>
                  <input
                    type="text"
                    required
                    pattern="[a-zA-Z0-9_]{3,24}"
                    placeholder="kotori_reader"
                    value={username}
                    data-nav=""
                    onChange={(e) => setUsername(e.target.value)}
                  />
                  <span className="field__hint">3–24 letters, numbers, or underscores</span>
                </label>

                <label className="field">
                  <span className="field__label">Display name</span>
                  <input
                    type="text"
                    required
                    maxLength={40}
                    placeholder="Kotori"
                    value={displayName}
                    data-nav=""
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                  <span className="field__hint">Shown on your profile & messages</span>
                </label>
              </div>

              <div className="field">
                <span className="field__label">Choose starter avatar emblem</span>
                <div className="social-auth__presets">
                  {PRESET_ENTRIES.map(([id, preset]) => (
                    <button
                      key={id}
                      type="button"
                      className={cx('social-auth__preset', avatarPreset === id && 'is-selected')}
                      data-nav=""
                      onClick={() => setAvatarPreset(id)}
                    >
                      <Avatar
                        displayName={displayName || username || preset.label}
                        preset={id}
                        size="sm"
                      />
                      <span>{preset.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {error && (
            <div className="social-auth__error" role="alert">
              {error}
            </div>
          )}

          <div className="social-auth__actions">
            <Button variant="primary" type="submit" disabled={busy}>
              {busy
                ? 'Working…'
                : tab === 'register'
                  ? 'Create Account & Generate Friend Code'
                  : tab === 'login'
                    ? 'Sign In'
                    : 'Send Password Reset'}
            </Button>
            <Button variant="ghost" type="button" onClick={() => navigate({ name: 'settings' })}>
              Backend Settings
            </Button>
          </div>
        </form>

        <div className="social-auth__footer">
          <p>
            <strong>Local-first guarantee:</strong> Your visual novel library, playtime, collections, and Steam imports
            always stay on your PC and work offline whether you sign in or not.
          </p>
          {social.mode === 'local-sandbox' && (
            <p className="social-auth__sandbox-note">
              <strong>Local Sandbox Mode active:</strong> Accounts, Friend Codes, and messages are stored locally with
              OS encryption so you can test multi-account switching and companion readers (<code>VNS-AOKO-2026</code> &{' '}
              <code>VNS-LABM-2048</code>) immediately. Connect a Supabase project anytime in Settings for live
              cross-PC messaging.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
