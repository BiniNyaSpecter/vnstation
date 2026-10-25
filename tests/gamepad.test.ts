import { describe, expect, it } from 'vitest'
import {
  GamepadTracker,
  INITIAL_REPEAT_MS,
  REPEAT_INTERVAL_MS,
  readDirection,
  type GamepadLike
} from '../src/renderer/src/lib/gamepad'

function makePad(overrides: {
  pressed?: number[]
  axes?: [number, number]
  connected?: boolean
  id?: string
} = {}): GamepadLike {
  const pressedSet = new Set(overrides.pressed ?? [])
  return {
    connected: overrides.connected ?? true,
    id: overrides.id ?? 'Xbox Wireless Controller',
    buttons: Array.from({ length: 16 }, (_, index) => ({ pressed: pressedSet.has(index) })),
    axes: overrides.axes ?? [0, 0]
  }
}

describe('readDirection', () => {
  it('reads D-pad directions first', () => {
    expect(readDirection(makePad({ pressed: [12] }))).toBe('up')
    expect(readDirection(makePad({ pressed: [13] }))).toBe('down')
    expect(readDirection(makePad({ pressed: [14] }))).toBe('left')
    expect(readDirection(makePad({ pressed: [15] }))).toBe('right')
  })

  it('applies the left-stick deadzone and picks the dominant axis', () => {
    expect(readDirection(makePad({ axes: [0.25, -0.3] }))).toBeNull()
    expect(readDirection(makePad({ axes: [0.8, -0.3] }))).toBe('right')
    expect(readDirection(makePad({ axes: [-0.8, 0.2] }))).toBe('left')
    expect(readDirection(makePad({ axes: [0.1, -0.75] }))).toBe('up')
    expect(readDirection(makePad({ axes: [0.1, 0.75] }))).toBe('down')
  })
})

describe('GamepadTracker', () => {
  it('ignores buttons already held when focus returns (first poll resyncs)', () => {
    const tracker = new GamepadTracker()
    const first = tracker.poll([makePad({ pressed: [0, 15] })], 1000)
    expect(first.actions).toEqual([])
    expect(first.activePadId).toBe('Xbox Wireless Controller')

    // Releasing and pressing again fires the action.
    tracker.poll([makePad()], 1050)
    const next = tracker.poll([makePad({ pressed: [0] })], 1100)
    expect(next.actions).toEqual([{ type: 'confirm' }])
  })

  it('repeats held directions with an initial delay and steady interval', () => {
    const tracker = new GamepadTracker()
    tracker.poll([makePad()], 0)

    expect(tracker.poll([makePad({ pressed: [15] })], 10).actions).toEqual([{ type: 'move', direction: 'right' }])
    expect(tracker.poll([makePad({ pressed: [15] })], 10 + INITIAL_REPEAT_MS - 1).actions).toEqual([])
    expect(tracker.poll([makePad({ pressed: [15] })], 10 + INITIAL_REPEAT_MS).actions).toEqual([{ type: 'move', direction: 'right' }])
    expect(tracker.poll([makePad({ pressed: [15] })], 10 + INITIAL_REPEAT_MS + REPEAT_INTERVAL_MS).actions).toEqual([
      { type: 'move', direction: 'right' }
    ])
  })

  it('swaps Confirm and Back when layout is set to east (B / Circle)', () => {
    const tracker = new GamepadTracker()
    tracker.poll([makePad()], 0)

    expect(tracker.poll([makePad({ pressed: [0] })], 20, 'south').actions).toEqual([{ type: 'confirm' }])
    tracker.poll([makePad()], 30, 'south')
    expect(tracker.poll([makePad({ pressed: [1] })], 40, 'south').actions).toEqual([{ type: 'back' }])

    tracker.poll([makePad()], 50, 'east')
    expect(tracker.poll([makePad({ pressed: [1] })], 60, 'east').actions).toEqual([{ type: 'confirm' }])
    tracker.poll([makePad()], 70, 'east')
    expect(tracker.poll([makePad({ pressed: [0] })], 80, 'east').actions).toEqual([{ type: 'back' }])
  })

  it('maps bumpers, play and favorite buttons to edge-triggered actions', () => {
    const tracker = new GamepadTracker()
    tracker.poll([makePad()], 0)

    const { actions } = tracker.poll([makePad({ pressed: [2, 3, 4, 5] })], 20)
    expect(actions).toEqual([
      { type: 'play' },
      { type: 'favorite' },
      { type: 'prev-category' },
      { type: 'next-category' }
    ])
    // Holding the buttons on the next frame does not re-fire them.
    expect(tracker.poll([makePad({ pressed: [2, 3, 4, 5] })], 40).actions).toEqual([])
  })
})
