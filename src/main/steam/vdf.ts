/**
 * Minimal, pure parser for Valve's KeyValues text format (`libraryfolders.vdf`
 * and `appmanifest_*.acf`). Never executes or modifies anything on disk.
 */

export type VdfValue = string | VdfObject
export interface VdfObject {
  [key: string]: VdfValue
}

function tokenizeVdf(input: string): string[] {
  const tokens: string[] = []
  let i = 0
  const n = input.length

  while (i < n) {
    const ch = input[i]
    // Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      i++
      continue
    }
    // Line comment
    if (ch === '/' && input[i + 1] === '/') {
      while (i < n && input[i] !== '\n') i++
      continue
    }
    // Braces
    if (ch === '{' || ch === '}') {
      tokens.push(ch)
      i++
      continue
    }
    // Quoted string
    if (ch === '"') {
      i++
      let value = ''
      while (i < n && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < n) {
          const next = input[i + 1]
          if (next === '"' || next === '\\') {
            value += next
            i += 2
            continue
          }
          if (next === 'n') {
            value += '\n'
            i += 2
            continue
          }
          if (next === 't') {
            value += '\t'
            i += 2
            continue
          }
        }
        value += input[i]
        i++
      }
      if (i < n && input[i] === '"') i++
      tokens.push(value)
      continue
    }
    // Unquoted token
    let raw = ''
    while (i < n && !/[\s{}"]/.test(input[i])) {
      raw += input[i]
      i++
    }
    if (raw) tokens.push(raw)
  }

  return tokens
}

export function parseVdf(text: string): VdfObject {
  const tokens = tokenizeVdf(text)
  let pos = 0

  function parseBlock(): VdfObject {
    const obj: VdfObject = {}
    while (pos < tokens.length) {
      const token = tokens[pos]
      if (token === '}') {
        pos++
        break
      }
      if (token === '{') {
        pos++
        continue
      }
      const key = token
      pos++
      if (pos >= tokens.length) break
      const next = tokens[pos]
      if (next === '{') {
        pos++
        const child = parseBlock()
        const existing = obj[key]
        if (existing && typeof existing === 'object') {
          obj[key] = { ...existing, ...child }
        } else {
          obj[key] = child
        }
      } else if (next === '}') {
        break
      } else {
        obj[key] = next
        pos++
      }
    }
    return obj
  }

  return parseBlock()
}

function getCaseInsensitive(obj: VdfObject, targetKey: string): VdfValue | undefined {
  const lower = targetKey.toLowerCase()
  for (const [k, v] of Object.entries(obj)) {
    if (k.toLowerCase() === lower) return v
  }
  return undefined
}

/** Extracts all Steam library folder root paths from `libraryfolders.vdf`. */
export function parseLibraryFoldersVdf(text: string): string[] {
  const root = parseVdf(text)
  const container =
    (getCaseInsensitive(root, 'libraryfolders') as VdfObject | undefined) ??
    (getCaseInsensitive(root, 'LibraryFolders') as VdfObject | undefined) ??
    root

  if (!container || typeof container !== 'object') return []

  const paths: string[] = []
  for (const [key, value] of Object.entries(container)) {
    if (!/^\d+$/.test(key)) continue
    if (typeof value === 'string' && value.trim()) {
      paths.push(value.trim())
    } else if (typeof value === 'object' && value !== null) {
      const folderPath = getCaseInsensitive(value, 'path')
      if (typeof folderPath === 'string' && folderPath.trim()) {
        paths.push(folderPath.trim())
      }
    }
  }
  return [...new Set(paths)]
}

export interface ParsedAppManifest {
  appId: number
  name: string
  installDir: string
  lastPlayedAt: string | null
}

/** Extracts appid, name, installdir, and LastPlayed from a Steam `appmanifest_*.acf` file. */
export function parseAppManifestAcf(text: string): ParsedAppManifest | null {
  const root = parseVdf(text)
  const appState = (getCaseInsensitive(root, 'AppState') as VdfObject | undefined) ?? root
  if (!appState || typeof appState !== 'object') return null

  const rawAppId = getCaseInsensitive(appState, 'appid')
  const rawName = getCaseInsensitive(appState, 'name')
  const rawInstallDir = getCaseInsensitive(appState, 'installdir')
  const rawLastPlayed = getCaseInsensitive(appState, 'LastPlayed')

  const appId = typeof rawAppId === 'string' ? Number(rawAppId.trim()) : NaN
  const name = typeof rawName === 'string' ? rawName.trim() : ''
  const installDir = typeof rawInstallDir === 'string' ? rawInstallDir.trim() : ''

  if (!Number.isInteger(appId) || appId <= 0 || !name) return null

  let lastPlayedAt: string | null = null
  if (typeof rawLastPlayed === 'string') {
    const epochSeconds = Number(rawLastPlayed.trim())
    if (Number.isFinite(epochSeconds) && epochSeconds > 946684800) {
      lastPlayedAt = new Date(epochSeconds * 1000).toISOString()
    }
  }

  return {
    appId,
    name,
    installDir,
    lastPlayedAt
  }
}
