/**
 * Motion mode from Settings: "full" always animates, "reduced" never does, and "system"
 * follows Windows' "animation effects" setting. (When that Windows setting is off, apps are
 * told to reduce motion, which used to make this app look completely static.)
 */
export function reducedMotion(): boolean {
  const mode = document.documentElement.dataset.motion ?? 'system'
  if (mode === 'full') return false
  if (mode === 'reduced') return true
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Smooth scrolling unless motion is reduced. */
export function scrollBehavior(): ScrollBehavior {
  return reducedMotion() ? 'auto' : 'smooth'
}

const running = new WeakMap<Element, number>()

/**
 * Eased scrolling that the browser's built-in `behavior: 'smooth'` cannot do: a fixed
 * duration with a decelerating curve, cancellable when a new target arrives mid-flight.
 * This is what makes rows glide to their anchor like a console home screen.
 */
export function animateScroll(element: HTMLElement, target: { left?: number; top?: number }, duration = 380): void {
  const fromLeft = element.scrollLeft
  const fromTop = element.scrollTop
  const toLeft = target.left ?? fromLeft
  const toTop = target.top ?? fromTop

  const previous = running.get(element)
  if (previous !== undefined) cancelAnimationFrame(previous)

  if (reducedMotion() || duration <= 0 || (Math.abs(toLeft - fromLeft) < 1 && Math.abs(toTop - fromTop) < 1)) {
    element.scrollLeft = toLeft
    element.scrollTop = toTop
    running.delete(element)
    return
  }

  const start = performance.now()
  const step = (now: number): void => {
    const progress = Math.min(1, (now - start) / duration)
    const eased = 1 - Math.pow(1 - progress, 4) // ease-out quart
    element.scrollLeft = fromLeft + (toLeft - fromLeft) * eased
    element.scrollTop = fromTop + (toTop - fromTop) * eased
    if (progress < 1) running.set(element, requestAnimationFrame(step))
    else running.delete(element)
  }
  running.set(element, requestAnimationFrame(step))
}

/**
 * Scrolls the enclosing vertical scroller just enough to bring `element` into view,
 * clear of the top bar and bottom hint bar. When `element` is in the top hero/shelf
 * section of Home, scrolls all the way back to 0 so the hero banner and shelf title
 * never stay clipped behind the top bar.
 */
export function ensureVisibleVertically(element: HTMLElement): void {
  const scroller = element.closest<HTMLElement>('[data-scroll-y]')
  if (!scroller) return

  if (element.closest('.home__screen, .details__hero')) {
    if (scroller.scrollTop > 0) animateScroll(scroller, { top: 0 }, 320)
    return
  }

  const rowOrSetting = element.closest<HTMLElement>('.row, .setting')
  const topBox = (rowOrSetting ?? element).getBoundingClientRect()
  const bottomBox = element.getBoundingClientRect()
  const view = scroller.getBoundingClientRect()
  const topMargin = view.top + 116
  const bottomMargin = view.bottom - 56

  if (topBox.top < topMargin) {
    const nextTop = Math.max(0, scroller.scrollTop - (topMargin - topBox.top))
    animateScroll(scroller, { top: nextTop < 140 ? 0 : nextTop }, 320)
  } else if (bottomBox.bottom > bottomMargin) {
    animateScroll(scroller, { top: scroller.scrollTop + (bottomBox.bottom - bottomMargin) }, 320)
  }
}
