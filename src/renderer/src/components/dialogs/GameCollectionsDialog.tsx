import { useState, type FormEvent } from 'react'
import type { Game } from '@shared/types'
import { Button } from '@renderer/components/ui/Button'
import { Dialog, DialogActions, DialogBody } from '@renderer/components/ui/Dialog'
import { useAppStore } from '@renderer/state/appStore'

export function GameCollectionsDialog() {
  const gameId = useAppStore((state) => (state.dialog?.type === 'game-collections' ? state.dialog.gameId : null))
  const game = useAppStore((state) => state.games.find((candidate) => candidate.id === gameId))
  const closeDialog = useAppStore((state) => state.closeDialog)
  const close = (): void => closeDialog('game-collections')
  return (
    <Dialog open={game !== undefined} onClose={close} title="Add to collection" description={game ? `Choose where “${game.title}” appears.` : undefined}>
      {game && <GameCollectionsForm key={game.id} game={game} onClose={close} />}
    </Dialog>
  )
}

function GameCollectionsForm({ game, onClose }: { game: Game; onClose: () => void }) {
  const collections = useAppStore((state) => state.collections)
  const createCollection = useAppStore((state) => state.createCollection)
  const setGameCollections = useAppStore((state) => state.setGameCollections)
  const [selected, setSelected] = useState(() => new Set(collections.filter((c) => c.gameIds.includes(game.id)).map((c) => c.id)))
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const toggle = (id: string): void =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    const created = await createCollection({ name })
    setBusy(false)
    if (created) {
      setSelected((current) => new Set(current).add(created.id))
      setName('')
    }
  }

  async function save(): Promise<void> {
    setBusy(true)
    const saved = await setGameCollections(game.id, [...selected])
    setBusy(false)
    if (saved) onClose()
  }

  return (
    <>
      <DialogBody>
        {collections.length === 0 ? (
          <p className="dialog__empty">You have no collections yet. Create your first one below.</p>
        ) : (
          <ul className="check-list">
            {collections.map((collection) => (
              <li key={collection.id}>
                <label className="check">
                  <input type="checkbox" checked={selected.has(collection.id)} onChange={() => toggle(collection.id)} />
                  <span>{collection.name}</span>
                  <span className="check__count">{collection.gameIds.length}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <form className="inline-form" onSubmit={(event) => void create(event)}>
          <input className="input" placeholder="New collection name" aria-label="New collection name" value={name} onChange={(event) => setName(event.target.value)} />
          <Button type="submit" nav={false} disabled={!name.trim() || busy}>Create</Button>
        </form>
      </DialogBody>
      <DialogActions>
        <Button variant="ghost" nav={false} onClick={onClose}>Cancel</Button>
        <Button variant="primary" nav={false} disabled={busy} onClick={() => void save()}>Save</Button>
      </DialogActions>
    </>
  )
}
