import { describe, expect, it } from 'vitest'
import { createStore } from '@renderer/lib/store'

describe('createStore', () => {
  it('reads, merges and notifies', () => {
    const store = createStore<{ count: number; label: string }>(() => ({ count: 0, label: 'a' }))
    let calls = 0
    const unsubscribe = store.subscribe(() => calls++)

    store.setState({ count: 1 })
    store.setState((state) => ({ count: state.count + 1 }))
    expect(store.getState()).toEqual({ count: 2, label: 'a' })
    expect(calls).toBe(2)

    unsubscribe()
    store.setState({ count: 9 })
    expect(calls).toBe(2)
  })

  it('exposes set/get to the initializer so actions can live in the store', () => {
    const store = createStore<{ n: number; bump: () => void }>((set, get) => ({
      n: 0,
      bump: () => set({ n: get().n + 1 })
    }))
    store.getState().bump()
    store.getState().bump()
    expect(store.getState().n).toBe(2)
  })
})
