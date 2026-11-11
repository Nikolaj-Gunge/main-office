import { describe, expect, test } from 'bun:test'
import { falloff, gunshotMix } from './mixing.ts'

describe('falloff', () => {
  test('full volume up close, then strictly quieter with distance, silent at range', () => {
    expect(falloff(0, 3, 30)).toBe(1)
    expect(falloff(3, 3, 30)).toBe(1)
    let previous = 1
    for (let d = 3.5; d < 30; d += 0.5) {
      const g = falloff(d, 3, 30)
      expect(g).toBeLessThan(previous)
      previous = g
    }
    expect(falloff(30, 3, 30)).toBe(0)
  })

  test('footstep curve: a step 10 m away is much quieter than one at 3 m', () => {
    expect(falloff(6, 3, 30)).toBeLessThan(0.4)
    expect(falloff(10, 3, 30)).toBeLessThan(0.2)
    expect(falloff(20, 3, 30)).toBeLessThan(0.07)
  })
})

describe('gunshotMix', () => {
  test('own gun is quieter than a remote gun right next to you', () => {
    expect(gunshotMix(null).volume).toBeLessThan(gunshotMix(2).volume)
  })

  test('distant shots are quieter, duller, later and mostly echo', () => {
    const near = gunshotMix(5)
    const far = gunshotMix(60)
    expect(far.volume).toBeLessThan(near.volume)
    expect(far.lowpass).toBeLessThan(near.lowpass)
    expect(far.delay).toBeGreaterThan(0.15)
    expect(far.close).toBe(0)
    expect(far.tail).toBeGreaterThan(near.tail)
  })

  test('still audible across the map', () => {
    expect(gunshotMix(80).volume).toBeGreaterThan(0.1)
  })
})
