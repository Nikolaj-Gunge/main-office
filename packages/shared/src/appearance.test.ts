import { describe, expect, test } from 'bun:test'
import {
  type Appearance,
  BEARDS,
  DEFAULT_APPEARANCE,
  EYE_COLORS,
  HAIR_COLORS,
  HAIR_STYLES,
  packAppearance,
  randomAppearance,
  SKIN_TONES,
  unpackAppearance,
} from './appearance.ts'

describe('appearance', () => {
  test('pack/unpack round-trips every value of every field', () => {
    const sizes: [keyof Appearance, number][] = [
      ['body', 2],
      ['skin', SKIN_TONES.length],
      ['hair', HAIR_STYLES.length],
      ['hairColor', HAIR_COLORS.length],
      ['eyes', EYE_COLORS.length],
      ['beard', BEARDS.length],
    ]
    for (const [key, n] of sizes) {
      for (let v = 0; v < n; v++) {
        const a = { ...DEFAULT_APPEARANCE, [key]: v }
        expect(unpackAppearance(packAppearance(a))).toEqual(a)
      }
    }
  })

  test('random looks round-trip and fit in 24 bits', () => {
    let seed = 1
    const random = () => {
      seed = (seed * 16807) % 2147483647
      return (seed - 1) / 2147483646
    }
    for (let i = 0; i < 200; i++) {
      const a = randomAppearance(random)
      const v = packAppearance(a)
      expect(v).toBeLessThan(1 << 24)
      expect(unpackAppearance(v)).toEqual(a)
    }
  })

  test('out-of-range and junk values clamp instead of breaking', () => {
    const a = unpackAppearance(
      packAppearance({ body: 7, skin: -3, hair: 99, hairColor: Number.NaN, eyes: 2.9, beard: 15 }),
    )
    expect(a).toEqual({
      body: 1,
      skin: 0,
      hair: HAIR_STYLES.length - 1,
      hairColor: 0,
      eyes: 2,
      beard: BEARDS.length - 1,
    })
    // Whatever arrives on the wire unpacks into valid indices.
    const any = unpackAppearance(0xffffff)
    expect(any.skin).toBeLessThan(SKIN_TONES.length)
    expect(any.eyes).toBeLessThan(EYE_COLORS.length)
    expect(any.body).toBeLessThan(2)
  })
})
