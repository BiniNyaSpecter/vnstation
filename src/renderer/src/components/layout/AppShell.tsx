import { useEffect } from 'react'
import { AddGameDialog } from '@renderer/components/dialogs/AddGameDialog'
import { AgeGateDialog } from '@renderer/components/dialogs/AgeGate'
import { CollectionFormDialog, DeleteCollectionDialog } from '@renderer/components/dialogs/CollectionDialogs'
import { EditGameDialog } from '@renderer/components/dialogs/EditGameDialog'
import { GameCollectionsDialog } from '@renderer/components/dialogs/GameCollectionsDialog'
import { MatchDialog } from '@renderer/components/dialogs/MatchDialog'
import { RemoveGameDialog } from '@renderer/components/dialogs/RemoveGameDialog'
import { Backdrop } from '@renderer/components/game/Backdrop'
import { ToastHost } from '@renderer/components/ui/Toast'
import { focusEntryPoint, isSpatialFocusActive } from '@renderer/lib/focus'
import { useAppStore } from '@renderer/state/appStore'
import { useSelectedGame, useVisibleGames } from '@renderer/state/hooks'
import { CollectionsView } from '@renderer/views/CollectionsView'
import { DetailsView } from '@renderer/views/DetailsView'
import { HomeView } from '@renderer/views/HomeView'
import { LibraryView } from '@renderer/views/LibraryView'
import { SettingsView } from '@renderer/views/SettingsView'
import { HintBar } from './HintBar'
import { NavRail } from './NavRail'
import { TopBar } from './TopBar'
import { WaveBackground } from './WaveBackground'

export function AppShell() {
  const route = useAppStore((state) => state.route)
  const collapsed = useAppStore((state) => state.prefs.railCollapsed)
  const navLayout = useAppStore((state) => state.prefs.navLayout)
  const libraryLayout = useAppStore((state) => state.prefs.libraryLayout)
  const inputMode = useAppStore((state) => state.inputMode)
  const visible = useVisibleGames()
  const selected = useSelectedGame(visible)
  const detailsGame = useAppStore((state) =>
    route.name === 'details' ? state.games.find((g) => g.id === route.gameId) : undefined
  )
  const backdropGame = detailsGame ?? selected
  const isHeroRoute =
    route.name === 'home' ||
    route.name === 'details' ||
    ((route.name === 'library' || route.name === 'recent' || route.name === 'favorites' || (route.name === 'collections' && route.collectionId !== null)) &&
      libraryLayout === 'shelf')

  const routeKey = route.name === 'collections' ? `c-${route.collectionId ?? ''}` : route.name === 'details' ? `d-${route.gameId}` : route.name

  // When navigating between tabs with a controller or keyboard, move focus into the new view's
  // entry point automatically unless focus is currently intentionally inside the top bar or side rail.
  useEffect(() => {
    if (!isSpatialFocusActive() && inputMode !== 'gamepad') return
    const frame = window.requestAnimationFrame(() => {
      const active = document.activeElement
      if (active instanceof HTMLElement && active.classList.contains('topnav__item') && route.name !== 'details') {
        const currentTab = document.querySelector<HTMLElement>('.topnav [aria-current="page"]')
        if (currentTab && currentTab !== active) currentTab.focus({ preventScroll: true })
        return
      }
      const inChrome = active instanceof HTMLElement && (active.closest('.topbar') || active.closest('[data-nav-scope="rail"]'))
      if (!inChrome || route.name === 'details') {
        focusEntryPoint()
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [routeKey, inputMode, route.name])

  const view = (() => {
    switch (route.name) {
      case 'home':
        return <HomeView />
      case 'library':
        return <LibraryView scope="all" />
      case 'recent':
        return <LibraryView scope="recent" />
      case 'favorites':
        return <LibraryView scope="favorites" />
      case 'collections':
        return <CollectionsView collectionId={route.collectionId} />
      case 'settings':
        return <SettingsView />
      case 'details':
        return <DetailsView gameId={route.gameId} />
    }
  })()

  return (
    <div className="shell" data-rail={navLayout === 'rail' ? (collapsed ? 'collapsed' : 'expanded') : undefined} data-nav={navLayout}>
      <WaveBackground />
      {backdropGame && <Backdrop game={backdropGame} drift={route.name === 'details'} dimmed={!isHeroRoute} />}
      {navLayout === 'rail' && <NavRail />}
      <main className="shell__main">
        <TopBar />
        <div className="shell__view" key={routeKey}>
          {view}
        </div>
        <HintBar />
      </main>
      <AddGameDialog />
      <RemoveGameDialog />
      <EditGameDialog />
      <MatchDialog />
      <AgeGateDialog />
      <GameCollectionsDialog />
      <CollectionFormDialog />
      <DeleteCollectionDialog />
      <ToastHost />
    </div>
  )
}
