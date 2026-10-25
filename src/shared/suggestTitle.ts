/**
 * Derives a human-friendly title candidate from an executable path.
 * It is only ever a suggestion: the user confirms or edits it, and the executable
 * name is never assumed to match the official game title.
 */

/** Executable names that say nothing about the game; fall back to the folder name. */
const GENERIC_NAMES = new Set([
  'game',
  'start',
  'launcher',
  'launch',
  'run',
  'play',
  'main',
  'nw',
  'app',
  'vn',
  'autorun',
  'start game',
  'bgi',
  'siglusengine',
  'siglus engine',
  'krkr',
  'ethornell',
  'advhd',
  'catssystem2',
  'cs2',
  'yu-ris',
  'yuris',
  'reallive',
  'malie',
  'artemis'
])

const splitPath = (path: string): string[] => path.split(/[\\/]+/).filter(Boolean)

function tidy(raw: string): string {
  const cleaned = raw
    .replace(/\.exe$/i, '')
    // trailing version markers: _v1.2, -ver2.0.1, " v3"
    .replace(/[\s_.-]+v(?:er(?:sion)?)?[\s_.-]?\d+(?:[._-]\d+)*$/i, '')
    // architecture / platform suffixes
    .replace(/[\s_.-]+(?:x64|x86|win32|win64)(?=$|[\s_.-])/gi, '')
    .replace(/[_.]+/g, ' ')
    // SteinsGate -> Steins Gate
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.replace(/(^|\s)([a-z])/g, (_m, space: string, letter: string) => space + letter.toUpperCase())
}

export function suggestTitle(executablePath: string): string {
  const parts = splitPath(executablePath)
  const fileName = parts[parts.length - 1] ?? ''
  const fromFile = tidy(fileName)
  const folder = parts.length > 1 ? parts[parts.length - 2] : ''
  const isGeneric = !fromFile || GENERIC_NAMES.has(fromFile.toLowerCase())
  if (isGeneric && folder && !/^[a-z]:$/i.test(folder)) return tidy(folder)
  return fromFile
}
