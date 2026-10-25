import { useSyncExternalStore } from 'react'
import type { Store } from './store'

/**
 * Subscribes a component to a slice of a store.
 * The selector must return a stable reference (a primitive or an existing slice
 * of state). Derive new arrays/objects with `useMemo` in the component instead.
 */
export function useStore<T extends object, U>(store: Store<T>, selector: (state: T) => U): U {
  const read = (): U => selector(store.getState())
  return useSyncExternalStore(store.subscribe, read, read)
}
