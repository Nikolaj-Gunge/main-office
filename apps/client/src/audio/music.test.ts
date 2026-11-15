import { describe, expect, test } from 'bun:test'
import {
  LOOP_SECONDS,
  MUSIC_RATE,
  renderHaven,
  renderStem,
  renderStinger,
  STEMS,
  smoothTension,
  stemLevels,
} from './music-stems.ts'

describe('adaptive music', () => {
  test('every stem is one clean loop of the same length, seamless where it wraps', () => {
    const n = Math.round(LOOP_SECONDS * MUSIC_RATE)
    for (const id of STEMS) {
      const x = renderStem(id)
      expect(x.length).toBe(n)
      let peak = 0
      for (const s of x) {
        expect(Number.isFinite(s)).toBe(true)
        peak = Math.max(peak, Math.abs(s))
      }
      expect(peak).toBeGreaterThan(0.3)
      expect(peak).toBeLessThanOrEqual(1)
      // The last sample runs into the first like any other two neighbours.
      let step = 0
      for (let i = 1; i < x.length; i++)
        step = Math.max(step, Math.abs((x[i] ?? 0) - (x[i - 1] ?? 0)))
      expect(Math.abs((x[0] ?? 0) - (x[n - 1] ?? 0))).toBeLessThanOrEqual(step + 1e-6)
    }
  })

  test('Haven and the stingers render', () => {
    expect(renderHaven().length).toBeGreaterThan(MUSIC_RATE * 20)
    for (const id of ['spotted', 'bitten', 'dusk'] as const) {
      const x = renderStinger(id)
      expect(x.length / MUSIC_RATE).toBeLessThan(6)
      expect(Math.max(...x.map(Math.abs))).toBeGreaterThan(0.5)
    }
  })

  test('layers come in one by one as tension rises; near silence when calm', () => {
    const calm = stemLevels(0.05)
    for (const id of STEMS) expect(calm[id]).toBe(0)
    const mid = stemLevels(0.5)
    expect(mid.drone).toBeGreaterThan(0.5)
    expect(mid.pulse).toBeGreaterThan(0)
    expect(mid.high).toBe(0)
    const peak = stemLevels(1)
    for (const id of STEMS) expect(peak[id]).toBeGreaterThan(0.3)
  })

  test('tension rises within seconds and falls slowly', () => {
    let t = 0
    for (let i = 0; i < 3 * 60; i++) t = smoothTension(t, 1, 1 / 60)
    expect(t).toBeGreaterThan(0.9)
    for (let i = 0; i < 3 * 60; i++) t = smoothTension(t, 0, 1 / 60)
    expect(t).toBeGreaterThan(0.7)
  })
})
