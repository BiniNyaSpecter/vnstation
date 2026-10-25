import { describe, expect, it } from 'vitest'
import { pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'
import { createTrustedUrlGuard } from '../src/main/security'

describe('createTrustedUrlGuard', () => {
  const root = resolve('/opt/app/renderer')

  it('trusts only files inside the renderer folder', () => {
    const guard = createTrustedUrlGuard(root)
    expect(guard(pathToFileURL(join(root, 'index.html')).href)).toBe(true)
    expect(guard(pathToFileURL(resolve('/opt/app/other/secret.html')).href)).toBe(false)
    expect(guard(pathToFileURL(resolve('/opt/app/renderer/../main/index.js')).href)).toBe(false)
  })

  it('rejects remote and malformed URLs', () => {
    const guard = createTrustedUrlGuard(root)
    expect(guard('https://example.com')).toBe(false)
    expect(guard('not a url')).toBe(false)
    expect(guard('')).toBe(false)
  })

  it('trusts the dev server origin only when one is configured', () => {
    expect(createTrustedUrlGuard(root, 'http://localhost:5173')('http://localhost:5173/index.html')).toBe(true)
    expect(createTrustedUrlGuard(root, 'http://localhost:5173')('http://localhost:9999/')).toBe(false)
    expect(createTrustedUrlGuard(root)('http://localhost:5173/')).toBe(false)
  })
})
