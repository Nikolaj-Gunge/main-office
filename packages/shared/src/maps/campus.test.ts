import { beforeAll, describe, expect, test } from 'bun:test'
import { createPhysicsWorld, initPhysics } from '../physics/world.ts'
import { buildCampus } from './campus.ts'
import { describeMapRules } from './map-test-kit.ts'
import { findSpawnPoints } from './spawn-points.ts'

const map = buildCampus()
const UP = 4.5

describeMapRules({
  map,
  bounds: { x0: -50, x1: 50, z0: -35, z1: 35, yMax: 10 },
  levels: [0, UP],
  minPoints: { 0: 1500, [UP]: 400 },
  routes: [
    {
      name: 'atrium grand stairs',
      start: [-10, 0, -20],
      yawDeg: 0,
      seconds: 4,
      level: UP,
      arrived: (p) => p.z < -28.5,
    },
    {
      name: 'west exterior stairs to the balcony',
      start: [-42.5, 0, -4],
      yawDeg: 0,
      seconds: 4,
      level: UP,
      arrived: (p) => p.z < -12.8 && p.z > -15,
    },
    {
      name: "B's exterior stairs to the roof terrace",
      start: [41.5, 0, 10],
      yawDeg: 0,
      seconds: 4,
      level: UP,
      arrived: (p) => p.z < 1.5 && p.x > 22,
    },
    {
      name: 'bridge from A to B',
      start: [6, UP, -24.5],
      yawDeg: -90,
      seconds: 4,
      level: UP,
      arrived: (p) => p.x > 23,
    },
  ],
})

describe('campus layout', () => {
  beforeAll(async () => {
    await initPhysics()
  })

  test('upper spawn points only on A, the balcony, the bridge and B roof', () => {
    const points = findSpawnPoints(map, createPhysicsWorld(map))
    for (const p of points) {
      if (p[1] !== UP) continue
      const [x, , z] = p
      const inA = x > -40 && x < 10 && z < -15
      const balcony = x > -44 && x < -18 && z > -15 && z < -12.5
      const bridge = x >= 10 && x <= 22 && z > -26 && z < -23
      const roofB = x > 22 && x < 45 && z > -28 && z < 2.3
      expect({ point: p, ok: inA || balcony || bridge || roofB }).toEqual({ point: p, ok: true })
    }
  })

  test('colliding box count stays reasonable', () => {
    expect(map.boxes.filter((b) => b.collide !== false).length).toBeLessThan(600)
  })
})
