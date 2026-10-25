import type { ContentRating } from '@shared/types'

export function formatPlaytime(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return 'Not played yet'
  const hours = Math.floor(minutes / 60)
  const rest = Math.round(minutes % 60)
  if (hours === 0) return `${rest}m`
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

export function formatSessionDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '< 1m'
  if (seconds < 60) return `${Math.round(seconds)}s`
  return formatPlaytime(Math.round(seconds / 60))
}

const startOfDay = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

/** "Today", "Yesterday", "3 days ago", "2 weeks ago", or a calendar date. */
export function formatRelativeDate(iso: string | null, now: Date = new Date(), locale?: string): string {
  if (!iso) return 'Never'
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return 'Never'
  const days = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 35) {
    const weeks = Math.round(days / 7)
    return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`
  }
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(then)
}

/** Handles partial ISO dates: "2019", "2019-11", "2019-11-08". */
export function formatReleaseDate(value: string | null, locale?: string): string {
  if (!value) return 'Unknown'
  const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(value)
  if (!match) return 'Unknown'
  const [, year, month, day] = match
  if (!month) return year
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day ?? '1')))
  const options: Intl.DateTimeFormatOptions = day
    ? { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }
    : { year: 'numeric', month: 'short', timeZone: 'UTC' }
  return new Intl.DateTimeFormat(locale, options).format(date)
}

export function releaseYear(value: string | null): string {
  const match = value ? /^(\d{4})/.exec(value) : null
  return match ? match[1] : 'Unknown'
}

export const RATING_LABELS: Record<ContentRating, string> = {
  unrated: 'Not rated',
  'all-ages': 'All ages',
  teen: 'Teen',
  mature: 'Mature',
  restricted: '18+ Adults only'
}

export function formatClock(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(date)
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
