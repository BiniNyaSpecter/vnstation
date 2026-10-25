import { describe, expect, it } from 'vitest'
import { UserFacingError } from '../src/main/errors'
import { toResult } from '../src/main/ipcResult'

describe('toResult', () => {
  it('wraps successful values, sync or async', async () => {
    expect(await toResult(() => 5)).toEqual({ ok: true, value: 5 })
    expect(await toResult(async () => 'x')).toEqual({ ok: true, value: 'x' })
  })

  it('passes user-facing messages through', async () => {
    expect(await toResult(() => { throw new UserFacingError('Pick a different name.') })).toEqual({ ok: false, message: 'Pick a different name.' })
    expect(await toResult(async () => { throw new UserFacingError('Async too.') })).toEqual({ ok: false, message: 'Async too.' })
  })

  it('hides unexpected errors, including any file paths they mention', async () => {
    const original = console.error
    console.error = () => undefined
    try {
      const result = await toResult(() => { throw new Error('ENOENT: C:\\Users\\someone\\secret.db') })
      expect(result).toEqual({ ok: false, message: 'Something went wrong. Please try again.' })
    } finally {
      console.error = original
    }
  })
})
