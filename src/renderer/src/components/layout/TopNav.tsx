import { useLayoutEffect, useRef, useState } from 'react'
import { cx } from '@renderer/lib/cx'
import { isSpatialFocusActive } from '@renderer/lib/focus'
import { useAppStore, type Route } from '@renderer/state/appStore'

const ITEMS: Array<{ name: Route['name']; label: string }> = [
  { name: 'home', label: 'Home' },
  { name: 'library', label: 'My library' },
  { name: 'recent', label: 'Recently played' },
  { name: 'favorites', label: 'Favorites' },
  { name: 'collections', label: 'Collections' },
  { name: 'friends', label: 'Friends' },
  { name: 'messages', label: 'Messages' },
  { name: 'profile', label: 'Profile' }
]

const routeFor = (name: Route['name']): Route => (name === 'collections' ? { name, collectionId: null } : ({ name } as Route))

/**
 * PlayStation-style category bar. The accent line under the active category slides
 * between items instead of jumping. Focusing a category via keyboard or controller
 * switches to that tab immediately, matching how game tiles select on focus.
 */
export function TopNav() {
  const history = useAppStore((state) => state.history)
  const navigate = useAppStore((state) => state.navigate)
  const unreadMessages = useAppStore((state) => state.social.totalUnreadCount)
  const incomingFriends = useAppStore(
    (state) => state.social.friends.filter((f) => f.status === 'pending' && f.direction === 'incoming').length
  )
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
  }, [active, unreadMessages, incomingFriends])

  return (
    <nav className="topnav" aria-label="Main" ref={bar}>
      {ITEMS.map((item) => {
        const badgeCount =
          item.name === 'messages' ? unreadMessages : item.name === 'friends' ? incomingFriends : 0
        return (
          <button
            key={item.name}
            type="button"
            className={cx('topnav__item', active === item.name && 'is-active')}
            data-nav=""
            aria-current={active === item.name ? 'page' : undefined}
            onFocus={(event) => {
              if (
                (isSpatialFocusActive() || event.currentTarget.matches(':focus-visible')) &&
                (active !== item.name || history.length > 1)
              ) {
                navigate(routeFor(item.name))
              }
            }}
            onClick={() => navigate(routeFor(item.name))}
          >
            {item.label}
            {badgeCount > 0 && <span className="nav-badge">{badgeCount}</span>}
          </button>
        )
      })}
      <span
        className="topnav__bar"
        aria-hidden="true"
        style={mark ? { transform: `translateX(${mark.left}px)`, width: mark.width, opacity: 1 } : { opacity: 0 }}
      />
    </nav>
  )
}
