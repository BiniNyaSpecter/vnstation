import { describe, expect, it } from 'vitest'
import { pickNext, type Box } from '@renderer/lib/spatialNav'

const box = (left: number, top: number, width = 100, height = 150): Box => ({ left, top, width, height })

describe('pickNext', () => {
  const row1 = [box(0, 0), box(120, 0), box(240, 0)]
  const row2 = [box(0, 200), box(120, 200)]
  const all = [...row1, ...row2]

  it('moves along a row', () => {
    expect(pickNext(row1[0], 'right', all)).toBe(1)
    expect(pickNext(row1[2], 'left', all)).toBe(1)
  })

  it('stops at the end of a row instead of jumping to another row', () => {
    expect(pickNext(row1[2], 'right', all)).toBe(-1)
    expect(pickNext(row2[1], 'right', all)).toBe(-1)
  })

  it('moves between rows, preferring the best-aligned item', () => {
    expect(pickNext(row1[1], 'down', all)).toBe(4)
    expect(pickNext(row2[0], 'up', all)).toBe(0)
  })

  it('handles an enlarged selected tile aligned to the bottom', () => {
    const big = box(0, -40, 140, 210)
    expect(pickNext(big, 'right', [big, box(160, 0)])).toBe(1)
  })

  it('returns -1 when there is nothing in that direction', () => {
    expect(pickNext(row1[0], 'up', all)).toBe(-1)
    expect(pickNext(row1[0], 'left', all)).toBe(-1)
  })

  it('steps through every settings row vertically without skipping misaligned controls', () => {
    // Simulates Settings rows with different widths and horizontal alignments:
    // 0: Select (x=700, y=200, w=160, h=40)
    // 1: Switch (x=814, y=280, w=46, h=26)
    // 2: Range  (x=634, y=360, w=180, h=24)
    // 3: Switch (x=814, y=440, w=46, h=26)
    // 4: Left-aligned button (x=120, y=520, w=180, h=40)
    // 5: Switch (x=814, y=600, w=46, h=26)
    const settingsRows = [
      box(700, 200, 160, 40),
      box(814, 280, 46, 26),
      box(634, 360, 180, 24),
      box(814, 440, 46, 26),
      box(120, 520, 180, 40),
      box(814, 600, 46, 26)
    ]

    expect(pickNext(settingsRows[0], 'down', settingsRows)).toBe(1)
    expect(pickNext(settingsRows[1], 'down', settingsRows)).toBe(2)
    expect(pickNext(settingsRows[2], 'down', settingsRows)).toBe(3)
    expect(pickNext(settingsRows[3], 'down', settingsRows)).toBe(4)
    expect(pickNext(settingsRows[4], 'down', settingsRows)).toBe(5)

    expect(pickNext(settingsRows[5], 'up', settingsRows)).toBe(4)
    expect(pickNext(settingsRows[4], 'up', settingsRows)).toBe(3)
    expect(pickNext(settingsRows[3], 'up', settingsRows)).toBe(2)
    expect(pickNext(settingsRows[2], 'up', settingsRows)).toBe(1)
    expect(pickNext(settingsRows[1], 'up', settingsRows)).toBe(0)
  })
})
