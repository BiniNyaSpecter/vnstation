import type { ReactNode } from 'react'
import { cx } from '@renderer/lib/cx'

/** `outline` mimics the boxed source/rating label on console game pages. */
export function Badge({
  children,
  tone = 'soft'
}: {
  children: ReactNode
  tone?: 'soft' | 'outline' | 'accent' | 'neutral' | 'danger'
}) {
  return <span className={cx('badge', `badge--${tone}`)}>{children}</span>
}
