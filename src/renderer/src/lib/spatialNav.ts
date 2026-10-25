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
 * Horizontal moves stay on the same visual row; vertical moves step to the nearest
 * visual row in that direction and pick the horizontally closest item in that row
 * so intermediate rows are never skipped.
 */
export function pickNext(from: Box, direction: Direction, candidates: readonly Box[]): number {
  const horizontal = direction === 'left' || direction === 'right'
  let best = -1
  let bestScore = Number.POSITIVE_INFINITY

  if (horizontal) {
    candidates.forEach((box, index) => {
      const dx = centerX(box) - centerX(from)
      const dy = centerY(box) - centerY(from)
      const ahead = direction === 'right' ? dx > 1 : dx < -1
      if (!ahead) return

      const overlap = Math.min(from.top + from.height, box.top + box.height) - Math.max(from.top, box.top)
      if (overlap <= 0) return

      const score = Math.abs(dx) + Math.abs(dy) * 3
      if (score < bestScore) {
        best = index
        bestScore = score
      }
    })
    return best
  }

  const valid: Array<{ index: number; box: Box; absDx: number; absDy: number }> = []
  candidates.forEach((box, index) => {
    const dx = centerX(box) - centerX(from)
    const dy = centerY(box) - centerY(from)
    const ahead = direction === 'down' ? dy > 1 : dy < -1
    if (!ahead) return

    // Ignore controls that sit on the same visual row as `from`.
    const overlap = Math.min(from.top + from.height, box.top + box.height) - Math.max(from.top, box.top)
    const minH = Math.min(from.height, box.height)
    if (minH > 0 && overlap > minH * 0.4) return

    valid.push({ index, box, absDx: Math.abs(dx), absDy: Math.abs(dy) })
  })

  if (valid.length === 0) return -1

  const minDy = Math.min(...valid.map((candidate) => candidate.absDy))
  const rowTolerance = Math.max(from.height, 48)

  for (const candidate of valid) {
    if (candidate.absDy > minDy + rowTolerance) continue
    const score = candidate.absDx + candidate.absDy * 0.5
    if (score < bestScore) {
      best = candidate.index
      bestScore = score
    }
  }

  return best
}
