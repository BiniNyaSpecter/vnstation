import { describe, expect, it } from 'vitest'
import { suggestTitle } from '@shared/suggestTitle'

describe('suggestTitle', () => {
  it('turns a snake_case file name into a title', () => {
    expect(suggestTitle('D:\\VisualNovels\\example_game.exe')).toBe('Example Game')
  })

  it('strips version and architecture suffixes', () => {
    expect(suggestTitle('D:\\VN\\SteinsGate_v1.2.exe')).toBe('Steins Gate')
    expect(suggestTitle('D:\\VN\\Some-Title_ver2.0.1.exe')).toBe('Some-Title')
    expect(suggestTitle('D:\\VN\\Foo_x64.exe')).toBe('Foo')
  })

  it('uses the folder name when the executable name is generic', () => {
    expect(suggestTitle('C:\\Games\\Fate.Stay.Night\\game.exe')).toBe('Fate Stay Night')
    expect(suggestTitle('/games/Clockwork Tides/start.exe')).toBe('Clockwork Tides')
  })

  it('keeps non-English titles intact', () => {
    expect(suggestTitle('D:\\ビジュアルノベル\\星降る夜\\game.exe')).toBe('星降る夜')
    expect(suggestTitle('D:\\VN\\星降る夜.exe')).toBe('星降る夜')
  })

  it('handles paths with spaces', () => {
    expect(suggestTitle('D:\\My Games\\Some Title\\Some Title.exe')).toBe('Some Title')
  })

  it('falls back to the file name at a drive root', () => {
    expect(suggestTitle('D:\\game.exe')).toBe('Game')
  })
})
