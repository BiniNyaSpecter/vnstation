import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { MetadataCandidate, MetadataSearchResult } from '@shared/metadata'
import type { Game } from '@shared/types'
import { Badge } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { AgeGatePanel } from '@renderer/components/dialogs/AgeGate'
import { Dialog, DialogActions, DialogBody } from '@renderer/components/ui/Dialog'
import { Icon } from '@renderer/components/ui/Icon'
import { deriveArtStyle, fallbackCoverUrl } from '@renderer/lib/art'
import { cx } from '@renderer/lib/cx'
import { services } from '@renderer/services'
import { useAppStore } from '@renderer/state/appStore'

type Status =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'done'; result: MetadataSearchResult }

export function MatchDialog() {
  const gameId = useAppStore((state) => (state.dialog?.type === 'match-game' ? state.dialog.gameId : null))
  const game = useAppStore((state) => state.games.find((candidate) => candidate.id === gameId))
  const closeDialog = useAppStore((state) => state.closeDialog)
  const close = (): void => closeDialog('match-game')
  return (
    <Dialog
      wide
      open={game !== undefined}
      onClose={close}
      title="Find details"
      description={game ? `Choose the match for “${game.title}”. Nothing is saved until you confirm.` : undefined}
    >
      {game && <MatchForm key={game.id} game={game} onClose={close} />}
    </Dialog>
  )
}

