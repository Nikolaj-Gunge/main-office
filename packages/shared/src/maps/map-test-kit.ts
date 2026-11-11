import { beforeAll, describe, expect, test } from 'bun:test'
import { TICK_DT } from '../constants.ts'
import { createPhysicsWorld, initPhysics } from '../physics/world.ts'
import { Button, type PlayerInput } from '../sim/input.ts'
import { DEFAULT_MOVEMENT } from '../sim/movement-config.ts'
import { AUTO_PICKUP_RADIUS } from '../sim/pickups.ts'
import { createPlayerState, PlayerBody, type PlayerState, stepPlayer } from '../sim/player.ts'
import { findSpawnPoints } from './spawn-points.ts'
import type { MapDef, MaterialId, Vec3 } from './types.ts'

/**
 * Shared playability rules for big maps (ported from office.test.ts): spawns, bounds, random
 * spawn points, sealed rooms, ways up and weapon pickups. Each map's test calls
 * `describeMapRules` with its own bounds, levels and routes.
 */
export interface MapRules {
  map: MapDef
  /** Playable area (x/z, inclusive of walls) and the highest a player may ever get. */
  bounds: { x0: number; x1: number; z0: number; z1: number; yMax: number }
  /** Every floor height that has fixed spawns, lowest first. */
  levels: number[]
  /** Minimum random spawn points per level. */
  minPoints: Record<number, number>
  /** Walk forward (yaw in degrees, 0 = -Z) from `start` and arrive at `level` where `arrived` says. */
  routes: {
    name: string
    start: Vec3
    yawDeg: number
    seconds: number
    level: number
    arrived: (pos: { x: number; y: number; z: number }) => boolean
  }[]
}

/** Things nobody should spawn on top of. */
const FURNITURE = new Set<MaterialId>([
  'desk',
  'fabric',
  'fabricAlt',
  'plant',
  'screen',
  'wood',
  'cover',
  'accent',
  'marker',
  'rack',
  'whiteboard',
  'glass',
  'ramp',
  'target',
])

function runFor(
  s: PlayerState,
  body: PlayerBody,
  seconds: number,
  input: (t: number) => PlayerInput,
) {
  for (let t = 0; t < Math.round(seconds / TICK_DT); t++) stepPlayer(s, input(t), TICK_DT, body)
}

