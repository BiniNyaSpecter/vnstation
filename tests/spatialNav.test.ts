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
})
