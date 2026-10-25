import { useEffect, useState, type ReactNode } from 'react'
import type { VerifyResult } from '@shared/contracts'
import type { PlayHistory, SessionTracking } from '@shared/launcher'
import type { Game } from '@shared/types'
import { GameActions } from '@renderer/components/game/GameActions'
import { StatRow } from '@renderer/components/game/StatRow'
import { Badge } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { Icon } from '@renderer/components/ui/Icon'
import { formatRelativeDate, formatReleaseDate, formatSessionDuration, RATING_LABELS } from '@renderer/lib/format'
import { services } from '@renderer/services'
import { useAppStore } from '@renderer/state/appStore'

export function DetailsView({ gameId }: { gameId: string }) {
  const game = useAppStore((state) => state.games.find((candidate) => candidate.id === gameId))
  const goBack = useAppStore((state) => state.goBack)

  if (!game) {
    return (
      <EmptyState
        icon="library"
        title="This game is no longer in your library"
        description="It may have been removed. Go back to keep browsing."
        actions={<Button variant="primary" entryPoint onClick={goBack}>Go back</Button>}
      />
    )
  }

  return <DetailsContent game={game} />
}

function DetailsContent({ game }: { game: Game }) {
  const goBack = useAppStore((state) => state.goBack)
  const openDialog = useAppStore((state) => state.openDialog)
  const verifyGame = useAppStore((state) => state.verifyGame)
  const refreshMetadata = useAppStore((state) => state.refreshMetadata)
  const running = useAppStore((state) => state.runningGames[game.id] ?? null)
  const adultMode = useAppStore((state) => state.prefs.showRestricted && state.prefs.metadataEnabled)
  const [check, setCheck] = useState<VerifyResult | null>(null)

  // Look for moved or deleted files each time the page opens or the saved paths change.
  useEffect(() => {
    setCheck(null)
    if (game.isSample) return
    let live = true
    void verifyGame(game.id).then((result) => live && setCheck(result))
    return () => {
      live = false
    }
  }, [game.id, game.isSample, game.launch.executablePath, game.launch.workingDirectory, verifyGame])

  const needsDetails = adultMode && game.source?.provider === 'vndb' && !game.synopsis && game.contentRating === 'restricted'

  const problem =
    check?.executableExists === false
      ? 'VNStation can’t find this game’s executable. It may have been moved or deleted.'
      : check?.workingDirectoryExists === false
        ? 'This game’s working directory is missing.'
        : null

  return (
    <div className="stage details">
      <div className="details__scroll" data-scroll-y="">
        <section className="details__hero">
          <Button variant="ghost" icon="arrowLeft" onClick={goBack}>Back</Button>
          <div className="details__titleblock">
            <h1 className="hero__title">{game.title}</h1>
            {game.originalTitle && (
              <p className="hero__subtitle" lang={game.originalLanguage === 'Japanese' ? 'ja' : undefined}>{game.originalTitle}</p>
            )}
            <StatRow game={game} />
            {game.contentRating === 'restricted' && (
              <p className="notice notice--info" role="note">
                <span className="notice__badge" aria-hidden="true">18+</span>
                <span>
                  This game is rated for adults and may contain sexual or violent content.
                  {needsDetails ? ' Refresh its details to download the description and artwork.' : ''}
                </span>
                {needsDetails && <Button onClick={() => void refreshMetadata(game.id)}>Refresh details</Button>}
              </p>
            )}
            {problem && (
              <p className="notice" role="alert">
                <Icon name="alert" size={18} />
                <span>{problem}</span>
                <Button size="md" onClick={() => openDialog({ type: 'edit-game', gameId: game.id })}>Repair</Button>
              </p>
            )}
            {running && (
              <p className="notice notice--info" role="status">
                <Icon name="play" size={18} />
                <span>
                  {running.mode === 'folder'
                    ? 'Running (tracking the game process started from its installation folder).'
                    : 'Currently running. Playtime will be updated when the game closes.'}
                </span>
              </p>
            )}
            <GameActions game={game} showDetails={false} entryPoint />
          </div>
        </section>

        <section className="details__content">
          <div className="details__main">
            <h2 className="section-title">About</h2>
            <p className="details__synopsis">{game.synopsis ?? 'No description yet. Use “Find details” in the menu above to look it up on VNDB, or add your own in Edit game.'}</p>
            {(game.genres.length > 0 || game.tags.length > 0) && (
              <ul className="chips" aria-label="Genres and tags">
                {game.genres.map((genre) => <li key={`g-${genre}`}><Badge tone="accent">{genre}</Badge></li>)}
                {game.tags.map((tag) => <li key={`t-${tag}`}><Badge>{tag}</Badge></li>)}
              </ul>
            )}
            <h2 className="section-title">Your notes</h2>
            <NotesField key={game.id} game={game} />
          </div>

          <aside className="details__side">
            <InfoList
              title="About this game"
              note={game.source ? sourceLabel(game) : 'Added manually, so there are no downloaded details yet.'}
              rows={[
                ['Developer', game.developer ?? 'Unknown'],
                ['Release date', formatReleaseDate(game.releaseDate)],
                ['Original language', game.originalLanguage ?? 'Unknown'],
                ['Available in', game.languages.length ? game.languages.join(', ') : 'Unknown'],
                ['Rating', RATING_LABELS[game.contentRating]]
              ]}
            />
            <InfoList
              title="In your library"
              note="Only you can change these."
              rows={[
                ['Executable', <span className="path" key="exe">{game.launch.executablePath}</span>],
                ['Working directory', <span className="path" key="wd">{game.launch.workingDirectory}</span>],
                ['Launch arguments', game.launch.arguments || 'None'],
                ['Added', formatRelativeDate(game.addedAt)]
              ]}
            />
            <PlayHistoryCard game={game} isRunning={Boolean(running)} />
          </aside>
        </section>
      </div>
    </div>
  )
}

