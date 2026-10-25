/**
 * A tiny framework-agnostic store with a Zustand-compatible shape
 * (`getState` / `setState` / `subscribe`), so it can be swapped for Zustand later
 * without touching call sites. React bindings live in `useStore.ts`.
 */
export type Listener = () => void
export type SetState<T> = (partial: Partial<T> | ((state: T) => Partial<T>)) => void

export interface Store<T> {
  getState: () => T
  setState: SetState<T>
  subscribe: (listener: Listener) => () => void
}

export function createStore<T extends object>(
  initializer: (set: SetState<T>, get: () => T) => T
): Store<T> {
  const listeners = new Set<Listener>()
  let state: T

  const getState = (): T => state

  const setState: SetState<T> = (partial) => {
    const patch = typeof partial === 'function' ? partial(state) : partial
    state = { ...state, ...patch }
    listeners.forEach((listener) => listener())
  }

  const subscribe = (listener: Listener): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  state = initializer(setState, getState)
  return { getState, setState, subscribe }
}
