import { describe, expect, it } from 'vitest'
import { deriveArtStyle, fallbackBackgroundUrl, fallbackCoverUrl, hashString, wrapTitle } from '@renderer/lib/art'

describe('wrapTitle', () => {
  it('wraps words onto lines', () => {
    expect(wrapTitle('The Last Train to Meridian', 14, 4)).toEqual(['The Last Train', 'to Meridian'])
  })
  it('counts wide characters as two units', () => {
    expect(wrapTitle('星降る夜の物語と不思議な出来', 14, 4)).toHaveLength(2)
  })
  it('splits overlong words and truncates past the line limit', () => {
    expect(wrapTitle('Supercalifragilisticexpialidocious', 12, 4).length).toBeGreaterThan(1)
    const lines = wrapTitle('one two three four five six seven eight nine ten', 6, 2)
    expect(lines).toHaveLength(2)
    expect(lines[1].endsWith('…')).toBe(true)
  })
})

describe('procedural artwork', () => {
  const style = { motif: 'skyline', hue: 210 } as const

  it('is deterministic', () => {
    expect(hashString('abc')).toBe(hashString('abc'))
    expect(deriveArtStyle('x')).toEqual(deriveArtStyle('x'))
    expect(fallbackCoverUrl('A', style)).toBe(fallbackCoverUrl('A', style))
  })

  it('produces SVG data URIs and escapes titles', () => {
    const cover = decodeURIComponent(fallbackCoverUrl('Salt & <Ceremony>', style))
    expect(cover.startsWith('data:image/svg+xml')).toBe(true)
    // The title wraps onto two lines; each is escaped independently.
    expect(cover).toContain('Salt &amp;')
    expect(cover).toContain('&lt;Ceremony&gt;')
    expect(cover.includes('<Ceremony>')).toBe(false)
    expect(fallbackBackgroundUrl(style).startsWith('data:image/svg+xml')).toBe(true)
  })

  it('renders every motif', () => {
    for (const motif of ['moon', 'skyline', 'waves', 'forest', 'aurora', 'petals'] as const) {
      expect(fallbackBackgroundUrl({ motif, hue: 120 }).length).toBeGreaterThan(500)
    }
  })
})
