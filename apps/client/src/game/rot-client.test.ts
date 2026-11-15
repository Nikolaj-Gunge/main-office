import { describe, expect, test } from 'bun:test'
import { birdsongLevel } from './rot-client.ts'

describe('birdsong', () => {
  test('sings by day, quieter at night and indoors, and stops with the dead near', () => {
    expect(birdsongLevel(1, false, false)).toBeGreaterThan(birdsongLevel(0, false, false))
    expect(birdsongLevel(1, false, true)).toBeLessThan(birdsongLevel(1, false, false))
    expect(birdsongLevel(1, true, false)).toBe(0)
  })
})
