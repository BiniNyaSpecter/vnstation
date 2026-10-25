import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateExecutable } from '../src/main/executables'

/** Uses empty placeholder files named *.exe. Nothing is ever executed. */
describe('validateExecutable', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vnstation-test-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('accepts an existing .exe, including spaces and non-English characters', async () => {
    const folder = join(dir, 'My Games', '星降る夜')
    await mkdir(folder, { recursive: true })
    const file = join(folder, 'ゲーム start.EXE')
    await writeFile(file, '')

    const result = await validateExecutable(file)
    expect(result.path).toBe(file)
    expect(result.directory).toBe(folder)
    expect(result.fileName).toBe('ゲーム start.EXE')
  })

  it('rejects other file types', async () => {
    const file = join(dir, 'readme.txt')
    await writeFile(file, '')
    await expect(validateExecutable(file)).rejects.toThrow('Only .exe files')
  })

  it('rejects missing files and folders named like executables', async () => {
    await expect(validateExecutable(join(dir, 'gone.exe'))).rejects.toThrow('could not be found')
    const folderLikeExe = join(dir, 'folder.exe')
    await mkdir(folderLikeExe)
    await expect(validateExecutable(folderLikeExe)).rejects.toThrow('could not be found')
  })

  it('rejects relative paths, empty input and odd values', async () => {
    await expect(validateExecutable('game.exe')).rejects.toThrow('absolute')
    await expect(validateExecutable('')).rejects.toThrow('No file')
    await expect(validateExecutable(undefined)).rejects.toThrow('No file')
    await expect(validateExecutable(`${dir}/a\0.exe`)).rejects.toThrow('not valid')
  })
})
