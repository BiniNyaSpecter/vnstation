/**
 * Spatial (directional) navigation. This is the pure geometry; `focus.ts` applies
 * it to the DOM. A gamepad adapter can later feed the same four directions, which
 * is why keyboard navigation is built on this instead of ad-hoc key handlers.
 */
export type Direction = 'up' | 'down' | 'left' | 'right'

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

const centerX = (box: Box): number => box.left + box.width / 2
const centerY = (box: Box): number => box.top + box.height / 2

/**
 * Returns the index of the best candidate in `direction`, or -1.
 * Horizontal moves stay on the same visual row; vertical moves prefer the
 * candidate that is closest and best aligned.
 */
export function pickNext(from: Box, direction: Direction, candidates: readonly Box[]): number {
  const horizontal = direction === 'left' || direction === 'right'
  let best = -1
  let bestScore = Number.POSITIVE_INFINITY

  candidates.forEach((box, index) => {
    const dx = centerX(box) - centerX(from)
    const dy = centerY(box) - centerY(from)
    const ahead =
      direction === 'right' ? dx > 1 : direction === 'left' ? dx < -1 : direction === 'down' ? dy > 1 : dy < -1
    if (!ahead) return

    if (horizontal) {
      const overlap = Math.min(from.top + from.height, box.top + box.height) - Math.max(from.top, box.top)
      if (overlap <= 0) return
    }

    const primary = horizontal ? Math.abs(dx) : Math.abs(dy)
    const secondary = horizontal ? Math.abs(dy) : Math.abs(dx)
    const score = primary + secondary * 3
    if (score < bestScore) {
      best = index
      bestScore = score
    }
  })

  return best
}
