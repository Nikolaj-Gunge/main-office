import { describe, expect, test } from 'bun:test'
import { heightAt } from './terrain.ts'
import {
  CURRENT,
  currentAt,
  FLOOD_RISE,
  floodAt,
  heldAt,
  JETTY_ABOVE,
  jettyPassable,
  lakeOutlet,
  snowCoverAt,
  waterAt,
} from './weather-effects.ts'
import { buildDeadwood } from './world.ts'

const def = buildDeadwood().survival
if (!def) throw new Error('no survival world')
const lake = def.lakes[0]
if (!lake) throw new Error('no lake')

describe('the flood', () => {
  test('a long storm raises the lake over the jetty; it goes back down after', () => {
    const holds = [
      { kind: 'storm' as const, from: 0, to: 900 },
      { kind: 'clear' as const, from: 900 },
    ]
    const at = (clock: number) => floodAt({ seed: 3, clock, holds })
    expect(at(30)).toBeLessThan(0.2)
    // Rising all through the storm…
    expect(at(300)).toBeGreaterThan(at(120))
    expect(at(880)).toBeGreaterThan(0.9)
    expect(jettyPassable(at(60))).toBe(true)
    expect(jettyPassable(at(880))).toBe(false)
    // …and draining away slower than it came.
    expect(at(1100)).toBeLessThan(at(880))
    expect(at(1100)).toBeGreaterThan(0.4)
    expect(at(900 + 1500)).toBeLessThan(0.05)
    expect(jettyPassable(at(900 + 1500))).toBe(true)
  })

  test('holds only count while they last; an old pin holds throughout', () => {
    const past = { seed: 1, clock: 500, holds: [{ kind: 'storm' as const, from: 100, to: 200 }] }
    expect(heldAt(past, 50)).toBeUndefined()
    expect(heldAt(past, 150)).toBe('storm')
    expect(heldAt(past, 250)).toBeUndefined()
    expect(heldAt({ seed: 1, clock: 5, pin: 'fog' }, 1)).toBe('fog')
  })

  test('the jetty floods once the water is over its deck; passable below', () => {
    expect(jettyPassable(0)).toBe(true)
    expect(jettyPassable(JETTY_ABOVE / FLOOD_RISE)).toBe(true)
    expect(jettyPassable(1)).toBe(false)
  })

  test('the swollen lake reaches low ground past its old shore', () => {
    // Somewhere just past the old water's edge, low enough to go under in a flood.
    let spot: { x: number; z: number } | null = null
    for (let a = 0; a < 64 && !spot; a++) {
      for (let r = lake.r + 4; r < lake.r + 45; r += 1) {
        const x = lake.x + Math.cos((a / 64) * Math.PI * 2) * r
        const z = lake.z + Math.sin((a / 64) * Math.PI * 2) * r
        const h = heightAt(def.terrain, x, z)
        if (h > lake.y + 0.2 && h < lake.y + FLOOD_RISE - 0.3) {
          spot = { x, z }
          break
        }
      }
    }
    if (!spot) throw new Error('no low bank')
    expect(waterAt(def, spot.x, spot.z, 0)).toBeNull()
    const flooded = waterAt(def, spot.x, spot.z, 1)
    expect(flooded?.depth).toBeGreaterThan(0.2)
    // Far from any lake there's never water.
    expect(waterAt(def, lake.x + 600, lake.z, 1)).toBeNull()
  })

  test('the current only pulls in a real flood, at deep water, and never faster than CURRENT', () => {
    const outlet = lakeOutlet(def.terrain, lake)
    const x = lake.x - lake.r + 5
    expect(currentAt(lake, outlet, x, lake.z, 1, 0.3)).toBeNull()
    expect(currentAt(lake, outlet, x, lake.z, 0.1, 1)).toBeNull()
    const pull = currentAt(lake, outlet, x, lake.z, 1, 1)
    if (!pull) throw new Error('no current')
    const speed = Math.hypot(pull.x, pull.z)
    expect(speed).toBeGreaterThan(CURRENT * 0.8)
    expect(speed).toBeLessThanOrEqual(CURRENT + 1e-9)
  })
})

describe('snow on the ground', () => {
  test('settles over minutes in a cold spell and thaws after', () => {
    const holds = [
      { kind: 'snow' as const, from: 0, to: 1200 },
      { kind: 'clear' as const, from: 1200 },
    ]
    const at = (clock: number) => snowCoverAt({ seed: 9, clock, holds })
    expect(at(20)).toBeLessThan(0.15)
    expect(at(600)).toBeGreaterThan(0.8)
    expect(at(1300)).toBeGreaterThan(0.5)
    expect(at(1200 + 2400)).toBeLessThan(0.05)
    // Rain never settles.
    expect(snowCoverAt({ seed: 9, clock: 900, holds: [{ kind: 'storm', from: 0 }] })).toBe(0)
  })
})