const TRACKING_NOTES: Partial<Record<SessionTracking, string>> = {
  folder: 'tracked via folder',
  handoff: 'launcher exited early',
  'app-closed': 'VNStation closed',
  interrupted: 'interrupted'
}

function PlayHistoryCard({ game, isRunning }: { game: Game; isRunning: boolean }) {
  const [history, setHistory] = useState<PlayHistory | null>(null)

  useEffect(() => {
    let live = true
    services.launcher.history(game.id, 5).then(
      (result) => live && setHistory(result),
      () => live && setHistory(null)
    )
    return () => {
      live = false
    }
  }, [game.id, game.lastPlayedAt, game.playtimeMinutes, isRunning])

  if (!history || history.sessions.length === 0) return null

  return (
    <InfoList
      title="Recent sessions"
      note={history.totalSessions === 1 ? '1 recorded launch' : `${history.totalSessions} recorded launches`}
      rows={history.sessions.map((session) => {
        const note = session.tracking ? TRACKING_NOTES[session.tracking] : null
        const value =
          session.endedAt === null
            ? 'Running now'
            : session.tracking === 'interrupted'
              ? 'Interrupted'
              : note
                ? `${formatSessionDuration(session.seconds)} (${note})`
                : formatSessionDuration(session.seconds)
        return [`${formatRelativeDate(session.startedAt)} (#${session.id})`, value]
      })}
    />
  )
}

const sourceLabel = (game: Game): string =>
  game.source?.provider === 'sample'
    ? 'Sample data for development, not from a provider.'
    : 'Information from VNDB (vndb.org), made available under the Open Database License.'

function NotesField({ game }: { game: Game }) {
  const updateNotes = useAppStore((state) => state.updateNotes)
  const [value, setValue] = useState(game.notes)
  return (
    <label className="field">
      <span className="sr-only">Your notes about {game.title}</span>
      <textarea
        className="input input--area"
        rows={4}
        placeholder="Routes you’ve finished, where you left off, anything worth remembering."
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => value !== game.notes && void updateNotes(game.id, value)}
      />
    </label>
  )
}

function InfoList({ title, note, rows }: { title: string; note: string; rows: Array<[string, ReactNode]> }) {
  return (
    <section className="info">
      <h3 className="info__title">{title}</h3>
      <p className="info__note">{note}</p>
      <dl className="info__list">
        {rows.map(([label, value]) => (
          <div key={label} className="info__row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
