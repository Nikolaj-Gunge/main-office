import type { MaterialId } from '../maps/types.ts'
import type { LampOptions, Site } from './kit.ts'
import { armyTent, cot, drum, fence, logPile, paving, pupTent, sandbags } from './places-kit.ts'
import { crate, table } from './structures.ts'

/**
 * The lived-in side of Haven (structures.ts builds its walls, huts, bonfire and people): shacks
 * and lean-tos, market stalls, a cook station, watchtowers, a water tower, a coop, a garden,
 * washing, a generator and strings of bulbs, braziers, and plank walks and trodden paths between.
 *
 * Kept clear: the gate road (x ±3 from the gate to the fire), the ring of seats round the fire,
 * the ground south of it where people wake (x ±6, z 6–11), Gus's customers (x 18–22, z −9…−3)
 * and the infirmary's, bunkhouse's and workshop's doors. Light is warm white and amber, soft;
 * most of it is glowing geometry, with a few real lamps (night.ts lights the nearest).
 */
export function havenLife(s: Site): void {
  paths(s)
  square(s)
  market(s)
  north(s)
  west(s)
  east(s)
  south(s)
  // Braziers inside the gate and in the corners.
  for (const [x, z] of [
    [-4, -25.5],
    [4, -25.5],
    [-25.5, -21.5],
    [25.5, -21.5],
    [-25.5, 22.5],
    [25.5, 22.5],
  ] as const) {
    brazier(s, x, z)
  }
  watchtower(s, 26.8, -26.8)
  watchtower(s, -26.8, 26.8)
}

// --- Parts ------------------------------------------------------------------------------------

/** Warm-white glow, for bulbs and lamps that light nothing themselves. */
const BULB: MaterialId = 'lightpanel'
const WARM: LampOptions = { color: 0xffdcb4, intensity: 8, distance: 11 }
const AMBER: LampOptions = { color: 0xffb070, intensity: 18, distance: 15, flicker: 0.4 }

/** A string of bulbs from one point to another, sagging in the middle (glow only). */
function bulbs(s: Site, x0: number, z0: number, x1: number, z1: number, y: number, every = 1) {
  const length = Math.hypot(x1 - x0, z1 - z0)
  const n = Math.max(2, Math.round(length / every))
  const deg = (Math.atan2(-(z1 - z0), x1 - x0) * 180) / Math.PI
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n
    const sag = 0.5 * Math.min(1, length / 12) * 4 * t * (1 - t)
    const x = x0 + (x1 - x0) * t
    const z = z0 + (z1 - z0) * t
    s.turned(x, y - sag, z, length / n + 0.02, 0.02, 0.02, deg, 'metal')
    if (i > 0 || n < 3) s.deco(x, y - sag - 0.12, z, 0.07, 0.09, 0.07, BULB)
  }
}

/** A post with a lantern hanging from an arm: lights a path. */
function lampPost(s: Site, x: number, z: number, lit = true): void {
  s.block(x, 0, z, 0.12, 2.4, 0.12, 'log')
  s.deco(x + 0.25, 2.3, z, 0.55, 0.06, 0.06, 'log')
  if (lit) s.lantern(x + 0.45, 2.3, z, 0.4, WARM)
  else s.deco(x + 0.45, 1.75, z, 0.14, 0.2, 0.14, 'lantern')
}

/** A burn barrel: embers glowing at the top, a real (amber) fire light. */
function brazier(s: Site, x: number, z: number): void {
  s.block(x, 0, z, 0.62, 0.85, 0.62, 'rust')
  s.deco(x, 0.85, z, 0.5, 0.12, 0.5, 'lantern')
  s.deco(x, 0.9, z, 0.24, 0.2, 0.24, BULB)
  s.light(x, 1.4, z, AMBER)
}

