import { TICK_DT } from '../constants.ts'
import { createPhysicsWorld, type PhysicsWorld } from '../physics/world.ts'
import type { PlayerInput } from '../sim/input.ts'
import { DEFAULT_MOVEMENT } from '../sim/movement-config.ts'
import { AUTO_PICKUP_RADIUS } from '../sim/pickups.ts'
import { createPlayerState, PlayerBody, type PlayerState, stepPlayer } from '../sim/player.ts'
import type { MapDef, Vec3 } from './types.ts'

/**
 * Shared checks for map tests (spawns, reachability, sealed rooms). Test-only helpers: call
 * `initPhysics()` first.
 */

export function spawnAt(map: MapDef, pos: [number, number, number], yawDeg = 0) {
  const body = new PlayerBody(createPhysicsWorld(map), { ...DEFAULT_MOVEMENT })
  const state = createPlayerState({ pos, yaw: (yawDeg * Math.PI) / 180 })
  return { body, state }
}

export function runPlayer(
  s: PlayerState,
  body: PlayerBody,
  seconds: number,
  input: (t: number) => PlayerInput,
) {
  for (let t = 0; t < Math.round(seconds / TICK_DT); t++) stepPlayer(s, input(t), TICK_DT, body)
}

/** Floor heights in use: the distinct heights the fixed spawns stand on, lowest first. */
export function floorHeights(map: MapDef): number[] {
  return [...new Set(map.spawns.map((s) => s.pos[1]))].sort((a, b) => a - b)
}

/**
 * Random spawn points on `y` that can't walk to the biggest connected free region of that floor
 * (rooms nobody can get in or out of). Flood fills a fine grid of spots a standing player fits
 * in; cells 0.25 m apart can't have a wall between them, so free neighbours connect.
 */
export function sealedPoints(
  physics: PhysicsWorld,
  points: Vec3[],
  y: number,
  min: [number, number],
  max: [number, number],
): Vec3[] {
  const probe = new PlayerBody(physics, { ...DEFAULT_MOVEMENT })
  const step = 0.25
  const nx = Math.round((max[0] - min[0]) / step) + 1
  const nz = Math.round((max[1] - min[1]) / step) + 1
  const free = new Uint8Array(nx * nz)
  for (let i = 0; i < nx; i++) {
    for (let k = 0; k < nz; k++) {
      const pos = { x: min[0] + i * step, y, z: min[1] + k * step }
      free[i * nz + k] = probe.fits(pos, DEFAULT_MOVEMENT.standHeight) ? 1 : 0
    }
  }
  probe.free()
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
  return points
    .filter((p) => p[1] === y)
    .filter((p) => {
      const i = Math.round((p[0] - min[0]) / step)
      const k = Math.round((p[2] - min[1]) / step)
      return region[i * nz + k] !== main
    })
}

/**
 * Can a player standing on `floor` get within auto-pickup reach of a weapon at `pos`? Checks
 * whether a standing capsule fits anywhere inside the pickup radius.
 */
export function pickupReachable(physics: PhysicsWorld, pos: Vec3, floor: number): boolean {
  const probe = new PlayerBody(physics, { ...DEFAULT_MOVEMENT })
  try {
    for (let r = 0; r <= AUTO_PICKUP_RADIUS - 0.05; r += 0.15) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const x = pos[0] + Math.cos(a) * r
        const z = pos[2] + Math.sin(a) * r
        if (probe.fits({ x, y: floor, z }, DEFAULT_MOVEMENT.standHeight)) return true
      }
    }
    return false
  } finally {
    probe.free()
  }
}

/** Deterministic random play: 15 s of mashed buttons and wandering yaw, reporting each tick. */
export function randomPlay(
  map: MapDef,
  seed: number,
  seconds: number,
  onTick: (pos: { x: number; y: number; z: number }) => void,
) {
  let s = seed
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
  for (const spawn of map.spawns) {
    const { body, state } = spawnAt(map, [...spawn.pos], (spawn.yaw * 180) / Math.PI)
    let buttons = 0
    let yaw = spawn.yaw
    for (let t = 0; t < Math.round(seconds / TICK_DT); t++) {
      if (rand() < 0.05) buttons = Math.floor(rand() * 128)
      yaw += (rand() - 0.5) * 0.2
      stepPlayer(state, { buttons, yaw, pitch: 0 }, TICK_DT, body)
      onTick(state.pos)
    }
  }
}
