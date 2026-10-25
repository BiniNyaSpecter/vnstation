import { useMemo } from 'react'
import type { Collection, Game } from '@shared/types'
import { visibleCollections } from '@renderer/lib/query'
import { useAppStore } from './appStore'

/** Games the user has chosen to see (restricted entries are hidden by default). */
export function useVisibleGames(): Game[] {
  const games = useAppStore((state) => state.games)
  const showRestricted = useAppStore((state) => state.prefs.showRestricted)
  return useMemo(
    () => (showRestricted ? games : games.filter((game) => game.contentRating !== 'restricted')),
    [games, showRestricted]
  )
}

export function useVisibleCollections(visible: Game[]): Collection[] {
  const collections = useAppStore((state) => state.collections)
  return useMemo(() => visibleCollections(collections, visible), [collections, visible])
}

/** The globally selected game, or the first of `list` when it is not part of that list. */
export function useSelectedGame(list: Game[]): Game | null {
  const selectedId = useAppStore((state) => state.selectedGameId)
  return useMemo(() => list.find((game) => game.id === selectedId) ?? list[0] ?? null, [list, selectedId])
}
