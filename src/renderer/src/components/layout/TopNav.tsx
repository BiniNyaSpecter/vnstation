import { useLayoutEffect, useRef, useState } from 'react'
import { cx } from '@renderer/lib/cx'
import { useAppStore, type Route } from '@renderer/state/appStore'

const ITEMS: Array<{ name: Route['name']; label: string }> = [
  { name: 'home', label: 'Home' },
  { name: 'library', label: 'My library' },
  { name: 'recent', label: 'Recently played' },
  { name: 'favorites', label: 'Favorites' },
  { name: 'collections', label: 'Collections' }
]

const routeFor = (name: Route['name']): Route => (name === 'collections' ? { name, collectionId: null } : ({ name } as Route))

/**
 * PlayStation-style category bar. The accent line under the active category slides
 * between items instead of jumping. Switching happens on click or Enter, never on
 * mere focus, so arrow keys can pass over categories without reloading the screen.
 */
export function TopNav() {
  const history = useAppStore((state) => state.history)
  const navigate = useAppStore((state) => state.navigate)
  const active = history[0].name
  const bar = useRef<HTMLElement>(null)
  const [mark, setMark] = useState<{ left: number; width: number } | null>(null)

  useLayoutEffect(() => {
    const measure = (): void => {
      const current = bar.current?.querySelector<HTMLElement>('[aria-current="page"]')
      setMark(current ? { left: current.offsetLeft, width: current.offsetWidth } : null)
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (bar.current) observer.observe(bar.current)
    return () => observer.disconnect()
  }, [active])

  return (
    <nav className="topnav" aria-label="Main" ref={bar}>
      {ITEMS.map((item) => (
        <button
          key={item.name}
          type="button"
          className={cx('topnav__item', active === item.name && 'is-active')}
          data-nav=""
          aria-current={active === item.name ? 'page' : undefined}
          onClick={() => navigate(routeFor(item.name))}
        >
          {item.label}
        </button>
      ))}
      <span
        className="topnav__bar"
        aria-hidden="true"
        style={mark ? { transform: `translateX(${mark.left}px)`, width: mark.width, opacity: 1 } : { opacity: 0 }}
      />
    </nav>
  )
}
