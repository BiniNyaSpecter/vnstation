import type { Direction } from './spatialNav'

/**
 * Standard W3C Gamepad support. Pure polling and repeat rules live in
 * `GamepadTracker` so they can be tested without a browser or controller.
 */
export type ConfirmButtonLayout = 'south' | 'east'

export type GamepadAction =
  | { type: 'move'; direction: Direction }
  | { type: 'confirm' }
  | { type: 'back' }
  | { type: 'play' }
  | { type: 'favorite' }
  | { type: 'prev-category' }
  | { type: 'next-category' }

export interface GamepadLike {
  readonly connected: boolean
  readonly id: string
  readonly buttons: ReadonlyArray<{ readonly pressed: boolean }>
  readonly axes: ReadonlyArray<number>
}

export const STICK_DEADZONE = 0.5
export const INITIAL_REPEAT_MS = 340
export const REPEAT_INTERVAL_MS = 115

const BUTTON_SOUTH = 0
const BUTTON_EAST = 1
const BUTTON_WEST = 2
const BUTTON_NORTH = 3
const BUTTON_LB = 4
const BUTTON_RB = 5
const BUTTON_START = 9
const BUTTON_DPAD_UP = 12
const BUTTON_DPAD_DOWN = 13
const BUTTON_DPAD_LEFT = 14
const BUTTON_DPAD_RIGHT = 15

const isPressed = (pad: GamepadLike, index: number): boolean => Boolean(pad.buttons[index]?.pressed)

export function readDirection(pad: GamepadLike, deadzone = STICK_DEADZONE): Direction | null {
  if (isPressed(pad, BUTTON_DPAD_UP)) return 'up'
  if (isPressed(pad, BUTTON_DPAD_DOWN)) return 'down'
  if (isPressed(pad, BUTTON_DPAD_LEFT)) return 'left'
  if (isPressed(pad, BUTTON_DPAD_RIGHT)) return 'right'

  const x = pad.axes[0] ?? 0
  const y = pad.axes[1] ?? 0
  if (Math.abs(x) < deadzone && Math.abs(y) < deadzone) return null
  if (Math.abs(x) >= Math.abs(y)) return x < 0 ? 'left' : 'right'
  return y < 0 ? 'up' : 'down'
}

export class GamepadTracker {
  private heldDirection: Direction | null = null
  private nextRepeatAt = 0
  private pressedButtons = new Set<number>()
  private needsResync = true

  /**
   * Call when the window loses focus or is hidden so a button held while exiting
   * a game cannot fire an unintended action when focus returns to VNStation.
   */
  reset(): void {
    this.heldDirection = null
    this.nextRepeatAt = 0
    this.pressedButtons.clear()
    this.needsResync = true
  }

  poll(
    pads: ReadonlyArray<GamepadLike | null | undefined>,
    nowMs: number,
    layout: ConfirmButtonLayout = 'south'
  ): { actions: GamepadAction[]; activePadId: string | null } {
    const pad = pads.find((candidate): candidate is GamepadLike => Boolean(candidate && candidate.connected))
    if (!pad) {
      this.reset()
      return { actions: [], activePadId: null }
    }

    if (this.needsResync) {
      this.needsResync = false
      this.heldDirection = readDirection(pad)
      this.nextRepeatAt = nowMs + INITIAL_REPEAT_MS
      this.pressedButtons = this.currentPressedSet(pad)
      return { actions: [], activePadId: pad.id }
    }

    const actions: GamepadAction[] = []
    const direction = readDirection(pad)
    if (direction === null) {
      this.heldDirection = null
      this.nextRepeatAt = 0
    } else if (direction !== this.heldDirection) {
      this.heldDirection = direction
      this.nextRepeatAt = nowMs + INITIAL_REPEAT_MS
      actions.push({ type: 'move', direction })
    } else if (nowMs >= this.nextRepeatAt) {
      this.nextRepeatAt = nowMs + REPEAT_INTERVAL_MS
      actions.push({ type: 'move', direction })
    }

    const currentButtons = this.currentPressedSet(pad)
    const justPressed = (index: number): boolean => currentButtons.has(index) && !this.pressedButtons.has(index)

    const confirmIndex = layout === 'east' ? BUTTON_EAST : BUTTON_SOUTH
    const backIndex = layout === 'east' ? BUTTON_SOUTH : BUTTON_EAST

    if (justPressed(confirmIndex)) actions.push({ type: 'confirm' })
    if (justPressed(backIndex)) actions.push({ type: 'back' })
    if (justPressed(BUTTON_WEST) || justPressed(BUTTON_START)) actions.push({ type: 'play' })
    if (justPressed(BUTTON_NORTH)) actions.push({ type: 'favorite' })
    if (justPressed(BUTTON_LB)) actions.push({ type: 'prev-category' })
    if (justPressed(BUTTON_RB)) actions.push({ type: 'next-category' })

    this.pressedButtons = currentButtons
    return { actions, activePadId: pad.id }
  }

  private currentPressedSet(pad: GamepadLike): Set<number> {
    const set = new Set<number>()
    pad.buttons.forEach((button, index) => {
      if (button?.pressed) set.add(index)
    })
    return set
  }
}
