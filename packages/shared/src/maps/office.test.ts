import { beforeAll, describe, expect, test } from 'bun:test'
import { TICK_DT } from '../constants.ts'
import { createPhysicsWorld, initPhysics } from '../physics/world.ts'
import { Button, type PlayerInput } from '../sim/input.ts'
import { DEFAULT_MOVEMENT } from '../sim/movement-config.ts'
import { AUTO_PICKUP_RADIUS } from '../sim/pickups.ts'
import { createPlayerState, PlayerBody, type PlayerState, stepPlayer } from '../sim/player.ts'
import { buildOffice } from './office.ts'
import { findSpawnPoints } from './spawn-points.ts'

const map = buildOffice()
const UP = 4.5

beforeAll(async () => {
  await initPhysics()
})

function spawnAt(pos: [number, number, number], yawDeg = 0) {
  const body = new PlayerBody(createPhysicsWorld(map), { ...DEFAULT_MOVEMENT })
  const state = createPlayerState({ pos, yaw: (yawDeg * Math.PI) / 180 })
  return { body, state }
}

function run(s: PlayerState, body: PlayerBody, seconds: number, input: (t: number) => PlayerInput) {
  for (let t = 0; t < Math.round(seconds / TICK_DT); t++) stepPlayer(s, input(t), TICK_DT, body)
}

describe('office map', () => {
  test('every spawn is free and on solid floor', () => {
    for (const spawn of map.spawns) {
      const { body, state } = spawnAt([...spawn.pos])
      expect(body.fits(state.pos, DEFAULT_MOVEMENT.standHeight)).toBe(true)
      run(state, body, 1, () => ({ buttons: 0, yaw: spawn.yaw, pitch: 0 }))
      expect(state.grounded).toBe(true)
      expect(Math.abs(state.pos.y - spawn.pos[1])).toBeLessThan(0.15)
    }
  })

  test('has 12–16 spawns on both floors', () => {
    expect(map.spawns.length).toBeGreaterThanOrEqual(12)
    expect(map.spawns.length).toBeLessThanOrEqual(16)
    expect(map.spawns.some((s) => s.pos[1] >= UP)).toBe(true)
    expect(map.spawns.some((s) => s.pos[1] === 0)).toBe(true)
  })

  const routes: [string, [number, number, number], number][] = [
    ['grand stairs', [0, 0, 1.5], -6.5],
    ['east stairs', [27.9, 0, 1.5], -6.5],
    ['west stairwell', [-28, 0, -6.8], -14],
  ]
  for (const [name, start, reachZ] of routes) {
    test(`${name} lead up to the gallery`, () => {
      const { body, state } = spawnAt(start)
      run(state, body, 4, () => ({ buttons: Button.Forward, yaw: 0, pitch: 0 }))
      expect(state.pos.y).toBeCloseTo(UP, 1)
      expect(state.pos.z).toBeLessThan(reachZ)
    })
  }

  test('random play from every spawn stays inside the building', () => {
    let seed = 7
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 4294967296
    }
    for (const spawn of map.spawns) {
      const { body, state } = spawnAt([...spawn.pos], (spawn.yaw * 180) / Math.PI)
      let buttons = 0
      let yaw = spawn.yaw
      for (let t = 0; t < Math.round(15 / TICK_DT); t++) {
        if (rand() < 0.05) buttons = Math.floor(rand() * 128)
        yaw += (rand() - 0.5) * 0.2
        stepPlayer(state, { buttons, yaw, pitch: 0 }, TICK_DT, body)
        const p = state.pos
        expect(Number.isFinite(p.x + p.y + p.z)).toBe(true)
        expect(p.y).toBeGreaterThan(-0.1)
        expect(p.y).toBeLessThan(9)
        expect(Math.abs(p.x)).toBeLessThan(30)
        expect(Math.abs(p.z)).toBeLessThan(20)
      }
    }
  })

  test('random spawn points cover both floors, never on furniture or outside', () => {
    const points = findSpawnPoints(map, createPhysicsWorld(map))
    expect(points.length).toBeGreaterThan(300)
    const upper = points.filter((p) => p[1] === UP).length
    expect(upper).toBeGreaterThan(60)
    expect(points.length - upper).toBeGreaterThan(200)
    for (const p of points) {
      expect(Math.abs(p[0])).toBeLessThan(30)
      expect(Math.abs(p[2])).toBeLessThan(20)
    }
    // Upper-floor points only over the north wing (the hall below is open to the roof).
    for (const p of points) if (p[1] === UP) expect(p[2]).toBeLessThan(-6)
    // Spot-check: every point lets a player stand there and stay put.
    for (const p of points.filter((_, i) => i % 15 === 0)) {
      const { body, state } = spawnAt([p[0], p[1], p[2]])
      run(state, body, 0.5, () => ({ buttons: 0, yaw: 0, pitch: 0 }))
      expect(state.grounded).toBe(true)
      expect(Math.abs(state.pos.y - p[1])).toBeLessThan(0.1)
    }
  })

  test('every weapon can be picked up by walking over it (a player fits within reach)', () => {
    const physics = createPhysicsWorld(map)
    const probe = new PlayerBody(physics, { ...DEFAULT_MOVEMENT })
    for (const p of map.pickups ?? []) {
      // Floor the player would stand on: the highest level at or below the weapon.
      const floor = p.pos[1] >= UP - 0.01 ? UP : 0
      let reachable = false
      for (let r = 0; r <= AUTO_PICKUP_RADIUS - 0.05 && !reachable; r += 0.15) {
        for (let a = 0; a < Math.PI * 2 && !reachable; a += Math.PI / 8) {
          const x = p.pos[0] + Math.cos(a) * r
          const z = p.pos[2] + Math.sin(a) * r
          reachable = probe.fits({ x, y: floor, z }, DEFAULT_MOVEMENT.standHeight)
        }
      }
      expect({ pickup: p.pos, reachable }).toEqual({ pickup: p.pos, reachable: true })
    }
  })

  test('weapon pickups lie on surfaces inside the building', () => {
    expect(map.pickups?.length).toBeGreaterThanOrEqual(6)
    for (const p of map.pickups ?? []) {
      expect([1, 2]).toContain(p.weapon)
      expect(Math.abs(p.pos[0])).toBeLessThan(30)
      expect(Math.abs(p.pos[2])).toBeLessThan(20)
    }
  })
})
