import { isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { WebContents } from 'electron'

export type UrlGuard = (rawUrl: string) => boolean

/**
 * Builds a predicate that accepts only the app's own pages: files inside the
 * packaged renderer folder, or (in development only) the Vite dev server origin.
 */
export function createTrustedUrlGuard(rendererRoot: string, devServerUrl?: string): UrlGuard {
  const root = resolve(rendererRoot)
  const devOrigin = devServerUrl ? new URL(devServerUrl).origin : null

  return (rawUrl) => {
    try {
      const url = new URL(rawUrl)
      if (url.protocol === 'file:') {
        const rel = relative(root, fileURLToPath(url))
        return !rel.startsWith('..') && !isAbsolute(rel)
      }
      return devOrigin !== null && url.origin === devOrigin
    } catch {
      return false
    }
  }
}

/** Locks a window's web contents down to the app's own pages. */
export function hardenWebContents(contents: WebContents, isTrustedUrl: UrlGuard): void {
  // The UI never needs extra windows; deny every window.open / target=_blank.
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault()
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
  // Deny every permission (camera, microphone, notifications...) except writing to the clipboard.
  const allowed = (permission: string): boolean => permission === 'clipboard-sanitized-write'
  contents.session.setPermissionRequestHandler((_contents, permission, callback) => callback(allowed(permission)))
  contents.session.setPermissionCheckHandler((_contents, permission) => allowed(permission))
}
