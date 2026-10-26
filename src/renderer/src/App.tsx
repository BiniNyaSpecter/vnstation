import { useEffect } from 'react'
import { APP_CONFIG } from '@shared/app-config'
import { ACCENTS } from '@renderer/lib/prefs'
import { activateFocused, focusEntryPoint, moveFocus, setSpatialFocusActive } from '@renderer/lib/focus'
import { GamepadTracker } from '@renderer/lib/gamepad'
import { configureSound, playSound } from '@renderer/lib/sound'
import type { Direction } from '@renderer/lib/spatialNav'
import { AppShell } from '@renderer/components/layout/AppShell'
import { appStore, useAppStore } from '@renderer/state/appStore'

const ARROWS: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right'
}

const isTyping = (element: Element | null): boolean =>
  element instanceof HTMLElement &&
  (element.isContentEditable ||
    element.tagName === 'TEXTAREA' ||
    (element.tagName === 'INPUT' && !/^(range|checkbox|radio|button|submit|reset)$/i.test((element as HTMLInputElement).type)))

/** Arrow-key navigation, Esc to go back, "/" to search, "[" / "]" for categories, "F" to favorite, Ctrl+B to toggle the rail. */
function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.altKey) return
      const state = appStore.getState()
      state.setInputState({ inputMode: 'keyboard' })
      const active = document.activeElement
      const modalOpen = Boolean(document.querySelector('dialog[open]'))

      if (modalOpen) {
        if (!event.ctrlKey && !event.metaKey && !isTyping(active) && event.key in ARROWS) {
          if (moveFocus(ARROWS[event.key])) {
            event.preventDefault()
            playSound('move')
          }
        }
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        state.setPref('railCollapsed', !state.prefs.railCollapsed)
        return
      }
      if (event.ctrlKey || event.metaKey) return

      if (isTyping(active)) {
        if (event.key === 'Escape' && active instanceof HTMLElement) {
          event.preventDefault()
          active.blur()
          focusEntryPoint()
        } else if (
          active instanceof HTMLElement &&
          active.id === 'global-search' &&
          (event.key === 'ArrowDown' || event.key === 'Enter')
        ) {
          event.preventDefault()
          active.blur()
          focusEntryPoint()
        } else if (
          active instanceof HTMLInputElement &&
          (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
          moveFocus(ARROWS[event.key])
        ) {
          event.preventDefault()
          playSound('move')
        }
        return
      }

      if (event.key === '/') {
        event.preventDefault()
        document.getElementById('global-search')?.focus()
      } else if (event.key === 'Escape') {
        state.goBack()
      } else if (event.key === '[') {
        event.preventDefault()
        state.cycleCategory(-1)
      } else if (event.key === ']') {
        event.preventDefault()
        state.cycleCategory(1)
      } else if (event.key.toLowerCase() === 'f' && state.selectedGameId && state.route.name !== 'settings') {
        event.preventDefault()
        void state.toggleFavorite(state.selectedGameId)
      } else if (event.key === 'Enter' && (!active || active === document.body)) {
        if (focusEntryPoint()) {
          event.preventDefault()
          playSound('move')
        }
      } else if (event.key in ARROWS) {
        // Only take over when focus is on the page or a navigable element, never inside menus.
        const onPage =
          !active ||
          active === document.body ||
          active.hasAttribute('data-nav') ||
          Boolean(active.closest('.shell__main'))
        if (onPage) {
          if (
            active instanceof HTMLSelectElement ||
            (active instanceof HTMLInputElement && active.type === 'range')
          ) {
            event.preventDefault()
          }
          if (moveFocus(ARROWS[event.key])) {
            event.preventDefault()
            playSound('move')
          }
        }
      }
    }
    const onPointerDown = (): void => {
      setSpatialFocusActive(false)
      appStore.getState().setInputState({ inputMode: 'keyboard' })
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('pointerdown', onPointerDown, { passive: true })
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [])
}

