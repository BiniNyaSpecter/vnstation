import { ensureVisibleVertically } from './motion'
import { pickNext, type Direction } from './spatialNav'

const NAV_SELECTOR = '[data-nav]'
const RAIL_SELECTOR = '[data-nav-scope="rail"]'
const TOPBAR_SELECTOR = '.topbar'
const DIALOG_FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'

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
  return true
}

function focusBest(from: HTMLElement, direction: Direction, pool: HTMLElement[]): boolean {
  const index = pickNext(
    from.getBoundingClientRect(),
    direction,
    pool.map((element) => element.getBoundingClientRect())
  )
  return focusTarget(pool[index])
}

/** Moves focus into the page content (selected tile or primary action) or the active dialog. */
export function focusEntryPoint(): boolean {
  const modal = openModalDialog()
  if (modal) {
    return focusTarget(visibleNavItems()[0])
  }
  const preferred = document.querySelector<HTMLElement>('[data-nav-default]')
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

  if (!(active instanceof HTMLElement) || !active.hasAttribute('data-nav')) return focusEntryPoint()

  const items = visibleNavItems()
  if (inRail(active)) {
    if (direction === 'right') return focusEntryPoint()
    return focusBest(active, direction, items.filter(inRail))
  }

  // Pressing Down from the top bar jumps straight into the page's default entry point
  // (selected game or primary action) instead of whichever random element is geometrically below.
  if (inTopBar(active) && direction === 'down') {
    if (focusEntryPoint()) return true
  }

  if (focusBest(active, direction, items.filter((element) => !inRail(element)))) return true

  // Pressing Up from the top of the page reaches the active top-bar category if present.
  if (direction === 'up' && !inTopBar(active)) {
    const activeTopTab =
      document.querySelector<HTMLElement>('.topnav [aria-current="page"]') ??
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
