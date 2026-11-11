import { beforeAll, describe, expect, test } from 'bun:test'
import { createPhysicsWorld, initPhysics } from '../physics/world.ts'
import { describeMapRules } from './map-test-kit.ts'
import { findSpawnPoints } from './spawn-points.ts'
import { buildWarehouse } from './warehouse.ts'

const map = buildWarehouse()
const UP = 4.5
const DOCK = 1.25

describeMapRules({
  map,
  bounds: { x0: -45, x1: 45, z0: -30, z1: 30, yMax: 12 },
  levels: [0, DOCK, UP],
  minPoints: { 0: 900, [DOCK]: 100, [UP]: 200 },
  routes: [
    {
      name: 'west ramp',
      start: [-43.5, 0, 14],
      yawDeg: 0,
      seconds: 4,
      level: UP,
      arrived: (p) => p.z < 1.5 && p.x < -38,
    },
    {
      name: 'east stairs',
      start: [37.5, 0, 29],
      yawDeg: 0,
      seconds: 4,
      level: UP,
      arrived: (p) => p.z < 21.5 && p.x > 35,
    },
    {
      name: 'office stairwell',
      start: [43.25, 0, -13],
      yawDeg: 0,
      seconds: 4,
      level: UP,
      arrived: (p) => p.z < -22 && p.x > 41.5,
    },
    {
      name: 'west dock ramp',
      start: [-32, 0, -16],
      yawDeg: 0,
      seconds: 3,
      level: DOCK,
      arrived: (p) => p.z < -23.5,
    },
    {
      name: 'east dock ramp',
      start: [8, 0, -16],
      yawDeg: 0,
      seconds: 3,
      level: DOCK,
      arrived: (p) => p.z < -23.5,
    },
    {
      name: 'dock stairs',
      start: [-9.5, 0, -19],
      yawDeg: 0,
      seconds: 3,
      level: DOCK,
      arrived: (p) => p.z < -23.5,
    },
    {
      name: 'catwalk (west platform to east mezzanine)',
      start: [-41, UP, -14],
      yawDeg: -90,
      seconds: 16,
      level: UP,
      arrived: (p) => p.x > 36,
    },
  ],
})

describe('warehouse layout', () => {
  beforeAll(async () => {
    await initPhysics()
  })

  test('dock and mezzanine spawn points only where those levels are', () => {
    const points = findSpawnPoints(map, createPhysicsWorld(map))
    for (const p of points) {
      if (p[1] === DOCK) {
        expect(p[2]).toBeLessThan(-22.5)
        expect(p[0]).toBeLessThan(20)
      }
      if (p[1] === UP) {
        // West platform, catwalk, east mezzanine or the office block's upper floor.
        const ok = p[0] < -38 || (p[2] > -15 && p[2] < -13) || p[0] > 28
        expect({ point: p, ok }).toEqual({ point: p, ok: true })
      }
    }
  })

  test('colliding box count stays reasonable', () => {
    expect(map.boxes.filter((b) => b.collide !== false).length).toBeLessThan(600)
  })
})
