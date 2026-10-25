import { useEffect, useRef } from 'react'
import { Button } from '@renderer/components/ui/Button'
import { Dialog, DialogActions, DialogBody } from '@renderer/components/ui/Dialog'
import { useAppStore } from '@renderer/state/appStore'

/** The wording of the 18+ confirmation, used both inline (match screen) and as a dialog (Settings). */
export function AgeGateText() {
  return (
    <>
      <p>
        Some games are rated <strong>18+</strong> and can include sexual or violent content in their artwork and descriptions. Showing them is optional, and they
        stay hidden unless you confirm your age.
      </p>
      <p className="age-gate__question">Are you 18 years old or older?</p>
    </>
  )
}

/** Inline version, shown inside another dialog without closing it. */
export function AgeGatePanel({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const panel = useRef<HTMLDivElement>(null)
  // It appears below a scrolling list: bring it into view and put focus on its first button.
  useEffect(() => {
    panel.current?.scrollIntoView({ block: 'nearest' })
    panel.current?.querySelector('button')?.focus()
  }, [])
  return (
    <div className="age-gate" role="group" aria-label="Age confirmation" ref={panel}>
      <span className="age-gate__badge" aria-hidden="true">18+</span>
      <div className="age-gate__body">
        <AgeGateText />
        <div className="age-gate__actions">
          <Button variant="primary" nav={false} onClick={onConfirm}>I’m 18 or older</Button>
          <Button variant="ghost" nav={false} onClick={onCancel}>No, keep them hidden</Button>
        </div>
      </div>
    </div>
  )
}

/** Opened from Settings when someone turns on adults-only entries for the first time. */
export function AgeGateDialog() {
  const open = useAppStore((state) => state.dialog?.type === 'age-gate')
  const closeDialog = useAppStore((state) => state.closeDialog)
  const confirmAdult = useAppStore((state) => state.confirmAdult)
  const close = (): void => closeDialog('age-gate')
  return (
    <Dialog open={open} onClose={close} title="Show adults-only (18+) games?">
      <DialogBody>
        <AgeGateText />
      </DialogBody>
      <DialogActions>
        <Button variant="ghost" nav={false} onClick={close}>No, keep them hidden</Button>
        <Button variant="primary" nav={false} onClick={confirmAdult}>I’m 18 or older</Button>
      </DialogActions>
    </Dialog>
  )
}
