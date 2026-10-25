import { Button } from '@renderer/components/ui/Button'
import { Dialog, DialogActions, DialogBody } from '@renderer/components/ui/Dialog'
import { useAppStore } from '@renderer/state/appStore'

export function RemoveGameDialog() {
  const gameId = useAppStore((state) => (state.dialog?.type === 'remove-game' ? state.dialog.gameId : null))
  const game = useAppStore((state) => state.games.find((candidate) => candidate.id === gameId))
  const closeDialog = useAppStore((state) => state.closeDialog)
  const close = (): void => closeDialog('remove-game')
  const removeGame = useAppStore((state) => state.removeGame)
  const open = gameId !== null && game !== undefined

  return (
    <Dialog open={open} onClose={close} title="Remove from library?">
      {game && (
        <>
          <DialogBody>
            <p>
              “{game.title}” will be removed from VNStation, along with its favorite and notes. The game itself is not
              touched: its files stay exactly where they are, and you can add it again at any time.
            </p>
          </DialogBody>
          <DialogActions>
            <Button variant="ghost" nav={false} onClick={close}>
              Cancel
            </Button>
            <Button variant="danger" nav={false} onClick={() => void removeGame(game.id)}>
              Remove from library
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  )
}