/** A shack of corrugated iron, patched with planks, a lit window, a door on `door` side. */
function shack(
  s: Site,
  x: number,
  z: number,
  w: number,
  d: number,
  door: 'n' | 's' | 'e' | 'w',
  window: 'n' | 's' | 'e' | 'w',
): void {
  const t = s.sub(x, z)
  t.shell(0, 0, {
    w,
    d,
    h: 2.3,
    wall: 'rust',
    floor: 'wood',
    roof: 'rust',
    doors: [{ side: door, at: 0, width: 1.1 }],
    windows: [{ side: window, at: 0, width: 0.9, height: 0.8, sill: 1.1 }],
    noRoom: true,
  })
  // Plank patches over the holes in the tin.
  const out = 0.12
  t.deco(-w / 4, 0.3, d / 2 + out - 0.08, 1, 0.9, 0.04, 'wood')
  t.deco(w / 2 + out - 0.08, 0.9, d / 4, 0.04, 0.7, 0.9, 'wood')
  t.deco(w / 4, 1.2, -d / 2 - out + 0.08, 0.8, 0.6, 0.04, 'wood')
  // The window glows; lamplight inside.
  const along = window === 'n' || window === 's'
  // On the wall's middle line (walls are 0.2 thick).
  const half = (along ? d : w) / 2 - 0.1
  const fix = window === 's' || window === 'e' ? half : -half
  if (along) litWindowAt(t, true, 0, fix, 0.9)
  else litWindowAt(t, false, fix, 0, 0.9)
  t.lantern(0, 2.3, 0, 0.4, WARM)
  cot(t, w / 2 - 0.55, 0, false, 0.12)
  crate(t, -w / 2 + 0.45, -d / 2 + 0.45, 0.6, undefined, 0.12)
  // A stovepipe.
  t.block(-w / 2 + 0.4, 2.3, d / 2 - 0.4, 0.16, 0.8, 0.16, 'metal', { collide: false })
}

/** litWindow for the shacks' smaller windows (sill 1.1, 0.8 high). */
function litWindowAt(s: Site, alongX: boolean, x: number, z: number, w: number): void {
  const [sx, sz] = alongX ? [w, 0.03] : [0.03, w]
  s.deco(x, 0.12 + 1.1, z, sx, 0.8, sz, 'windowglow')
  s.deco(x, 0.12 + 1.1, z, 0.05, 0.8, 0.05, 'wood') // the frame's upright
}

/** A lean-to: a sloping tin roof on four posts over a cot, a tarp and boxes. */
function leanTo(s: Site, x: number, z: number): void {
  const t = s.sub(x, z)
  for (const [px, pz, h] of [
    [-1.5, -1.2, 2.3],
    [1.5, -1.2, 2.3],
    [-1.5, 1.2, 1.6],
    [1.5, 1.2, 1.6],
  ] as const) {
    t.block(px, 0, pz, 0.12, h, 0.12, 'log')
  }
  t.turned(0, 1.88, 0, 3.4, 0.06, 2.8, 0, 'rust', 0.25)
  t.deco(-1.55, 0, 0, 0.04, 1.5, 2.3, 'canvas')
  cot(t, -0.4, -0.2, true)
  crate(t, 1, -0.6, 0.6)
  crate(t, 1.05, 0.2, 0.5)
  t.deco(0.9, 0.6, -0.6, 0.14, 0.2, 0.14, 'lantern')
}

