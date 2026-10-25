import type { Game } from '@shared/types'
import { formatPlaytime, formatRelativeDate, RATING_LABELS, releaseYear } from '@renderer/lib/format'

/** Compact facts under the title: time played, last played, release year, rating. */
export function StatRow({ game }: { game: Game }) {
  return (
    <dl className="stats">
      <div className="stats__item">
        <dt>Time played</dt>
        <dd>{formatPlaytime(game.playtimeMinutes)}</dd>
      </div>
      <div className="stats__item">
        <dt>Last played</dt>
        <dd>{formatRelativeDate(game.lastPlayedAt)}</dd>
      </div>
      <div className="stats__item">
        <dt>Released</dt>
        <dd>{releaseYear(game.releaseDate)}</dd>
      </div>
      <div className="stats__item">
        <dt>Rating</dt>
        <dd>
          <span className="rating-box">{RATING_LABELS[game.contentRating]}</span>
        </dd>
      </div>
    </dl>
  )
}
