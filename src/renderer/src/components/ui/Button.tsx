import type { ComponentProps } from 'react'
import { cx } from '@renderer/lib/cx'
import { Icon, type IconName } from './Icon'

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  icon?: IconName
  /** Include in directional (arrow-key / gamepad) navigation. Default true. */
  nav?: boolean
  /** Make this the element focused when moving into the page from the rail. */
  entryPoint?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  nav = true,
  entryPoint = false,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx('btn', `btn--${variant}`, `btn--${size}`, className)}
      data-nav={nav ? '' : undefined}
      data-nav-default={entryPoint ? '' : undefined}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'lg' ? 22 : size === 'sm' ? 15 : 18} />}
      {children && <span>{children}</span>}
    </button>
  )
}

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'children'> {
  icon: IconName
  /** Accessible name (also shown as a tooltip). */
  label: string
  size?: number
  nav?: boolean
}

export function IconButton({ icon, label, size = 20, nav = true, type = 'button', className, ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      className={cx('icon-btn', className)}
      aria-label={label}
      title={label}
      data-nav={nav ? '' : undefined}
      {...rest}
    >
      <Icon name={icon} size={size} />
    </button>
  )
}
