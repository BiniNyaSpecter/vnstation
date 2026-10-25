import type { Game } from '@shared/types'
import { cx } from '@renderer/lib/cx'
import { isSpatialFocusActive } from '@renderer/lib/focus'
import { ensureVisibleVertically } from '@renderer/lib/motion'
import { playSound } from '@renderer/lib/sound'
import { Icon } from '@renderer/components/ui/Icon'
import { useAppStore } from '@renderer/state/appStore'
import { CoverArt } from './CoverArt'

export interface GameTileProps {
  game: Game
  selected: boolean
  /** Roving tabindex: one tile per group is a Tab stop, arrows move between the rest. */
  tabbable: boolean
  labelMode?: 'selected' | 'always'
  onSelect: () => void
  onOpen: () => void
}

/**
 * Focus selects (so the hero follows the keyboard); Enter or double-click opens details.
 */
export function GameTile({ game, selected, tabbable, labelMode = 'selected', onSelect, onOpen }: GameTileProps) {
  const running = useAppStore((state) => Boolean(state.runningGames[game.id]))
  const choose = (): void => {
    if (!selected) playSound('move')
    onSelect()
  }
  return (
    <button
      type="button"
      className={cx('tile', selected && 'is-selected', labelMode === 'always' && 'tile--labelled')}
      data-nav=""
      data-nav-default={selected ? '' : undefined}
      data-game-id={game.id}
      tabIndex={tabbable ? 0 : -1}
      aria-label={game.title}
      aria-current={selected ? 'true' : undefined}
      onFocus={(event) => {
        // Rows position themselves horizontally; here we only keep the tile clear of the screen edges.
        if (event.currentTarget.matches(':focus-visible') || isSpatialFocusActive()) {
          ensureVisibleVertically(event.currentTarget)
        }
        choose()
      }}
      onClick={choose}
      onDoubleClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          onOpen()
        }
      }}
    >
      <span className="tile__art">
        <CoverArt src={game.coverUrl} fallback={game.coverFallbackUrl} />
        {running && (
          <span className="tile__running" title="Currently running">
            Running
          </span>
        )}
        {game.contentRating === 'restricted' && (
          <span className="tile__age" title="Rated for adults (18+)">
            18+
          </span>
        )}
        {game.librarySource !== 'manual' && !running && (
          <span className="tile__source" title={game.librarySource === 'steam-api' ? 'Imported from Steam Web API' : 'Imported from local Steam library'}>
            Steam
          </span>
        )}
        {game.favorite && (
          <span className="tile__fav" aria-hidden="true">
            <Icon name="heartFilled" size={13} />
          </span>
        )}
      </span>
      <span className="tile__label">{game.title}</span>
    </button>
  )
}
