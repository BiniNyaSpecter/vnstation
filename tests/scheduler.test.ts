import { describe, expect, it } from 'vitest'
import { RequestScheduler } from '../src/main/metadata/scheduler'

function clock() {
  let now = 1_000_000
  const sleeps: number[] = []
  return {
    now: () => now,
    sleep: async (ms: number) => { sleeps.push(ms); now += ms },
    advance: (ms: number) => { now += ms },
    sleeps
  }
}

describe('RequestScheduler', () => {
  it('runs tasks one at a time with a minimum gap', async () => {
    const c = clock()
    const scheduler = new RequestScheduler({ minIntervalMs: 500, maxPerWindow: 100, windowMs: 60_000 }, c.now, c.sleep)
    const order: number[] = []
    await Promise.all([1, 2, 3].map((n) => scheduler.run(async () => { order.push(n) })))
    expect(order).toEqual([1, 2, 3])
    expect(c.sleeps).toEqual([500, 500]) // the first needs no wait
  })

  it('does not wait when enough time has already passed', async () => {
    const c = clock()
    const scheduler = new RequestScheduler({ minIntervalMs: 500, maxPerWindow: 100, windowMs: 60_000 }, c.now, c.sleep)
    await scheduler.run(async () => 1)
    c.advance(2000)
    await scheduler.run(async () => 2)
    expect(c.sleeps).toEqual([])
  })

  it('refuses to exceed the cap, then recovers when the window moves on', async () => {
    const c = clock()
    const scheduler = new RequestScheduler({ minIntervalMs: 0, maxPerWindow: 2, windowMs: 1000 }, c.now, c.sleep)
    await scheduler.run(async () => 1)
    await scheduler.run(async () => 2)
    await expect(scheduler.run(async () => 3)).rejects.toThrow('lot of requests')
    c.advance(1500)
    expect(await scheduler.run(async () => 4)).toBe(4)
  })

  it('keeps working after a task fails', async () => {
    const c = clock()
    const scheduler = new RequestScheduler({ minIntervalMs: 0, maxPerWindow: 100, windowMs: 1000 }, c.now, c.sleep)
    await expect(scheduler.run(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(await scheduler.run(async () => 'fine')).toBe('fine')
  })
})
