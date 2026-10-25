import { APP_CONFIG } from '@shared/app-config'
import { cx } from '@renderer/lib/cx'
import { Icon, type IconName } from '@renderer/components/ui/Icon'
import { useAppStore, type Route } from '@renderer/state/appStore'

interface RailItem {
  name: Route['name']
  label: string
  icon: IconName
}

const MAIN_ITEMS: RailItem[] = [
  { name: 'home', label: 'Home', icon: 'home' },
  { name: 'library', label: 'My library', icon: 'library' },
  { name: 'recent', label: 'Recently played', icon: 'recent' },
  { name: 'favorites', label: 'Favorites', icon: 'heart' },
  { name: 'collections', label: 'Collections', icon: 'collections' }
]
const SETTINGS_ITEM: RailItem = { name: 'settings', label: 'Settings', icon: 'settings' }

function routeFor(name: Route['name']): Route {
  if (name === 'collections') return { name, collectionId: null }
  return { name } as Route
}

export function NavRail() {
  const history = useAppStore((state) => state.history)
  const collapsed = useAppStore((state) => state.prefs.railCollapsed)
  const navigate = useAppStore((state) => state.navigate)
  const setPref = useAppStore((state) => state.setPref)
  // The root of the back stack is always the top-level section the user is in.
  const active = history[0].name

  const renderItem = (item: RailItem) => (
    <li key={item.name}>
      <button
        type="button"
        className={cx('rail__item', active === item.name && 'is-active')}
        data-nav=""
        aria-current={active === item.name ? 'page' : undefined}
        aria-label={item.label}
        title={collapsed ? item.label : undefined}
        onClick={() => navigate(routeFor(item.name))}
      >
        <Icon name={item.icon} size={22} />
        <span className="rail__label">{item.label}</span>
      </button>
    </li>
  )

  return (
    <nav className="rail" aria-label="Main" data-collapsed={collapsed} data-nav-scope="rail">
      <div className="rail__brand">
        <Icon name="mark" size={26} className="rail__mark" />
        <span className="rail__name">{APP_CONFIG.name}</span>
      </div>
      <ul className="rail__list">{MAIN_ITEMS.map(renderItem)}</ul>
      <ul className="rail__list rail__list--foot">
        {renderItem(SETTINGS_ITEM)}
        <li>
          <button
            type="button"
            className="rail__item"
            data-nav=""
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            onClick={() => setPref('railCollapsed', !collapsed)}
          >
            <Icon name="panel" size={22} />
            <span className="rail__label">Collapse</span>
          </button>
        </li>
      </ul>
    </nav>
  )
}
