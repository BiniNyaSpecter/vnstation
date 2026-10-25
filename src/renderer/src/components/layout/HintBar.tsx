import { useAppStore } from '@renderer/state/appStore'

/**
 * Console-style control hints along the bottom edge. Automatically shows controller
 * prompts when a gamepad is being used and keyboard shortcuts otherwise.
 */
export function HintBar() {
  const canGoBack = useAppStore((state) => state.history.length > 1)
  const inputMode = useAppStore((state) => state.inputMode)
  const confirm = useAppStore((state) => state.prefs.gamepadConfirm)
  const hasSelected = useAppStore((state) => Boolean(state.selectedGameId))

  const hints: Array<[string, string]> =
    inputMode === 'gamepad'
      ? [
          ['D-Pad / LS', 'Navigate'],
          [confirm === 'east' ? 'B / ○' : 'A / ✕', 'Select'],
          ...(canGoBack ? ([[confirm === 'east' ? 'A / ✕' : 'B / ○', 'Back']] as Array<[string, string]>) : []),
          ...(hasSelected ? ([['Start', 'Play'], ['Y / △', 'Favorite']] as Array<[string, string]>) : []),
          ['LB / RB', 'Category']
        ]
      : [
          ['↑ ↓ ← →', 'Navigate'],
          ['Enter', 'Open'],
          ...(canGoBack ? ([['Esc', 'Back']] as Array<[string, string]>) : []),
          ['[ ]', 'Category'],
          ['/', 'Search'],
          ['F11', 'Full screen']
        ]

  return (
    <footer className="hints" aria-hidden="true">
      {hints.map(([keys, label]) => (
        <span key={label}>
          <kbd>{keys}</kbd>
          {label}
        </span>
      ))}
    </footer>
  )
}
