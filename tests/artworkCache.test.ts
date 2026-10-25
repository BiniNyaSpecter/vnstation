import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleArtRequest } from '../src/main/metadata/artProtocol'
import { ArtworkCache, sniffImageType } from '../src/main/metadata/artworkCache'
import { bytesResponse, fakeFetcher, JPEG, PNG } from './fixtures/vndb'

describe('sniffImageType', () => {
  it('identifies images by their first bytes', () => {
    expect(sniffImageType(JPEG)?.ext).toBe('jpg')
    expect(sniffImageType(PNG)?.ext).toBe('png')
    expect(sniffImageType(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39]))?.ext).toBe('gif')
    expect(sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))?.ext).toBe('webp')
  })
  it('rejects everything else', () => {
    expect(sniffImageType(new TextEncoder().encode('<html>'))).toBeNull()
    expect(sniffImageType(new Uint8Array([]))).toBeNull()
    expect(sniffImageType(new TextEncoder().encode('MZ executable'))).toBeNull()
  })
})

describe('ArtworkCache', () => {
  let root: string
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'vnstation-art-')) })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  const cacheWith = (route: Parameters<typeof fakeFetcher>[0]) => {
    const { fetcher, requests } = fakeFetcher(route)
    return { cache: new ArtworkCache(root, fetcher, () => new Date(1_700_000_000_000)), requests }
  }

  it('downloads an image into the cache and returns a local art URL', async () => {
    const { cache, requests } = cacheWith(() => bytesResponse(JPEG))
    const url = await cache.downloadProviderImage('https://t.vndb.org/cv/01/101.jpg', 'v101-cover')
    expect(url).toBe('vnstation-art://art/vndb/v101-cover.jpg?v=1700000000')
    expect(requests).toHaveLength(1)
    expect([...(await readFile(join(root, 'vndb', 'v101-cover.jpg')))]).toEqual([...JPEG])
  })

  it('replaces older files of a different type and leaves no temporary files behind', async () => {
    const { cache } = cacheWith((r) => bytesResponse(r.url.includes('png') ? PNG : JPEG))
    await cache.downloadProviderImage('https://t.vndb.org/a.jpg', 'v7-cover')
    await cache.downloadProviderImage('https://t.vndb.org/a.png', 'v7-cover')
    expect(await readdir(join(root, 'vndb'))).toEqual(['v7-cover.png'])
  })

  it('refuses unexpected addresses, names, content and sizes', async () => {
    const { cache, requests } = cacheWith(() => bytesResponse(JPEG))
    await expect(cache.downloadProviderImage('https://evil.example/x.jpg', 'v1-cover')).rejects.toThrow('unexpected address')
    await expect(cache.downloadProviderImage('http://t.vndb.org/x.jpg', 'v1-cover')).rejects.toThrow('unexpected address')
    await expect(cache.downloadProviderImage('https://t.vndb.org/x.jpg', '../v1-cover')).rejects.toThrow('Unexpected artwork name')
    expect(requests).toHaveLength(0)

    const html = cacheWith(() => bytesResponse(new TextEncoder().encode('<html>not an image</html>')))
    await expect(html.cache.downloadProviderImage('https://t.vndb.org/x.jpg', 'v1-cover')).rejects.toThrow('not a supported image')

    const huge = cacheWith(() => bytesResponse(JPEG, 200, { 'content-length': String(50 * 1024 * 1024) }))
    await expect(huge.cache.downloadProviderImage('https://t.vndb.org/x.jpg', 'v1-cover')).rejects.toThrow('too large')

    const missing = cacheWith(() => bytesResponse(JPEG, 404))
    await expect(missing.cache.downloadProviderImage('https://t.vndb.org/x.jpg', 'v1-cover')).rejects.toThrow('404')
    expect(await readdir(root)).toEqual([])
  })

  it('copies a user-chosen image and validates it first', async () => {
    const { cache } = cacheWith(() => bytesResponse(JPEG))
    const good = join(root, 'my picture 星.png')
    await writeFile(good, PNG)
    expect(await cache.saveUserImage(good, 'game-abc', 'cover')).toBe('vnstation-art://art/user/game-abc-cover.png?v=1700000000')

    const fake = join(root, 'not-really.png')
    await writeFile(fake, 'plain text pretending to be an image')
    await expect(cache.saveUserImage(fake, 'game-abc', 'cover')).rejects.toThrow('not a supported image')
    await expect(cache.saveUserImage(join(root, 'missing.png'), 'game-abc', 'cover')).rejects.toThrow('could not be found')
    await expect(cache.saveUserImage(good, '../escape', 'cover')).rejects.toThrow('not valid')

    await cache.deleteUserImage('game-abc', 'cover')
    expect(await readdir(join(root, 'user'))).toEqual([])
  })

  it('only resolves files it could have written, inside its own folder', () => {
    const { cache } = cacheWith(() => bytesResponse(JPEG))
    expect(cache.resolveFile('vndb/v1-cover.jpg')).toBe(join(root, 'vndb', 'v1-cover.jpg'))
    expect(cache.resolveFile('user/game-1-cover.webp')).toBe(join(root, 'user', 'game-1-cover.webp'))
    for (const bad of ['../secret.png', 'vndb/../../secret.png', 'vndb/a/b.png', 'other/v1.png', 'vndb/v1.exe', 'vndb/v1', '', 'vndb/', '/vndb/v1.png', 'vndb/..%2Fx.png', 'vndb/a b.png', 'vndb/.jpg/..']) {
      expect(cache.resolveFile(bad)).toBeNull()
    }
  })

  it('reports and clears only the provider cache', async () => {
    const { cache } = cacheWith(() => bytesResponse(JPEG))
    await cache.downloadProviderImage('https://t.vndb.org/a.jpg', 'v1-cover')
    await cache.downloadProviderImage('https://t.vndb.org/b.jpg', 'v1-background')
    const mine = join(root, 'mine.png')
    await writeFile(mine, PNG)
    await cache.saveUserImage(mine, 'game-1', 'cover')

    expect(await cache.stats()).toEqual({ files: 2, bytes: JPEG.length * 2 })
    await cache.clearProviderCache()
    expect(await cache.stats()).toEqual({ files: 0, bytes: 0 })
    expect(await readdir(join(root, 'user'))).toEqual(['game-1-cover.png'])
  })
})

describe('art protocol', () => {
  let root: string
  let cache: ArtworkCache
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'vnstation-proto-'))
    cache = new ArtworkCache(root, fakeFetcher(() => bytesResponse(JPEG)).fetcher)
    await cache.downloadProviderImage('https://t.vndb.org/a.jpg', 'v1-cover')
    await writeFile(join(root, 'secret.png'), PNG)
  })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  it('serves cached images with the right type', async () => {
    const response = await handleArtRequest(cache, 'vnstation-art://art/vndb/v1-cover.jpg?v=123')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...JPEG])
  })

  it('answers 404 for anything else', async () => {
    for (const url of [
      'vnstation-art://art/vndb/missing.jpg',
      'vnstation-art://art/vndb/..%2F..%2Fsecret.png',
      'vnstation-art://art/%2e%2e/secret.png',
      'vnstation-art://art/secret.png',
      'vnstation-art://other/vndb/v1-cover.jpg',
      'vnstation-art://art/vndb/v1-cover.exe',
      'https://example.com/x.jpg',
      'not a url'
    ]) {
      expect((await handleArtRequest(cache, url)).status).toBe(404)
    }
  })
})
