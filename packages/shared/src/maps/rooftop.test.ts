import { beforeAll, describe, expect, test } from 'bun:test'
import { createPhysicsWorld, initPhysics } from '../physics/world.ts'
import { Button } from '../sim/input.ts'
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
import { buildRooftop } from './rooftop.ts'
import { findSpawnPoints } from './spawn-points.ts'

const map = buildRooftop()
const HALF = 15
const DECK = 3

beforeAll(async () => {
  await initPhysics()
})

describe('rooftop map', () => {
  test('every spawn is free and on solid floor', () => {
    for (const spawn of map.spawns) {
      const { body, state } = spawnAt(map, [...spawn.pos])
      expect(body.fits(state.pos, DEFAULT_MOVEMENT.standHeight)).toBe(true)
      runPlayer(state, body, 1, () => ({ buttons: 0, yaw: spawn.yaw, pitch: 0 }))
      expect(state.grounded).toBe(true)
      expect(Math.abs(state.pos.y - spawn.pos[1])).toBeLessThan(0.15)
    }
  })

  test('fixed spawns on the roof and on the water tank deck', () => {
    expect(floorHeights(map)).toEqual([0, DECK])
    expect(map.spawns.length).toBeGreaterThanOrEqual(6)
    expect(map.spawns.length).toBeLessThanOrEqual(12)
  })

  test('the water tank stairs lead up to the deck', () => {
    const { body, state } = spawnAt(map, [-7.3, 0, 14.4])
    runPlayer(state, body, 4, () => ({ buttons: Button.Forward, yaw: 0, pitch: 0 }))
    expect(state.pos.y).toBeCloseTo(DECK, 1)
    expect(state.pos.z).toBeLessThan(10.4)
    expect(state.grounded).toBe(true)
  })

  test('random play from every spawn stays on the roof (nobody falls off)', () => {
    randomPlay(map, 7, 15, (p) => {
      expect(Number.isFinite(p.x + p.y + p.z)).toBe(true)
      expect(p.y).toBeGreaterThan(-0.1)
      expect(p.y).toBeLessThan(6)
      expect(Math.abs(p.x)).toBeLessThan(HALF)
      expect(Math.abs(p.z)).toBeLessThan(HALF)
    })
  })

  test('random spawn points cover the roof and the deck, never on furniture or outside', () => {
    const points = findSpawnPoints(map, createPhysicsWorld(map))
    const deck = points.filter((p) => p[1] === DECK)
    const roof = points.filter((p) => p[1] === 0)
    expect(roof.length).toBeGreaterThan(150)
    expect(deck.length).toBeGreaterThanOrEqual(4)
    expect(roof.length + deck.length).toBe(points.length)
    for (const p of points) {
      expect(Math.abs(p[0])).toBeLessThan(HALF)
      expect(Math.abs(p[2])).toBeLessThan(HALF)
    }
    // Deck points only on the deck (x -13..-6, z 3.5..10.5).
    for (const p of deck) {
      expect(p[0]).toBeGreaterThan(-13)
      expect(p[0]).toBeLessThan(-6)
      expect(p[2]).toBeGreaterThan(3.5)
      expect(p[2]).toBeLessThan(10.5)
    }
    // Some inside the stairwell hut (x -13.5..-9, z -13.5..-9).
    expect(roof.some((p) => p[0] < -9 && p[2] < -9 && p[0] > -13.5 && p[2] > -13.5)).toBe(true)
    // Spot-check: every point lets a player stand there and stay put.
    for (const p of points.filter((_, i) => i % 6 === 0)) {
      const { body, state } = spawnAt(map, [p[0], p[1], p[2]])
      runPlayer(state, body, 0.5, () => ({ buttons: 0, yaw: 0, pitch: 0 }))
      expect(state.grounded).toBe(true)
      expect(Math.abs(state.pos.y - p[1])).toBeLessThan(0.1)
    }
  })

  test('every random spawn point can walk out to the rest of its floor (no sealed spots)', () => {
    const physics = createPhysicsWorld(map)
    const points = findSpawnPoints(map, physics)
    for (const y of [0, DECK]) {
      const sealed = sealedPoints(physics, points, y, [-HALF, -HALF], [HALF, HALF])
      expect({ floor: y, sealed }).toEqual({ floor: y, sealed: [] })
    }
  })

  test('every weapon can be picked up by walking over it (a player fits within reach)', () => {
    const physics = createPhysicsWorld(map)
    for (const p of map.pickups ?? []) {
      const floor = p.pos[1] >= DECK - 0.01 ? DECK : 0
      expect({ pickup: p.pos, reachable: pickupReachable(physics, p.pos, floor) }).toEqual({
        pickup: p.pos,
        reachable: true,
      })
    }
  })

  test('5–8 weapon pickups on the roof, at most one sniper', () => {
    const pickups = map.pickups ?? []
    expect(pickups.length).toBeGreaterThanOrEqual(5)
    expect(pickups.length).toBeLessThanOrEqual(8)
    expect(pickups.filter((p) => p.weapon === 2).length).toBeLessThanOrEqual(1)
    for (const p of pickups) {
      expect(PRIMARY_WEAPONS as readonly number[]).toContain(p.weapon)
      expect(Math.abs(p.pos[0])).toBeLessThan(HALF)
      expect(Math.abs(p.pos[2])).toBeLessThan(HALF)
    }
  })
})
