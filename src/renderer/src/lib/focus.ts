import { animateScroll, ensureVisibleVertically } from './motion'
import { pickNext, type Box, type Direction } from './spatialNav'

const NAV_SELECTOR = '[data-nav]'
const RAIL_SELECTOR = '[data-nav-scope="rail"]'
const TOPBAR_SELECTOR = '.topbar'
const DIALOG_FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'

let lastFocusedBox: Box | null = null

/**
 * Marks that focus is being driven by keyboard or controller navigation so CSS
 * can show clear focus rings even when `.focus()` was called from a gamepad poll
 * (where Chromium's `:focus-visible` heuristic does not trigger).
 */
export function setSpatialFocusActive(active: boolean): void {
  if (typeof document === 'undefined') return
  if (active) document.documentElement.dataset.navFocus = 'true'
  else delete document.documentElement.dataset.navFocus
}

export function isSpatialFocusActive(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.navFocus === 'true'
}

function openModalDialog(): HTMLDialogElement | null {
  return document.querySelector<HTMLDialogElement>('dialog[open]')
}

function openMenuList(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.menu__list[role="menu"]')
}

function stepRangeInput(input: HTMLInputElement, delta: -1 | 1): boolean {
  const min = Number(input.min || 0)
  const max = Number(input.max || 100)
  const step = Number(input.step || 1)
  const current = Number(input.value || 0)
  const next = Math.min(max, Math.max(min, Math.round((current + delta * step) * 1000) / 1000))
  if (next === current) return false
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, String(next))
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  return true
}

function visibleNavItems(): HTMLElement[] {
  const modal = openModalDialog()
  const scope: ParentNode = modal ?? document
  const selector = modal ? DIALOG_FOCUSABLE : NAV_SELECTOR
  return Array.from(scope.querySelectorAll<HTMLElement>(selector)).filter(
    (element) =>
      !(element as HTMLButtonElement).disabled &&
      element.getClientRects().length > 0 &&
      !element.closest('[inert]')
  )
}

const inRail = (element: Element): boolean => element.closest(RAIL_SELECTOR) !== null
const inTopBar = (element: Element): boolean => element.closest(TOPBAR_SELECTOR) !== null

function focusTarget(target: HTMLElement | undefined): boolean {
  if (!target) return false
  setSpatialFocusActive(true)
  target.focus({ preventScroll: true })
  ensureVisibleVertically(target)
  lastFocusedBox = target.getBoundingClientRect()
  return true
}

function focusBestFromBox(fromBox: Box, direction: Direction, pool: HTMLElement[]): boolean {
  const index = pickNext(
    fromBox,
    direction,
    pool.map((element) => element.getBoundingClientRect())
  )
  return focusTarget(pool[index])
}

function focusBest(from: HTMLElement, direction: Direction, pool: HTMLElement[]): boolean {
  return focusBestFromBox(from.getBoundingClientRect(), direction, pool)
}

/** Moves focus into the page content (selected tile or primary action) or the active dialog. */
export function focusEntryPoint(): boolean {
  lastFocusedBox = null
  const modal = openModalDialog()
  if (modal) {
    return focusTarget(visibleNavItems()[0])
  }
  const preferred =
    document.querySelector<HTMLElement>('[data-nav-default]') ??
    document.querySelector<HTMLElement>('[data-entry-point]')
  const fallback = visibleNavItems().find((element) => !inRail(element) && !inTopBar(element))
  const anyVisible = visibleNavItems().find((element) => !inRail(element))
  return focusTarget(preferred ?? fallback ?? anyVisible)
}

/**
 * Moves focus one step in `direction`. Returns false when nothing moved, so the
 * caller can let the browser's default behaviour (scrolling) happen.
 */
