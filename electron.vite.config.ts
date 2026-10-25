import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

const sharedAlias = { '@shared': resolve('src/shared') }

/**
 * Content-Security-Policy for packaged builds. Injected as a <meta> tag because
 * file:// pages never receive response headers. Dev builds skip it: the Vite dev
 * server needs inline scripts for React Fast Refresh.
 */
const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // vnstation-art: locally cached artwork; *.vndb.org: match-result thumbnails only.
  "img-src 'self' data: blob: vnstation-art: https://*.vndb.org",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

function productionCsp(): Plugin {
  return {
    name: 'vnstation:production-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${PRODUCTION_CSP}" />`
      )
    }
  }
}

export default defineConfig({
  main: { resolve: { alias: sharedAlias } },
  preload: { resolve: { alias: sharedAlias } },
  renderer: {
    resolve: { alias: { ...sharedAlias, '@renderer': resolve('src/renderer/src') } },
    plugins: [react(), productionCsp()]
  }
})
