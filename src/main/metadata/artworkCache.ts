import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import { ART_URL_PREFIX, type ArtworkKind } from '@shared/metadata'
import { UserFacingError } from '../errors'
import type { Fetcher } from './http'
import { isVndbImageUrl } from './vndb'

export interface ImageType {
  ext: 'jpg' | 'png' | 'gif' | 'webp'
  mime: string
}

/** Identifies an image by its first bytes, never by file name or what a server claims. */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  const at = (i: number): number => bytes[i] ?? -1
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return { ext: 'jpg', mime: 'image/jpeg' }
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return { ext: 'png', mime: 'image/png' }
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return { ext: 'gif', mime: 'image/gif' }
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) {
    return { ext: 'webp', mime: 'image/webp' }
  }
  return null
}

const MIME_BY_EXT: Record<string, string> = { '.jpg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' }
export const mimeForFile = (file: string): string | null => MIME_BY_EXT[extname(file).toLowerCase()] ?? null

const MAX_DOWNLOAD_BYTES = 12 * 1024 * 1024
const MAX_USER_IMAGE_BYTES = 15 * 1024 * 1024
const SEGMENT = /^[\w.-]+$/

/**
 * Local artwork storage inside the app-data folder:
 *   vndb/  downloaded provider artwork (safe to clear, can be downloaded again)
 *   user/  images the user chose themselves (never cleared automatically)
 * Files are only ever served through `resolveFile`, which cannot leave this folder.
 */
export class ArtworkCache {
  constructor(
    readonly root: string,
    private readonly fetcher: Fetcher,
    private readonly now: () => Date = () => new Date()
  ) {}

  private artUrl(folder: 'vndb' | 'user', file: string): string {
    return `${ART_URL_PREFIX}${folder}/${file}?v=${Math.floor(this.now().getTime() / 1000)}`
  }

  private async removeVariants(dir: string, base: string): Promise<void> {
    for (const ext of ['jpg', 'png', 'gif', 'webp']) await rm(join(dir, `${base}.${ext}`), { force: true })
  }

  private async writeAtomically(dir: string, base: string, type: ImageType, bytes: Uint8Array): Promise<string> {
    await mkdir(dir, { recursive: true })
    await this.removeVariants(dir, base)
    const final = join(dir, `${base}.${type.ext}`)
    const temp = `${final}.tmp-${process.pid}`
    await writeFile(temp, bytes)
    await rename(temp, final)
    return `${base}.${type.ext}`
  }

  /** Downloads a provider image and returns its local art URL. `name` looks like "v17-cover". */
  async downloadProviderImage(remoteUrl: string, name: string): Promise<string> {
    if (!isVndbImageUrl(remoteUrl)) throw new Error('Refusing to download an image from an unexpected address.')
    if (!/^v\d{1,9}-(cover|background)$/.test(name)) throw new Error('Unexpected artwork name.')

    const response = await this.fetcher(remoteUrl, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`Image download failed (${response.status}).`)
    const declared = Number(response.headers.get('content-length') ?? 0)
    if (declared > MAX_DOWNLOAD_BYTES) throw new Error('Image is too large.')
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length > MAX_DOWNLOAD_BYTES) throw new Error('Image is too large.')
    const type = sniffImageType(bytes)
    if (!type) throw new Error('Downloaded file is not a supported image.')

    const file = await this.writeAtomically(join(this.root, 'vndb'), name, type, bytes)
    return this.artUrl('vndb', file)
  }

  /** Copies an image the user picked into the cache and returns its local art URL. */
  async saveUserImage(sourcePath: string, gameId: string, kind: ArtworkKind): Promise<string> {
    const info = await stat(sourcePath).catch(() => null)
    if (!info || !info.isFile()) throw new UserFacingError('That image could not be found.')
    if (info.size > MAX_USER_IMAGE_BYTES) throw new UserFacingError('That image is too large. Choose one under 15 MB.')
    const bytes = new Uint8Array(await readFile(sourcePath))
    const type = sniffImageType(bytes)
    if (!type) throw new UserFacingError('That file is not a supported image. Use a JPG, PNG, GIF or WebP.')
    if (!SEGMENT.test(gameId)) throw new UserFacingError('That game is not valid.')
    const file = await this.writeAtomically(join(this.root, 'user'), `${gameId}-${kind}`, type, bytes)
    return this.artUrl('user', file)
  }

  async deleteUserImage(gameId: string, kind: ArtworkKind): Promise<void> {
    if (SEGMENT.test(gameId)) await this.removeVariants(join(this.root, 'user'), `${gameId}-${kind}`)
  }

  /** Maps "vndb/v17-cover.jpg" to a real path inside the cache, or null if it is not one of our files. */
  resolveFile(relativePath: string): string | null {
    const parts = relativePath.split('/')
    if (parts.length !== 2 || (parts[0] !== 'vndb' && parts[0] !== 'user')) return null
    if (!parts.every((part) => SEGMENT.test(part) && part !== '.' && part !== '..')) return null
    if (!mimeForFile(parts[1])) return null
    const file = resolve(this.root, ...parts)
    const rel = relative(resolve(this.root), file)
    return rel.startsWith('..') || isAbsolute(rel) ? null : file
  }

  async stats(): Promise<{ files: number; bytes: number }> {
    const dir = join(this.root, 'vndb')
    const names = await readdir(dir).catch(() => [] as string[])
    let bytes = 0
    let files = 0
    for (const name of names) {
      const info = await stat(join(dir, name)).catch(() => null)
      if (info?.isFile()) {
        files++
        bytes += info.size
      }
    }
    return { files, bytes }
  }

  async clearProviderCache(): Promise<void> {
    await rm(join(this.root, 'vndb'), { recursive: true, force: true })
  }
}
