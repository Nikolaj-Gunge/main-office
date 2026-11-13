import type { BoxFlags } from '../maps/builder.ts'
import type { MaterialId } from '../maps/types.ts'
import type { LootTable } from './items.ts'
import { DECO, type LampOptions, type Site } from './kit.ts'
import { FLOOR } from './structures.ts'

/**
 * The parts the places of Deadwood are put together from: thick walls, cheap furniture, wrecks,
 * tents, barricades and lamp posts. Vehicles and tents are built around their site's origin with
 * their length along x, so they are placed and turned with `s.sub(x, z, turn)`.
 */

/** A gap in a wall: centre along it (in the site's coordinates), width, sill and top. */
export type Gap = [at: number, width: number, sill: number, top: number]

/** A doorway `width` wide at `at`, 2.2 m high. */
export const doorway = (at: number, width = 1.4, top = 2.2): Gap => [at, width, 0, top]

/**
 * A wall of any thickness: along x (at z = `fixed`) or along z (at x = `fixed`), from `from` to
 * `to`, standing on `y`, with gaps.
 */
export function thickWall(
  s: Site,
  alongX: boolean,
  fixed: number,
  from: number,
  to: number,
  y: number,
  h: number,
  thick: number,
  material: MaterialId,
  gaps: Gap[] = [],
  flags: BoxFlags = {},
): void {
  const piece = (a: number, b: number, bottom: number, top: number) => {
    if (b - a < 0.02 || top - bottom < 0.02) return
    const mid = (a + b) / 2
    if (alongX) s.block(mid, y + bottom, fixed, b - a, top - bottom, thick, material, flags)
    else s.block(fixed, y + bottom, mid, thick, top - bottom, b - a, material, flags)
  }
  let cursor = from
  for (const [at, width, sill, top] of [...gaps].sort((a, b) => a[0] - b[0])) {
    const a = Math.max(cursor, at - width / 2)
    const b = Math.min(to, at + width / 2)
    piece(cursor, a, 0, h)
    piece(a, b, 0, sill)
    piece(a, b, Math.min(h, top), h)
    cursor = b
  }
  piece(cursor, to, 0, h)
}

/** A thin wall inside a building, floor to ceiling, with doorways at `doors`. */
export function partition(
  s: Site,
  alongX: boolean,
  fixed: number,
  from: number,
  to: number,
  h: number,
  material: MaterialId,
  doors: number[] = [],
  doorWidth = 1.4,
): void {
  thickWall(
    s,
    alongX,
    fixed,
    from,
    to,
    FLOOR,
    h,
    0.14,
    material,
    doors.map((at) => doorway(at, doorWidth)),
  )
}

// --- Furniture --------------------------------------------------------------------------------

/** A plain table: a top on two trestles. */
export function desk(
  s: Site,
  x: number,
  z: number,
  w = 1.4,
  d = 0.8,
  loot?: LootTable,
  top: MaterialId = 'desk',
): void {
  s.block(x, FLOOR + 0.7, z, w, 0.06, d, top)
  for (const e of [-1, 1]) {
    if (w >= d) s.deco(x + e * (w / 2 - 0.14), FLOOR, z, 0.06, 0.7, d - 0.14, 'wood')
    else s.deco(x, FLOOR, z + e * (d / 2 - 0.14), w - 0.14, 0.7, 0.06, 'wood')
  }
  if (loot) s.loot(x, FLOOR + 0.81, z, loot)
}

/** A cupboard, dresser, locker, fridge or machine: one box, with loot on top if it is low. */
export function cabinet(
  s: Site,
  x: number,
  z: number,
  w: number,
  h: number,
  d: number,
  material: MaterialId,
  loot?: LootTable,
): void {
  s.block(x, FLOOR, z, w, h, d, material)
  if (loot) s.loot(x, FLOOR + h + 0.05, z, loot)
}

