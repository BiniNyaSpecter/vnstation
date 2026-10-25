import { useEffect, useState, type FormEvent } from 'react'
import type { GameEntryPatch, VerifyResult } from '@shared/contracts'
import type { Game } from '@shared/types'
import { Button } from '@renderer/components/ui/Button'
import { Dialog, DialogActions, DialogBody } from '@renderer/components/ui/Dialog'
import { Icon } from '@renderer/components/ui/Icon'
import { formatRelativeDate } from '@renderer/lib/format'
import { bridge } from '@renderer/services/bridge'
import { useAppStore } from '@renderer/state/appStore'

const folderOf = (path: string): string => path.replace(/[\\/][^\\/]*$/, '')
const DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/

export function EditGameDialog() {
  const gameId = useAppStore((state) => (state.dialog?.type === 'edit-game' ? state.dialog.gameId : null))
  const game = useAppStore((state) => state.games.find((candidate) => candidate.id === gameId))
  const closeDialog = useAppStore((state) => state.closeDialog)
  const close = (): void => closeDialog('edit-game')
  return (
    <Dialog
      wide
      open={game !== undefined}
      onClose={close}
      title="Edit game"
      description="Change how this entry is shown and launched. Your game files are never modified."
    >
      {game && <EditGameForm key={game.id} game={game} onClose={close} />}
    </Dialog>
  )
}

