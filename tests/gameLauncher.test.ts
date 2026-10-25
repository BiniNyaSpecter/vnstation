import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LauncherEvent } from '@shared/launcher'
import { LibraryStore } from '../src/main/db/libraryStore'
import { openLibraryDatabase } from '../src/main/db/openLibraryDatabase'
import type { Database } from '../src/main/db/sqlite'
import { splitArguments } from '../src/main/launcher/args'
import { ProcessGameLauncher, type SpawnedProcess } from '../src/main/launcher/gameLauncher'

class FakeChildProcess extends EventEmitter implements SpawnedProcess {
  spawnNow(): void {
    this.emit('spawn')
  }
  failNow(code: string, message = code): void {
    const err = new Error(message) as NodeJS.ErrnoException
    err.code = code
    this.emit('error', err)
  }
  exitNow(code: number | null = 0): void {
    this.emit('exit', code)
  }
}

describe('splitArguments', () => {
  it('returns an empty list for blank strings', () => {
    expect(splitArguments('')).toEqual([])
    expect(splitArguments('   \t  ')).toEqual([])
  })

  it('splits plain flags and keeps quoted paths with spaces intact', () => {
    expect(splitArguments('--windowed --save-dir "D:\\Visual Novels\\White Album 2\\save" -lang ja')).toEqual([
      '--windowed',
      '--save-dir',
      'D:\\Visual Novels\\White Album 2\\save',
      '-lang',
      'ja'
    ])
  })

  it('preserves Windows backslashes and non-English characters without a shell', () => {
    expect(splitArguments('"--path=D:\\ゲーム\\魔法使いの夜\\\\" --flag')).toEqual([
      '--path=D:\\ゲーム\\魔法使いの夜\\',
      '--flag'
    ])
    expect(splitArguments('D:\\ゲーム\\セーブ --title "星の夢 & ; | > nul"')).toEqual([
      'D:\\ゲーム\\セーブ',
      '--title',
      '星の夢 & ; | > nul'
    ])
  })

  it('unescapes escaped double quotes inside arguments', () => {
    expect(splitArguments('--note "say \\"hello\\" now"')).toEqual(['--note', 'say "hello" now'])
  })
})

