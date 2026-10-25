import { useEffect } from 'react'
import { useAppStore } from '@renderer/state/appStore'
import { Icon } from './Icon'

export function ToastHost() {
  const toast = useAppStore((state) => state.toast)
  const dismiss = useAppStore((state) => state.dismissToast)

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => dismiss(toast.id), 5000)
    return () => window.clearTimeout(timer)
  }, [toast, dismiss])

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toast && (
        <div key={toast.id} className={`toast toast--${toast.tone}`}>
          <Icon name={toast.tone === 'error' ? 'alert' : toast.tone === 'success' ? 'check' : 'info'} size={18} />
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  )
}