/** A run of shelves of any length (shop gondolas, store rooms); loot lies along the boards. */
export function shelving(
  s: Site,
  x: number,
  z: number,
  alongX: boolean,
  length: number,
  loot: LootTable[] = [],
  material: MaterialId = 'metal',
): void {
  const [w, d] = alongX ? [length, 0.45] : [0.45, length]
  s.block(x, FLOOR, z, w, 1.7, d, material, { render: false })
  for (const y of [0.08, 0.62, 1.16, 1.65]) s.deco(x, FLOOR + y, z, w, 0.05, d, material)
  for (const e of [-1, 1]) {
    const off = e * (length / 2 - 0.03)
    if (alongX) s.deco(x + off, FLOOR, z, 0.05, 1.7, d, material)
    else s.deco(x, FLOOR, z + off, w, 1.7, 0.05, material)
  }
  loot.forEach((t, i) => {
    const along = ((i + 0.5) / loot.length - 0.5) * (length - 0.5)
    const y = FLOOR + (i % 2 === 0 ? 0.7 : 1.24)
    s.loot(alongX ? x + along : x, y, alongX ? z : z + along, t)
  })
}

/** A camp bed or a stretcher: canvas on a low frame. */
export function cot(s: Site, x: number, z: number, alongX: boolean, y = 0): void {
  const [w, d] = alongX ? [1.9, 0.8] : [0.8, 1.9]
  s.block(x, y, z, w, 0.38, d, 'canvas')
  s.deco(alongX ? x - 0.7 : x, y + 0.38, alongX ? z : z - 0.7, 0.4, 0.08, 0.4, 'plaster')
}

/** A note somebody left: read it with E. */
export function note(s: Site, key: string, x: number, y: number, z: number, text: string): void {
  s.deco(x, y, z, 0.22, 0.01, 0.3, 'whiteboard')
  s.interact(key, 'note', x, y + 0.05, z, 'Read the note', text)
}

/** A light that has almost given up. */
export function dying(
  s: Site,
  x: number,
  y: number,
  z: number,
  color = 0xdfe8ff,
  intensity = 9,
): void {
  s.light(x, y, z, { color, intensity, distance: 10, flicker: 0.7 })
}

// --- Streets and yards ------------------------------------------------------------------------

/** Paving: a thin slab you walk "in" rather than on (so nothing has to be lifted onto it). */
export function paving(
  s: Site,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  material: MaterialId = 'asphalt',
  top = 0.045,
): void {
  s.span([x0, -0.2, z0], [x1, top, z1], material, DECO)
}

/** A thin mark painted on the ground or a floor (lines, stains), `y` being what it lies on. */
export function decal(
  s: Site,
  x: number,
  z: number,
  w: number,
  d: number,
  material: MaterialId,
  y = 0,
): void {
  s.deco(x, y + 0.005, z, w, 0.015, d, material)
}

/** Somebody bled here. */
export function blood(s: Site, x: number, z: number, w = 1.1, d = 0.8, y = 0): void {
  decal(s, x, z, w, d, 'accent', y)
}

/** What is left of somebody, under a sheet. */
export function corpse(s: Site, x: number, z: number, alongX: boolean, y = 0): void {
  const [w, d] = alongX ? [1.75, 0.55] : [0.55, 1.75]
  s.deco(x, y + 0.02, z, w, 0.24, d, 'fabricAlt')
  blood(s, x + 0.3, z + 0.25, 1.3, 1, y)
}

/** A street lamp; `lit` gives it a working bulb. */
export function lampPost(s: Site, x: number, z: number, lit?: LampOptions, dx = 0.9, dz = 0): void {
  s.block(x, 0, z, 0.16, 5, 0.16, 'metal')
  s.deco(x + dx / 2, 4.9, z + dz / 2, Math.abs(dx) + 0.1, 0.1, Math.abs(dz) + 0.1, 'metal')
  s.deco(x + dx, 4.74, z + dz, 0.45, 0.14, 0.45, lit ? 'lightpanel' : 'metal')
  if (lit) s.light(x + dx, 4.5, z + dz, { intensity: 30, distance: 20, ...lit })
}

