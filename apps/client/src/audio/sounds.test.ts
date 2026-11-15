import { describe, expect, test } from 'bun:test'
import { SOUNDS, type SoundId } from './sounds.ts'

const RATE = 48000
const AMBIENCE = new Set<SoundId>([
  'wind',
  'rain.light',
  'rain.heavy',
  'thunder.near',
  'thunder.far',
  'horn',
  'birdsong',
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
    // Timed against a fixed reference job run right beside it, so a busy machine (other test
    // files, other builds) slows both alike: ~3x the reference when idle (~230 ms vs ~80 ms).
    // Best of three, so one unlucky stall doesn't fail it; a real 2x slowdown still does.
    const bankMs = () => {
      const start = performance.now()
      for (const def of Object.values(SOUNDS)) {
        for (let v = 0; v < def.variants; v++) def.recipe(RATE, v)
      }
      return performance.now() - start
    }
    const referenceMs = () => {
      const start = performance.now()
      const out = new Float32Array(RATE * 10)
      let seed = 1
      for (let pass = 0; pass < 16; pass++) {
        for (let i = 0; i < out.length; i++) {
          seed = (seed * 1664525 + 1013904223) >>> 0
          out[i] = Math.sin(i * 0.01) * 0.5 + (seed / 2 ** 32 - 0.5) * 0.1 + (out[i] ?? 0) * 0.3
        }
      }
      return performance.now() - start
    }
    let best = Number.POSITIVE_INFINITY
    for (let tries = 0; tries < 3 && best >= 6; tries++) {
      best = Math.min(best, bankMs() / referenceMs())
    }
    expect(best).toBeLessThan(6)
  })
})
