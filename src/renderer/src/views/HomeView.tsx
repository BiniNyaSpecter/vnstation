import { useMemo } from 'react'
import type { Game } from '@shared/types'
import { FirstRun } from '@renderer/components/game/FirstRun'
import { GameRow } from '@renderer/components/game/GameRow'
import { HeroBanner } from '@renderer/components/game/HeroBanner'
import { recentlyPlayed, sortGames } from '@renderer/lib/query'
import { useSelectedGame, useVisibleCollections, useVisibleGames } from '@renderer/state/hooks'
import { useAppStore } from '@renderer/state/appStore'

interface Shelf {
  id: string
  title: string
  games: Game[]
}

export function HomeView() {
  const status = useAppStore((state) => state.status)
  const defaultSort = useAppStore((state) => state.prefs.defaultSort)
  const selectGame = useAppStore((state) => state.selectGame)
  const openDetails = useAppStore((state) => state.openDetails)
  const visible = useVisibleGames()
  const collections = useVisibleCollections(visible)
  const selected = useSelectedGame(visible)

  const shelves = useMemo<Shelf[]>(() => {
    const byId = new Map(visible.map((game) => [game.id, game]))
    const list: Shelf[] = [
      { id: 'continue', title: 'Continue', games: recentlyPlayed(visible, 14) },
      { id: 'favorites', title: 'Favorites', games: sortGames(visible.filter((game) => game.favorite), 'title') }
    ]
    for (const collection of collections) {
      const games = collection.gameIds.flatMap((id) => byId.get(id) ?? [])
      list.push({ id: collection.id, title: collection.name, games })
    }
    list.push({ id: 'all', title: 'All games', games: sortGames(visible, defaultSort) })
    return list.filter((shelf) => shelf.games.length > 0)
  }, [visible, collections, defaultSort])

  if (status === 'loading') return <HomeSkeleton />
  if (status === 'error') return <p className="view-error">Your library could not be loaded. Restart VNStation and try again.</p>
  if (!selected) return <FirstRun />

  const [first, ...rest] = shelves
  const row = (shelf: Shelf) => (
    <GameRow key={shelf.id} title={shelf.title} games={shelf.games} selectedId={selected.id} onSelect={selectGame} onOpen={openDetails} />
  )

  return (
    <div className="stage">
      <div className="home__scroll" data-scroll-y="">
        <section className="home__screen" aria-label="Selected game">
          <HeroBanner game={selected} />
          {first && row(first)}
        </section>
        {rest.length > 0 && <div className="home__more">{rest.map(row)}</div>}
      </div>
    </div>
  )
}

function HomeSkeleton() {
  return (
    <div className="stage" aria-busy="true" aria-label="Loading your library">
      <div className="home__scroll" data-scroll-y="">
        <section className="home__screen">
          <div className="hero">
            <div className="skeleton skeleton--title" />
            <div className="skeleton skeleton--line" />
          </div>
          <div className="row__track">
            {Array.from({ length: 7 }, (_, index) => (
              <div key={index} className="skeleton skeleton--tile" />
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
