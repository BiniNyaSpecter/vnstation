import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { cx } from '@renderer/lib/cx'
import { Icon, type IconName } from './Icon'

export interface MenuItem {
  id: string
  label: string
  icon?: IconName
  danger?: boolean
  onSelect: () => void
}

/** A small popover menu: Escape / outside-click to close, arrow keys to move. */
export function Menu({ items, label = 'More options' }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const menuItems = (): HTMLButtonElement[] =>
      Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
    menuItems()[0]?.focus()

    const onPointerDown = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation() // do not also trigger "go back"
      setOpen(false)
      root.current?.querySelector<HTMLButtonElement>('.menu__trigger')?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const nodes = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    const index = nodes.indexOf(document.activeElement as HTMLButtonElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    nodes[(index + step + nodes.length) % nodes.length]?.focus()
  }

  return (
    <div className="menu" ref={root}>
      <button
        type="button"
        className="icon-btn menu__trigger"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        data-nav=""
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="more" />
      </button>
      {open && (
        <div className="menu__list" role="menu" aria-label={label} onKeyDown={onListKeyDown}>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={cx('menu__item', item.danger && 'is-danger')}
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
            >
              {item.icon && <Icon name={item.icon} size={18} />}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
