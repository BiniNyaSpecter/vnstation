import { useState, type FormEvent } from 'react'
import type { Collection } from '@shared/types'
import { Button } from '@renderer/components/ui/Button'
import { Dialog, DialogActions, DialogBody } from '@renderer/components/ui/Dialog'
import { useAppStore } from '@renderer/state/appStore'

/** Create (collectionId null) or rename a collection. */
export function CollectionFormDialog() {
  const open = useAppStore((state) => state.dialog?.type === 'collection-form')
  const collectionId = useAppStore((state) => (state.dialog?.type === 'collection-form' ? state.dialog.collectionId : null))
  const collection = useAppStore((state) => state.collections.find((c) => c.id === collectionId))
  const closeDialog = useAppStore((state) => state.closeDialog)
  const close = (): void => closeDialog('collection-form')
  return (
    <Dialog open={open} onClose={close} title={collection ? 'Edit collection' : 'New collection'}>
      <CollectionForm key={collection?.id ?? 'new'} collection={collection} onClose={close} />
    </Dialog>
  )
}

function CollectionForm({ collection, onClose }: { collection: Collection | undefined; onClose: () => void }) {
  const createCollection = useAppStore((state) => state.createCollection)
  const updateCollection = useAppStore((state) => state.updateCollection)
  const [name, setName] = useState(collection?.name ?? '')
  const [description, setDescription] = useState(collection?.description ?? '')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    const input = { name, description: description.trim() || null }
    const saved = collection ? await updateCollection(collection.id, input) : (await createCollection(input)) !== null
    setBusy(false)
    if (saved) onClose()
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <DialogBody>
        <label className="field">
          <span className="field__label">Name</span>
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </label>
        <label className="field">
          <span className="field__label">Description (optional)</span>
          <input className="input" value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
      </DialogBody>
      <DialogActions>
        <Button variant="ghost" nav={false} onClick={onClose}>Cancel</Button>
        <Button variant="primary" type="submit" nav={false} disabled={!name.trim() || busy}>
          {collection ? 'Save' : 'Create collection'}
        </Button>
      </DialogActions>
    </form>
  )
}

export function DeleteCollectionDialog() {
  const collectionId = useAppStore((state) => (state.dialog?.type === 'delete-collection' ? state.dialog.collectionId : null))
  const collection = useAppStore((state) => state.collections.find((c) => c.id === collectionId))
  const closeDialog = useAppStore((state) => state.closeDialog)
  const close = (): void => closeDialog('delete-collection')
  const deleteCollection = useAppStore((state) => state.deleteCollection)
  return (
    <Dialog open={collection !== undefined} onClose={close} title="Delete this collection?">
      {collection && (
        <>
          <DialogBody>
            <p>
              “{collection.name}” will be deleted. The {collection.gameIds.length === 1 ? 'game' : `${collection.gameIds.length} games`} in it stay in your library.
            </p>
          </DialogBody>
          <DialogActions>
            <Button variant="ghost" nav={false} onClick={close}>Cancel</Button>
            <Button variant="danger" nav={false} onClick={() => void deleteCollection(collection.id)}>Delete collection</Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  )
}
