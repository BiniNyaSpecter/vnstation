import { beforeEach, describe, expect, it } from 'vitest'
import { __testing, configureSound, playSound, RECIPES } from '@renderer/lib/sound'

/** A fake Web Audio graph that records what would be played. */
function fakeAudio() {
  const created = { oscillators: [] as Array<{ type: string; freq: number; started: number; stopped: number }>, gains: [] as Array<{ value: number }> }
  const param = (initial = 0) => ({ value: initial, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} })
  const context = {
    state: 'running',
    currentTime: 10,
    destination: {},
    resume: async () => {},
    createGain: () => {
      const gain = { gain: param(1), connect() {} }
      created.gains.push(gain.gain)
      return gain
    },
    createOscillator: () => {
      const record = { type: '', freq: 0, started: -1, stopped: -1 }
      created.oscillators.push(record)
      return {
        set type(value: string) { record.type = value },
        frequency: { setValueAtTime: (f: number) => { record.freq = f }, exponentialRampToValueAtTime() {} },
        connect() {},
        start: (t: number) => { record.started = t },
        stop: (t: number) => { record.stopped = t }
      }
    }
  }
  return { created, factory: () => context as unknown as AudioContext }
}

describe('interface sounds', () => {
  let time = 1000
  let audio = fakeAudio()
  beforeEach(() => {
    time = 1000
    audio = fakeAudio()
    __testing.reset({ factory: audio.factory, clock: () => time })
  })

  it('plays every note of a sound, in tune and in sequence', () => {
    playSound('select')
    expect(audio.created.oscillators.map((o) => o.freq)).toEqual(RECIPES.select.map((n) => n.freq))
    expect(audio.created.oscillators[1].started).toBeGreaterThan(audio.created.oscillators[0].started)
    expect(audio.created.oscillators.every((o) => o.stopped > o.started)).toBe(true)
  })

  it('stays quiet when switched off or set to zero volume', () => {
    configureSound({ enabled: false, volume: 0.5 })
    playSound('move')
    configureSound({ enabled: true, volume: 0 })
    playSound('move')
    expect(audio.created.oscillators).toHaveLength(0)
  })

  it('applies the master volume, clamped to 0–1', () => {
    configureSound({ enabled: true, volume: 3 })
    playSound('move')
    expect(audio.created.gains[0].value).toBe(1)
    configureSound({ enabled: true, volume: 0.25 })
    expect(audio.created.gains[0].value).toBe(0.25)
  })

  it('does not machine-gun when a key is held down', () => {
    for (let i = 0; i < 10; i++) {
      playSound('move')
      time += 10 // faster than the minimum gap
    }
    expect(audio.created.oscillators.length).toBeLessThan(4)
    time += 500
    const before = audio.created.oscillators.length
    playSound('move')
    expect(audio.created.oscillators.length).toBe(before + 1)
  })

  it('never throws when audio is unavailable or fails', () => {
    __testing.reset({ factory: () => null, clock: () => time })
    expect(() => playSound('move')).not.toThrow()
    __testing.reset({ factory: () => { throw new Error('no audio device') }, clock: () => time })
    expect(() => playSound('error')).not.toThrow()
  })

  it('keeps every sound short and quiet', () => {
    for (const notes of Object.values(RECIPES)) {
      for (const note of notes) {
        expect(note.gain).toBeLessThan(0.15)
        expect(note.start + note.duration).toBeLessThan(0.5)
      }
    }
  })
})
