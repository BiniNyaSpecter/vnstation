import { useEffect, useId, useRef, type ReactNode } from 'react'
import { playSound } from '@renderer/lib/sound'
import { IconButton } from './Button'

/**
 * Modal built on the native <dialog>: focus trapping, Escape handling and
 * focus restoration come from the platform. Children are mounted only while
 * open, so form state resets every time.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  wide = false,
  children
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  wide?: boolean
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      playSound('open')
    }
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className={wide ? 'dialog dialog--wide' : 'dialog'}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        // Clicks on the backdrop land on the <dialog> element itself.
        if (event.target === event.currentTarget) onClose()
      }}
    >
      {open && (
        <div className="dialog__panel">
          <header className="dialog__head">
            <div>
              <h2 id={titleId} className="dialog__title">{title}</h2>
              {description && <p className="dialog__description">{description}</p>}
            </div>
            <IconButton icon="close" label="Close" nav={false} onClick={onClose} />
          </header>
          {children}
        </div>
      )}
    </dialog>
  )
}

export const DialogBody = ({ children }: { children: ReactNode }) => <div className="dialog__body">{children}</div>
export const DialogActions = ({ children }: { children: ReactNode }) => <footer className="dialog__actions">{children}</footer>
