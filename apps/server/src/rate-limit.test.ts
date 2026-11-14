import { describe, expect, test } from 'bun:test'
import { ClientMsg } from '@office-fps/shared'
import { MessageLimiter, TokenBucket } from './rate-limit.ts'

describe('TokenBucket', () => {
  test('allows the burst, then the rate', () => {
    const bucket = new TokenBucket(10, 5, 0)
    let allowed = 0
    for (let i = 0; i < 20; i++) if (bucket.take(0)) allowed++
    expect(allowed).toBe(5)
    expect(bucket.take(50)).toBe(false) // half a token
    expect(bucket.take(100)).toBe(true) // 0.1 s at 10/s = one more
    // A long pause refills to the burst, no further.
    for (let i = 0; i < 5; i++) expect(bucket.take(60_000)).toBe(true)
    expect(bucket.take(60_000)).toBe(false)
  })
})

describe('MessageLimiter', () => {
  test('an honest client is never limited', () => {
    const limiter = new MessageLimiter(() => {})
    // 10 s: 15 inputs/s plus an early flush per press, a ping every 2 s, a few actions.
    for (let ms = 0; ms < 10_000; ms += 1000 / 60) {
      const tick = Math.round(ms / (1000 / 60))
      if (tick % 4 === 0 || tick % 10 === 0)
        expect(limiter.allow(ClientMsg.Input, () => 'x', ms)).toBe(true)
      if (tick % 120 === 0) expect(limiter.allow(ClientMsg.Ping, () => 'x', ms)).toBe(true)
      if (tick % 20 === 0) expect(limiter.allow(ClientMsg.Action, () => 'x', ms)).toBe(true)
    }
    expect(limiter.dropped).toBe(0)
  })

  test('an Action flood is dropped and logged once per 5 s', () => {
    const lines: string[] = []
    const limiter = new MessageLimiter((line) => lines.push(line))
    let allowed = 0
    // 1000 actions a second for 3 s.
    for (let ms = 0; ms < 3000; ms++) if (limiter.allow(ClientMsg.Action, () => '#7', ms)) allowed++
    // The burst of 20 plus 10/s.
    expect(allowed).toBeGreaterThanOrEqual(49)
    expect(allowed).toBeLessThanOrEqual(51)
    expect(limiter.dropped).toBe(3000 - allowed)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('#7')
    // Each type has its own allowance.
    expect(limiter.allow(ClientMsg.Input, () => '#7', 3000)).toBe(true)
  })
})
