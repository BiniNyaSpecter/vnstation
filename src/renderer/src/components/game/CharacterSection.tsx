import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CharacterRecord, CharacterRole, CharacterTrait, SpoilerLevel, SpoilerPreference } from '@shared/characters'
import type { Game } from '@shared/types'
import { Badge } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { Dialog, DialogActions, DialogBody } from '@renderer/components/ui/Dialog'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { Select } from '@renderer/components/ui/Select'
import { cx } from '@renderer/lib/cx'
import { formatRelativeDate } from '@renderer/lib/format'
import { playSound } from '@renderer/lib/sound'
import { services } from '@renderer/services'
import { useAppStore } from '@renderer/state/appStore'

const ROLE_LABELS: Record<CharacterRole, string> = {
  main: 'Protagonist',
  primary: 'Main character',
  side: 'Side character',
  appears: 'Makes an appearance'
}

const ROLE_SHORT_LABELS: Record<CharacterRole, string> = {
  main: 'Protagonist',
  primary: 'Main',
  side: 'Side',
  appears: 'Appears'
}

const SPOILER_LABELS: Record<SpoilerLevel, string> = {
  0: 'No spoilers',
  1: 'Minor spoiler',
  2: 'Major spoiler'
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function maxAllowedSpoiler(pref: SpoilerPreference): SpoilerLevel {
  if (pref === 'all') return 2
  if (pref === 'minor') return 1
  return 0
}

function getSampleCharacters(game: Game): CharacterRecord[] {
  const now = new Date().toISOString()
  return [
    {
      id: 'c101',
      vndbId: 'v0',
      name: 'Mina Takahashi',
      originalName: '高橋 美奈',
      aliases: ['The Night-Shift Observer'],
      description: `Lead protagonist of ${game.title}. Keeps the logbooks in order and notices the first anomaly.`,
      biographySegments: [
        {
          text: `Lead protagonist of ${game.title}. Keeps the logbooks in order and notices the first anomaly.`,
          spoiler: false
        },
        {
          text: 'She was the one who originally sent the repeating signal three winters ago.',
          spoiler: true
        }
      ],
      hasBiographySpoilers: true,
      role: 'main',
      spoiler: 0,
      portraitUrl: null,
      bloodType: 'A',
      heightCm: 162,
      weightKg: null,
      age: 21,
      birthday: [10, 14],
      traits: [
        { id: 'i1', name: 'Calm', groupName: 'Personality', spoiler: 0, lie: false },
        { id: 'i2', name: 'Notebook keeper', groupName: 'Role', spoiler: 0, lie: false },
        { id: 'i3', name: 'Time traveler', groupName: 'Plot', spoiler: 2, lie: false }
      ],
      vndbUrl: 'https://vndb.org/c1',
      fetchedAt: now
    },
    {
      id: 'c102',
      vndbId: 'v0',
      name: 'Renji Kurosawa',
      originalName: '黒沢 蓮司',
      aliases: [],
      description: 'An archivist who arrives on the last evening train carrying an unmarked key.',
      biographySegments: [
        {
          text: 'An archivist who arrives on the last evening train carrying an unmarked key.',
          spoiler: false
        }
      ],
      hasBiographySpoilers: false,
      role: 'primary',
      spoiler: 0,
      portraitUrl: null,
      bloodType: 'O',
      heightCm: 176,
      weightKg: null,
      age: 24,
      birthday: [2, 19],
      traits: [
        { id: 'i4', name: 'Glasses', groupName: 'Appearance', spoiler: 0, lie: false },
        { id: 'i5', name: 'Investigator', groupName: 'Role', spoiler: 0, lie: false }
      ],
      vndbUrl: 'https://vndb.org/c2',
      fetchedAt: now
    },
    {
      id: 'c103',
      vndbId: 'v0',
      name: 'The Seventh Passenger',
      originalName: '七人目の乗客',
      aliases: ['Lady in Grey'],
      description: 'Appears only after the third chapter once the timetable changes.',
      biographySegments: [
        {
          text: 'Appears only after the third chapter once the timetable changes.',
          spoiler: true
        }
      ],
      hasBiographySpoilers: true,
      role: 'side',
      spoiler: 2,
      portraitUrl: null,
      bloodType: null,
      heightCm: null,
      weightKg: null,
      age: null,
      birthday: null,
      traits: [
        { id: 'i6', name: 'Mysterious', groupName: 'Personality', spoiler: 0, lie: false },
        { id: 'i7', name: 'Apparition', groupName: 'Nature', spoiler: 2, lie: false }
      ],
      vndbUrl: 'https://vndb.org/c3',
      fetchedAt: now
    }
  ]
}

function CharacterPortrait({
  src,
  name,
  blurred = false,
  large = false
}: {
  src: string | null
  name: string
  blurred?: boolean
  large?: boolean
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
  }, [src])

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')

  if (!src || failed) {
    return (
      <div
        className={cx('char-portrait char-portrait--fallback', large && 'char-portrait--lg', blurred && 'is-blurred')}
        aria-hidden="true"
      >
        <span className="char-portrait__monogram">{initials || '?'}</span>
      </div>
    )
  }

  return (
    <div className={cx('char-portrait', large && 'char-portrait--lg', blurred && 'is-blurred')}>
      <img
        src={src}
        alt={name}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    </div>
  )
}

