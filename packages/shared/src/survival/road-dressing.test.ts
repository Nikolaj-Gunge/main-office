import { describe, expect, test } from 'bun:test'
import type { MapBox } from '../maps/types.ts'
import { emptyBuild } from './kit.ts'
import { dressRoads, RoadGrid } from './road-dressing.ts'
import { heightAt } from './terrain.ts'
import { buildDeadwood } from './world.ts'

const map = buildDeadwood()
const def = map.survival
if (!def) throw new Error('Deadwood has no survival world')
const roads = new RoadGrid(def.roads)
const world = {
  roads: def.roads,
  pois: def.pois,
  lakes: def.lakes,
  groundAt: (x: number, z: number) => heightAt(def.terrain, x, z),
}

const isLampPost = (b: MapBox) => b.material === 'metal' && b.size[1] === 6.6
const isPowerPole = (b: MapBox) => b.material === 'log' && b.size[1] === 8.2
/** Drums the dressing left on the verge (places have drums of their own, further in). */
const isRoadsideDrum = (b: MapBox) =>
  b.material === 'rust' &&
  b.size[1] === 0.9 &&
  b.size[0] === 0.6 &&
  roads.edgeDistance(b.center[0], b.center[2]) < 2.5
const streetLights = (map.lights ?? []).filter((l) => l.distance === 24)

describe('road dressing', () => {
  test('streetlamps line the paved roads: most dead, some lit, a few flickering', () => {
    const posts = map.boxes.filter(isLampPost)
    expect(posts.length).toBeGreaterThan(40)
    expect(streetLights.length).toBeGreaterThan(15)
    expect(streetLights.length).toBeLessThan(posts.length)
    expect(streetLights.some((l) => l.flicker)).toBe(true)
    expect(streetLights.some((l) => !l.flicker)).toBe(true)
    // Every post stands beside an asphalt road.
    for (const b of posts) {
      const near = roads.nearest(b.center[0], b.center[2])
      expect(near?.road.kind).toBe('asphalt')
    }
    // Night lights only the nearest few; the whole list must stay cheap to scan.
    expect(map.lights?.length ?? 0).toBeLessThan(400)
  })

  test('posts, poles and drums are solid and stand off the road, outside buildings', () => {
    const solid = map.boxes.filter(
      (b) => b.collide !== false && (isLampPost(b) || isPowerPole(b) || isRoadsideDrum(b)),
    )
    expect(map.boxes.filter(isPowerPole).length).toBeGreaterThan(100)
    for (const b of solid) {
      const half = Math.max(b.size[0], b.size[2]) / 2
      expect(roads.edgeDistance(b.center[0], b.center[2])).toBeGreaterThan(half)
      for (const room of def.rooms) {
        const inside =
          b.center[0] > room.min[0] &&
          b.center[0] < room.max[0] &&
          b.center[2] > room.min[1] &&
          b.center[2] < room.max[1]
        expect(inside).toBe(false)
      }
      // On the ground, not floating or buried.
      const ground = heightAt(def.terrain, b.center[0], b.center[2])
      expect(Math.abs(b.center[1] - b.size[1] / 2 - ground)).toBeLessThan(0.05)
    }
  })

  test('signs face the road, say where Haven is, and are off the road', () => {
    const signs = def.signs ?? []
    expect(signs.length).toBeGreaterThan(30)
    expect(signs.some((s) => s.kind === 'guide' && s.lines[0] === 'HAVEN')).toBe(true)
    for (const kind of ['speed', 'mile', 'warn', 'graffiti'] as const)
      expect(signs.some((s) => s.kind === kind)).toBe(true)
    for (const s of signs) {
      expect(Math.hypot(...s.facing)).toBeCloseTo(1, 5)
      expect(roads.edgeDistance(s.pos[0], s.pos[2])).toBeGreaterThan(0)
      expect(s.pos[1]).toBeGreaterThan(heightAt(def.terrain, s.pos[0], s.pos[2]) + 0.5)
    }
  })

  test('is the same every time it is built', () => {
    const a = emptyBuild()
    const b = emptyBuild()
    const signsA = dressRoads(a, world, def.seed)
    const signsB = dressRoads(b, world, def.seed)
    expect(a.boxes.length).toBeGreaterThan(1000)
    expect(JSON.stringify(a.boxes)).toBe(JSON.stringify(b.boxes))
    expect(JSON.stringify(a.lights)).toBe(JSON.stringify(b.lights))
    expect(JSON.stringify(signsA)).toBe(JSON.stringify(signsB))
  })
})