function MatchForm({ game, onClose }: { game: Game; onClose: () => void }) {
  const showRestricted = useAppStore((state) => state.prefs.showRestricted)
  const adultConfirmed = useAppStore((state) => state.prefs.adultConfirmed)
  const updatePrefs = useAppStore((state) => state.updatePrefs)
  const confirmAdult = useAppStore((state) => state.confirmAdult)
  const applyMetadata = useAppStore((state) => state.applyMetadata)
  const openDialog = useAppStore((state) => state.openDialog)
  const [query, setQuery] = useState(game.title)
  const [status, setStatus] = useState<Status>({ state: 'loading' })
  const [selected, setSelected] = useState<string | null>(null)
  const [replaceTitle, setReplaceTitle] = useState(true)
  const [saving, setSaving] = useState(false)
  const [asking, setAsking] = useState(false)
  const latest = useRef(0)
  const firstRun = useRef(true)

  const search = useCallback(
    async (text: string): Promise<void> => {
      const request = ++latest.current
      setStatus({ state: 'loading' })
      setSelected(null)
      try {
        const result = await services.metadata.search(text, { includeRestricted: showRestricted })
        if (request === latest.current) setStatus({ state: 'done', result })
      } catch (error) {
        if (request === latest.current) setStatus({ state: 'error', message: error instanceof Error ? error.message : 'The search failed.' })
      }
    },
    [showRestricted]
  )

  // Search once with the title we already have. Later searches are user-driven.
  useEffect(() => {
    void search(game.title)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // When adults-only entries get switched on (here or elsewhere), search again so those results appear.
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    void search(query)
  }, [showRestricted]) // eslint-disable-line react-hooks/exhaustive-deps

  async function confirm(): Promise<void> {
    if (!selected || saving) return
    setSaving(true)
    const saved = await applyMetadata(game.id, selected, { replaceTitle, allowAdult: showRestricted })
    setSaving(false)
    if (saved) onClose()
  }

  function submitSearch(event: FormEvent): void {
    event.preventDefault()
    if (query.trim()) void search(query)
  }

  return (
    <>
      <DialogBody>
        <form className="inline-form match-search" onSubmit={submitSearch}>
          <input className="input" aria-label="Title to search for" placeholder="Title to search for" value={query} onChange={(event) => setQuery(event.target.value)} autoFocus />
          <Button type="submit" icon="search" nav={false} disabled={!query.trim() || status.state === 'loading'}>Search</Button>
        </form>

        {status.state === 'loading' && (
          <div className="matches" aria-busy="true" aria-label="Searching">
            {[0, 1, 2].map((n) => <div key={n} className="skeleton skeleton--match" />)}
          </div>
        )}

        {status.state === 'error' && (
          <div className="notice" role="alert">
            <Icon name="alert" size={18} />
            <span>{status.message}</span>
            <Button nav={false} onClick={() => void search(query)}>Try again</Button>
            <Button variant="ghost" nav={false} onClick={() => openDialog({ type: 'edit-game', gameId: game.id })}>
              Edit manually
            </Button>
          </div>
        )}

        {status.state === 'done' && (
          <>
            {status.result.candidates.length === 0 ? (
              <p className="dialog__empty">
                No matches for “{query.trim()}”. Try a shorter or alternative title, such as the original (Japanese) name. You can also skip this and keep
                the game without details.
              </p>
            ) : (
              <ul className="matches" role="radiogroup" aria-label="Possible matches">
                {status.result.candidates.map((candidate) => (
                  <li key={candidate.externalId}>
                    <MatchRow candidate={candidate} selected={selected === candidate.externalId} onSelect={() => setSelected(candidate.externalId)} />
                  </li>
                ))}
              </ul>
            )}
            {status.result.hiddenRestrictedCount > 0 &&
              (asking ? (
                <AgeGatePanel
                  onConfirm={() => {
                    setAsking(false)
                    confirmAdult()
                  }}
                  onCancel={() => setAsking(false)}
                />
              ) : (
                <div className="hidden-note">
                  <span>
                    {status.result.hiddenRestrictedCount} {status.result.hiddenRestrictedCount === 1 ? 'result is' : 'results are'} hidden because{' '}
                    {status.result.hiddenRestrictedCount === 1 ? 'it is' : 'they are'} rated 18+.
                  </span>
                  <Button nav={false} onClick={() => (adultConfirmed ? updatePrefs({ showRestricted: true }) : setAsking(true))}>
                    Show 18+ results
                  </Button>
                </div>
              ))}
          </>
        )}

        <label className="check check--plain">
          <input type="checkbox" checked={replaceTitle} onChange={(event) => setReplaceTitle(event.target.checked)} />
          <span>Use the official title instead of “{game.title}”</span>
        </label>
        <p className="dialog__hint">Search results come from VNDB (vndb.org). Only your search text is sent.</p>
      </DialogBody>
      <DialogActions>
        <Button variant="ghost" nav={false} onClick={onClose}>Skip for now</Button>
        <Button variant="primary" nav={false} disabled={!selected || saving} onClick={() => void confirm()}>
          {saving ? 'Downloading…' : 'Use this match'}
        </Button>
      </DialogActions>
    </>
  )
}

function MatchRow({ candidate, selected, onSelect }: { candidate: MetadataCandidate; selected: boolean; onSelect: () => void }) {
  const [broken, setBroken] = useState(false)
  const placeholder = fallbackCoverUrl(candidate.title, deriveArtStyle(candidate.externalId))
  const facts = [candidate.releaseDate?.slice(0, 4), candidate.developers.join(', '), candidate.languages.join(', ')].filter(Boolean).join(' · ')
  return (
    <button type="button" role="radio" aria-checked={selected} className={cx('match', selected && 'is-selected')} onClick={onSelect}>
      <img
        className="match__thumb"
        src={candidate.thumbnailUrl && !broken ? candidate.thumbnailUrl : placeholder}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
      />
      <span className="match__body">
        <span className="match__title">{candidate.title}</span>
        {candidate.originalTitle && <span className="match__original">{candidate.originalTitle}</span>}
        <span className="match__facts">{facts || 'No further details'}</span>
      </span>
      {candidate.contentRating === 'mature' && <Badge tone="outline">Mature</Badge>}
      {candidate.contentRating === 'restricted' && <Badge tone="outline">18+</Badge>}
      {selected && <Icon name="check" size={20} className="match__check" />}
    </button>
  )
}