export function CharacterSection({ game }: { game: Game }) {
  const openDialog = useAppStore((state) => state.openDialog)
  const showToast = useAppStore((state) => state.showToast)
  const prefs = useAppStore((state) => state.prefs)
  const setPref = useAppStore((state) => state.setPref)

  const [characters, setCharacters] = useState<CharacterRecord[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [fromCache, setFromCache] = useState(false)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [roleFilter, setRoleFilter] = useState<'all' | CharacterRole>('all')
  const [revealedIds, setRevealedIds] = useState<Record<string, boolean>>({})
  const [selectedCharacter, setSelectedCharacter] = useState<CharacterRecord | null>(null)

  const isLinkedVndb = game.source?.provider === 'vndb'
  const allowAdult = prefs.showRestricted && prefs.adultConfirmed
  const spoilerPref = prefs.spoilerPreference ?? 'hide'
  const allowedSpoiler = maxAllowedSpoiler(spoilerPref)

  const loadCharacters = useCallback(
    async (force = false) => {
      if (game.isSample) {
        setCharacters(getSampleCharacters(game))
        setFromCache(true)
        setFetchedAt(null)
        setStatus('ready')
        return
      }
      if (!isLinkedVndb) {
        setCharacters([])
        setStatus('idle')
        return
      }

      setStatus('loading')
      setErrorMessage(null)
      try {
        const result = await services.metadata.getCharacters(game.id, { allowAdult, force })
        setCharacters(result.characters)
        setFromCache(result.fromCache)
        setFetchedAt(result.fetchedAt)
        setStatus('ready')
        if (force) {
          showToast('Character profiles refreshed from VNDB.', 'success')
        }
      } catch (error) {
        const msg = error instanceof Error && error.message ? error.message : 'Could not load character profiles from VNDB.'
        setErrorMessage(msg)
        setStatus('error')
      }
    },
    [allowAdult, game, isLinkedVndb, showToast]
  )

  useEffect(() => {
    setRoleFilter('all')
    setRevealedIds({})
    setSelectedCharacter(null)
    void loadCharacters(false)
  }, [game.id, game.source?.externalId, allowAdult, loadCharacters])

  const countsByRole = useMemo(() => {
    const counts: Record<'all' | CharacterRole, number> = {
      all: characters.length,
      main: 0,
      primary: 0,
      side: 0,
      appears: 0
    }
    for (const c of characters) {
      counts[c.role] = (counts[c.role] ?? 0) + 1
    }
    return counts
  }, [characters])

  const filteredCharacters = useMemo(
    () => (roleFilter === 'all' ? characters : characters.filter((c) => c.role === roleFilter)),
    [characters, roleFilter]
  )

  if (!game.isSample && !isLinkedVndb) {
    return (
      <div className="chars-empty">
        <EmptyState
          icon="search"
          title="Link this game to VNDB to view its characters"
          description="Character portraits, roles, biographies and traits come from VNDB once your game is matched."
          actions={
            prefs.metadataEnabled ? (
              <Button variant="primary" icon="search" onClick={() => openDialog({ type: 'match-game', gameId: game.id })}>
                Find details on VNDB
              </Button>
            ) : undefined
          }
        />
      </div>
    )
  }

  if (status === 'loading') {
    return (
      <section className="chars" aria-busy="true" aria-label="Loading characters">
        <div className="chars__toolbar">
          <div className="chars__status">Loading character compendium from VNDB…</div>
        </div>
        <div className="chars__grid">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="char-card char-card--skeleton" aria-hidden="true">
              <div className="char-portrait char-portrait--skeleton" />
              <div className="char-card__body">
                <div className="skeleton-line skeleton-line--title" />
                <div className="skeleton-line skeleton-line--sub" />
              </div>
            </div>
          ))}
        </div>
      </section>
    )
  }

  if (status === 'error') {
    return (
      <div className="chars-empty">
        <EmptyState
          icon="alert"
          title="Could not load characters"
          description={errorMessage ?? 'VNDB could not be reached right now.'}
          actions={
            <Button variant="primary" onClick={() => void loadCharacters(true)}>
              Try again
            </Button>
          }
        />
      </div>
    )
  }

  if (characters.length === 0) {
    return (
      <div className="chars-empty">
        <EmptyState
          icon="info"
          title="No characters listed on VNDB"
          description="VNDB does not have character profiles linked to this visual novel yet."
          actions={
            !game.isSample ? (
              <Button onClick={() => void loadCharacters(true)}>Refresh from VNDB</Button>
            ) : undefined
          }
        />
      </div>
    )
  }

  const roles: Array<'all' | CharacterRole> = ['all', 'main', 'primary', 'side', 'appears']

  return (
    <section className="chars" aria-label="Characters">
      <div className="chars__toolbar">
        <div className="chars__roles" role="tablist" aria-label="Filter characters by role">
          {roles.map((r) => {
            const count = countsByRole[r]
            if (r !== 'all' && count === 0) return null
            const active = roleFilter === r
            return (
              <button
                key={r}
                type="button"
                role="tab"
                aria-selected={active}
                className={cx('chip-btn', active && 'is-active')}
                data-nav=""
                onClick={() => {
                  playSound('select')
                  setRoleFilter(r)
                }}
              >
                <span>{r === 'all' ? 'All' : ROLE_SHORT_LABELS[r]}</span>
                <span className="chip-btn__count">{count}</span>
              </button>
            )
          })}
        </div>

        <div className="chars__controls">
          <div className="chars__spoiler-select">
            <span className="chars__control-label">Spoilers</span>
            <Select
              label="Character spoiler filter"
              value={spoilerPref}
              onChange={(val) => setPref('spoilerPreference', val as SpoilerPreference)}
              options={[
                { value: 'hide', label: 'Hide spoilers' },
                { value: 'minor', label: 'Allow minor' },
                { value: 'all', label: 'Show all' }
              ]}
            />
          </div>
          {!game.isSample && (
            <Button size="md" onClick={() => void loadCharacters(true)}>
              Refresh cast
            </Button>
          )}
        </div>
      </div>

      <p className="chars__meta">
        {game.isSample
          ? 'Sample character profiles for interface preview.'
          : `${characters.length} ${characters.length === 1 ? 'character' : 'characters'} from VNDB (${game.source?.externalId})${
              fetchedAt ? ` · Updated ${formatRelativeDate(fetchedAt)}${fromCache ? ' (cached)' : ''}` : ''
            }.`}
      </p>

      <div className="chars__grid">
        {filteredCharacters.map((char) => {
          const isMasked = char.spoiler > allowedSpoiler && !revealedIds[char.id]
          const previewBio =
            char.description ??
            (char.hasBiographySpoilers ? 'Biography contains spoilers. Open profile to reveal.' : 'No biography listed.')

          return (
            <button
              key={char.id}
              type="button"
              className={cx('char-card', isMasked && 'char-card--masked')}
              data-nav=""
              onClick={() => {
                playSound('select')
                if (isMasked) {
                  setRevealedIds((prev) => ({ ...prev, [char.id]: true }))
                } else {
                  setSelectedCharacter(char)
                }
              }}
            >
              <CharacterPortrait src={char.portraitUrl} name={isMasked ? 'Spoiler' : char.name} blurred={isMasked} />
              <div className="char-card__body">
                <div className="char-card__badges">
                  <Badge tone={char.role === 'main' || char.role === 'primary' ? 'accent' : 'soft'}>
                    {ROLE_SHORT_LABELS[char.role]}
                  </Badge>
                  {char.spoiler > 0 && (
                    <Badge>{SPOILER_LABELS[char.spoiler]}</Badge>
                  )}
                </div>

                {isMasked ? (
                  <>
                    <div className="char-card__name">Spoiler character hidden</div>
                    <div className="char-card__sub">
                      Marked as a {SPOILER_LABELS[char.spoiler].toLowerCase()} on VNDB. Select to reveal this character.
                    </div>
                  </>
                ) : (
                  <>
                    <div className="char-card__name">{char.name}</div>
                    {char.originalName && (
                      <div className="char-card__orig" lang="ja">
                        {char.originalName}
                      </div>
                    )}
                    <p className="char-card__bio">{previewBio}</p>
                  </>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {selectedCharacter && (
        <CharacterDetailDialog
          character={selectedCharacter}
          allowedSpoiler={allowedSpoiler}
          isSample={game.isSample}
          onClose={() => setSelectedCharacter(null)}
        />
      )}
    </section>
  )
}

function CharacterDetailDialog({
  character,
  allowedSpoiler,
  isSample,
  onClose
}: {
  character: CharacterRecord
  allowedSpoiler: SpoilerLevel
  isSample: boolean
  onClose: () => void
}) {
  const showToast = useAppStore((state) => state.showToast)
  const [revealBioSpoilers, setRevealBioSpoilers] = useState(allowedSpoiler >= 2)
  const [revealTraitSpoilers, setRevealTraitSpoilers] = useState(allowedSpoiler >= 2)

  useEffect(() => {
    setRevealBioSpoilers(allowedSpoiler >= 2)
    setRevealTraitSpoilers(allowedSpoiler >= 2)
  }, [character.id, allowedSpoiler])

  const effectiveTraitSpoiler: SpoilerLevel = revealTraitSpoilers ? 2 : allowedSpoiler
  const visibleTraits = useMemo(
    () => character.traits.filter((t) => t.spoiler <= effectiveTraitSpoiler),
    [character.traits, effectiveTraitSpoiler]
  )
  const hiddenTraitCount = character.traits.length - visibleTraits.length

  const groupedTraits = useMemo(() => {
    const groups = new Map<string, CharacterTrait[]>()
    for (const trait of visibleTraits) {
      const group = trait.groupName ?? 'Other'
      const list = groups.get(group)
      if (list) list.push(trait)
      else groups.set(group, [trait])
    }
    return [...groups.entries()]
  }, [visibleTraits])

  const stats: Array<[string, string]> = []
  if (character.age !== null) stats.push(['Age', `${character.age}`])
  if (character.birthday) {
    const [m, d] = character.birthday
    stats.push(['Birthday', `${MONTHS[m - 1] ?? m} ${d}`])
  }
  if (character.heightCm !== null) stats.push(['Height', `${character.heightCm} cm`])
  if (character.weightKg !== null) stats.push(['Weight', `${character.weightKg} kg`])
  if (character.bloodType) stats.push(['Blood type', character.bloodType])

  const handleOpenVndb = async () => {
    if (isSample) {
      showToast('Sample characters use placeholder VNDB links.', 'info')
      return
    }
    try {
      await services.metadata.openExternalVndb(character.vndbUrl)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not open VNDB in your browser.', 'error')
    }
  }

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={character.name}
      description={character.originalName ?? ROLE_LABELS[character.role]}
    >
      <DialogBody>
        <div className="char-detail">
          <div className="char-detail__aside">
            <CharacterPortrait src={character.portraitUrl} name={character.name} large />
            <div className="char-detail__badges">
              <Badge tone="accent">{ROLE_LABELS[character.role]}</Badge>
              {character.spoiler > 0 && <Badge>{SPOILER_LABELS[character.spoiler]}</Badge>}
            </div>
            {stats.length > 0 && (
              <dl className="char-detail__stats">
                {stats.map(([label, val]) => (
                  <div key={label} className="char-detail__stat">
                    <dt>{label}</dt>
                    <dd>{val}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          <div className="char-detail__main">
            {character.aliases.length > 0 && (
              <div className="char-detail__block">
                <h3 className="char-detail__heading">Also known as</h3>
                <p className="char-detail__aliases">{character.aliases.join(' · ')}</p>
              </div>
            )}

            <div className="char-detail__block">
              <div className="char-detail__heading-row">
                <h3 className="char-detail__heading">Biography</h3>
                {character.hasBiographySpoilers && (
                  <Button
                    size="md"
                    onClick={() => setRevealBioSpoilers((v) => !v)}
                  >
                    {revealBioSpoilers ? 'Hide biography spoilers' : 'Reveal biography spoilers'}
                  </Button>
                )}
              </div>

              {character.biographySegments.length === 0 ? (
                <p className="char-detail__bio-empty">No biography provided on VNDB.</p>
              ) : (
                <div className="char-detail__bio">
                  {character.biographySegments.map((seg, idx) =>
                    seg.spoiler && !revealBioSpoilers ? (
                      <button
                        key={idx}
                        type="button"
                        className="char-spoiler-block"
                        data-nav=""
                        onClick={() => setRevealBioSpoilers(true)}
                      >
                        Spoiler text hidden — select to reveal
                      </button>
                    ) : (
                      <p key={idx} className={cx('char-detail__paragraph', seg.spoiler && 'char-detail__paragraph--spoiler')}>
                        {seg.text}
                      </p>
                    )
                  )}
                </div>
              )}
            </div>

            {character.traits.length > 0 && (
              <div className="char-detail__block">
                <div className="char-detail__heading-row">
                  <h3 className="char-detail__heading">Traits</h3>
                  {hiddenTraitCount > 0 && !revealTraitSpoilers && (
                    <Button size="md" onClick={() => setRevealTraitSpoilers(true)}>
                      Show {hiddenTraitCount} spoiler {hiddenTraitCount === 1 ? 'trait' : 'traits'}
                    </Button>
                  )}
                  {revealTraitSpoilers && allowedSpoiler < 2 && (
                    <Button size="md" onClick={() => setRevealTraitSpoilers(false)}>
                      Hide spoiler traits
                    </Button>
                  )}
                </div>

                {groupedTraits.length === 0 ? (
                  <p className="char-detail__bio-empty">
                    All traits for this character are marked as spoilers. Select “Show spoiler traits” to view them.
                  </p>
                ) : (
                  <div className="char-traits">
                    {groupedTraits.map(([group, list]) => (
                      <div key={group} className="char-traits__group">
                        <div className="char-traits__label">{group}</div>
                        <ul className="chips">
                          {list.map((t) => (
                            <li key={`${t.id}-${t.name}`}>
                              <Badge tone={t.spoiler > 0 ? 'accent' : 'soft'}>
                                {t.name}
                                {t.lie ? ' (lie)' : ''}
                              </Badge>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </DialogBody>
      <DialogActions>
        <Button onClick={() => void handleOpenVndb()}>
          Open on VNDB ({character.id})
        </Button>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  )
}