export function moveFocus(direction: Direction): boolean {
  setSpatialFocusActive(true)
  const menu = openMenuList()
  if (menu) {
    if (direction !== 'up' && direction !== 'down') return false
    const nodes = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    if (nodes.length === 0) return false
    const index = nodes.indexOf(document.activeElement as HTMLButtonElement)
    const step = direction === 'down' ? 1 : -1
    return focusTarget(nodes[(index + step + nodes.length) % nodes.length])
  }

  const modal = openModalDialog()
  const active = document.activeElement
  if (active instanceof HTMLInputElement && active.type === 'range' && (direction === 'left' || direction === 'right')) {
    return stepRangeInput(active, direction === 'right' ? 1 : -1)
  }

  if (modal) {
    const items = visibleNavItems()
    if (!(active instanceof HTMLElement) || !modal.contains(active)) {
      return focusTarget(items[0])
    }
    return focusBest(active, direction, items)
  }

  if (!(active instanceof HTMLElement) || !active.hasAttribute('data-nav')) {
    const pageItems = visibleNavItems().filter((element) => !inRail(element) && !inTopBar(element))
    const fromBox =
      (active instanceof HTMLElement && active !== document.body ? active.getBoundingClientRect() : null) ??
      lastFocusedBox
    if (fromBox && pageItems.length > 0 && focusBestFromBox(fromBox, direction, pageItems)) {
      return true
    }
    return focusEntryPoint()
  }

  lastFocusedBox = active.getBoundingClientRect()
  const items = visibleNavItems()
  if (inRail(active)) {
    if (direction === 'right') return focusEntryPoint()
    return focusBest(active, direction, items.filter(inRail))
  }

  // Pressing Down from the top bar jumps straight into the page's default entry point
  // (selected game or primary action) instead of whichever random element is geometrically below.
  if (inTopBar(active)) {
    if (direction === 'down') return focusEntryPoint()
    return focusBest(active, direction, items.filter(inTopBar))
  }

  // Inside page content: navigate within page controls first so vertical moves never skip
  // intermediate toolbars (Sort/Filter, Play actions, New Collection) to jump straight to the top bar.
  const pageItems = items.filter((element) => !inRail(element) && !inTopBar(element))
  if (focusBest(active, direction, pageItems)) return true

  // At the bottom of a scrollable view (e.g. Settings where Storage / About are below the last control),
  // allow Down arrow to scroll the remaining read-only content into view.
  if (direction === 'down') {
    const scroller = active.closest<HTMLElement>('[data-scroll-y]')
    if (scroller && scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 8) {
      animateScroll(
        scroller,
        { top: Math.min(scroller.scrollHeight - scroller.clientHeight, scroller.scrollTop + 220) },
        260
      )
      return true
    }
  }

  // Pressing Up from the topmost page control reaches the active top-bar category if present.
  if (direction === 'up') {
    const scroller = active.closest<HTMLElement>('[data-scroll-y]')
    if (scroller && scroller.scrollTop > 0) {
      animateScroll(scroller, { top: 0 }, 260)
    }
    const activeTopTab =
      document.querySelector<HTMLElement>('.topnav [aria-current="page"]') ??
      document.querySelector<HTMLElement>('.topbar [aria-current="page"]') ??
      document.querySelector<HTMLElement>('.topbar [data-nav]')
    if (focusTarget(activeTopTab ?? undefined)) return true
  }

  if (direction === 'left') {
    const current =
      document.querySelector<HTMLElement>(`${RAIL_SELECTOR} [aria-current="page"]`) ??
      document.querySelector<HTMLElement>(`${RAIL_SELECTOR} [data-nav]`)
    if (focusTarget(current ?? undefined)) return true
  }
  return false
}

/** Activates the currently focused control (for gamepad Confirm), or focuses the entry point first. */
export function activateFocused(): boolean {
  setSpatialFocusActive(true)
  const active = document.activeElement
  if (active instanceof HTMLElement && active !== document.body && active.getClientRects().length > 0) {
    if (active instanceof HTMLSelectElement) {
      if (active.options.length > 0) {
        const nextIndex = (active.selectedIndex + 1) % active.options.length
        const nextValue = active.options[nextIndex].value
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
        setter?.call(active, nextValue)
        active.dispatchEvent(new Event('change', { bubbles: true }))
      }
      return true
    }
    active.click()
    return true
  }
  return focusEntryPoint()
}
