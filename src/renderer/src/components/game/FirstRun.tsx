import { Button } from '@renderer/components/ui/Button'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { useAppStore } from '@renderer/state/appStore'

/**
 * Shown whenever the library has no visible games. Guides first-time users, or
 * explains when every game in the library is currently hidden by the 18+ filter.
 */
export function FirstRun() {
  const totalEntries = useAppStore((state) => state.entries.length)
  const adultConfirmed = useAppStore((state) => state.prefs.adultConfirmed)
  const updatePrefs = useAppStore((state) => state.updatePrefs)
  const openDialog = useAppStore((state) => state.openDialog)
  const addSampleGames = useAppStore((state) => state.addSampleGames)

  if (totalEntries > 0) {
    return (
      <EmptyState
        icon="library"
        title="Adults-only games are hidden"
        description="Every game currently in your library is rated 18+, and adults-only entries are switched off."
        actions={
          <>
            <Button
              variant="primary"
              size="lg"
              entryPoint
              onClick={() => (adultConfirmed ? updatePrefs({ showRestricted: true }) : openDialog({ type: 'age-gate' }))}
            >
              Show 18+ games
            </Button>
            <Button size="lg" icon="plus" onClick={() => openDialog({ type: 'add-game' })}>
              Add another game
            </Button>
          </>
        }
      />
    )
  }

  return (
    <EmptyState
      icon="library"
      title="Add your first visual novel"
      description="VNStation keeps a shelf of the games you already own. Your files stay where they are."
      steps={['Choose the game’s .exe file', 'Confirm its title and launch options', 'Press Play']}
      actions={
        <>
          <Button variant="primary" size="lg" icon="plus" entryPoint onClick={() => openDialog({ type: 'add-game' })}>
            Add a game
          </Button>
          <Button size="lg" onClick={() => void addSampleGames()}>
            Preview with sample games
          </Button>
        </>
      }
    />
  )
}
