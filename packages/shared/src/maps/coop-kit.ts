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

// ─── Set dressing (all decoration: nothing here blocks movement, sight or bullets) ──────────

/** A small seeded random (same layout every build). */
export function scatter(seed: number): () => number {
  let a = Math.floor(seed * 9973) | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t + 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface LampOptions {
  /** How far below the ceiling it hangs (m). */
  drop?: number
  color?: number
  intensity?: number
  distance?: number
  /** 0–1, see MapLight.flicker. */
  flicker?: number
}

function lampLight(m: MapBuilder, pos: Vec3, o: LampOptions, hang?: number) {
  m.light({
    kind: 'point',
    pos,
    color: o.color ?? 0xffd9a0,
    intensity: o.intensity ?? 7,
    distance: o.distance ?? 12,
    ...(o.flicker ? { flicker: o.flicker } : {}),
    ...(hang ? { hang } : {}),
  })
}

/** A lamp on a cord from the ceiling at height `ceil`: shade, glowing bulb, and its light. */
export function hangingLamp(
  m: MapBuilder,
  x: number,
  ceil: number,
  z: number,
  o: LampOptions = {},
) {
  const y = ceil - (o.drop ?? 0.9)
  // Cord, shade and bulb all hang from the light about to be added, and swing with it.
  const hung = { ...DECO, swing: m.nextLight }
  m.span([x - 0.012, y + 0.14, z - 0.012], [x + 0.012, ceil - 0.005, z + 0.012], 'metal', hung)
  m.block(x, y, z, 0.44, 0.14, 0.44, 'metal', hung)
  m.block(x, y - 0.025, z, 0.26, 0.03, 0.26, 'lightpanel', hung)
  lampLight(m, [x, y - 0.2, z], o, ceil - (y - 0.2))
}

/** A long fluorescent fixture on two wires, lengthwise along x or z, with its light. */
export function tubeLight(
  m: MapBuilder,
  x: number,
  ceil: number,
  z: number,
  along: 'x' | 'z' = 'x',
  o: LampOptions = {},
) {
  const y = ceil - (o.drop ?? 0.5)
  const [lx, lz] = along === 'x' ? [1.3, 0.22] : [0.22, 1.3]
  for (const s of [-0.5, 0.5]) {
    const wx = x + (along === 'x' ? s : 0)
    const wz = z + (along === 'z' ? s : 0)
    m.span(
      [wx - 0.008, y + 0.06, wz - 0.008],
      [wx + 0.008, ceil - 0.005, wz + 0.008],
      'metal',
      DECO,
    )
  }
  m.block(x, y, z, lx, 0.06, lz, 'metal', DECO)
  m.block(x, y - 0.03, z, lx * 0.9, 0.03, lz * 0.6, 'lightpanel', DECO)
  lampLight(m, [x, y - 0.25, z], { intensity: 6, distance: 11, color: 0xdfe8ff, ...o })
}

/** A small red emergency lamp on a wall or ceiling (flickers a little). */
export function emergencyLight(m: MapBuilder, x: number, y: number, z: number, flicker = 0.4) {
  m.block(x, y, z, 0.25, 0.12, 0.25, 'accent', DECO)
  m.light({
    kind: 'point',
    pos: [x, y - 0.2, z],
    color: 0xff3a2a,
    intensity: 4,
    distance: 7,
    flicker,
  })
}

/** A ceiling tile hanging loose by one corner. */
export function loosePanel(m: MapBuilder, x: number, ceil: number, z: number, tilt = 0.8) {
  m.box({
    center: [x, ceil - 0.32, z],
    size: [0.6, 0.03, 0.6],
    rotation: [tilt, 0.3, 0.25],
    material: 'ceiling',
    collide: false,
  })
}

/** Broken chunks of concrete and plaster round (x, z). */
export function rubble(
  m: MapBuilder,
  x: number,
  y: number,
  z: number,
  rnd: () => number,
  n = 6,
  spread = 1.2,
) {
  for (let i = 0; i < n; i++) {
    const w = 0.12 + rnd() * 0.35
    const h = 0.06 + rnd() * 0.18
    m.box({
      center: [x + (rnd() - 0.5) * spread * 2, y + 0.02 + h / 2, z + (rnd() - 0.5) * spread * 2],
      size: [w, h, 0.1 + rnd() * 0.3],
      rotation: [(rnd() - 0.5) * 0.5, rnd() * Math.PI, (rnd() - 0.5) * 0.5],
      material: rnd() < 0.6 ? 'concrete' : 'plaster',
      collide: false,
    })
  }
}

/** Sheets of paper strewn across the floor round (x, z). */
export function papers(
  m: MapBuilder,
  x: number,
  y: number,
  z: number,
  rnd: () => number,
  n = 6,
  spread = 1.5,
) {
  for (let i = 0; i < n; i++) {
    m.box({
      center: [
        x + (rnd() - 0.5) * spread * 2,
        y + 0.02 + i * 0.002,
        z + (rnd() - 0.5) * spread * 2,
      ],
      size: [0.21, 0.004, 0.29],
      rotation: [0, rnd() * Math.PI, 0],
      material: 'whiteboard',
      collide: false,
    })
  }
}

/** A smear of blood on the floor round (x, z): a few overlapping splats and a drag mark. */
export function blood(m: MapBuilder, x: number, y: number, z: number, rnd: () => number, size = 1) {
  const n = 3 + Math.floor(rnd() * 3)
  for (let i = 0; i < n; i++) {
    const s = (0.25 + rnd() * 0.5) * size
    m.box({
      center: [x + (rnd() - 0.5) * size, y + 0.025 + i * 0.001, z + (rnd() - 0.5) * size],
      size: [s, 0.003, s * (0.6 + rnd() * 0.6)],
      rotation: [0, rnd() * Math.PI, 0],
      material: 'accent',
      collide: false,
    })
  }
  const angle = rnd() * Math.PI
  m.box({
    center: [x + Math.cos(angle) * 0.9 * size, y + 0.024, z + Math.sin(angle) * 0.9 * size],
    size: [1.6 * size, 0.003, 0.18 * size],
    rotation: [0, -angle, 0],
    material: 'accent',
    collide: false,
  })
}

/** Planks nailed across an opening `width` wide, lengthwise along x or z, from `y` up. */
export function boards(
  m: MapBuilder,
  x: number,
  y: number,
  z: number,
  width: number,
  along: 'x' | 'z',
) {
  ;[0.5, 1.2, 1.9].forEach((h, i) => {
    const slant = (i % 2 === 0 ? 1 : -1) * 0.12
    m.box({
      center: [x, y + h, z],
      size: along === 'x' ? [width + 0.3, 0.16, 0.04] : [0.04, 0.16, width + 0.3],
      rotation: along === 'x' ? [0, 0, slant] : [slant, 0, 0],
      material: 'wood',
      collide: false,
    })
  })
}

/** A straight run (pipe, cable, beam) of `thickness` between two points. */
export function run(
  m: MapBuilder,
  a: Vec3,
  b: Vec3,
  thickness: number,
  material: MaterialId = 'metal',
) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const dz = b[2] - a[2]
  const flat = Math.hypot(dx, dz)
  m.box({
    center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
    size: [Math.hypot(flat, dy), thickness, thickness],
    rotation: [0, Math.atan2(-dz, dx), Math.atan2(dy, flat)],
    material,
    collide: false,
  })
}

/** A cable sagging between two points under the ceiling. */
export function cable(m: MapBuilder, a: Vec3, b: Vec3, sag = 0.4) {
  const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - sag, (a[2] + b[2]) / 2]
  run(m, a, mid, 0.025, 'screen')
  run(m, mid, b, 0.025, 'screen')
}