/** A watchtower against the wall: four legs, a deck at 3.2 m, rails, a roof, a ladder. */
function watchtower(s: Site, x: number, z: number): void {
  const h = 3.2
  for (const [dx, dz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    s.block(x + dx, 0, z + dz, 0.2, h + 2.2, 0.2, 'log')
  }
  s.block(x, h, z, 2.4, 0.15, 2.4, 'wood')
  for (const e of [-1, 1]) {
    s.deco(x, h + 0.15, z + e * 1.15, 2.4, 0.9, 0.06, 'wood')
    s.deco(x + e * 1.15, h + 0.15, z, 0.06, 0.9, 2.4, 'wood')
  }
  s.deco(x, h + 2.2, z, 2.9, 0.12, 2.9, 'rust')
  // The ladder, on the side facing into the camp.
  const lx = x - Math.sign(x) * 1.25
  for (const e of [-1, 1]) s.deco(lx, 0, z + e * 0.25, 0.06, h + 0.9, 0.06, 'wood')
  for (let y = 0.3; y < h + 0.6; y += 0.35) s.deco(lx, y, z, 0.05, 0.05, 0.5, 'wood')
  s.lantern(x, h + 2.2, z, 0.5, WARM)
}

// --- Areas ------------------------------------------------------------------------------------

/** Trodden earth from the gate to the fire, and plank walks to the huts' doors. */
function paths(s: Site): void {
  paving(s, -1.7, -29.6, 1.7, -2, 'dirt', 0.025)
  paving(s, -13.9, -4.6, -4.4, -3.4, 'wood', 0.05) // infirmary
  paving(s, -14.6, 5, -13.4, 12.9, 'wood', 0.05) // bunkhouse
  paving(s, -13.4, 5, -6.2, 6.2, 'wood', 0.05)
  paving(s, 6.2, 8.6, 16.6, 9.8, 'wood', 0.05) // workshop
  paving(s, 15.4, 9.8, 16.6, 11.9, 'wood', 0.05)
  paving(s, 4, -1.2, 18.5, -0.2, 'dirt', 0.025) // to Gus
  paving(s, -1.4, -19, -9, -17.8, 'dirt', 0.025) // to the kitchen
  // Lamps along the gate road.
  for (const z of [-21, -12]) {
    lampPost(s, -3.4, z)
    lampPost(s, 3.4, z, z === -12)
  }
}

/** The square round the fire: bulbs, firewood, a cook station, the notice board, a generator. */
function square(s: Site): void {
  // Warm-white bulbs strung on two poles across the square north of the fire, fed by a generator.
  for (const e of [-1, 1]) s.block(e * 7, 0, -5, 0.14, 3.4, 0.14, 'log')
  bulbs(s, -7, -5, 7, -5, 3.3)
  bulbs(s, 7, -5, 9.6, 3, 3.3)
  bulbs(s, -7, -5, -9.6, 3, 3.3)
  for (const e of [-1, 1]) s.block(e * 9.6, 0, 3, 0.14, 3.4, 0.14, 'log')
  s.block(-8.8, 0, -6.8, 1.2, 0.8, 0.7, 'metal')
  s.deco(-8.8, 0.8, -6.8, 0.6, 0.12, 0.4, 'accent')
  s.deco(-9.35, 0.8, -6.95, 0.08, 0.5, 0.08, 'rust') // exhaust
  s.deco(-7.9, 0.02, -6, 1.2, 0.03, 0.03, 'asphalt') // cable to the pole
  s.deco(-7.2, 0.02, -5.6, 0.03, 0.03, 0.9, 'asphalt')
  drum(s, -10, -7, 'rust')

  // Firewood by the fire, and a block to split it on.
  s.block(-5.8, 0, -0.6, 1.6, 0.35, 0.7, 'log')
  s.block(-5.8, 0.35, -0.6, 1.4, 0.35, 0.6, 'log')
  s.block(-5.95, 0.7, -0.6, 0.9, 0.3, 0.5, 'log')
  s.block(-6, 0, 1.5, 0.5, 0.45, 0.5, 'log')
  s.turned(-5.95, 0.45, 1.45, 0.5, 0.06, 0.06, 35, 'wood', 0.5)

  // The cook station east of the fire: a brick hearth, a grill, pots, a prep table.
  s.block(6.4, 0, 1.2, 1.5, 0.75, 0.8, 'brick')
  s.deco(6.4, 0.75, 1.2, 1.3, 0.04, 0.65, 'metal')
  s.deco(6.4, 0.6, 1.62, 1, 0.12, 0.02, 'lantern') // coals glowing through the front
  s.deco(6, 0.79, 1.2, 0.36, 0.3, 0.36, 'metal') // stock pot
  s.deco(6.75, 0.79, 1.1, 0.4, 0.08, 0.4, 'asphalt') // a skillet
  s.deco(6, 1.09, 1.2, 0.3, 0.02, 0.3, 'rust')
  table(s, 6.4, 3, 1.4, 0.7)
  s.deco(6.1, 0.9, 3, 0.4, 0.06, 0.25, 'wood') // chopping board
  s.deco(6.7, 0.9, 3.05, 0.12, 0.14, 0.12, 'plaster')
  s.light(6.4, 1.3, 1.2, { color: 0xffb070, intensity: 7, distance: 8, flicker: 0.3 })

  // Notice board: names of the missing, a map, a rota.
  s.block(5.6, 0, -7.4, 0.12, 2.1, 0.12, 'log').block(7.4, 0, -7.4, 0.12, 2.1, 0.12, 'log')
  s.deco(6.5, 1, -7.4, 1.9, 1, 0.06, 'wood')
  for (const [x, y, w, h] of [
    [5.95, 1.55, 0.22, 0.3],
    [6.3, 1.5, 0.22, 0.3],
    [6.65, 1.58, 0.22, 0.28],
    [7.05, 1.45, 0.3, 0.38],
    [6.0, 1.12, 0.26, 0.24],
    [6.55, 1.1, 0.6, 0.34],
  ] as const) {
    s.deco(x, y - h / 2, -7.35, w, h, 0.02, 'whiteboard')
  }
}

/** Market stalls north-east of the square, facing south. */
function market(s: Site): void {
  for (const [x, wares] of [
    [6.8, ['plant', 'accent', 'hay'] as MaterialId[]],
    [10.8, ['fabric', 'metal', 'fabricAlt'] as MaterialId[]],
  ] as const) {
    const t = s.sub(x, -13)
    t.block(0, 0, 0, 3, 0.9, 0.7, 'wood')
    for (const [px, pz] of [
      [-1.5, -0.9],
      [1.5, -0.9],
      [-1.5, 0.5],
      [1.5, 0.5],
    ] as const) {
      t.block(px, 0, pz, 0.1, 2.3, 0.1, 'log')
    }
    t.turned(0, 2.25, -0.2, 3.5, 0.06, 2, 0, 'canvas', -0.15)
    wares.forEach((m, i) => {
      t.deco(-0.9 + i * 0.9, 0.9, 0.05, 0.7, 0.16, 0.45, 'wood')
      t.deco(-0.9 + i * 0.9, 1.06, 0.05, 0.6, 0.1, 0.35, m)
    })
    crate(t, -0.9, -1.3, 0.6)
    crate(t, 0.6, -1.4, 0.7)
    bulbs(t, -1.5, 0.5, 1.5, 0.5, 2.2, 0.6)
    t.light(0, 2, 0.6, WARM)
  }
}

/** Along the north wall: string lights in front of the tents, the army tent, the water tower. */
function north(s: Site): void {
  for (const x of [5.4, 11, 17, 23]) s.block(x, 0, -19.4, 0.12, 2.6, 0.12, 'log')
  bulbs(s, 5.4, -19.4, 11, -19.4, 2.5)
  bulbs(s, 11, -19.4, 17, -19.4, 2.5)
  bulbs(s, 17, -19.4, 23, -19.4, 2.5)

  // Supplies stacked inside the gate, east of it, and sandbags either side.
  crate(s, 11.4, -27.6, 0.9)
  crate(s, 12.4, -27.5, 0.8)
  crate(s, 11.5, -27.6, 0.7, undefined, 0.9)
  drum(s, 13.6, -27.8)
  drum(s, 14.3, -27.3, 'metal')
  s.block(16.2, 0, -27.8, 2.4, 0.5, 0.9, 'sandbag')
  sandbags(s, -5.8, -28.2, true, 2.6)
  sandbags(s, 7.4, -28.2, true, 2)

  // A walk-in army tent in the north-west corner: cots, a footlocker, a lantern.
  const tent = s.sub(-20, -23)
  armyTent(tent)
  cot(tent, -1.5, -0.7, false)
  cot(tent, 1.5, -0.7, false)
  crate(tent, 0, -1.8, 0.6)
  tent.lantern(0, 2.4, 0, 0.45, WARM)

  // The water tower north of the kitchen: a tank on legs, a pipe down to a tap and a trough.
  const wx = -6.5
  const wz = -24
  for (const [dx, dz] of [
    [-0.9, -0.9],
    [0.9, -0.9],
    [-0.9, 0.9],
    [0.9, 0.9],
  ] as const) {
    s.block(wx + dx, 0, wz + dz, 0.18, 3.2, 0.18, 'log')
  }
  s.block(wx, 3.2, wz, 2.3, 0.12, 2.3, 'wood')
  s.block(wx, 3.32, wz, 2, 1.7, 2, 'metal')
  s.deco(wx, 5.02, wz, 2.1, 0.12, 2.1, 'rust')
  s.deco(wx + 1.05, 0.6, wz + 1.05, 0.08, 2.7, 0.08, 'rust')
  s.block(wx + 1.3, 0, wz + 2, 1.4, 0.5, 0.6, 'metal')

  // A long table south of the kitchen tent, with benches and a lantern on it.
  table(s, -11, -11.5, 3, 0.9)
  for (const z of [-12.35, -10.65]) s.block(-11, 0, z, 2.8, 0.45, 0.32, 'wood')
  s.deco(-10.3, 0.9, -11.5, 0.14, 0.2, 0.14, 'lantern')
  s.light(-10.3, 1.2, -11.5, { ...WARM, intensity: 5, distance: 7, flicker: 0.1 })
  s.deco(-11.8, 0.9, -11.6, 0.3, 0.04, 0.3, 'metal') // a pot
  s.deco(-12.4, 0.9, -11.3, 0.1, 0.12, 0.1, 'plaster') // mugs
  s.deco(-11.4, 0.9, -11.25, 0.1, 0.12, 0.1, 'plaster')
  // String lights from the kitchen tent over the table.
  s.block(-8.8, 0, -11.5, 0.12, 2.6, 0.12, 'log')
  bulbs(s, -9.5, -15.7, -8.8, -11.5, 2.4, 0.7)
}

/** The west side: a shack, pup tents, washing on a line, rain barrels by the bunkhouse. */
function west(s: Site): void {
  shack(s, -22, 4, 4, 3, 'e', 's')
  pupTent(s, -26.6, 0.6)
  pupTent(s, -26.6, -10)
  pupTent(s, -26.6, -14)
  s.deco(-24.8, 0, -12, 1, 0.05, 1.4, 'asphalt') // a cold fire pit between them
  s.block(-27.2, 0, -12, 1.6, 0.04, 0.9, 'canvas', { collide: false })

  // Washing on a line between two poles, north of the bunkhouse.
  s.block(-26.5, 0, 8.5, 0.12, 2.1, 0.12, 'log').block(-20.5, 0, 8.5, 0.12, 2.1, 0.12, 'log')
  s.deco(-23.5, 1.98, 8.5, 6, 0.02, 0.02, 'metal')
  for (const [x, w, h, m] of [
    [-25.6, 0.55, 0.7, 'fabric'],
    [-24.7, 0.5, 0.45, 'plaster'],
    [-23.8, 0.6, 0.75, 'fabricAlt'],
    [-22.9, 0.4, 0.5, 'canvas'],
    [-22.1, 0.55, 0.65, 'fabric'],
    [-21.3, 0.35, 0.4, 'plaster'],
  ] as const) {
    s.deco(x, 1.97 - h, 8.5, w, h, 0.03, m)
  }
  s.block(-23.5, 0, 9.8, 0.9, 0.4, 0.6, 'metal') // the tub
  s.deco(-22.4, 0, 9.9, 0.3, 0.3, 0.3, 'rust') // a bucket

  // Rain barrels at the bunkhouse corner, and a stack of tyres.
  drum(s, -10.3, 13.6, 'wood')
  drum(s, -10.3, 14.4, 'wood')
  for (let i = 0; i < 3; i++) s.deco(-8.6, i * 0.24, 18.5, 0.7, 0.24, 0.7, 'asphalt')
  // Tarps over a heap of salvage.
  crate(s, -7.5, 24, 0.9)
  crate(s, -6.6, 24.2, 0.7)
  s.turned(-7.1, 0.75, 24.1, 2.2, 0.04, 1.6, 10, 'canvas', 0.15)
  s.deco(-8.6, 0, 22.6, 0.3, 0.3, 0.3, 'metal')
}

/** The east side: a shack and a lean-to by the wall, the workbench, tyres. */
function east(s: Site): void {
  shack(s, 25, -12, 4, 3.4, 'w', 'n')
  leanTo(s, 25.4, 1.2)
  lampPost(s, 21.5, -10.5)

  // A workbench outside the workshop: a vice, tools, a saw horse and a lamp on a post.
  s.block(23.6, 0, 9.4, 2.2, 0.9, 0.8, 'wood')
  s.deco(22.9, 0.9, 9.3, 0.2, 0.18, 0.16, 'metal') // vice
  s.deco(23.8, 0.9, 9.5, 0.5, 0.03, 0.06, 'metal') // a saw
  s.deco(24.3, 0.9, 9.2, 0.25, 0.08, 0.15, 'accent') // a toolbox
  s.block(23.6, 0, 11.4, 1.2, 0.7, 0.3, 'wood')
  s.block(25.1, 0, 9.4, 0.1, 2.3, 0.1, 'log')
  s.deco(24.8, 2.2, 9.4, 0.6, 0.06, 0.06, 'log')
  s.lantern(24.6, 2.2, 9.4, 0.35, { ...WARM, intensity: 5, distance: 7 })
  logPile(s, 26.6, 14, false, 2.4)
  for (let i = 0; i < 2; i++) s.deco(21.2, i * 0.24, 19.6, 0.7, 0.24, 0.7, 'asphalt')
  s.deco(22.1, 0, 19.4, 0.7, 0.24, 0.7, 'asphalt')
}

/** South of the fire: the vegetable patch and the chicken coop. */
function south(s: Site): void {
  // A shack and a lean-to either side of the ground people wake on.
  shack(s, -7, 15, 3.4, 3, 'n', 'e')
  leanTo(s, 9, 15.5)
  s.deco(1, 0, 22.5, 8.4, 0.05, 4.4, 'dirt')
  for (const z of [21, 22.5, 24]) {
    for (let x = -2.6; x <= 4.6; x += 0.9) s.deco(x, 0.05, z, 0.3, 0.28, 0.3, 'plant')
  }
  fence(s, [
    [0, 20],
    [-3.5, 20],
    [-3.5, 25],
    [5.5, 25],
    [5.5, 20],
    [1.6, 20],
  ])
  drum(s, 6.4, 20.8, 'wood')
  drum(s, 6.4, 21.6, 'wood')
  lampPost(s, -0.6, 19.2)

  // The chicken coop: a hutch on legs and a wired run.
  s.block(9.6, 0, 24.3, 1.6, 1.3, 1.2, 'wood', { render: false })
  for (const [dx, dz] of [
    [-0.7, -0.5],
    [0.7, -0.5],
    [-0.7, 0.5],
    [0.7, 0.5],
  ] as const) {
    s.deco(9.6 + dx, 0, 24.3 + dz, 0.08, 0.5, 0.08, 'wood')
  }
  s.deco(9.6, 0.5, 24.3, 1.6, 0.7, 1.2, 'wood')
  s.turned(9.6, 1.2, 24.3, 1.8, 0.06, 1.4, 0, 'shingle', 0.2)
  s.turned(9.6, 0.25, 23.4, 0.3, 0.04, 0.8, 0, 'wood', -0.6)
  fence(
    s,
    [
      [10.6, 23.4],
      [13, 23.4],
      [13, 26.4],
      [8.6, 26.4],
      [8.6, 25.1],
    ],
    'metal',
    0.9,
    1.5,
  )
  // Hens.
  for (const [x, z] of [
    [11.4, 24.2],
    [12.2, 25.1],
    [10.9, 25.7],
    [11.9, 23.9],
  ] as const) {
    s.deco(x, 0, z, 0.22, 0.2, 0.3, 'plaster')
    s.deco(x, 0.2, z - 0.12, 0.1, 0.1, 0.1, 'plaster')
  }
}
