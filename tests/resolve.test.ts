import { describe, expect, it } from 'vitest'
import type { GameEntry } from '@shared/types'
import { createSampleSnapshot } from '@shared/sampleLibrary'
import { resolveEntries, resolveEntry } from '@renderer/lib/resolve'

const base = (): GameEntry => ({ ...createSampleSnapshot().entries[0] })

describe('resolveEntry', () => {
  it('lets user edits win over provider metadata', () => {
    const entry = base()
    entry.user = { ...entry.user, title: 'My Title', synopsis: 'My own summary' }
    const game = resolveEntry(entry)
    expect(game.title).toBe('My Title')
    expect(game.synopsis).toBe('My own summary')
    expect(game.developer).toBe(entry.provider.developer)
  })

  it('keeps provider data intact so a refresh cannot erase user edits', () => {
    const entry = base()
    entry.user = { ...entry.user, title: 'My Title' }
    expect(entry.provider.title).toBe('Lanterns of Hollowmere')
  })

  it('generates artwork when none exists, and prefers real artwork when present', () => {
    const entry = base()
    expect(resolveEntry(entry).coverUrl.startsWith('data:image/svg+xml')).toBe(true)

    entry.provider = { ...entry.provider, coverUrl: 'file:///cache/cover.jpg' }
    const game = resolveEntry(entry)
    expect(game.coverUrl).toBe('file:///cache/cover.jpg')
    expect(game.coverFallbackUrl.startsWith('data:image/svg+xml')).toBe(true)
  })

  it('names untitled entries plainly', () => {
    const entry = base()
    entry.provider = { ...entry.provider, title: null }
    expect(resolveEntry(entry).title).toBe('Untitled game')
  })

  it('reuses results for unchanged entries', () => {
    const entries = createSampleSnapshot().entries
    const first = resolveEntries(entries)
    const second = resolveEntries(entries)
    expect(second[0]).toBe(first[0])
  })
})
