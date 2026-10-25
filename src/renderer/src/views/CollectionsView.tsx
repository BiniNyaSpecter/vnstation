import { useMemo } from 'react'
import { CoverArt } from '@renderer/components/game/CoverArt'
import { Button } from '@renderer/components/ui/Button'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { useAppStore } from '@renderer/state/appStore'
import { useVisibleCollections, useVisibleGames } from '@renderer/state/hooks'
import { LibraryView } from './LibraryView'

export function CollectionsView({ collectionId }: { collectionId: string | null }) {
  const visible = useVisibleGames()
  const collections = useVisibleCollections(visible)
  const push = useAppStore((state) => state.push)
  const openDialog = useAppStore((state) => state.openDialog)
  const byId = useMemo(() => new Map(visible.map((game) => [game.id, game])), [visible])

  const open = collectionId ? collections.find((collection) => collection.id === collectionId) : undefined
  if (open) return <LibraryView scope="collection" collection={open} />

  return (
    <div className="lib">
      <div className="lib__scroll" data-scroll-y="">
        <header className="lib__head">
          <div className="lib__heading">
            <h1 className="lib__title">Collections</h1>
            <span className="lib__count">{collections.length}</span>
          </div>
          <Button icon="plus" onClick={() => openDialog({ type: 'collection-form', collectionId: null })}>New collection</Button>
        </header>
        {collections.length === 0 ? (
          <EmptyState
            icon="collections"
            title="No collections yet"
            description="Collections group games your way, like “Cozy evenings” or “Reading now”."
            actions={<Button variant="primary" entryPoint onClick={() => openDialog({ type: 'collection-form', collectionId: null })}>Create a collection</Button>}
          />
        ) : (
          <div className="collections">
            {collections.map((collection) => {
              const covers = collection.gameIds.slice(0, 3).flatMap((id) => byId.get(id) ?? [])
              return (
                <button key={collection.id} type="button" className="collection" data-nav="" onClick={() => push({ name: 'collections', collectionId: collection.id })}>
                  <span className="collection__stack" aria-hidden="true">
                    {covers.map((game, index) => (
                      <span key={game.id} className={`collection__cover collection__cover--${index}`}>
                        <CoverArt src={game.coverUrl} fallback={game.coverFallbackUrl} />
                      </span>
                    ))}
                  </span>
                  <span className="collection__name">{collection.name}</span>
                  <span className="collection__meta">
                    {collection.gameIds.length} {collection.gameIds.length === 1 ? 'game' : 'games'}
                  </span>
                  {collection.description && <span className="collection__desc">{collection.description}</span>}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
