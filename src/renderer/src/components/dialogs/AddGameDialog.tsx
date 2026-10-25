import { useState, type FormEvent } from 'react'
import type { PickedExecutable, ScannedExecutable } from '@shared/api'
import { suggestTitle } from '@shared/suggestTitle'
import { Badge } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { Dialog, DialogActions, DialogBody } from '@renderer/components/ui/Dialog'
import { Icon } from '@renderer/components/ui/Icon'
import { bridge } from '@renderer/services/bridge'
import { samePath, useAppStore } from '@renderer/state/appStore'

export function AddGameDialog() {
  const open = useAppStore((state) => state.dialog?.type === 'add-game')
  const closeDialog = useAppStore((state) => state.closeDialog)
  const close = (): void => closeDialog('add-game')
  return (
    <Dialog
      wide
      open={open}
      onClose={close}
      title="Add games"
      description="Pick a visual novel’s executable file, or scan a games folder to import several at once. VNStation links to your existing installs and never modifies your files."
    >
      <AddGameForm onCancel={close} />
    </Dialog>
  )
}

interface ScannedRow extends ScannedExecutable {
  title: string
  checked: boolean
  alreadyInLibrary: boolean
}

function AddGameForm({ onCancel }: { onCancel: () => void }) {
  const addGame = useAppStore((state) => state.addGame)
  const addGames = useAppStore((state) => state.addGames)
  const games = useAppStore((state) => state.games)

  const [mode, setMode] = useState<'single' | 'folder'>('single')
  const [picked, setPicked] = useState<PickedExecutable | null>(null)
  const [title, setTitle] = useState('')
  const [workingDirectory, setWorkingDirectory] = useState('')
  const [args, setArgs] = useState('')

  const [scannedFolder, setScannedFolder] = useState<string | null>(null)
  const [scannedRows, setScannedRows] = useState<ScannedRow[]>([])

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function chooseExecutable(): Promise<void> {
    if (!bridge) {
      setError('The file picker is only available in the desktop app.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await bridge.dialogs.pickExecutable()
      if (result.status === 'picked') {
        setMode('single')
        setPicked(result.file)
        setTitle(suggestTitle(result.file.path))
        setWorkingDirectory(result.file.directory)
      } else if (result.status === 'invalid') {
        setError(result.message)
      }
    } catch {
      setError('Could not open the file picker. Try again.')
    } finally {
      setBusy(false)
    }
  }

  async function chooseFolderScan(): Promise<void> {
    if (!bridge) {
      setError('Folder scanning is only available in the desktop app.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await bridge.dialogs.scanFolder()
      if (result.status === 'scanned') {
        setMode('folder')
        setScannedFolder(result.folder)
        setScannedRows(
          result.candidates.map((item) => {
            const exists = games.some((g) => samePath(g.launch.executablePath, item.path))
            return {
              ...item,
              title: item.suggestedTitle,
              checked: !exists,
              alreadyInLibrary: exists
            }
          })
        )
      } else if (result.status === 'invalid') {
        setError(result.message)
      }
    } catch {
      setError('Could not scan that folder. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const selectedScanRows = scannedRows.filter((row) => row.checked && !row.alreadyInLibrary && row.title.trim() !== '')
  const canSubmitSingle = mode === 'single' && picked !== null && title.trim() !== '' && workingDirectory.trim() !== ''
  const canSubmitFolder = mode === 'folder' && selectedScanRows.length > 0

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (mode === 'single') {
      if (!picked || !canSubmitSingle) return
      await addGame({
        title,
        launch: { executablePath: picked.path, workingDirectory: workingDirectory.trim(), arguments: args.trim() }
      })
    } else if (canSubmitFolder) {
      await addGames(
        selectedScanRows.map((row) => ({
          title: row.title.trim(),
          launch: { executablePath: row.path, workingDirectory: row.directory, arguments: '' }
        }))
      )
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <DialogBody>
        <div className="field">
          <span className="field__label">Source</span>
          <div className="picker">
            <Button icon="plus" nav={false} disabled={busy} onClick={() => void chooseExecutable()}>
              {picked && mode === 'single' ? 'Choose a different .exe' : 'Choose executable (.exe)'}
            </Button>
            <Button icon="folder" nav={false} disabled={busy} onClick={() => void chooseFolderScan()}>
              Scan folder for games…
            </Button>
          </div>
          {error && (
            <p className="field__error" role="alert">
              <Icon name="alert" size={16} /> {error}
            </p>
          )}
        </div>

        {mode === 'single' && picked && (
          <>
            <div className="field">
              <span className="field__label">Selected file</span>
              <span className="picker__path">{picked.path}</span>
            </div>
            <label className="field">
              <span className="field__label">Title</span>
              <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
              <span className="field__hint">Suggested from the file or folder name. Change it to match the game.</span>
            </label>
            <label className="field">
              <span className="field__label">Working directory</span>
              <input className="input" value={workingDirectory} onChange={(event) => setWorkingDirectory(event.target.value)} />
              <span className="field__hint">The game starts from this folder. Most games need the one that contains the executable.</span>
            </label>
            <label className="field">
              <span className="field__label">Launch arguments (optional)</span>
              <input className="input" value={args} onChange={(event) => setArgs(event.target.value)} />
            </label>
          </>
        )}

        {mode === 'folder' && scannedFolder && (
          <>
            <div className="field">
              <span className="field__label">Scanned folder</span>
              <span className="picker__path">{scannedFolder}</span>
            </div>
            {scannedRows.length === 0 ? (
              <p className="dialog__empty">No game executables (.exe) were found in that folder or its immediate subfolders.</p>
            ) : (
              <>
                <p className="dialog__hint">
                  Found {scannedRows.length} {scannedRows.length === 1 ? 'executable' : 'executables'}. Uncheck any helper launchers you do not want to import.
                </p>
                <ul className="check-list" aria-label="Discovered executables">
                  {scannedRows.map((row, index) => (
                    <li key={row.path}>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={row.checked}
                          disabled={row.alreadyInLibrary}
                          onChange={(event) =>
                            setScannedRows((current) =>
                              current.map((item, idx) => (idx === index ? { ...item, checked: event.target.checked } : item))
                            )
                          }
                        />
                        <span className="match__body">
                          <span className="match__title">{row.title}</span>
                          <span className="match__facts">{row.path}</span>
                        </span>
                        {row.alreadyInLibrary && <Badge tone="outline">In library</Badge>}
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </DialogBody>
      <DialogActions>
        <Button variant="ghost" nav={false} onClick={onCancel}>
          Cancel
        </Button>
        {mode === 'folder' ? (
          <Button variant="primary" type="submit" nav={false} disabled={!canSubmitFolder}>
            {selectedScanRows.length > 0 ? `Import ${selectedScanRows.length} ${selectedScanRows.length === 1 ? 'game' : 'games'}` : 'Import selected'}
          </Button>
        ) : (
          <Button variant="primary" type="submit" nav={false} disabled={!canSubmitSingle}>
            Add to library
          </Button>
        )}
      </DialogActions>
    </form>
  )
}
