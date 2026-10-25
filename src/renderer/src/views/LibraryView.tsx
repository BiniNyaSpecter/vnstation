import { useMemo, useState } from 'react'
import type { Collection, SortKey } from '@shared/types'
import { FirstRun } from '@renderer/components/game/FirstRun'
import { GameGrid } from '@renderer/components/game/GameGrid'
import { GameRow } from '@renderer/components/game/GameRow'
import { HeroBanner } from '@renderer/components/game/HeroBanner'
import { Button, IconButton } from '@renderer/components/ui/Button'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { Menu } from '@renderer/components/ui/Menu'
import { Select } from '@renderer/components/ui/Select'
import { cx } from '@renderer/lib/cx'
import { collectFacets, filterGames, SORT_OPTIONS, sortGames } from '@renderer/lib/query'
import { useAppStore } from '@renderer/state/appStore'
import { useSelectedGame, useVisibleGames } from '@renderer/state/hooks'

export type LibraryScope = 'all' | 'recent' | 'favorites' | 'collection'

const TITLES: Record<LibraryScope, string> = {
  all: 'My library',
  recent: 'Recently played',
  favorites: 'Favorites',
  collection: ''
}

export function LibraryView({ scope, collection }: { scope: LibraryScope; collection?: Collection }) {
  const visible = useVisibleGames()
  const search = useAppStore((state) => state.search)
  const setSearch = useAppStore((state) => state.setSearch)
  const defaultSort = useAppStore((state) => state.prefs.defaultSort)
  const layout = useAppStore((state) => state.prefs.libraryLayout)
  const setPref = useAppStore((state) => state.setPref)
  const selectedId = useAppStore((state) => state.selectedGameId)
  const selectGame = useAppStore((state) => state.selectGame)
  const openDetails = useAppStore((state) => state.openDetails)
  const goBack = useAppStore((state) => state.goBack)
  const openDialog = useAppStore((state) => state.openDialog)

  const [sort, setSort] = useState<SortKey>(scope === 'recent' ? 'recentlyPlayed' : defaultSort)
  const [genre, setGenre] = useState('')
  const [language, setLanguage] = useState('')

  // What belongs to this section, before the user narrows it down.
  const scoped = useMemo(
    () =>
      filterGames(visible, {
        showRestricted: true, // `visible` already honours the content filter
        favoritesOnly: scope === 'favorites',
        playedOnly: scope === 'recent',
        gameIds: collection ? new Set(collection.gameIds) : null
      }),
    [visible, scope, collection]
  )
  const facets = useMemo(() => collectFacets(scoped), [scoped])
  const results = useMemo(
    () => sortGames(filterGames(scoped, { showRestricted: true, search, genre: genre || null, language: language || null }), sort),
    [scoped, search, genre, language, sort]
  )
  const selected = useSelectedGame(results)

  const title = collection ? collection.name : TITLES[scope]
  const narrowed = Boolean(search || genre || language)
  const clearFilters = (): void => {
    setSearch('')
    setGenre('')
    setLanguage('')
  }

  if (visible.length === 0) return <FirstRun />

  const body = (() => {
    if (results.length === 0) return <NoResults scope={scope} narrowed={narrowed} onClear={clearFilters} />
    if (layout === 'shelf' && selected) {
      return (
        <>
          <HeroBanner game={selected} compact />
          <GameRow title={title || 'Games'} games={results} selectedId={selected.id} onSelect={selectGame} onOpen={openDetails} />
        </>
      )
    }
    return <GameGrid games={results} selectedId={selected?.id ?? selectedId} onSelect={selectGame} onOpen={openDetails} />
  })()

  return (
    <div className={cx('lib', layout === 'shelf' && results.length > 0 && 'lib--shelf')}>
      <div className="lib__scroll" data-scroll-y="">
        <header className="lib__head">
          <div className="lib__heading">
            {scope === 'collection' && <IconButton icon="arrowLeft" label="Back to collections" onClick={goBack} />}
            <h1 className="lib__title">{title}</h1>
            <span className="lib__count">{results.length}</span>
            {collection && (
              <Menu
                label="Collection options"
                items={[
                  { id: 'rename', label: 'Rename or edit', icon: 'edit', onSelect: () => openDialog({ type: 'collection-form', collectionId: collection.id }) },
                  { id: 'delete', label: 'Delete collection', icon: 'trash', danger: true, onSelect: () => openDialog({ type: 'delete-collection', collectionId: collection.id }) }
                ]}
              />
            )}
          </div>
          <div className="lib__controls">
            <Select label="Sort by" value={sort} onChange={(value) => setSort(value as SortKey)} options={SORT_OPTIONS.map((o) => ({ value: o.key, label: o.label }))} />
            <Select label="Genre or tag" value={genre} onChange={setGenre} options={[{ value: '', label: 'All genres' }, ...facets.genres.map((g) => ({ value: g, label: `${g} (${facets.genreCounts[g]})` }))]} />
            <Select label="Language" value={language} onChange={setLanguage} options={[{ value: '', label: 'All languages' }, ...facets.languages.map((l) => ({ value: l, label: l }))]} />
            <div className="segmented" role="group" aria-label="Layout">
              <IconButton icon="grid" label="Grid layout" aria-pressed={layout === 'grid'} className={layout === 'grid' ? 'is-active' : undefined} onClick={() => setPref('libraryLayout', 'grid')} />
              <IconButton icon="shelf" label="Shelf layout" aria-pressed={layout === 'shelf'} className={layout === 'shelf' ? 'is-active' : undefined} onClick={() => setPref('libraryLayout', 'shelf')} />
            </div>
          </div>
        </header>
        {search && (
          <button type="button" className="chip" onClick={() => setSearch('')}>
            Search: “{search}” <span aria-hidden="true">×</span>
            <span className="sr-only">Clear search</span>
          </button>
        )}
        {body}
      </div>
    </div>
  )
}

function NoResults({ scope, narrowed, onClear }: { scope: LibraryScope; narrowed: boolean; onClear: () => void }) {
  if (narrowed) {
    return (
      <EmptyState
        icon="search"
        title="No games match"
        description="Nothing in this view matches your search and filters."
        actions={<Button variant="primary" onClick={onClear}>Clear search and filters</Button>}
      />
    )
  }
  if (scope === 'favorites') {
    return <EmptyState icon="heart" title="No favorites yet" description="Press the heart on any game to keep it here for quick access." />
  }
  if (scope === 'recent') {
    return <EmptyState icon="recent" title="Nothing played yet" description="Games you play will show up here, most recent first." />
  }
  return <EmptyState icon="collections" title="This collection is empty" description="None of its games are visible right now." />
}
