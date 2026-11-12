import { beforeAll, describe, expect, test } from 'bun:test'
import { createPhysicsWorld, initPhysics, PLAYER_QUERY_GROUPS, RAPIER } from '../physics/world.ts'
import { loadMap, MAPS, MATERIALS } from './index.ts'

beforeAll(async () => {
  await initPhysics()
})

/** Thin walk-through floor coverings (carpet, tiles) must lie on a real, solid floor. */
const FLOOR_MATERIALS = new Set(['carpet', 'tile', 'wood', 'floor'])

for (const id of Object.keys(MAPS)) {
  describe(`map "${id}"`, () => {
    const map = loadMap(id)

    test('has spawns', () => {
      expect(map.spawns.length).toBeGreaterThan(0)
    })

    test('boxes have positive size and known materials', () => {
      for (const box of map.boxes) {
        for (const s of box.size) expect(s).toBeGreaterThan(0)
        expect(MATERIALS).toContain(box.material)
      }
    })

    test('every floor covering lies on a solid floor (no fake floors over holes)', () => {
      const physics = createPhysicsWorld(map)
      const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })
      const floating: string[] = []
      for (const box of map.boxes) {
        const [sx, sy, sz] = box.size
        if (box.collide !== false || box.rotation || sy > 0.05 || sx * sz < 1) continue
        if (!FLOOR_MATERIALS.has(box.material)) continue
        const [cx, cy, cz] = box.center
        // Sample a grid across the covering: right below it there must be something solid.
        for (let i = 0.1; i < 1; i += 0.2) {
          for (let k = 0.1; k < 1; k += 0.2) {
            const x = cx - sx / 2 + sx * i
            const z = cz - sz / 2 + sz * k
            ray.origin = { x, y: cy + sy / 2, z }
            const hit = physics.world.castRay(ray, sy + 0.05, true, undefined, PLAYER_QUERY_GROUPS)
            if (!hit)
              floating.push(
                `${box.material} at (${x.toFixed(1)}, ${cy.toFixed(2)}, ${z.toFixed(1)})`,
              )
          }
        }
      }
      expect(floating.slice(0, 5)).toEqual([])
    })

    test('spawns are not inside any unrotated box', () => {
      for (const { pos } of map.spawns) {
        const head = [pos[0], pos[1] + 1.0, pos[2]]
        for (const box of map.boxes) {
          if (box.rotation) continue
          const inside = head.every(
            (v, i) => Math.abs(v - (box.center[i] ?? 0)) < (box.size[i] ?? 0) / 2,
          )
          expect(inside).toBe(false)
        }
      }
    })
  })
}

test('unknown map throws', () => {
  expect(() => loadMap('nope')).toThrow()
})
