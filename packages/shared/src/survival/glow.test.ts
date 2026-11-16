import { describe, expect, test } from 'bun:test'
import { GLOW_ODDS, glowFor } from './glow.ts'

describe('The Glow', () => {
  test('about one clear night in GLOW_ODDS, the same every time', () => {
    let n = 0
    for (let night = 0; night < 1200; night++) if (glowFor(7, night, 'calm', 'clear')) n++
    expect(n / 1200).toBeGreaterThan(0.5 / GLOW_ODDS)
    expect(n / 1200).toBeLessThan(1.5 / GLOW_ODDS)
    expect(glowFor(7, 42, 'calm', 'clear')).toBe(glowFor(7, 42, 'calm', 'clear'))
  })

  test('never on a fog night or under anything but a clear sky', () => {
    for (let night = 0; night < 300; night++) {
      expect(glowFor(7, night, 'fog', 'clear')).toBe(false)
      expect(glowFor(7, night, 'calm', 'overcast')).toBe(false)
      expect(glowFor(7, night, 'hunting', 'snow')).toBe(false)
    }
  })
})
