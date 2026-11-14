import { describe, expect, test } from 'bun:test'
import { SOUNDS, type SoundId } from './sounds.ts'

const RATE = 48000
const AMBIENCE = new Set<SoundId>([
  'wind',
  'rain.light',
  'rain.heavy',
  'thunder.near',
  'thunder.far',
])

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
        // Wind, rain and thunder are ambience: long (rain loops ~9 s so the repeat is hard to hear). Everything else is a short hit.
        expect(data.length / RATE).toBeLessThan(AMBIENCE.has(id) ? 12 : 2)
      }
      if (def.variants > 1) expect(variants[0]).not.toEqual(variants[1])
    })
  }

  test('rain loops without a click: its end runs on into its start', () => {
    for (const id of ['rain.light', 'rain.heavy'] as const) {
      const data = SOUNDS[id].recipe(RATE, 0)
      let jump = 0
      let typical = 0
      for (let i = 1; i < data.length; i++) {
        typical = Math.max(typical, Math.abs((data[i] ?? 0) - (data[i - 1] ?? 0)))
      }
      jump = Math.abs((data[0] ?? 0) - (data[data.length - 1] ?? 0))
      expect(jump).toBeLessThanOrEqual(typical)
    }
  })

  test('the whole bank synthesizes quickly (it runs when you click Play)', () => {
    const start = performance.now()
    for (const def of Object.values(SOUNDS)) {
      for (let v = 0; v < def.variants; v++) def.recipe(RATE, v)
    }
    expect(performance.now() - start).toBeLessThan(400)
  })
})
