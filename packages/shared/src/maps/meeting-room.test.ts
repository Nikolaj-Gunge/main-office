import { beforeAll, describe, expect, test } from 'bun:test'
import { createPhysicsWorld, initPhysics } from '../physics/world.ts'
import { DEFAULT_MOVEMENT } from '../sim/movement-config.ts'
import { PRIMARY_WEAPONS } from '../sim/weapons.ts'
import {
  floorHeights,
  pickupReachable,
  randomPlay,
  runPlayer,
  sealedPoints,
  spawnAt,
} from './map-checks.ts'
import { buildMeetingRoom } from './meeting-room.ts'
import { findSpawnPoints } from './spawn-points.ts'

const map = buildMeetingRoom()
const HALF_X = 12
const HALF_Z = 9
const CEIL = 3

beforeAll(async () => {
  await initPhysics()
})

describe('meeting room map', () => {
  test('every spawn is free and on solid floor', () => {
    for (const spawn of map.spawns) {
      const { body, state } = spawnAt(map, [...spawn.pos])
      expect(body.fits(state.pos, DEFAULT_MOVEMENT.standHeight)).toBe(true)
      runPlayer(state, body, 1, () => ({ buttons: 0, yaw: spawn.yaw, pitch: 0 }))
      expect(state.grounded).toBe(true)
      expect(Math.abs(state.pos.y - spawn.pos[1])).toBeLessThan(0.15)
    }
  })

  test('one floor, 6–10 fixed spawns', () => {
    expect(floorHeights(map)).toEqual([0])
    expect(map.spawns.length).toBeGreaterThanOrEqual(6)
    expect(map.spawns.length).toBeLessThanOrEqual(10)
  })

  test('random play from every spawn stays inside the walls', () => {
    randomPlay(map, 7, 15, (p) => {
      expect(Number.isFinite(p.x + p.y + p.z)).toBe(true)
      expect(p.y).toBeGreaterThan(-0.1)
      expect(p.y).toBeLessThan(CEIL)
      expect(Math.abs(p.x)).toBeLessThan(HALF_X)
      expect(Math.abs(p.z)).toBeLessThan(HALF_Z)
    })
  })

  test('random spawn points cover the floor, never on furniture or outside', () => {
    const points = findSpawnPoints(map, createPhysicsWorld(map))
    expect(points.length).toBeGreaterThan(50)
    for (const p of points) {
      expect(p[1]).toBe(0)
      expect(Math.abs(p[0])).toBeLessThan(HALF_X)
      expect(Math.abs(p[2])).toBeLessThan(HALF_Z)
    }
    // Every room gets some: boardroom, glass room, kitchenette, and the hallway ring.
    const inside = (x0: number, z0: number, x1: number, z1: number) =>
      points.filter((p) => p[0] > x0 && p[0] < x1 && p[2] > z0 && p[2] < z1).length
    expect(inside(-9.5, -6.5, 3.5, 5.5)).toBeGreaterThan(10)
    expect(inside(3.5, -6.5, 9.5, 1.5)).toBeGreaterThan(3)
    expect(inside(3.5, 1.5, 9.5, 5.5)).toBeGreaterThan(0)
    expect(inside(-12, -9, 12, -6.5)).toBeGreaterThan(5)
    expect(inside(-12, 5.5, 12, 9)).toBeGreaterThan(5)
    // Spot-check: every point lets a player stand there and stay put.
    for (const p of points.filter((_, i) => i % 5 === 0)) {
      const { body, state } = spawnAt(map, [p[0], p[1], p[2]])
      runPlayer(state, body, 0.5, () => ({ buttons: 0, yaw: 0, pitch: 0 }))
      expect(state.grounded).toBe(true)
      expect(Math.abs(state.pos.y - p[1])).toBeLessThan(0.1)
    }
  })

  test('every random spawn point can walk out to the rest of the floor (no sealed rooms)', () => {
    const physics = createPhysicsWorld(map)
    const points = findSpawnPoints(map, physics)
    const sealed = sealedPoints(physics, points, 0, [-HALF_X, -HALF_Z], [HALF_X, HALF_Z])
    expect({ floor: 0, sealed }).toEqual({ floor: 0, sealed: [] })
  })

  test('every weapon can be picked up by walking over it (a player fits within reach)', () => {
    const physics = createPhysicsWorld(map)
    for (const p of map.pickups ?? []) {
      expect({ pickup: p.pos, reachable: pickupReachable(physics, p.pos, 0) }).toEqual({
        pickup: p.pos,
        reachable: true,
      })
    }
  })

  test('5–8 weapon pickups inside the walls, at most one sniper', () => {
    const pickups = map.pickups ?? []
    expect(pickups.length).toBeGreaterThanOrEqual(5)
    expect(pickups.length).toBeLessThanOrEqual(8)
    expect(pickups.filter((p) => p.weapon === 2).length).toBeLessThanOrEqual(1)
    for (const p of pickups) {
      expect(PRIMARY_WEAPONS as readonly number[]).toContain(p.weapon)
      expect(Math.abs(p.pos[0])).toBeLessThan(HALF_X)
      expect(Math.abs(p.pos[2])).toBeLessThan(HALF_Z)
      expect(p.pos[1]).toBeGreaterThanOrEqual(0)
      expect(p.pos[1]).toBeLessThan(1.3)
    }
  })
})
