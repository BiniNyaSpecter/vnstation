import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

/** An empty screen is an invitation to act: say what is missing and how to fix it. */
export function EmptyState({
  icon,
  title,
  description,
  steps,
  actions
}: {
  icon: IconName
  title: string
  description: string
  steps?: string[]
  actions?: ReactNode
}) {
  return (
    <div className="empty">
      <div className="empty__icon">
        <Icon name={icon} size={30} />
      </div>
      <h2 className="empty__title">{title}</h2>
      <p className="empty__description">{description}</p>
      {steps && (
        <ol className="empty__steps">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}
      {actions && <div className="empty__actions">{actions}</div>}
    </div>
  )
}
