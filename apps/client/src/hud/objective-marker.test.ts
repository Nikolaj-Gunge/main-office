import { describe, expect, test } from 'bun:test'
import { markerSpot } from './objective-marker.ts'

describe('waypoint marker', () => {
  test('a target behind you sits at a side edge, halfway up, clear of the bottom HUD', () => {
    for (const x of [100, 799, 800, 1200, 3000]) {
      const spot = markerSpot(x, 880, true, 1600, 900)
      expect(spot.y).toBe(450)
      expect([40, 1560]).toContain(spot.x)
      expect(spot.off).toBe(true)
    }
    // Behind and to your right projects mirrored, onto the left: the marker says turn right.
    expect(markerSpot(400, 450, true, 1600, 900).x).toBe(1560)
    expect(markerSpot(1200, 450, true, 1600, 900).x).toBe(40)
  })

  test('in front it sits over the target but never drops onto the HUD', () => {
    expect(markerSpot(800, 450, false, 1600, 900)).toEqual({ x: 800, y: 450, off: false })
    expect(markerSpot(800, 890, false, 1600, 900)).toEqual({ x: 800, y: 730, off: true })
    expect(markerSpot(-50, -50, false, 1600, 900)).toEqual({ x: 40, y: 40, off: true })
  })
})
