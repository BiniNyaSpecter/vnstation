import { readFile } from 'node:fs/promises'
import type { ArtworkCache } from './artworkCache'
import { mimeForFile } from './artworkCache'

/**
 * Serves `vnstation-art://art/<folder>/<file>` from the artwork cache and nothing
 * else. Anything outside the cache folder, or not an image we wrote, is a 404.
 */
export async function handleArtRequest(cache: ArtworkCache, requestUrl: string): Promise<Response> {
  const notFound = (): Response => new Response('Not found', { status: 404 })
  try {
    const url = new URL(requestUrl)
    if (url.protocol !== 'vnstation-art:' || url.host !== 'art') return notFound()
    const file = cache.resolveFile(decodeURIComponent(url.pathname.replace(/^\//, '')))
    const mime = file ? mimeForFile(file) : null
    if (!file || !mime) return notFound()
    return new Response(new Uint8Array(await readFile(file)), {
      headers: { 'Content-Type': mime, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' }
    })
  } catch {
    return notFound()
  }
}
