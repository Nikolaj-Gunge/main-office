import { describe, expect, test } from 'bun:test'
import { SOUNDS, type SoundId } from './sounds.ts'

const RATE = 48000

describe('synthesized sounds', () => {
  for (const [id, def] of Object.entries(SOUNDS) as [SoundId, (typeof SOUNDS)[SoundId]][]) {
    test(`${id}: ${def.variants} clean variant(s)`, () => {
      const variants = Array.from({ length: def.variants }, (_, v) => def.recipe(RATE, v))
      for (const data of variants) {
        let peak = 0
        let energy = 0
        for (const s of data) {
          expect(Number.isFinite(s)).toBe(true)
          peak = Math.max(peak, Math.abs(s))
          energy += s * s
        }
        expect(peak).toBeLessThanOrEqual(1)
        expect(peak).toBeGreaterThan(0.1)
        expect(Math.sqrt(energy / data.length)).toBeGreaterThan(0.002)
        // Wind is ambience: one long gust. Everything else is a short hit.
        expect(data.length / RATE).toBeLessThan(id === 'wind' ? 8 : 2)
      }
      if (def.variants > 1) expect(variants[0]).not.toEqual(variants[1])
    })
  }

  test('the whole bank synthesizes quickly (it runs when you click Play)', () => {
    const start = performance.now()
    for (const def of Object.values(SOUNDS)) {
      for (let v = 0; v < def.variants; v++) def.recipe(RATE, v)
    }
    expect(performance.now() - start).toBeLessThan(400)
  })
})