function EditGameForm({ game, onClose }: { game: Game; onClose: () => void }) {
  const updateGame = useAppStore((state) => state.updateGame)
  const verifyGame = useAppStore((state) => state.verifyGame)
  const showToast = useAppStore((state) => state.showToast)
  const openDialog = useAppStore((state) => state.openDialog)
  const refreshMetadata = useAppStore((state) => state.refreshMetadata)
  const unlinkMetadata = useAppStore((state) => state.unlinkMetadata)
  const chooseArtwork = useAppStore((state) => state.chooseArtwork)
  const resetArtwork = useAppStore((state) => state.resetArtwork)
  const lookupsOn = useAppStore((state) => state.prefs.metadataEnabled)

  const [title, setTitle] = useState(game.title)
  const [executablePath, setExecutablePath] = useState(game.launch.executablePath)
  const [workingDirectory, setWorkingDirectory] = useState(game.launch.workingDirectory)
  const [args, setArgs] = useState(game.launch.arguments)
  const [developer, setDeveloper] = useState(game.developer ?? '')
  const [releaseDate, setReleaseDate] = useState(game.releaseDate ?? '')
  const [synopsis, setSynopsis] = useState(game.synopsis ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [check, setCheck] = useState<VerifyResult | null>(null)

  useEffect(() => {
    if (game.isSample) return
    let live = true
    void verifyGame(game.id).then((result) => live && setCheck(result))
    return () => {
      live = false
    }
  }, [game.id, game.isSample, verifyGame])

  async function chooseExecutable(): Promise<void> {
    if (!bridge) return setError('The file picker is only available in the desktop app.')
    setError(null)
    try {
      const result = await bridge.dialogs.pickExecutable()
      if (result.status === 'invalid') return setError(result.message)
      if (result.status !== 'picked') return
      // Follow the executable into its new folder unless the user had set a custom one.
      if (workingDirectory === folderOf(executablePath) || check?.workingDirectoryExists === false) setWorkingDirectory(result.file.directory)
      setExecutablePath(result.file.path)
      setCheck((current) => (current ? { ...current, executableExists: true } : current))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open the file picker.')
    }
  }

  async function chooseFolder(): Promise<void> {
    if (!bridge) return setError('The folder picker is only available in the desktop app.')
    setError(null)
    try {
      const result = await bridge.dialogs.pickFolder()
      if (result.status === 'invalid') return setError(result.message)
      if (result.status === 'picked') setWorkingDirectory(result.path)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open the folder picker.')
    }
  }

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    await action()
    setBusy(false)
  }

  const canSave = title.trim() !== '' && workingDirectory.trim() !== '' && !saving

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!canSave) return
    if (releaseDate.trim() && !DATE.test(releaseDate.trim())) return setError('Write the release date as YYYY, YYYY-MM or YYYY-MM-DD.')

    // Send only what changed, so an already-missing path never blocks editing other fields.
    const patch: GameEntryPatch = {}
    const launch: NonNullable<GameEntryPatch['launch']> = {}
    if (executablePath !== game.launch.executablePath) launch.executablePath = executablePath
    if (workingDirectory.trim() !== game.launch.workingDirectory) launch.workingDirectory = workingDirectory.trim()
    if (args.trim() !== game.launch.arguments) launch.arguments = args.trim()
    if (Object.keys(launch).length) patch.launch = launch

    const user: NonNullable<GameEntryPatch['user']> = {}
    if (title.trim() !== game.title) user.title = title.trim()
    // Blank means "use the downloaded value".
    if (developer.trim() !== (game.developer ?? '')) user.developer = developer.trim() || null
    if (releaseDate.trim() !== (game.releaseDate ?? '')) user.releaseDate = releaseDate.trim() || null
    if (synopsis.trim() !== (game.synopsis ?? '')) user.synopsis = synopsis.trim() || null
    if (Object.keys(user).length) patch.user = user

    if (!patch.launch && !patch.user) return onClose()
    setSaving(true)
    const saved = await updateGame(game.id, patch)
    setSaving(false)
    if (saved) {
      onClose()
      showToast('Saved your changes.', 'success')
    }
  }

  const linked = game.source?.provider === 'vndb'

  return (
    <form onSubmit={(event) => void submit(event)}>
      <DialogBody>
        {(check?.executableExists === false || check?.workingDirectoryExists === false) && (
          <p className="notice" role="alert">
            <Icon name="alert" size={18} />
            <span>
              {check.executableExists === false
                ? 'The saved executable could not be found. It may have been moved or deleted. Choose its new location.'
                : 'The saved working directory could not be found. Choose the folder the game should start from.'}
            </span>
          </p>
        )}

        <label className="field">
          <span className="field__label">Title</span>
          <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
        </label>

        <div className="field">
          <span className="field__label">Executable</span>
          <div className="picker">
            <Button icon="folder" nav={false} onClick={() => void chooseExecutable()}>Change file</Button>
            <span className="picker__path">{executablePath}</span>
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="edit-working-dir">Working directory</label>
          <div className="inline-form">
            <input id="edit-working-dir" className="input" value={workingDirectory} onChange={(event) => setWorkingDirectory(event.target.value)} />
            <Button nav={false} onClick={() => void chooseFolder()}>Browse</Button>
          </div>
          <span className="field__hint">The game starts from this folder. Most games need the one that contains the executable.</span>
        </div>

        <label className="field">
          <span className="field__label">Launch arguments (optional)</span>
          <input className="input" value={args} onChange={(event) => setArgs(event.target.value)} />
          <span className="field__hint">Passed to the game as typed. They are never run through a shell.</span>
        </label>

        <h3 className="dialog__section">Details</h3>
        <div className="source-row">
          {linked ? (
            <>
              <span>Downloaded from VNDB, updated {formatRelativeDate(game.metadataFetchedAt).toLowerCase()}.</span>
              <Button nav={false} disabled={busy || !lookupsOn} onClick={() => void run(() => refreshMetadata(game.id))}>Refresh</Button>
              <Button variant="ghost" nav={false} disabled={busy} onClick={() => void run(() => unlinkMetadata(game.id))}>Remove</Button>
            </>
          ) : (
            <>
              <span>{lookupsOn ? 'No details downloaded yet. You can also type your own below.' : 'Online lookups are switched off in Settings. You can type your own details below.'}</span>
              {lookupsOn && <Button nav={false} onClick={() => openDialog({ type: 'match-game', gameId: game.id })}>Find details</Button>}
            </>
          )}
        </div>
        <label className="field">
          <span className="field__label">Developer</span>
          <input className="input" value={developer} onChange={(event) => setDeveloper(event.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Release date</span>
          <input className="input" placeholder="YYYY-MM-DD" value={releaseDate} onChange={(event) => setReleaseDate(event.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Description</span>
          <textarea className="input input--area" rows={3} value={synopsis} onChange={(event) => setSynopsis(event.target.value)} />
          <span className="field__hint">Your changes are kept separately. Leave a field blank to use the downloaded value.</span>
        </label>

        <h3 className="dialog__section">Artwork</h3>
        <div className="art-row">
          <span>Cover</span>
          <Button nav={false} disabled={busy} onClick={() => void run(() => chooseArtwork(game.id, 'cover'))}>Choose image</Button>
          <Button variant="ghost" nav={false} disabled={busy || !game.hasCustomCover} onClick={() => void run(() => resetArtwork(game.id, 'cover'))}>Use default</Button>
        </div>
        <div className="art-row">
          <span>Background</span>
          <Button nav={false} disabled={busy} onClick={() => void run(() => chooseArtwork(game.id, 'background'))}>Choose image</Button>
          <Button variant="ghost" nav={false} disabled={busy || !game.hasCustomBackground} onClick={() => void run(() => resetArtwork(game.id, 'background'))}>Use default</Button>
        </div>

        {error && (
          <p className="field__error" role="alert">
            <Icon name="alert" size={16} /> {error}
          </p>
        )}
      </DialogBody>
      <DialogActions>
        <Button variant="ghost" nav={false} onClick={onClose}>Cancel</Button>
        <Button variant="primary" type="submit" nav={false} disabled={!canSave}>Save changes</Button>
      </DialogActions>
    </form>
  )
}
