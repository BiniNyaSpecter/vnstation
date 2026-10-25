import { UserFacingError } from '../errors'

/**
 * Keeps requests to a provider polite: one at a time, a minimum gap between them,
 * and a hard cap per window so a bug or a long session can never get the app
 * throttled. VNDB allows 200 requests per 5 minutes; the default cap is 120.
 */
export class RequestScheduler {
  private chain: Promise<unknown> = Promise.resolve()
  private last = Number.NEGATIVE_INFINITY
  private stamps: number[] = []

  constructor(
    private readonly options: { minIntervalMs: number; maxPerWindow: number; windowMs: number } = {
      minIntervalMs: 500,
      maxPerWindow: 120,
      windowMs: 5 * 60_000
    },
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  ) {}

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(async () => {
      const windowStart = this.now() - this.options.windowMs
      this.stamps = this.stamps.filter((stamp) => stamp > windowStart)
      if (this.stamps.length >= this.options.maxPerWindow) {
        throw new UserFacingError('VNStation has made a lot of requests to VNDB. Wait a few minutes and try again.')
      }
      const wait = this.last + this.options.minIntervalMs - this.now()
      if (wait > 0) await this.sleep(wait)
      this.last = this.now()
      this.stamps.push(this.last)
      return task()
    })
    this.chain = result.catch(() => undefined)
    return result
  }
}
