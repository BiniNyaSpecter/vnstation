import { describe, expect, it } from 'vitest'
import { UserFacingError } from '../src/main/errors'
import { parseApplyOptions, parseArtworkKind, parseCollectionInput, parseExternalId, parseGamePatch, parseId, parseIdList, parseNewGameDraft, parseRefreshOptions, parseSearchOptions } from '../src/main/validation'

const validDraft = { title: ' Game ', launch: { executablePath: 'C:\\VN\\a.exe', workingDirectory: 'C:\\VN', arguments: ' -x ' } }

describe('parseNewGameDraft', () => {
  it('trims and keeps valid input', () => {
    expect(parseNewGameDraft(validDraft)).toEqual({
      title: 'Game',
      launch: { executablePath: 'C:\\VN\\a.exe', workingDirectory: 'C:\\VN', arguments: '-x' }
    })
  })

  it('rejects malformed requests with readable messages', () => {
    expect(() => parseNewGameDraft(null)).toThrow(UserFacingError)
    expect(() => parseNewGameDraft('x')).toThrow(UserFacingError)
    expect(() => parseNewGameDraft({ ...validDraft, title: '   ' })).toThrow('Give the game a title')
    expect(() => parseNewGameDraft({ ...validDraft, title: 'x'.repeat(301) })).toThrow('too long')
    expect(() => parseNewGameDraft({ ...validDraft, launch: { ...validDraft.launch, arguments: 5 } })).toThrow(UserFacingError)
  })

  it('rejects NUL bytes anywhere', () => {
    expect(() => parseNewGameDraft({ ...validDraft, title: 'a\0b' })).toThrow(UserFacingError)
    expect(() => parseNewGameDraft({ ...validDraft, launch: { ...validDraft.launch, executablePath: 'C:\\a\0.exe' } })).toThrow(UserFacingError)
  })

  it('ignores unknown keys', () => {
    const parsed = parseNewGameDraft({ ...validDraft, admin: true }) as unknown as Record<string, unknown>
    expect(parsed.admin).toBeUndefined()
  })
})

describe('parseGamePatch', () => {
  it('accepts partial patches and turns blank optional fields into null', () => {
    expect(parseGamePatch({ favorite: true, user: { title: '  ', developer: ' Me ', notes: 'n' } })).toEqual({
      favorite: true,
      user: { title: null, developer: 'Me', notes: 'n' }
    })
  })

  it('validates types and ranges', () => {
    expect(() => parseGamePatch({ favorite: 'yes' })).toThrow(UserFacingError)
    expect(() => parseGamePatch({ playtimeMinutes: -1 })).toThrow(UserFacingError)
    expect(() => parseGamePatch({ playtimeMinutes: 1.5 })).toThrow(UserFacingError)
    expect(() => parseGamePatch({ lastPlayedAt: 'yesterday' })).toThrow(UserFacingError)
    expect(() => parseGamePatch({ user: { releaseDate: '28/10/2022' } })).toThrow(UserFacingError)
    expect(parseGamePatch({ user: { releaseDate: '2022-10' } }).user?.releaseDate).toBe('2022-10')
    expect(parseGamePatch({ lastPlayedAt: null }).lastPlayedAt).toBeNull()
  })

  it('only passes through fields it knows', () => {
    const patch = parseGamePatch({ favorite: false, id: 'hijack', launch: { executablePath: 'C:\\a.exe', evil: 1 } }) as Record<string, unknown>
    expect(patch.id).toBeUndefined()
    expect(patch.launch).toEqual({ executablePath: 'C:\\a.exe' })
  })
})

describe('parseCollectionInput / ids', () => {
  it('requires a name and bounds lengths', () => {
    expect(parseCollectionInput({ name: ' Cozy ', description: '' })).toEqual({ name: 'Cozy', description: null })
    expect(() => parseCollectionInput({ name: '  ' })).toThrow('Give the collection a name')
    expect(() => parseCollectionInput({ name: 'x'.repeat(121) })).toThrow('too long')
    expect(() => parseCollectionInput(undefined)).toThrow(UserFacingError)
  })

  it('accepts app-generated ids and rejects anything path-like', () => {
    expect(parseId('game-3f2a-b1')).toBe('game-3f2a-b1')
    expect(parseId('sample-nine-windows')).toBe('sample-nine-windows')
    for (const bad of ['', '../x', 'a b', 'a/b', 'a\\b', 'x\0', 5, null, 'x'.repeat(201)]) {
      expect(() => parseId(bad)).toThrow(UserFacingError)
    }
  })

  it('de-duplicates id lists and bounds their size', () => {
    expect(parseIdList(['a', 'b', 'a'])).toEqual(['a', 'b'])
    expect(() => parseIdList('a')).toThrow(UserFacingError)
    expect(() => parseIdList(Array.from({ length: 501 }, (_, i) => `c${i}`))).toThrow(UserFacingError)
  })
})

describe('metadata requests', () => {
  it('accepts only well-formed VNDB ids', () => {
    expect(parseExternalId('v17')).toBe('v17')
    for (const bad of ['17', 'V17', 'v', 'v1x', 'v1234567890', 'v1; DROP TABLE', '', null, 5]) {
      expect(() => parseExternalId(bad)).toThrow(UserFacingError)
    }
  })

  it('requires explicit, well-typed options', () => {
    expect(parseSearchOptions({ includeRestricted: false })).toEqual({ includeRestricted: false })
    expect(parseApplyOptions({ replaceTitle: true, allowAdult: false, extra: 1 })).toEqual({ replaceTitle: true, allowAdult: false })
    expect(parseRefreshOptions({ allowAdult: true })).toEqual({ allowAdult: true })
    expect(() => parseApplyOptions({ replaceTitle: true })).toThrow(UserFacingError)
    expect(() => parseRefreshOptions({})).toThrow(UserFacingError)
    expect(() => parseSearchOptions({})).toThrow(UserFacingError)
    expect(() => parseSearchOptions({ includeRestricted: 'no' })).toThrow(UserFacingError)
    expect(() => parseApplyOptions(null)).toThrow(UserFacingError)
  })

  it('knows the two artwork kinds', () => {
    expect(parseArtworkKind('cover')).toBe('cover')
    expect(parseArtworkKind('background')).toBe('background')
    expect(() => parseArtworkKind('poster')).toThrow(UserFacingError)
  })

  it('lets artwork overrides point only into the local cache, or be cleared', () => {
    expect(parseGamePatch({ user: { coverUrl: 'vnstation-art://art/user/game-1-cover.png?v=1' } }).user?.coverUrl).toBe('vnstation-art://art/user/game-1-cover.png?v=1')
    expect(parseGamePatch({ user: { coverUrl: null } }).user?.coverUrl).toBeNull()
    expect(parseGamePatch({ user: { backgroundUrl: '' } }).user?.backgroundUrl).toBeNull()
    for (const bad of ['https://tracker.example/pixel.png', 'file:///C:/secret.png', 'javascript:alert(1)', 'vnstation-art://other/x.png']) {
      expect(() => parseGamePatch({ user: { coverUrl: bad } })).toThrow(UserFacingError)
    }
  })
})
