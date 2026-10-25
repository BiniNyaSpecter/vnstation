import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFS, sanitizePrefs } from '@renderer/lib/prefs'

describe('sanitizePrefs', () => {
  it('returns defaults for missing or corrupt data', () => {
    expect(sanitizePrefs(null)).toEqual(DEFAULT_PREFS)
    expect(sanitizePrefs('garbage')).toEqual(DEFAULT_PREFS)
    expect(sanitizePrefs({ accent: 'neon', defaultSort: 'nope', railCollapsed: 'yes' })).toEqual(DEFAULT_PREFS)
  })

  it('keeps valid values and clamps numbers', () => {
    const prefs = sanitizePrefs({ accent: 'jade', railCollapsed: true, adultConfirmed: true, showRestricted: true, backdropStrength: 5, libraryLayout: 'shelf', defaultSort: 'releaseDate' })
    expect(prefs.accent).toBe('jade')
    expect(prefs.railCollapsed).toBe(true)
    expect(prefs.showRestricted).toBe(true)
    expect(prefs.backdropStrength).toBe(1)
    expect(prefs.libraryLayout).toBe('shelf')
    expect(prefs.defaultSort).toBe('releaseDate')
    expect(sanitizePrefs({ backdropStrength: 0 }).backdropStrength).toBe(0.4)
  })

  it('has sensible defaults for navigation, fonts and metadata', () => {
    expect(DEFAULT_PREFS.navLayout).toBe('top')
    expect(DEFAULT_PREFS.titleFont).toBe('console')
    expect(DEFAULT_PREFS.metadataEnabled).toBe(true)
    expect(sanitizePrefs({ navLayout: 'rail', titleFont: 'literary', metadataEnabled: false })).toMatchObject({ navLayout: 'rail', titleFont: 'literary', metadataEnabled: false })
    expect(sanitizePrefs({ navLayout: 'sideways', titleFont: 7, metadataEnabled: 'yes' })).toMatchObject({ navLayout: 'top', titleFont: 'console', metadataEnabled: true })
  })

  it('motion defaults to full and understands the old reduce-motion switch', () => {
    expect(DEFAULT_PREFS.motion).toBe('full')
    expect(sanitizePrefs({}).motion).toBe('full')
    expect(sanitizePrefs({ reduceMotion: true }).motion).toBe('reduced')
    expect(sanitizePrefs({ reduceMotion: false }).motion).toBe('full')
    expect(sanitizePrefs({ motion: 'system' }).motion).toBe('system')
    expect(sanitizePrefs({ motion: 'sideways' }).motion).toBe('full')
  })

  it('sound is on by default, quiet, and clamped', () => {
    expect(DEFAULT_PREFS.soundEnabled).toBe(true)
    expect(DEFAULT_PREFS.soundVolume).toBeLessThan(0.75)
    expect(sanitizePrefs({ soundVolume: 9 }).soundVolume).toBe(1)
    expect(sanitizePrefs({ soundVolume: -2 }).soundVolume).toBe(0)
    expect(sanitizePrefs({ soundEnabled: false }).soundEnabled).toBe(false)
  })

  it('adults-only entries can never be shown without the age confirmation', () => {
    expect(sanitizePrefs({ showRestricted: true }).showRestricted).toBe(false)
    expect(sanitizePrefs({ showRestricted: true, adultConfirmed: false }).showRestricted).toBe(false)
    expect(sanitizePrefs({ showRestricted: true, adultConfirmed: true }).showRestricted).toBe(true)
    expect(sanitizePrefs({ adultConfirmed: true }).showRestricted).toBe(false)
  })

  it('hides adults-only entries by default', () => {
    expect(DEFAULT_PREFS.showRestricted).toBe(false)
  })

  it('accepts all four themes and falls back to midnight for unknown themes', () => {
    expect(sanitizePrefs({ theme: 'obsidian' }).theme).toBe('obsidian')
    expect(sanitizePrefs({ theme: 'twilight' }).theme).toBe('twilight')
    expect(sanitizePrefs({ theme: 'daylight' }).theme).toBe('daylight')
    expect(sanitizePrefs({ theme: 'neon' }).theme).toBe('midnight')
  })
})
