/**
 * Interface sounds in the spirit of a console home screen: a soft tick as the selection moves,
 * a two-note "confirm", a falling "back". They are synthesised with the Web Audio API, so there
 * are no audio files to ship or license, and everything is quiet by design (master volume is a
 * Setting). Nothing here can throw into the UI: if audio is unavailable it silently does nothing.
 */
export type SoundName = 'move' | 'select' | 'back' | 'open' | 'success' | 'error'

interface Note {
  freq: number
  /** Slides to this frequency by the end of the note. */
  endFreq?: number
  start: number
  duration: number
  type: OscillatorType
  gain: number
}

export const RECIPES: Record<SoundName, Note[]> = {
  move: [{ freq: 1320, endFreq: 1040, start: 0, duration: 0.05, type: 'triangle', gain: 0.07 }],
  select: [
    { freq: 660, start: 0, duration: 0.1, type: 'sine', gain: 0.1 },
    { freq: 990, start: 0.07, duration: 0.16, type: 'sine', gain: 0.09 }
  ],
  back: [{ freq: 740, endFreq: 500, start: 0, duration: 0.12, type: 'sine', gain: 0.09 }],
  open: [{ freq: 420, endFreq: 880, start: 0, duration: 0.14, type: 'sine', gain: 0.06 }],
  success: [
    { freq: 523, start: 0, duration: 0.11, type: 'sine', gain: 0.08 },
    { freq: 659, start: 0.08, duration: 0.11, type: 'sine', gain: 0.08 },
    { freq: 784, start: 0.16, duration: 0.2, type: 'sine', gain: 0.08 }
  ],
  error: [
    { freq: 220, start: 0, duration: 0.13, type: 'triangle', gain: 0.1 },
    { freq: 175, start: 0.11, duration: 0.2, type: 'triangle', gain: 0.1 }
  ]
}

/** Minimum time between two plays of the same sound, so holding an arrow key does not buzz. */
const MIN_GAP_MS: Record<SoundName, number> = { move: 45, select: 90, back: 90, open: 120, success: 200, error: 200 }

const settings = { enabled: true, volume: 0.5 }
const lastPlayed = new Map<SoundName, number>()

type AudioFactory = () => AudioContext | null
const defaultFactory: AudioFactory = () => {
  const Ctor = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
  return Ctor ? new Ctor() : null
}
let factory: AudioFactory = defaultFactory
let context: AudioContext | null = null
let master: GainNode | null = null
let clock: () => number = () => Date.now()

/** Applies the user's sound settings. Called whenever preferences change. */
export function configureSound(next: { enabled: boolean; volume: number }): void {
  settings.enabled = next.enabled
  settings.volume = Math.min(1, Math.max(0, next.volume))
  if (master) master.gain.value = settings.volume
}

export function playSound(name: SoundName): void {
  if (!settings.enabled || settings.volume <= 0) return
  const now = clock()
  const previous = lastPlayed.get(name)
  if (previous !== undefined && now - previous < MIN_GAP_MS[name]) return
  lastPlayed.set(name, now)

  try {
    if (!context) {
      context = factory()
      if (!context) return
      master = context.createGain()
      master.gain.value = settings.volume
      master.connect(context.destination)
    }
    if (context.state === 'suspended') void context.resume()
    const output = master
    if (!output) return
    const t0 = context.currentTime
    for (const note of RECIPES[name]) {
      const oscillator = context.createOscillator()
      const envelope = context.createGain()
      const start = t0 + note.start
      const end = start + note.duration
      oscillator.type = note.type
      oscillator.frequency.setValueAtTime(note.freq, start)
      if (note.endFreq) oscillator.frequency.exponentialRampToValueAtTime(note.endFreq, end)
      // A quick attack and an exponential fade avoid clicks.
      envelope.gain.setValueAtTime(0.0001, start)
      envelope.gain.linearRampToValueAtTime(note.gain, start + 0.006)
      envelope.gain.exponentialRampToValueAtTime(0.0001, end)
      oscillator.connect(envelope)
      envelope.connect(output)
      oscillator.start(start)
      oscillator.stop(end + 0.02)
    }
  } catch {
    // Audio is a nicety. Never let it affect the interface.
  }
}

/** Test hooks. */
export const __testing = {
  reset(options: { factory?: AudioFactory; clock?: () => number } = {}): void {
    factory = options.factory ?? defaultFactory
    clock = options.clock ?? (() => Date.now())
    context = null
    master = null
    lastPlayed.clear()
    settings.enabled = true
    settings.volume = 0.5
  }
}