/** A wall of sandbags: crouch behind it. */
export function sandbags(
  s: Site,
  x: number,
  z: number,
  alongX: boolean,
  length: number,
  h = 1.1,
): void {
  const [w, d] = alongX ? [length, 0.7] : [0.7, length]
  s.block(x, 0, z, w, h - 0.3, d, 'sandbag')
  s.block(x, h - 0.3, z, alongX ? w - 0.5 : 0.45, 0.3, alongX ? 0.45 : d - 0.5, 'sandbag')
}

/** A concrete jersey barrier. */
export function barrier(s: Site, x: number, z: number, alongX: boolean, length = 2.6): void {
  const [w, d] = alongX ? [length, 0.6] : [0.6, length]
  s.block(x, 0, z, w, 0.45, d, 'concrete')
  s.block(x, 0.45, z, alongX ? w : 0.3, 0.5, alongX ? 0.3 : d, 'concrete')
}

/** A barricade thrown together from boards, a crate and whatever was to hand. */
export function barricade(s: Site, x: number, z: number, alongX: boolean, length = 3): void {
  const [w, d] = alongX ? [length, 0.3] : [0.3, length]
  s.block(x, 0, z, w, 1, d, 'wood')
  const along = (a: number, across: number): [number, number] =>
    alongX ? [x + a, z + across] : [x + across, z + a]
  const [cx, cz] = along(-length / 2 + 0.5, 0.55)
  s.block(cx, 0, cz, 0.8, 0.8, 0.8, 'cover')
  const [px, pz] = along(length / 4, 0)
  s.turned(px, 1, pz, length * 0.7, 0.16, 0.06, alongX ? 8 : 98, 'wood')
  const [tx, tz] = along(length / 2 - 0.4, -0.5)
  s.deco(tx, 0, tz, 0.7, 0.28, 0.7, 'asphalt')
}

/** An oil drum. */
export function drum(s: Site, x: number, z: number, material: MaterialId = 'rust', y = 0): void {
  s.block(x, y, z, 0.6, 0.9, 0.6, material)
}

/** A fence along a line of corners: posts you bump into, rails you don't. */
export function fence(
  s: Site,
  points: [number, number][],
  material: MaterialId = 'wood',
  h = 1.1,
  every = 4,
): void {
  points.forEach(([x0, z0], p) => {
    const next = points[p + 1]
    if (!next) {
      // A closed loop already has a post where it began.
      const first = points[0] as [number, number]
      if (p === 0 || first[0] !== x0 || first[1] !== z0) s.block(x0, 0, z0, 0.14, h, 0.14, material)
      return
    }
    const [x1, z1] = next
    const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0)
    const length = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0)
    const n = Math.max(1, Math.round(length / every))
    for (let i = 0; i < n; i++) {
      s.block(x0 + ((x1 - x0) * i) / n, 0, z0 + ((z1 - z0) * i) / n, 0.14, h, 0.14, material)
    }
    for (const y of [h * 0.4, h * 0.8]) {
      const [w, d] = alongX ? [length, 0.05] : [0.05, length]
      s.deco((x0 + x1) / 2, y, (z0 + z1) / 2, w, 0.1, d, material)
    }
  })
}

/** A sign on a pole, facing along z (or along x). */
export function sign(
  s: Site,
  x: number,
  z: number,
  text: string,
  alongX = true,
  h = 5,
  board: MaterialId = 'accent',
): void {
  s.block(x, 0, z, 0.25, h, 0.25, 'metal')
  s.deco(x, h - 1.5, z, alongX ? 3.4 : 0.2, 1.4, alongX ? 0.2 : 3.4, board)
  s.label(x, h + 0.4, z, text)
}

// --- Tents ------------------------------------------------------------------------------------

