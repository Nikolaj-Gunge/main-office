import { beforeAll, describe, expect, test } from 'bun:test'
import { createPhysicsWorld, initPhysics, loadMap } from '@office-fps/shared'
import { NavGrid } from './nav.ts'

beforeAll(async () => {
  await initPhysics()
})

describe('nav grid (Outbreak)', () => {
  const setup = () => {
    const map = loadMap('outbreak')
    const physics = createPhysicsWorld(map)
    const t0 = performance.now()
    const nav = new NavGrid(map, physics, () => false)
    return { map, nav, ms: performance.now() - t0 }
  }

  test('covers the map and builds fast enough', () => {
    const { nav, ms } = setup()
    expect(nav.size).toBeGreaterThan(3000)
    expect(ms).toBeLessThan(3000)
  })

  test('every stage area is reachable from the front door with all gates open', () => {
    const { map, nav } = setup()
    const field = nav.field([{ x: 0, y: 0, z: -2.5 }], () => true)
    for (const stage of map.coop?.stages ?? []) {
      for (const s of stage.zombieSpawns) {
        const d = nav.distance(field, { x: s[0], y: s[1], z: s[2] })
        expect({ stage: stage.name, at: s, ok: Number.isFinite(d) }).toEqual({
          stage: stage.name,
          at: s,
          ok: true,
        })
      }
      for (const s of stage.start) {
        expect(Number.isFinite(nav.distance(field, { x: s.pos[0], y: 0, z: s.pos[2] }))).toBe(true)
      }
    }
  })

  test('a shut gate cuts the way through', () => {
    const { nav } = setup()
    const field = nav.field([{ x: 0, y: 0, z: -2.5 }], (id) => id !== 0)
    expect(Number.isFinite(nav.distance(field, { x: 0, y: 0, z: -14 }))).toBe(true)
    expect(nav.distance(field, { x: 0, y: 0, z: -30 })).toBe(Number.POSITIVE_INFINITY)
  })

  test('walking downhill from the office leads back to the lobby', () => {
    const { nav } = setup()
    const field = nav.field([{ x: 0, y: 0, z: -2.5 }], () => true)
    let p = { x: 9, y: 0, z: -45 }
    for (let i = 0; i < 200; i++) {
      const next = nav.next(field, p)
      if (!next) break
      p = next
    }
    expect(Math.hypot(p.x - 0, p.z + 2.5)).toBeLessThan(1.5)
  })
})
