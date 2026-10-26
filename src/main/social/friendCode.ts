import { randomBytes } from 'node:crypto'

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

/**
 * Generates a cryptographically random, non-sequential Friend Code (`VNS-XXXX-XXXX`)
 * using an unambiguous 32-character alphabet (omitting 0, O, 1, I).
 */
export function generateFriendCode(): string {
  const bytes = randomBytes(8)
  let partA = ''
  let partB = ''
  for (let i = 0; i < 4; i++) {
    partA += ALPHABET[bytes[i] % ALPHABET.length]
    partB += ALPHABET[bytes[i + 4] % ALPHABET.length]
  }
  return `VNS-${partA}-${partB}`
}

/**
 * Sliding-window rate limiter to protect Friend Code lookups, friend requests,
 * and message sending from automated enumeration or spam.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>()

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now()
  ) {}

  check(key: string, actionLabel: string): void {
    const current = this.now()
    const cutoff = current - this.windowMs
    const history = (this.hits.get(key) ?? []).filter((ts) => ts > cutoff)
    if (history.length >= this.maxRequests) {
      throw new Error(`Too many ${actionLabel} attempts. Please wait a moment and try again.`)
    }
    history.push(current)
    this.hits.set(key, history)
  }

  reset(key?: string): void {
    if (key) this.hits.delete(key)
    else this.hits.clear()
  }
}