/**
 * Polls connected gamepads while the VNStation window is visible and focused.
 * Pauses automatically when a game has focus so controller input in a visual novel
 * never triggers actions in the background launcher.
 */
function useGamepadNavigation(): void {
  const enabled = useAppStore((state) => state.prefs.gamepadEnabled)

  useEffect(() => {
    if (!enabled || typeof navigator.getGamepads !== 'function') return
    const tracker = new GamepadTracker()
    let frame = 0
    let active = true
    let scheduled = false

    const schedule = (): void => {
      if (!active || scheduled) return
      if (document.visibilityState !== 'visible' || !document.hasFocus()) {
        tracker.reset()
        return
      }
      scheduled = true
      frame = window.requestAnimationFrame(step)
    }

    const step = (now: number): void => {
      scheduled = false
      if (!active) return
      if (document.visibilityState !== 'visible' || !document.hasFocus()) {
        tracker.reset()
        return
      }

      const state = appStore.getState()
      const pads = navigator.getGamepads ? navigator.getGamepads() : []
      const { actions, activePadId } = tracker.poll(pads, now, state.prefs.gamepadConfirm)
      if (activePadId !== state.gamepadName) state.setInputState({ gamepadName: activePadId })

      if (actions.length > 0) {
        setSpatialFocusActive(true)
        state.setInputState({ inputMode: 'gamepad', gamepadName: activePadId })
        const modalOpen = Boolean(document.querySelector('dialog[open]'))
        const menuOpen = Boolean(document.querySelector('.menu__list[role="menu"]'))
        for (const action of actions) {
          if (action.type === 'move') {
            if (moveFocus(action.direction)) playSound('move')
          } else if (action.type === 'confirm') {
            const wasSelect = document.activeElement instanceof HTMLSelectElement
            if (activateFocused() && wasSelect) playSound('select')
          } else if (action.type === 'back') {
            if (menuOpen) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
            else if (modalOpen) state.closeDialog()
            else state.goBack()
          } else if (!modalOpen && !menuOpen && action.type === 'play' && state.selectedGameId) {
            void state.launchGame(state.selectedGameId)
          } else if (!modalOpen && !menuOpen && action.type === 'favorite' && state.selectedGameId) {
            void state.toggleFavorite(state.selectedGameId)
          } else if (!modalOpen && !menuOpen && action.type === 'prev-category') {
            state.cycleCategory(-1)
          } else if (!modalOpen && !menuOpen && action.type === 'next-category') {
            state.cycleCategory(1)
          }
        }
      }

      schedule()
    }

    const onFocus = (): void => {
      tracker.reset()
      schedule()
    }
    const onBlur = (): void => {
      tracker.reset()
    }
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible' && document.hasFocus()) {
        tracker.reset()
        schedule()
      } else {
        tracker.reset()
      }
    }

    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    schedule()

    return () => {
      active = false
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
      window.cancelAnimationFrame(frame)
    }
  }, [enabled])
}

/** A soft confirm sound for every button press (tiles make their own "move" sound). */
function useClickSounds(): void {
  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      const button = (event.target as Element | null)?.closest?.('button')
      if (button && !button.disabled && !button.classList.contains('tile')) playSound('select')
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])
}

/** Mirrors preferences onto <html> so CSS variables and attributes drive the theme. */
function useAppearance(): void {
  const prefs = useAppStore((state) => state.prefs)
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = prefs.theme
    root.dataset.motion = prefs.motion
    root.dataset.titleFont = prefs.titleFont
    configureSound({ enabled: prefs.soundEnabled, volume: prefs.soundVolume })
    root.style.setProperty('--accent', ACCENTS[prefs.accent].value)
    root.style.setProperty('--backdrop-strength', String(prefs.backdropStrength))
  }, [prefs])
}

export function App() {
  useGlobalShortcuts()
  useGamepadNavigation()
  useClickSounds()
  useAppearance()
  useEffect(() => {
    document.title = APP_CONFIG.name
    void appStore.getState().init()
  }, [])
  return <AppShell />
}
