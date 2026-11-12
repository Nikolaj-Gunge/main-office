import type { MapBuilder } from './builder.ts'
import type { CoopZone, MapSpawn, MaterialId, Vec3 } from './types.ts'

/** Shared bits for building co-op maps. */

/** Wall thickness (m). */
export const WALL = 0.4
/** Ramps climb at 20°: the run (m, level) that rises `rise` m. */
export const runFor = (rise: number) => rise / Math.tan((20 * Math.PI) / 180)

/** Weapon ids for pickups and armories (WeaponId; maps don't import the sim). */
export const RIFLE = 1
export const SNIPER = 2
export const SHOTGUN = 3
export const MP5 = 5
export const LMG = 7

export const DECO = { collide: false } as const

/** Area over x0…x1 × z0…z1 (any order), standing on the floor at `y`. */
export function zone(x0: number, z0: number, x1: number, z1: number, y = 0, h = 3): CoopZone {
  return {
    min: [Math.min(x0, x1), y, Math.min(z0, z1)],
    max: [Math.max(x0, x1), y + h, Math.max(z0, z1)],
  }
}

/** A square area `size` m across, centred on (x, z). */
export function spot(x: number, z: number, y = 0, size = 2.4): CoopZone {
  return zone(x - size / 2, z - size / 2, x + size / 2, z + size / 2, y)
}

/** Start spots in a row across x at `z`, facing north (−Z) — or `yaw` (radians). */
export function starts(z: number, xs: number[], y = 0, yaw = 0): MapSpawn[] {
  return xs.map((x) => ({ pos: [x, y, z] as Vec3, yaw }))
}

/**
 * A wall across the map at `z` (from x0 to x1, floor `y`, `height` tall) with a gate filling
 * the gap g0…g1 up to `gateHeight`, wall above it, and warning stripes on the floor both sides.
 */
export function gateAcross(
  m: MapBuilder,
  z: number,
  x0: number,
  x1: number,
  g0: number,
  g1: number,
  gate: number,
  y: number,
  height: number,
  gateHeight = 3,
  material: MaterialId = 'wall',
): void {
  const t = WALL / 2
  if (g0 > x0) m.span([x0, y, z - t], [g0, y + height, z + t], material)
  if (x1 > g1) m.span([g1, y, z - t], [x1, y + height, z + t], material)
  if (gateHeight < height) m.span([g0, y + gateHeight, z - t], [g1, y + height, z + t], material)
  gateDoor(m, z, g0, g1, gate, y, gateHeight)
}

/** Just the gate (and its floor stripes) across x g0…g1 at `z`. */
export function gateDoor(
  m: MapBuilder,
  z: number,
  g0: number,
  g1: number,
  gate: number,
  y: number,
  gateHeight = 3,
): void {
  m.span([g0, y, z - 0.15], [g1, y + gateHeight, z + 0.15], 'metal', { gate })
  m.span([g0, y, z + WALL / 2], [g1, y + 0.02, z + WALL / 2 + 0.3], 'marker', DECO)
  m.span([g0, y, z - WALL / 2 - 0.3], [g1, y + 0.02, z - WALL / 2], 'marker', DECO)
}

/** A wall along z at `x` (from z0 to z1) with doorways (z centre, width), lintels at `door`. */
export function wallAlong(
  m: MapBuilder,
  x: number,
  z0: number,
  z1: number,
  y: number,
  height: number,
  doors: [number, number][] = [],
  material: MaterialId = 'wall',
  door = 2.8,
): void {
  const t = WALL / 2
  const lo = Math.min(z0, z1)
  const hi = Math.max(z0, z1)
  const gaps = doors.map(([c, w]) => [c - w / 2, c + w / 2] as const).sort((a, b) => a[0] - b[0])
  let from = lo
  for (const [g0, g1] of gaps) {
    if (g0 > from) m.span([x - t, y, from], [x + t, y + height, g0], material)
    m.span([x - t, y + door, g0], [x + t, y + height, g1], material)
    from = g1
  }
  if (hi > from) m.span([x - t, y, from], [x + t, y + height, hi], material)
}

/** A wall across x at `z` (from x0 to x1) with doorways (x centre, width). */
export function wallAcross(
  m: MapBuilder,
  z: number,
  x0: number,
  x1: number,
  y: number,
  height: number,
  doors: [number, number][] = [],
  material: MaterialId = 'wall',
  door = 2.8,
): void {
  const t = WALL / 2
  const lo = Math.min(x0, x1)
  const hi = Math.max(x0, x1)
  const gaps = doors.map(([c, w]) => [c - w / 2, c + w / 2] as const).sort((a, b) => a[0] - b[0])
  let from = lo
  for (const [g0, g1] of gaps) {
    if (g0 > from) m.span([from, y, z - t], [g0, y + height, z + t], material)
    m.span([g0, y + door, z - t], [g1, y + height, z + t], material)
    from = g1
  }
  if (hi > from) m.span([from, y, z - t], [hi, y + height, z + t], material)
}

/** A parked car (body + glass cabin) on the floor at `y`, lengthwise across x or along z. */
export function car(m: MapBuilder, x: number, y: number, z: number, along = false): void {
  const [w, d] = along ? [1.9, 4.4] : [4.4, 1.9]
  m.block(x, y + 0.15, z, w, 0.8, d, 'accent')
  m.block(x, y + 0.95, z, along ? 1.7 : 2.4, 0.55, along ? 2.4 : 1.7, 'glass')
  for (const a of [-1.4, 1.4]) {
    for (const b of [-0.85, 0.85]) {
      const [dx, dz] = along ? [b, a] : [a, b]
      m.block(x + dx, y, z + dz, along ? 0.25 : 0.6, 0.6, along ? 0.6 : 0.25, 'cover', DECO)
    }
  }
}
