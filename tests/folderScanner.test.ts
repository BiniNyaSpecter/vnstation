import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isHelperExecutable, scanFolderForExecutables } from '../src/main/folderScanner'

describe('scanFolderForExecutables', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vnstation-scan-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('discovers visual novel executables in subfolders and derives clean titles', async () => {
    const vnA = join(root, 'Steins_Gate')
    const vnB = join(root, 'Clannad')
    mkdirSync(vnA, { recursive: true })
    mkdirSync(vnB, { recursive: true })
    writeFileSync(join(vnA, 'SteinsGate.exe'), 'MZ')
    writeFileSync(join(vnB, 'SiglusEngine.exe'), 'MZ')

    const { candidates } = await scanFolderForExecutables(root)
    expect(candidates.map((c) => ({ fileName: c.fileName, title: c.suggestedTitle }))).toEqual([
      { fileName: 'SiglusEngine.exe', title: 'Clannad' },
      { fileName: 'SteinsGate.exe', title: 'Steins Gate' }
    ])
  })

  it('skips uninstallers, crash handlers, RenPy -32 companions, and internal engine folders', async () => {
    const gameDir = join(root, 'WhiteAlbum2')
    const libDir = join(gameDir, 'lib', 'py3-windows-x86_64')
    mkdirSync(libDir, { recursive: true })
    writeFileSync(join(gameDir, 'WhiteAlbum2.exe'), 'MZ')
    writeFileSync(join(gameDir, 'WhiteAlbum2-32.exe'), 'MZ')
    writeFileSync(join(gameDir, 'unins000.exe'), 'MZ')
    writeFileSync(join(gameDir, 'UnityCrashHandler64.exe'), 'MZ')
    writeFileSync(join(libDir, 'python.exe'), 'MZ')
    writeFileSync(join(libDir, 'WhiteAlbum2.exe'), 'MZ')

    const { candidates } = await scanFolderForExecutables(root)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].fileName).toBe('WhiteAlbum2.exe')
  })

  it('refuses to scan an entire filesystem drive root', async () => {
    const driveRoot = parse(root).root
    await expect(scanFolderForExecutables(driveRoot)).rejects.toThrow(/specific games folder/i)
  })

  it('identifies helper executables accurately', () => {
    expect(isHelperExecutable('unins000.exe')).toBe(true)
    expect(isHelperExecutable('UnityCrashHandler64.exe')).toBe(true)
    expect(isHelperExecutable('vc_redist.x64.exe')).toBe(true)
    expect(isHelperExecutable('dxsetup.exe')).toBe(true)
    expect(isHelperExecutable('Katawa Shoujo.exe')).toBe(false)
  })
})
