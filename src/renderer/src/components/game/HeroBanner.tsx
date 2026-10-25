import type { Game } from '@shared/types'
import { cx } from '@renderer/lib/cx'
import { GameActions } from './GameActions'
import { StatRow } from './StatRow'

/** The selected game's title block: name, facts, synopsis and actions. */
export function HeroBanner({ game, compact = false }: { game: Game; compact?: boolean }) {
  return (
    <div className={cx('hero', compact && 'hero--compact')}>
      {/* Keyed so the text block fades when the selection changes; actions stay mounted. */}
      <div className="hero__text" key={game.id}>
        <h1 className="hero__title">{game.title}</h1>
        {game.originalTitle && (
          <p className="hero__subtitle" lang={game.originalLanguage === 'Japanese' ? 'ja' : undefined}>
            {game.originalTitle}
          </p>
        )}
        <StatRow game={game} />
        {game.synopsis && <p className="hero__synopsis">{game.synopsis}</p>}
      </div>
      <GameActions game={game} entryPoint />
    </div>
  )
}
