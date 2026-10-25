import { useEffect, useState } from 'react'
import { formatClock } from '@renderer/lib/format'
import { cx } from '@renderer/lib/cx'
import { Button, IconButton } from '@renderer/components/ui/Button'
import { Icon } from '@renderer/components/ui/Icon'
import { useAppStore } from '@renderer/state/appStore'
import { TopNav } from './TopNav'

export function TopBar() {
  const navLayout = useAppStore((state) => state.prefs.navLayout)
  const onSettings = useAppStore((state) => state.history[0].name === 'settings')
  const navigate = useAppStore((state) => state.navigate)
  const search = useAppStore((state) => state.search)
  const setSearch = useAppStore((state) => state.setSearch)
  const openDialog = useAppStore((state) => state.openDialog)
  const showingSamples = useAppStore((state) => state.games.some((game) => game.isSample))
  const [now, setNow] = useState(() => new Date())
  const [online, setOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true))

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15_000)
    const onOnline = (): void => setOnline(true)
    const onOffline = (): void => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  return (
    <header className="topbar">
      {navLayout === 'top' && (
        <>
          <Icon name="mark" size={26} className="topbar__mark" />
          <TopNav />
        </>
      )}
      <div className="topbar__cluster">
        {!online && (
          <span className="preview-pill" title="You are offline. Your library and games work normally; online VNDB lookups will resume when you reconnect.">
            Offline
          </span>
        )}
        {showingSamples && (
          <span className="preview-pill" title="Sample games are invented, for previewing the interface. Remove them in Settings.">
            Sample games shown
          </span>
        )}
        <label className="search">
          <Icon name="search" size={18} />
          <input
            id="global-search"
            type="search"
            placeholder="Search your library"
            aria-label="Search your library"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <Button icon="plus" aria-label="Add game" onClick={() => openDialog({ type: 'add-game' })}>
          Add game
        </Button>
        {navLayout === 'top' && (
          <IconButton
            icon="settings"
            label="Settings"
            className={cx('icon-btn--plain', onSettings && 'is-active')}
            aria-current={onSettings ? 'page' : undefined}
            onClick={() => navigate({ name: 'settings' })}
          />
        )}
        <time className="clock" dateTime={now.toISOString()}>
          {formatClock(now)}
        </time>
      </div>
    </header>
  )
}
