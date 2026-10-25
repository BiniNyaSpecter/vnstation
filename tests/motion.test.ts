import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { animateScroll, ensureVisibleVertically, reducedMotion } from '@renderer/lib/motion'

/** Drives requestAnimationFrame by hand so the easing can be checked exactly, at any frame rate. */
describe('animateScroll', () => {
  let now = 0
  let queue: Array<{ id: number; cb: (t: number) => void }> = []
  let nextId = 1
  let reduced = false
  const g = globalThis as Record<string, unknown>
  const saved: Record<string, unknown> = {}

  const frame = (ms: number): void => {
    now += ms
    const due = queue
    queue = []
    due.forEach((entry) => entry.cb(now))
  }
  const element = () => ({ scrollLeft: 0, scrollTop: 0 }) as unknown as HTMLElement

  beforeEach(() => {
    now = 0
    queue = []
    nextId = 1
    reduced = false
    for (const key of ['document', 'window', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame']) saved[key] = g[key]
    g.document = { documentElement: { dataset: {} } }
    g.window = { matchMedia: () => ({ matches: reduced }) }
    g.performance = { now: () => now }
    g.requestAnimationFrame = (cb: (t: number) => void) => {
      const id = nextId++
      queue.push({ id, cb })
      return id
    }
    g.cancelAnimationFrame = (id: number) => {
      queue = queue.filter((entry) => entry.id !== id)
    }
  })
  afterEach(() => {
    for (const key of Object.keys(saved)) g[key] = saved[key]
  })

  it('eases out: fast at first, settling exactly on the target', () => {
    const el = element()
    animateScroll(el, { left: 200 }, 400)
    const seen: number[] = []
    for (let i = 0; i < 12; i++) {
      frame(40)
      seen.push(el.scrollLeft)
    }
    expect(seen[0]).toBeGreaterThan(200 * (40 / 400)) // ahead of a linear move
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1] - 0.0001)
    expect(seen[seen.length - 1]).toBe(200)
    expect(queue).toHaveLength(0)
  })

  it('ends on the exact target even with very few frames (slow machines)', () => {
    const el = element()
    animateScroll(el, { left: 155.5 }, 380)
    frame(700) // a single late frame
    expect(el.scrollLeft).toBe(155.5)
  })

  it('a newer target replaces the one in flight, starting from the current position', () => {
    const el = element()
    animateScroll(el, { left: 300 }, 400)
    frame(100)
    const mid = el.scrollLeft
    expect(mid).toBeGreaterThan(0)
    animateScroll(el, { left: 0 }, 400)
    expect(queue).toHaveLength(1) // the old animation was cancelled
    for (let i = 0; i < 12; i++) frame(40)
    expect(el.scrollLeft).toBe(0)
  })

  it('moves vertically and horizontally independently', () => {
    const el = element()
    animateScroll(el, { top: 120 }, 300)
    for (let i = 0; i < 10; i++) frame(40)
    expect(el.scrollTop).toBe(120)
    expect(el.scrollLeft).toBe(0)
  })

  it('jumps straight to the target for reduced motion, with no frames scheduled', () => {
    reduced = true
    const el = element()
    animateScroll(el, { left: 90 }, 400)
    expect(el.scrollLeft).toBe(90)
    expect(queue).toHaveLength(0)
  })

  it('"full" always animates, even when the operating system asks for reduced motion', () => {
    reduced = true
    ;(g.document as { documentElement: { dataset: Record<string, string> } }).documentElement.dataset.motion = 'full'
    expect(reducedMotion()).toBe(false)
    const el = element()
    animateScroll(el, { left: 90 }, 400)
    expect(queue).toHaveLength(1)
  })

  it('"system" follows the operating system and "reduced" never animates', () => {
    const dataset = (g.document as { documentElement: { dataset: Record<string, string> } }).documentElement.dataset
    dataset.motion = 'system'
    reduced = false
    expect(reducedMotion()).toBe(false)
    reduced = true
    expect(reducedMotion()).toBe(true)
    dataset.motion = 'reduced'
    reduced = false
    expect(reducedMotion()).toBe(true)
  })

  it('does nothing for a zero-length move', () => {
    const el = element()
    animateScroll(el, { left: 0 }, 400)
    expect(queue).toHaveLength(0)
  })

  it('scrolls the container all the way back to top: 0 when focusing inside .home__screen', () => {
    reduced = true
    const scroller = {
      scrollLeft: 0,
      scrollTop: 340,
      clientHeight: 800,
      getBoundingClientRect: () => ({ top: 0, bottom: 800 })
    } as unknown as HTMLElement
    const tile = {
      closest: (selector: string) => (selector === '[data-scroll-y]' ? scroller : selector === '.home__screen, .details__hero' ? ({} as HTMLElement) : null),
      getBoundingClientRect: () => ({ top: 100, bottom: 320 })
    } as unknown as HTMLElement
    ensureVisibleVertically(tile)
    expect(scroller.scrollTop).toBe(0)
  })
})