describe('ProcessGameLauncher', () => {
  let root: string
  let db: Database
  let store: LibraryStore
  let clockMs: number

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'vnstation-launch-'))
    db = openLibraryDatabase(':memory:')
    clockMs = Date.parse('2026-10-25T12:00:00.000Z')
    let idSeq = 0
    store = new LibraryStore(
      db,
      () => new Date(clockMs),
      () => `id-${++idSeq}`
    )
  })

  afterEach(async () => {
    db.close()
    await rm(root, { recursive: true, force: true })
  })

  async function createFakeInstall(folderName: string, exeName = 'game.exe'): Promise<{ folder: string; exe: string }> {
    const folder = join(root, folderName)
    await mkdir(folder, { recursive: true })
    const exe = join(folder, exeName)
    await writeFile(exe, 'MZ')
    return { folder, exe }
  }

  it('launches an executable from its configured working directory with parsed arguments and records playtime', async () => {
    const install = await createFakeInstall('Mahoyo JP — 魔法使いの夜', 'Mahoyo.exe')
    const altWorkDir = await createFakeInstall('Custom Work Dir')
    const entry = await store.addGame({
      title: 'Witch on the Holy Night',
      launch: {
        executablePath: install.exe,
        workingDirectory: altWorkDir.folder,
        arguments: '--windowed --config "D:\\My Saves\\config.ini"'
      }
    })

    const spawned: Array<{ exe: string; args: readonly string[]; cwd: string; child: FakeChildProcess }> = []
    const events: LauncherEvent[] = []
    const windowCalls: string[] = []

    const launcher = new ProcessGameLauncher({
      store,
      now: () => new Date(clockMs),
      spawnProcess: (exe, args, { cwd }) => {
        const child = new FakeChildProcess()
        spawned.push({ exe, args, cwd, child })
        queueMicrotask(() => child.spawnNow())
        return child
      },
      window: {
        minimize: () => windowCalls.push('minimize'),
        restoreAndFocus: () => windowCalls.push('restore')
      }
    })
    launcher.subscribe((e) => events.push(e))

    const result = await launcher.launch(entry.id, { minimizeOnLaunch: true, restoreOnExit: true })
    expect(result).toEqual({ ok: true, startedAt: '2026-10-25T12:00:00.000Z' })
    expect(spawned).toHaveLength(1)
    expect(spawned[0].exe).toBe(install.exe)
    expect(spawned[0].cwd).toBe(altWorkDir.folder)
    expect(spawned[0].args).toEqual(['--windowed', '--config', 'D:\\My Saves\\config.ini'])
    expect(windowCalls).toEqual(['minimize'])
    expect(await launcher.running()).toEqual([
      { gameId: entry.id, startedAt: '2026-10-25T12:00:00.000Z', mode: 'process' }
    ])

    // Duplicate launch while running is rejected cleanly.
    const duplicate = await launcher.launch(entry.id, { minimizeOnLaunch: false, restoreOnExit: false })
    expect(duplicate.ok).toBe(false)
    if (!duplicate.ok) expect(duplicate.reason).toBe('already-running')

    // Advance 45 minutes and exit.
    clockMs += 45 * 60_000
    spawned[0].child.exitNow(0)
    await new Promise((r) => setTimeout(r, 20))

    expect(await launcher.running()).toEqual([])
    expect(windowCalls).toEqual(['minimize', 'restore'])

    const updated = store.getEntry(entry.id)
    expect(updated.lastPlayedAt).toBe('2026-10-25T12:00:00.000Z')
    expect(updated.playtimeMinutes).toBe(45)

    const history = await launcher.history(entry.id, 10)
    expect(history.totalSessions).toBe(1)
    expect(history.sessions[0]).toMatchObject({
      gameId: entry.id,
      startedAt: '2026-10-25T12:00:00.000Z',
      endedAt: '2026-10-25T12:45:00.000Z',
      seconds: 2700,
      tracking: 'process'
    })
    expect(events.map((e) => e.type)).toEqual(['started', 'stopped'])
  })

  it('accumulates sub-minute sessions accurately into total playtime', async () => {
    const install = await createFakeInstall('ShortRuns')
    const entry = await store.addGame({
      title: 'Short Runs',
      launch: { executablePath: install.exe, workingDirectory: install.folder, arguments: '' }
    })

    let activeChild: FakeChildProcess | null = null
    const launcher = new ProcessGameLauncher({
      store,
      now: () => new Date(clockMs),
      spawnProcess: () => {
        const child = new FakeChildProcess()
        activeChild = child
        queueMicrotask(() => child.spawnNow())
        return child
      }
    })

    // Two 40-second sessions should total 80 seconds = 1 minute (instead of rounding each down to 0).
    await launcher.launch(entry.id, { minimizeOnLaunch: false, restoreOnExit: false })
    clockMs += 40_000
    activeChild!.exitNow(0)
    await new Promise((r) => setTimeout(r, 20))
    expect(store.getEntry(entry.id).playtimeMinutes).toBe(0)

    clockMs += 10_000
    await launcher.launch(entry.id, { minimizeOnLaunch: false, restoreOnExit: false })
    clockMs += 40_000
    activeChild!.exitNow(0)
    await new Promise((r) => setTimeout(r, 20))
    expect(store.getEntry(entry.id).playtimeMinutes).toBe(1)
  })

  it('follows another process in the game folder when a launcher executable exits early', async () => {
    const install = await createFakeInstall('LauncherVN', 'Launcher.exe')
    const entry = await store.addGame({
      title: 'Launcher VN',
      launch: { executablePath: install.exe, workingDirectory: install.folder, arguments: '' }
    })

    let childProcess: FakeChildProcess | null = null
    let folderAlive = true
    const events: LauncherEvent[] = []

    const launcher = new ProcessGameLauncher({
      store,
      now: () => new Date(clockMs),
      folderPollMs: 15,
      probeFolder: async (folder) => {
        expect(folder).toBe(install.folder)
        return folderAlive
      },
      spawnProcess: () => {
        const child = new FakeChildProcess()
        childProcess = child
        queueMicrotask(() => child.spawnNow())
        return child
      }
    })
    launcher.subscribe((e) => events.push(e))

    await launcher.launch(entry.id, { minimizeOnLaunch: false, restoreOnExit: false })
    // Launcher exits after 2 seconds, while the real game in the same folder is running.
    clockMs += 2_000
    childProcess!.exitNow(0)
    await new Promise((r) => setTimeout(r, 10))

    expect(await launcher.running()).toEqual([
      { gameId: entry.id, startedAt: '2026-10-25T12:00:00.000Z', mode: 'folder' }
    ])

    // Real game runs for 30 minutes, then exits.
    clockMs += 30 * 60_000
    folderAlive = false
    await new Promise((r) => setTimeout(r, 40))

    expect(await launcher.running()).toEqual([])
    expect(store.getEntry(entry.id).playtimeMinutes).toBe(30)
    const history = await launcher.history(entry.id, 5)
    expect(history.sessions[0].tracking).toBe('folder')
    expect(events.map((e) => e.type)).toEqual(['started', 'tracking', 'stopped'])
  })

  it('marks a quick launcher exit with no folder process as a handoff', async () => {
    const install = await createFakeInstall('SteamWrapper')
    const entry = await store.addGame({
      title: 'Steam Wrapper VN',
      launch: { executablePath: install.exe, workingDirectory: install.folder, arguments: '' }
    })

    let childProcess: FakeChildProcess | null = null
    const launcher = new ProcessGameLauncher({
      store,
      now: () => new Date(clockMs),
      probeFolder: async () => false,
      spawnProcess: () => {
        const child = new FakeChildProcess()
        childProcess = child
        queueMicrotask(() => child.spawnNow())
        return child
      }
    })

    await launcher.launch(entry.id, { minimizeOnLaunch: false, restoreOnExit: false })
    clockMs += 3_000
    childProcess!.exitNow(0)
    await new Promise((r) => setTimeout(r, 20))

    const history = await launcher.history(entry.id, 5)
    expect(history.sessions[0].tracking).toBe('handoff')
    expect(history.sessions[0].seconds).toBe(3)
  })

  it('handles missing executables, missing working directories, sample games, and elevation errors cleanly', async () => {
    await store.addSampleGames()
    const sample = store.snapshot().entries.find((e) => e.isSample)!

    const install = await createFakeInstall('MovedVN')
    const entry = await store.addGame({
      title: 'Moved VN',
      launch: { executablePath: install.exe, workingDirectory: install.folder, arguments: '' }
    })

    let spawnErrorCode: string | null = null
    const launcher = new ProcessGameLauncher({
      store,
      spawnProcess: () => {
        const child = new FakeChildProcess()
        queueMicrotask(() => {
          if (spawnErrorCode) child.failNow(spawnErrorCode)
          else child.spawnNow()
        })
        return child
      }
    })

    // 1. Sample game
    const sampleRes = await launcher.launch(sample.id, { minimizeOnLaunch: false, restoreOnExit: false })
    expect(sampleRes).toMatchObject({ ok: false, reason: 'sample' })

    // 2. Elevation required (EACCES)
    spawnErrorCode = 'EACCES'
    const adminRes = await launcher.launch(entry.id, { minimizeOnLaunch: false, restoreOnExit: false })
    expect(adminRes).toMatchObject({ ok: false, reason: 'needs-admin' })

    // 3. Missing executable
    await unlink(install.exe)
    const missingExeRes = await launcher.launch(entry.id, { minimizeOnLaunch: false, restoreOnExit: false })
    expect(missingExeRes).toMatchObject({ ok: false, reason: 'missing-executable' })
  })

  it('closes running sessions on app shutdown and marks crash-orphaned sessions as interrupted on startup', async () => {
    const install = await createFakeInstall('ShutdownVN')
    const entry = await store.addGame({
      title: 'Shutdown VN',
      launch: { executablePath: install.exe, workingDirectory: install.folder, arguments: '' }
    })

    const launcher = new ProcessGameLauncher({
      store,
      now: () => new Date(clockMs),
      spawnProcess: () => {
        const child = new FakeChildProcess()
        queueMicrotask(() => child.spawnNow())
        return child
      }
    })

    await launcher.launch(entry.id, { minimizeOnLaunch: false, restoreOnExit: false })
    clockMs += 15 * 60_000
    launcher.closeAllRunning()

    expect(store.getEntry(entry.id).playtimeMinutes).toBe(15)
    expect((await launcher.history(entry.id, 5)).sessions[0].tracking).toBe('app-closed')

    // Simulate an unclosed session left behind by a crash.
    store.startPlaySession(entry.id, '2026-10-25T14:00:00.000Z')
    expect(store.closeOrphanSessions('2026-10-25T15:00:00.000Z')).toBe(1)
    const sessions = (await launcher.history(entry.id, 5)).sessions
    expect(sessions[0]).toMatchObject({
      tracking: 'interrupted',
      seconds: 0,
      endedAt: '2026-10-25T15:00:00.000Z'
    })
    // Playtime was not inflated by the interrupted session.
    expect(store.getEntry(entry.id).playtimeMinutes).toBe(15)
  })
})
