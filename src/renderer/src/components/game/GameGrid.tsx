import type { Game } from '@shared/types'
import { GameTile } from './GameTile'

export function GameGrid({
  games,
  selectedId,
  onSelect,
  onOpen
}: {
  games: Game[]
  selectedId: string | null
  onSelect: (id: string) => void
  onOpen: (id: string) => void
}) {
  const hasSelection = games.some((game) => game.id === selectedId)
  return (
    <div className="grid">
      {games.map((game, index) => {
        const selected = game.id === selectedId
        return (
          <GameTile
            key={game.id}
            game={game}
            selected={selected}
            tabbable={selected || (!hasSelection && index === 0)}
            labelMode="always"
            onSelect={() => onSelect(game.id)}
            onOpen={() => onOpen(game.id)}
          />
        )
      })}
    </div>
  )
}
