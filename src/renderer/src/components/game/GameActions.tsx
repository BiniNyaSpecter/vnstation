import type { Game } from '@shared/types'
import { Button, IconButton } from '@renderer/components/ui/Button'
import { Menu, type MenuItem } from '@renderer/components/ui/Menu'
import { useAppStore } from '@renderer/state/appStore'

/** Play / Details / favourite / more: shared by the hero and the details page. */
export function GameActions({ game, showDetails = true, entryPoint = false }: { game: Game; showDetails?: boolean; entryPoint?: boolean }) {
  const launchGame = useAppStore((state) => state.launchGame)
  const launching = useAppStore((state) => state.launchingId === game.id)
  const running = useAppStore((state) => Boolean(state.runningGames[game.id]))
  const toggleFavorite = useAppStore((state) => state.toggleFavorite)
  const openDetails = useAppStore((state) => state.openDetails)
  const openDialog = useAppStore((state) => state.openDialog)
  const openGameFolder = useAppStore((state) => state.openGameFolder)
  const showToast = useAppStore((state) => state.showToast)
  const lookupsOn = useAppStore((state) => state.prefs.metadataEnabled)

  const items: MenuItem[] = [
    { id: 'edit', label: 'Edit game', icon: 'edit', onSelect: () => openDialog({ type: 'edit-game', gameId: game.id }) },
    ...(lookupsOn ? [{ id: 'find-details', label: 'Find details', icon: 'search' as const, onSelect: () => openDialog({ type: 'match-game', gameId: game.id }) }] : []),
    { id: 'collections', label: 'Add to collection', icon: 'collections', onSelect: () => openDialog({ type: 'game-collections', gameId: game.id }) },
    ...(!game.isSample ? [{ id: 'open-folder', label: 'Open game folder', icon: 'folder' as const, onSelect: () => void openGameFolder(game.id) }] : []),
    {
      id: 'copy-path',
      label: 'Copy executable path',
      icon: 'copy',
      onSelect: () => {
        navigator.clipboard.writeText(game.launch.executablePath).then(
          () => showToast('Executable path copied.', 'success'),
          () => showToast('Could not copy the path.', 'error')
        )
      }
    },
    {
      id: 'remove',
      label: 'Remove from library',
      icon: 'trash',
      danger: true,
      onSelect: () => openDialog({ type: 'remove-game', gameId: game.id })
    }
  ]

  const playLabel = running ? 'Running' : launching ? 'Starting…' : game.playtimeMinutes > 0 ? 'Resume' : 'Play'

  return (
    <div className="actions">
      <Button
        variant="primary"
        size="lg"
        icon="play"
        entryPoint={entryPoint}
        disabled={launching || running}
        onClick={() => void launchGame(game.id)}
      >
        {playLabel}
      </Button>
      {showDetails && (
        <Button variant="secondary" size="lg" icon="info" onClick={() => openDetails(game.id)}>
          Details
        </Button>
      )}
      <IconButton
        className={game.favorite ? 'icon-btn--fav is-active' : 'icon-btn--fav'}
        icon={game.favorite ? 'heartFilled' : 'heart'}
        label={game.favorite ? 'Remove from favorites' : 'Add to favorites'}
        aria-pressed={game.favorite}
        onClick={() => void toggleFavorite(game.id)}
      />
      <Menu items={items} label="More options" />
    </div>
  )
}