/** A small ridge tent (like Haven's): canvas stepping in towards the ridge. */
export function pupTent(s: Site, x: number, z: number, alongX = false): void {
  for (let i = 0; i < 3; i++) {
    const across = 2.2 * (1 - i / 3.3)
    const [w, d] = alongX ? [2.8, across] : [across, 2.8]
    s.block(x, i * 0.45, z, w, 0.45, d, 'canvas', i === 0 ? {} : DECO)
  }
}

/**
 * An army tent you can walk into: canvas on three sides, open to the south (+z), around the
 * site's origin. The dead come in through the open side.
 */
export function armyTent(t: Site, w = 5, d = 4.6): void {
  const h = 2.4
  t.block(0, 0, -d / 2, w, h, 0.08, 'canvas')
  for (const e of [-1, 1]) {
    t.block((e * w) / 2, 0, 0, 0.08, h, d, 'canvas')
    t.block(e * (w / 2 - 0.02), 0, d / 2 + 0.1, 0.12, h, 0.12, 'log')
  }
  t.deco(0, h, 0, w + 0.5, 0.1, d + 0.5, 'canvas')
  t.deco(0, h + 0.1, 0, (w + 0.5) * 0.62, 0.35, d + 0.5, 'canvas')
  t.deco(0, h + 0.45, 0, (w + 0.5) * 0.25, 0.3, d + 0.5, 'canvas')
  t.room(-w / 2 + 0.05, -d / 2 + 0.05, w / 2 - 0.05, d / 2, [[0, d / 2 + 0.9]])
}

// --- Wrecks -----------------------------------------------------------------------------------

const PAINT: MaterialId[] = ['rust', 'accent', 'platform', 'metal', 'whiteboard']
const paintOf = (look: number) => PAINT[look % PAINT.length] as MaterialId

/** Wheels: `[along, across]` each, lying against the body. */
function wheels(v: Site, at: [number, number][], size = 0.6): void {
  for (const [a, b] of at) v.deco(a, 0, b, size, size, 0.26, 'asphalt')
}

/** A wrecked car, nose towards +x (the look of `car` in maps/coop-kit.ts, after a bad year). */
export function carWreck(v: Site, look = 0): void {
  const paint = paintOf(look)
  v.block(0, 0.18, 0, 4.4, 0.72, 1.9, paint)
  v.block(-0.3, 0.9, 0, 2.3, 0.55, 1.7, look % 3 === 2 ? 'rust' : 'glass')
  const all: [number, number][] = [
    [-1.4, -0.85],
    [-1.4, 0.85],
    [1.4, -0.85],
    [1.4, 0.85],
  ]
  // Some have lost a wheel; some stand with a door open.
  wheels(v, look % 4 === 1 ? all.slice(0, 3) : all)
  if (look % 2 === 0) v.turned(0.25, 0.3, 1.32, 1, 0.8, 0.05, 40, paint)
}

/** A pickup truck, nose towards +x; `loot` lies in the bed. */
export function pickupWreck(v: Site, look = 0, loot?: LootTable): void {
  const paint = paintOf(look)
  v.block(0, 0.3, 0, 5, 0.6, 1.9, paint)
  v.block(0.7, 0.9, 0, 1.5, 0.7, 1.7, 'glass')
  for (const e of [-1, 1]) v.block(-1.45, 0.9, e * 0.91, 2.1, 0.35, 0.08, paint)
  v.deco(-2.46, 0.9, 0, 0.08, 0.35, 1.9, paint)
  wheels(
    v,
    [
      [-1.6, -0.86],
      [-1.6, 0.86],
      [1.6, -0.86],
      [1.6, 0.86],
    ],
    0.7,
  )
  if (loot) v.loot(-1.4, 0.95, 0, loot)
}

