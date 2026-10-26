import { AVATAR_PRESETS, sanitizeSafeImageUrl, type AvatarPresetId, type PresenceState } from '@shared/social'
import { cx } from '@renderer/lib/cx'

interface AvatarProps {
  displayName: string
  username?: string | null
  preset?: AvatarPresetId | null
  avatarUrl?: string | null
  presence?: PresenceState | null
  currentlyPlaying?: string | null
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

export function Avatar({
  displayName,
  username,
  preset = 'aoko',
  avatarUrl,
  presence,
  currentlyPlaying,
  size = 'md',
  className
}: AvatarProps) {
  const safeUrl = sanitizeSafeImageUrl(avatarUrl)
  const presetDef = AVATAR_PRESETS[preset ?? 'aoko'] ?? AVATAR_PRESETS.aoko
  const label = (displayName || username || 'VN').trim()
  const initials =
    label
      .split(/[\s_]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || presetDef.monogram

  const dotClass = currentlyPlaying ? 'is-playing' : presence ? `is-${presence}` : undefined

  return (
    <div
      className={cx('social-avatar', `social-avatar--${size}`, className)}
      style={{
        background: presetDef.gradient
      }}
      aria-hidden="true"
    >
      {safeUrl ? (
        <img
          src={safeUrl}
          alt=""
          className="social-avatar__img"
          referrerPolicy="no-referrer"
          loading="lazy"
        />
      ) : (
        <span className="social-avatar__initials">{initials}</span>
      )}
      {dotClass && (
        <span
          className={cx('social-avatar__presence', dotClass)}
          title={
            currentlyPlaying
              ? `Reading ${currentlyPlaying}`
              : presence === 'online'
                ? 'Online'
                : presence === 'away'
                  ? 'Away'
                  : 'Offline'
          }
        />
      )}
    </div>
  )
}