export function describeMapRules(rules: MapRules) {
  const { map, bounds, levels } = rules

  function spawnAt(pos: Vec3, yawDeg = 0) {
    const body = new PlayerBody(createPhysicsWorld(map), { ...DEFAULT_MOVEMENT })
    const state = createPlayerState({ pos: [...pos], yaw: (yawDeg * Math.PI) / 180 })
    return { body, state }
  }
  const inside = (x: number, z: number) =>
    x > bounds.x0 && x < bounds.x1 && z > bounds.z0 && z < bounds.z1
  /** The floor a player would stand on: the highest level at or below `y`. */
  const floorBelow = (y: number) => levels.filter((l) => l <= y + 0.01).at(-1) ?? 0

  describe(`${map.name} map rules`, () => {
    beforeAll(async () => {
      await initPhysics()
    })

    test('fixed spawns stand on every level', () => {
      const heights = [...new Set(map.spawns.map((s) => s.pos[1]))].sort((a, b) => a - b)
      expect(heights).toEqual(levels)
    })

    test('every fixed spawn is free and on solid floor', () => {
      for (const spawn of map.spawns) {
        const { body, state } = spawnAt(spawn.pos)
        expect({
          spawn: spawn.pos,
          fits: body.fits(state.pos, DEFAULT_MOVEMENT.standHeight),
        }).toEqual({ spawn: spawn.pos, fits: true })
        runFor(state, body, 1, () => ({ buttons: 0, yaw: spawn.yaw, pitch: 0 }))
        expect(state.grounded).toBe(true)
        expect(Math.abs(state.pos.y - spawn.pos[1])).toBeLessThan(0.15)
      }
    })

    for (const route of rules.routes) {
      test(`${route.name} lead up`, () => {
        const { body, state } = spawnAt(route.start, route.yawDeg)
        const yaw = (route.yawDeg * Math.PI) / 180
        runFor(state, body, route.seconds, () => ({ buttons: Button.Forward, yaw, pitch: 0 }))
        expect(state.pos.y).toBeCloseTo(route.level, 1)
        expect({ route: route.name, arrived: route.arrived(state.pos) }).toEqual({
          route: route.name,
          arrived: true,
        })
      })
    }

    test('random play from every spawn stays inside the map', () => {
      let seed = 7
      const rand = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        return seed / 4294967296
      }
      for (const spawn of map.spawns) {
        const { body, state } = spawnAt(spawn.pos, (spawn.yaw * 180) / Math.PI)
        let buttons = 0
        let yaw = spawn.yaw
        for (let t = 0; t < Math.round(15 / TICK_DT); t++) {
          if (rand() < 0.05) buttons = Math.floor(rand() * 128)
          yaw += (rand() - 0.5) * 0.2
          stepPlayer(state, { buttons, yaw, pitch: 0 }, TICK_DT, body)
          const p = state.pos
          expect(Number.isFinite(p.x + p.y + p.z)).toBe(true)
          expect(p.y).toBeGreaterThan(-0.1)
          expect(p.y).toBeLessThan(bounds.yMax)
          expect(inside(p.x, p.z)).toBe(true)
        }
      }
    })

    test('random spawn points cover every level, never on furniture or outside', () => {
      const physics = createPhysicsWorld(map)
      const points = findSpawnPoints(map, physics)
      for (const level of levels) {
        const count = points.filter((p) => p[1] === level).length
        expect({ level, enough: count >= (rules.minPoints[level] ?? 1) }).toEqual({
          level,
          enough: true,
        })
      }
      const solidBoxes = map.boxes.filter((b) => b.collide !== false && !b.rotation)
      for (const p of points) {
        expect(inside(p[0], p[2])).toBe(true)
        // What the point stands on: a floor, deck or stair, not a desk, crate or car.
        const support = solidBoxes.filter(
          (b) =>
            Math.abs(b.center[1] + b.size[1] / 2 - p[1]) < 0.03 &&
            Math.abs(p[0] - b.center[0]) <= b.size[0] / 2 &&
            Math.abs(p[2] - b.center[2]) <= b.size[2] / 2,
        )
        expect(support.length).toBeGreaterThan(0)
        const furniture = support.filter((b) => FURNITURE.has(b.material)).map((b) => b.material)
        expect({ point: p, furniture }).toEqual({ point: p, furniture: [] })
      }
      // Spot-check: every point lets a player stand there and stay put.
      for (const p of points.filter((_, i) => i % 25 === 0)) {
        const { body, state } = spawnAt(p)
        runFor(state, body, 0.5, () => ({ buttons: 0, yaw: 0, pitch: 0 }))
        expect(state.grounded).toBe(true)
        expect(Math.abs(state.pos.y - p[1])).toBeLessThan(0.1)
      }
    })

    test('every random spawn point can walk out to the rest of its floor (no sealed rooms)', () => {
      const physics = createPhysicsWorld(map)
      const probe = new PlayerBody(physics, { ...DEFAULT_MOVEMENT })
      const points = findSpawnPoints(map, physics)
      // Flood fill a fine grid of spots a player fits in; cells 0.25 m apart can't have a wall
      // between them, so neighbouring free cells are walkable to each other.
      const step = 0.25
      const nx = Math.round((bounds.x1 - bounds.x0) / step) + 1
      const nz = Math.round((bounds.z1 - bounds.z0) / step) + 1
      for (const y of levels) {
        const free = new Uint8Array(nx * nz)
        for (let i = 0; i < nx; i++) {
          for (let k = 0; k < nz; k++) {
            const pos = { x: bounds.x0 + i * step, y, z: bounds.z0 + k * step }
            free[i * nz + k] = probe.fits(pos, DEFAULT_MOVEMENT.standHeight) ? 1 : 0
          }
        }
        // Label connected regions; the biggest is the floor everyone shares.
        const region = new Int32Array(nx * nz).fill(-1)
        const sizes: number[] = []
        for (let start = 0; start < free.length; start++) {
          if (!free[start] || region[start] !== -1) continue
          const id = sizes.length
          let size = 0
          const stack = [start]
          region[start] = id
          while (stack.length > 0) {
            const c = stack.pop() ?? 0
            size++
            const i = Math.floor(c / nz)
            const k = c % nz
            for (const [di, dk] of [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ] as const) {
              const ni = i + di
              const nk = k + dk
              if (ni < 0 || nk < 0 || ni >= nx || nk >= nz) continue
              const n = ni * nz + nk
              if (free[n] && region[n] === -1) {
                region[n] = id
                stack.push(n)
              }
            }
          }
          sizes.push(size)
        }
        const main = sizes.indexOf(Math.max(...sizes))
        const sealed = points
          .filter((p) => p[1] === y)
          .filter((p) => {
            const c =
              Math.round((p[0] - bounds.x0) / step) * nz + Math.round((p[2] - bounds.z0) / step)
            return region[c] !== main
          })
        expect({ floor: y, sealed }).toEqual({ floor: y, sealed: [] })
      }
      probe.free()
    })

    test('every weapon can be picked up by walking over it (a player fits within reach)', () => {
      const physics = createPhysicsWorld(map)
      const probe = new PlayerBody(physics, { ...DEFAULT_MOVEMENT })
      for (const p of map.pickups ?? []) {
        const floor = floorBelow(p.pos[1])
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
      probe.free()
    })

    test('8–12 weapon pickups (rifles and snipers) lie inside the map', () => {
      const pickups = map.pickups ?? []
      expect(pickups.length).toBeGreaterThanOrEqual(8)
      expect(pickups.length).toBeLessThanOrEqual(12)
      expect(pickups.some((p) => p.weapon === 2)).toBe(true)
      for (const p of pickups) {
        expect([1, 2, 3]).toContain(p.weapon)
        expect(inside(p.pos[0], p.pos[2])).toBe(true)
        expect(p.pos[1]).toBeGreaterThanOrEqual(0)
        expect(p.pos[1]).toBeLessThan(bounds.yMax)
      }
    })
  })
}