/** An army truck with a canvas back, nose towards +x. */
export function armyTruck(v: Site): void {
  v.block(0, 0.55, 0, 6.6, 0.4, 2.3, 'metal')
  v.block(2.35, 0.95, 0, 1.8, 1.5, 2.2, 'rust')
  v.deco(3.26, 1.6, 0, 0.04, 0.6, 1.8, 'glass')
  v.block(-1.2, 0.95, 0, 4.2, 1.9, 2.3, 'canvas')
  wheels(
    v,
    [
      [2.3, -1.04],
      [2.3, 1.04],
      [-1, -1.04],
      [-1, 1.04],
      [-2.3, -1.04],
      [-2.3, 1.04],
    ],
    1,
  )
}

/** A log truck that never delivered, nose towards +x: logs on the bed and a few spilled. */
export function logTruck(v: Site): void {
  v.block(3, 0.5, 0, 2, 2.1, 2.3, 'rust')
  v.deco(4.02, 1.6, 0, 0.04, 0.7, 1.9, 'glass')
  v.block(-1, 0.75, 0, 6.2, 0.3, 2.3, 'metal')
  v.block(-1, 1.05, -0.55, 5.6, 0.55, 0.55, 'log')
  v.block(-1, 1.05, 0.55, 5.6, 0.55, 0.55, 'log')
  v.block(-1.2, 1.6, 0, 5.6, 0.55, 0.55, 'log')
  for (const x of [-3.8, 1.7]) {
    for (const e of [-1, 1]) v.deco(x, 1.05, e * 1.1, 0.1, 1.3, 0.1, 'metal')
  }
  v.turned(-2, 0, 2.6, 5.6, 0.5, 0.5, 14, 'log')
  v.turned(0.5, 0, 3.6, 5.6, 0.5, 0.5, -9, 'log')
  wheels(
    v,
    [
      [3, -1.04],
      [3, 1.04],
      [-1.6, -1.04],
      [-1.6, 1.04],
      [-3, -1.04],
      [-3, 1.04],
    ],
    1,
  )
}

/** A tractor left where it stopped, nose towards +x. */
export function tractor(v: Site): void {
  v.block(0.5, 0.6, 0, 2.2, 0.9, 0.9, 'accent')
  v.block(-0.9, 0.6, 0, 1.1, 1.9, 1.2, 'rust')
  v.deco(1.1, 1.5, 0.25, 0.1, 0.9, 0.1, 'metal')
  for (const e of [-1, 1]) {
    v.deco(-0.9, 0, e * 0.85, 1.5, 1.5, 0.4, 'asphalt')
    v.deco(1.3, 0, e * 0.65, 0.8, 0.8, 0.25, 'asphalt')
  }
}

/**
 * A rusted excavator, its tracks along x and its arm reaching out to the south (+z). The arm is
 * tilted, so it only looks right on a site that isn't turned.
 */
export function excavator(v: Site): void {
  for (const e of [-1, 1]) v.block(0, 0, e * 1.05, 4.2, 0.7, 0.6, 'asphalt')
  v.block(-0.2, 0.7, 0, 3.2, 1.3, 2.4, 'rust')
  v.block(0.7, 2, -0.6, 1.3, 1.2, 1.1, 'glass')
  v.deco(-1.2, 2, 0.3, 1, 0.5, 1.4, 'rust')
  v.turned(0.7, 2.6, 2.9, 0.45, 0.45, 5, 0, 'rust', -0.55)
  v.turned(0.7, 2, 5.9, 0.35, 0.35, 3.4, 0, 'rust', 0.95)
  v.block(0.7, 0, 6.9, 1.1, 0.7, 0.9, 'metal')
}

/** A stack of logs (or anything else long), three high. */
export function logPile(
  s: Site,
  x: number,
  z: number,
  alongX: boolean,
  length: number,
  material: MaterialId = 'log',
): void {
  for (const [i, across] of [2.4, 1.6, 0.8].entries()) {
    const [w, d] = alongX ? [length - i * 0.3, across] : [across, length - i * 0.3]
    s.block(x, i * 0.6, z, w, 0.6, d, material)
  }
}
