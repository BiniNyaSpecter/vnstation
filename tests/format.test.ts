import { describe, expect, it } from 'vitest'
import { formatPlaytime, formatRelativeDate, formatReleaseDate, releaseYear } from '@renderer/lib/format'

describe('formatPlaytime', () => {
  it('formats hours and minutes', () => {
    expect(formatPlaytime(926)).toBe('15h 26m')
    expect(formatPlaytime(120)).toBe('2h')
    expect(formatPlaytime(42)).toBe('42m')
  })
  it('says so when nothing has been played', () => {
    expect(formatPlaytime(0)).toBe('Not played yet')
    expect(formatPlaytime(Number.NaN)).toBe('Not played yet')
  })
})

describe('formatRelativeDate', () => {
  const now = new Date(2026, 9, 19, 12, 0)
  const daysAgo = (n: number, hour = 9): string => new Date(2026, 9, 19 - n, hour).toISOString()

  it('uses calendar days, not 24-hour windows', () => {
    expect(formatRelativeDate(daysAgo(0), now)).toBe('Today')
    expect(formatRelativeDate(new Date(2026, 9, 18, 23, 59).toISOString(), now)).toBe('Yesterday')
    expect(formatRelativeDate(daysAgo(3), now)).toBe('3 days ago')
    expect(formatRelativeDate(daysAgo(14), now)).toBe('2 weeks ago')
  })
  it('falls back to a date for older entries and "Never" for none', () => {
    expect(formatRelativeDate(daysAgo(200), now, 'en-US')).toMatch(/2026|2025/)
    expect(formatRelativeDate(null, now)).toBe('Never')
    expect(formatRelativeDate('not a date', now)).toBe('Never')
  })
})

describe('release dates', () => {
  it('formats partial and full ISO dates', () => {
    expect(formatReleaseDate('2022-10-28', 'en-US')).toBe('Oct 28, 2022')
    expect(formatReleaseDate('2019-11', 'en-US')).toBe('Nov 2019')
    expect(formatReleaseDate('2019', 'en-US')).toBe('2019')
  })
  it('reports unknown dates plainly', () => {
    expect(formatReleaseDate(null)).toBe('Unknown')
    expect(formatReleaseDate('soon')).toBe('Unknown')
    expect(releaseYear('2022-10-28')).toBe('2022')
    expect(releaseYear(null)).toBe('Unknown')
  })
})
