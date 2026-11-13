import { MapBuilder } from './builder.ts'
import type { MapDef, MaterialId } from './types.ts'

/**
 * "Rooftop": the roof of an office tower at sunset, 30 × 30 m, for 2–6 players. The roof is the
 * floor (y = 0); a low parapet runs round the edge with an invisible wall above it, so nobody
 * falls off. The city skyline and a few lower neighbouring roofs sit outside.
 *
 *   z=-15 ┌─ parapet ──────────────────────────────────────────────────┐
 *         │┌──────┐         AC▓▓     AC▓▓                    dish   │
 *         ││ hut  door             hatch▓                           │
 *         │└──────┘   ═══ duct ═══      ═══ duct ═══      cond▒     │
 *         │ ▬▬solar▬▬ ▬▬solar▬▬  stack  air▓   yard  AC▓▓  cond▒     │
 *         │ ▬▬ rows ▬▬inverter▓▬▬   ┌────────┐═══ screen wall ═══      │
 *         │ ▬▬ (low)▬▬ ▬▬    ▬▬    │elevator│                          │
 *         │▓riser                  │overrun │ locker▓  ( H )   vent    │
 *         │ ═ valve wall ═ door    └────────┘         helipad (open)  │
 *         │ tank deck 3 m ▓vessels  ▓pump      skylight  fan▓         │
 *         │ (under: legs) ▓   ↑stairs house                cabinet▓   │
 *         │    ▓generator     ↑     cond▒   AC▓▓                  cond▒│
 *   z=15  └──────────────────────────────────────────────────────────┘
 *        x=-15                                                     x=15
 *
 * The water tank deck is the only high ground (one narrow stair up, railing for low cover);
 * underneath it is a sheltered pocket among the legs and pressure vessels. The elevator overrun
 * in the middle, a screen wall round the north-east equipment yard and a scatter of tall
 * machinery (high cover, 2 m+) break the roof up; solar rows, condensers and ducts are low
 * cover. The helipad is the one open patch and the sniper lies in its middle.
 */
export function buildRooftop(): MapDef {
  const m = new MapBuilder('rooftop', 'Rooftop', {
    // Low sun in the west.
    sunDirection: [-1, 0.32, 0.25],
    sunColor: 0xffa45c,
    sunIntensity: 2.3,
    skyColor: 0x7d86c4,
    groundColor: 0x4a3a3a,
    ambientIntensity: 1.05,
    fogColor: 0xf0a070,
    fogNear: 45,
    fogFar: 200,
  }).withSkyline()

  const X0 = -15
  const X1 = 15
  const Z0 = -15
  const Z1 = 15
  const T = 0.3 // hut wall thickness
  const P = 0.4 // parapet thickness
  const PARAPET = 1.1
  const DECK = 3 // water tank deck level
  const BELOW = -12 // how far down the visible building goes
  const deco = { collide: false } as const
  const solid = { render: false } as const

  // ─── Building: roof slab, facade, parapet, invisible boundary ──────────────────────────
  m.span([X0 - P, BELOW, Z0 - P], [X1 + P, 0, Z1 + P], 'concrete')
  // Window bands down the facade (seen over the parapet).
  for (let y = -1.2; y > BELOW + 1; y -= 3.5) {
    const y0 = y - 1.6
    m.span([X0 - P - 0.02, y0, Z0 - P - 0.02], [X1 + P + 0.02, y, Z0 - P], 'screen', deco)
    m.span([X0 - P - 0.02, y0, Z1 + P], [X1 + P + 0.02, y, Z1 + P + 0.02], 'screen', deco)
    m.span([X0 - P - 0.02, y0, Z0 - P], [X0 - P, y, Z1 + P], 'screen', deco)
    m.span([X1 + P, y0, Z0 - P], [X1 + P + 0.02, y, Z1 + P], 'screen', deco)
  }
  const edges: [[number, number, number], [number, number, number]][] = [
    [
      [X0 - P, 0, Z0 - P],
      [X1 + P, 0, Z0],
    ],
    [
      [X0 - P, 0, Z1],
      [X1 + P, 0, Z1 + P],
    ],
    [
      [X0 - P, 0, Z0],
      [X0, 0, Z1],
    ],
    [
      [X1, 0, Z0],
      [X1 + P, 0, Z1],
    ],
  ]
  for (const [a, b] of edges) {
    m.span(a, [b[0], PARAPET, b[2]], 'concrete') // parapet (low cover)
    m.span(
      [a[0] - 0.03, PARAPET, a[2] - 0.03],
      [b[0] + 0.03, PARAPET + 0.05, b[2] + 0.03],
      'metal',
      deco,
    ) // coping
    m.span([a[0], PARAPET, a[2]], [b[0], 12, b[2]], 'concrete', solid) // nobody falls off
  }

  // ─── Neighbouring roofs (scenery only) ──────────────────────────────────────────────────
  m.span([-26, BELOW, -36], [6, -5, -24], 'concrete', deco) // north, lower
  m.span([-18, -5, -32], [-12, -3, -27], 'metal', deco) // its plant room
  m.span([12, BELOW, -36], [30, 16, -22], 'concrete', deco) // north-east tower
  for (let y = BELOW + 2; y < 15; y += 3.5) {
    m.span([12, y, -22.02], [30, y + 1.6, -22], 'screen', deco)
    m.span([11.98, y, -36], [12, y + 1.6, -22], 'screen', deco)
  }
  m.span([24, BELOW, -14], [40, -8, 18], 'concrete', deco) // east, lower
  m.span([30, -8, 0], [34, -6, 6], 'metal', deco)
  m.span([-18, BELOW, 24], [22, -3, 34], 'concrete', deco) // south, lower
  m.span([-4, -3, 27], [2, -1.2, 31], 'metal', deco)

  // ─── Roof finishes ──────────────────────────────────────────────────────────────────────
  const finish = (x0: number, z0: number, x1: number, z1: number, mat: MaterialId) =>
    m.span([x0, 0, z0], [x1, 0.012, z1], mat, deco)
  finish(-8.5, -9, -6.5, 3.5, 'tile') // maintenance walkway, hut → tank
  finish(-6.5, -9, 14, -7.5, 'tile') // along the ducts

  // ─── Helpers (as in office.ts) ──────────────────────────────────────────────────────────
  /** Wall along X (from x0 to x1 at z) with door gaps [centre, width]; door head at 2.4 m. */
  const wallX = (
    x0: number,
    x1: number,
    z: number,
    h: number,
    mat: MaterialId,
    doors: [number, number][] = [],
  ) => {
    let cursor = x0
    for (const [c, w] of [...doors].sort((a, b) => a[0] - b[0])) {
      if (c - w / 2 > cursor) m.span([cursor, 0, z - T / 2], [c - w / 2, h, z + T / 2], mat)
      m.span([c - w / 2, 2.4, z - T / 2], [c + w / 2, h, z + T / 2], mat)
      cursor = c + w / 2
    }
    if (cursor < x1) m.span([cursor, 0, z - T / 2], [x1, h, z + T / 2], mat)
  }
  const wallZ = (
    z0: number,
    z1: number,
    x: number,
    h: number,
    mat: MaterialId,
    doors: [number, number][] = [],
  ) => {
    let cursor = z0
    for (const [c, w] of [...doors].sort((a, b) => a[0] - b[0])) {
      if (c - w / 2 > cursor) m.span([x - T / 2, 0, cursor], [x + T / 2, h, c - w / 2], mat)
      m.span([x - T / 2, 2.4, c - w / 2], [x + T / 2, h, c + w / 2], mat)
      cursor = c + w / 2
    }
    if (cursor < z1) m.span([x - T / 2, 0, cursor], [x + T / 2, h, z1], mat)
  }
  /** Straight stairs from (zStart, y0) climbing towards -Z, full-width solid treads. */
  const stairs = (x0: number, x1: number, zStart: number, y0: number, rise: number) => {
    const steps = Math.round(rise / 0.25)
    for (let i = 1; i <= steps; i++) {
      const zNear = zStart - (i - 1) * 0.3
      m.span([x0, y0, zNear], [x1, y0 + i * 0.25, zNear - 0.3], 'metal')
    }
  }
  /** Big AC unit: high cover (2 m), fans on top. */
  const acUnit = (x: number, z: number, w = 2.6, d = 1.8) => {
    m.block(x, 0, z, w, 2, d, 'metal')
    for (const dx of [-w / 4, w / 4]) {
      m.block(x + dx, 2, z, d * 0.6, 0.06, d * 0.6, 'screen', deco) // fan grille
      m.block(x + dx, 2.06, z, 0.12, 0.08, 0.12, 'metal', deco) // hub
    }
    m.block(x, 0.3, z + d / 2 + 0.03, w * 0.8, 1.2, 0.04, 'rack', deco) // side grille
    m.block(x, 0.3, z - d / 2 - 0.03, w * 0.8, 1.2, 0.04, 'rack', deco)
  }
  /** Condenser: low cover (1.2 m). */
  const condenser = (x: number, z: number) => {
    m.block(x, 0, z, 1.4, 1.2, 1.4, 'metal')
    m.block(x, 1.2, z, 0.9, 0.04, 0.9, 'screen', deco)
  }
  /** Mushroom vent: a small knee-high obstacle. */
  const vent = (x: number, z: number) => {
    m.block(x, 0, z, 0.45, 0.8, 0.45, 'metal')
    m.block(x, 0.8, z, 0.8, 0.15, 0.8, 'metal', deco)
  }
  /** Exhaust stack: thin and tall, breaks sightlines without blocking paths. */
  const stack = (x: number, z: number) => {
    m.block(x, 0, z, 0.5, 2.6, 0.5, 'metal')
    m.block(x, 2.6, z, 0.6, 0.1, 0.6, 'concrete', deco)
  }
  /**
   * Row of solar panels along X, tilted towards the south: low cover (one 1.1 m collider), the
   * frame and panel are decoration.
   */
  const solarRow = (x0: number, x1: number, z: number) => {
    const w = x1 - x0
    const x = (x0 + x1) / 2
    m.block(x, 0, z, w, 1.1, 1.2, 'metal', solid)
    m.block(x, 0, z, w, 0.1, 1.2, 'metal', deco) // base rail
    for (let lx = x0 + 0.2; lx <= x1 - 0.19; lx += (w - 0.4) / Math.max(1, Math.round(w / 2))) {
      m.block(lx, 0, z + 0.45, 0.08, 0.55, 0.08, 'metal', deco) // front leg
      m.block(lx, 0, z - 0.45, 0.08, 0.95, 0.08, 'metal', deco) // back leg
    }
    m.box({
      center: [x, 0.82, z],
      size: [w, 0.05, 1.25],
      rotation: [0.36, 0, 0], // ~20°, high edge to the north
      material: 'screen',
      collide: false,
    })
  }

  // ─── Stairwell hut (north-west): one door, east side ────────────────────────────────────
  const HUT_H = 3.2
  const hx0 = -13.5
  const hx1 = -9
  const hz0 = -13.5
  const hz1 = -9
  const DOOR_Z = -11.25
  wallX(hx0, hx1, hz0 + T / 2, HUT_H, 'plaster')
  wallX(hx0, hx1, hz1 - T / 2, HUT_H, 'plaster')
  wallZ(hz0, hz1, hx0 + T / 2, HUT_H, 'plaster')
  wallZ(hz0, hz1, hx1 - T / 2, HUT_H, 'plaster', [[DOOR_Z, 1.6]])
  m.span([hx0 - 0.1, HUT_H, hz0 - 0.1], [hx1 + 0.1, HUT_H + 0.25, hz1 + 0.1], 'concrete')
  finish(hx0 + T, hz0 + T, hx1 - T, hz1 - T, 'tile')
  // Inside: the (locked) door down to the offices, a fuse box, a crate.
  m.span([hx0 + T, 0, -12], [hx0 + T + 0.04, 2.2, -10.6], 'metal', deco)
  m.span([hx0 + T + 0.04, 1.0, -10.85], [hx0 + T + 0.08, 1.1, -10.75], 'accent', deco) // handle
  m.span([-10.8, 1.1, hz0 + T], [-10.0, 2.0, hz0 + T + 0.2], 'rack', deco) // fuse box
  m.block(-12.6, 0, -12.6, 1.0, 1.0, 1.0, 'wood') // crate (low cover)
  // Outside: lamp over the door, antenna mast on the roof.
  m.span([hx1, 2.55, DOOR_Z - 0.2], [hx1 + 0.2, 2.7, DOOR_Z + 0.2], 'lightpanel', deco)
  m.block(-12.5, HUT_H + 0.25, -12.5, 0.15, 3.5, 0.15, 'metal', deco)
  m.block(-12.5, HUT_H + 2.2, -12.5, 1.2, 0.05, 0.05, 'metal', deco)

  // ─── Water tank on legs (south-west), deck at 3 m, stairs up from the south ─────────────
  // Sized so the walkways round the tank line up with the random-spawn grid (1.5 m).
  const dx0 = -13
  const dx1 = -6
  const dz0 = 3.5
  const dz1 = 10.5
  const TX = -9.75 // tank centre
  const TZ = 6.75
  const SX0 = -7.9 // stair x range
  const SX1 = -6.7
  m.span([dx0, DECK - 0.25, dz0], [dx1, DECK, dz1], 'metal') // deck
  for (const [x, z] of [
    [dx0 + 0.2, dz0 + 0.2],
    [dx1 - 0.2, dz0 + 0.2],
    [dx0 + 0.2, dz1 - 0.2],
    [dx1 - 0.2, dz1 - 0.2],
  ] as const) {
    m.block(x, 0, z, 0.3, DECK - 0.25, 0.3, 'metal') // legs
  }
  m.block(TX, 0, TZ, 0.7, DECK - 0.25, 0.7, 'metal') // centre leg
  m.span([dx0 + 0.2, 1.2, dz0 + 0.17], [dx1 - 0.2, 1.3, dz0 + 0.23], 'metal', deco) // braces
  m.span([dx0 + 0.17, 1.2, dz0 + 0.2], [dx0 + 0.23, 1.3, dz1 - 0.2], 'metal', deco)
  // Railing round the deck (solid 1 m kick panel: low cover), gap where the stairs arrive.
  const RAIL = 1.0
  m.span([dx0, DECK, dz0], [dx1, DECK + RAIL, dz0 + 0.1], 'metal')
  m.span([dx0, DECK, dz0], [dx0 + 0.1, DECK + RAIL, dz1], 'metal')
  m.span([dx1 - 0.1, DECK, dz0], [dx1, DECK + RAIL, dz1], 'metal')
  m.span([dx0, DECK, dz1 - 0.1], [SX0, DECK + RAIL, dz1], 'metal')
  m.span([SX1, DECK, dz1 - 0.1], [dx1, DECK + RAIL, dz1], 'metal')
  // The tank: two crossed boxes read as a squat cylinder.
  m.block(TX, DECK, TZ, 2.8, 2.6, 2.2, 'metal')
  m.block(TX, DECK, TZ, 2.2, 2.6, 2.8, 'metal')
  m.block(TX, DECK + 2.6, TZ, 2.3, 0.25, 2.3, 'metal', deco) // lid
  m.block(TX, DECK + 0.8, TZ, 2.84, 0.12, 2.24, 'concrete', deco) // bands
  m.block(TX, DECK + 1.8, TZ, 2.24, 0.12, 2.84, 'concrete', deco)
  stairs(SX0, SX1, dz1 + 12 * 0.3, 0, DECK)
  for (const x of [SX0 - 0.04, SX1 + 0.04]) {
    // Handrails along the stair (decoration).
    m.box({
      center: [x, DECK / 2 + 0.95, dz1 + 1.8],
      size: [0.05, 0.05, Math.hypot(3.6, DECK)],
      rotation: [Math.atan2(DECK, 3.6), 0, 0],
      material: 'metal',
      collide: false,
    })
  }

  // ─── Solar panel field (west-centre): three rows, each split by a gap ───────────────────
  for (const z of [-5.5, -2.5, 0.5]) {
    solarRow(-14.4, -9, z)
    solarRow(-7.6, -3.1, z)
  }

  // ─── Helipad (east): open ground, painted ring and H, edge lights ───────────────────────
  const HX = 8.5
  const HZ = 5
  const R = 4.5
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2
    m.box({
      center: [HX + Math.cos(a) * R, 0.008, HZ + Math.sin(a) * R],
      size: [0.35, 0.012, 1.25],
      rotation: [0, -a, 0],
      material: 'marker',
      collide: false,
    })
  }
  m.span([HX - 1.3, 0, HZ - 1.8], [HX - 0.8, 0.016, HZ + 1.8], 'plaster', deco)
  m.span([HX + 0.8, 0, HZ - 1.8], [HX + 1.3, 0.016, HZ + 1.8], 'plaster', deco)
  m.span([HX - 0.8, 0, HZ - 0.25], [HX + 0.8, 0.016, HZ + 0.25], 'plaster', deco)
  const padLights: [number, number][] = []
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8
    const x = HX + Math.cos(a) * (R + 0.6)
    const z = HZ + Math.sin(a) * (R + 0.6)
    padLights.push([x, z])
    m.block(x, 0, z, 0.2, 0.08, 0.2, 'lightpanel', deco)
  }

  // ─── Machinery: AC units, condensers, ducts, vents, stacks ──────────────────────────────
  acUnit(-1.5, -13.5) // north, against the parapet
  acUnit(4.5, -13.5)
  acUnit(1.5, 13.5) // south, against the parapet
  acUnit(9.5, -5.5) // equipment yard
  condenser(13.7, -7) // east edge
  condenser(13.7, -4.2)
  condenser(-4, 13.7) // south edge
  condenser(13.7, 13.7) // south-east corner
  // Elevator overrun: the tall block in the middle that keeps the roof from being one big
  // open field (3.4 m, nobody gets on top).
  m.span([-1.5, 0, -3], [2.5, 3.4, 2.5], 'plaster')
  m.span([-1.6, 3.4, -3.1], [2.6, 3.6, 2.6], 'concrete')
  m.span([-0.2, 0, 2.5], [1.2, 2.2, 2.54], 'metal', deco) // service door (locked)
  m.span([-1.54, 2.2, -2.2], [-1.5, 2.8, 1.5], 'rack', deco) // louvre
  // Equipment yard (north-east): a 2.4 m louvred screen wall from the overrun to near the east
  // parapet shuts it off from the helipad; in from the east end or from the north.
  m.span([2.5, 0, -3], [12.4, 2.4, -2.8], 'metal')
  for (let x = 2.9; x < 12.4; x += 0.8) {
    m.span([x - 0.03, 0.2, -2.82], [x + 0.03, 2.3, -2.78], 'rack', deco) // louvre ribs
  }
  // Duct run north of the centre, with a gap to cross (0.9 m: low cover, jump over).
  m.span([-4, 0, -8.45], [1, 0.9, -7.55], 'metal')
  m.span([3, 0, -8.45], [9, 0.9, -7.55], 'metal')
  m.span([-4.1, 0.9, -8.5], [-3.5, 2.8, -7.5], 'metal') // riser at the west end
  m.span([8.5, 0.9, -8.5], [9.1, 1.6, -7.5], 'metal') // elbow at the east end
  // Roof hatch housing between the north AC units and the duct (high cover).
  m.block(1.5, 0, -10.2, 1.2, 2, 1.2, 'metal')
  // Air handler in the yard.
  m.block(5.5, 0, -5, 2.2, 2, 1.4, 'metal')
  m.block(5.5, 0.3, -4.28, 1.8, 1.2, 0.04, 'rack', deco)
  // Exhaust riser against the west parapet, closing the lane along that edge.
  m.span([X0, 0, 1.6], [X0 + 1.1, 2.6, 3], 'metal')
  // Inverter cabinet in the middle solar row's gap (high cover).
  m.block(-8.3, 0, -2.5, 1.8, 2, 1, 'metal')
  m.block(-8.3, 0.4, -1.98, 1, 1.2, 0.04, 'rack', deco)
  // Under the deck: the north side is clad down to the roof (one door), so it's a sheltered
  // pocket rather than a window onto the whole roof.
  m.span([dx0, 0, dz0], [-7.8, DECK - 0.25, dz0 + 0.2], 'metal')
  m.span([-7.8, 2.4, dz0], [-6.2, DECK - 0.25, dz0 + 0.2], 'metal') // over the door
  m.span([-6.2, 0, dz0], [dx1, DECK - 0.25, dz0 + 0.2], 'metal')
  // Pressure vessels under the tank deck.
  for (const z of [5, 7.3, 9.6]) m.block(-7.2, 0, z, 1, 2.2, 1, 'metal')
  // Pump house south-west of the overrun (high cover).
  m.span([-4.5, 0, 4.2], [-2.1, 2.4, 7.6], 'plaster')
  m.span([-4.6, 2.4, 4.1], [-2, 2.55, 7.7], 'concrete', deco)
  m.span([-2.1, 0, 5.8], [-2.06, 2.1, 6.8], 'metal', deco) // door
  // Generator in the south-west corner (high cover).
  m.block(-11, 0, 12.5, 2.4, 2.2, 1.4, 'metal')
  m.block(-11, 0.3, 11.78, 2, 1.2, 0.04, 'rack', deco)
  m.block(-10.2, 2.2, 12.5, 0.3, 0.6, 0.3, 'metal', deco) // exhaust
  // Helipad: equipment locker on its west edge, electrical cabinet on its south edge.
  m.block(3.6, 0, 3.4, 1, 2, 1.6, 'metal')
  m.block(3.12, 1.2, 3.4, 0.04, 0.5, 1.2, 'accent', deco)
  m.block(6.5, 0, 9.9, 2, 2, 0.8, 'metal')
  m.block(6.5, 0.3, 10.32, 1.6, 1.4, 0.04, 'rack', deco)
  vent(-4.5, 2.4)
  vent(9.5, -11)
  vent(-5.5, -11.5)
  vent(12, 1)
  stack(0.5, -5.5)
  stack(-2.2, 9.5)
  // Exhaust fan housing beside the skylight (high cover).
  m.block(1.8, 0, 8.6, 1.2, 2, 1.2, 'metal')
  m.block(1.8, 2, 8.6, 0.9, 0.06, 0.9, 'screen', deco)
  stack(13.6, 10)
  // Skylight south of the overrun (low: 0.7 m).
  m.span([-1.5, 0, 6.3], [0.9, 0.6, 8.7], 'metal')
  m.span([-1.4, 0.6, 6.4], [0.8, 0.7, 8.6], 'glass')
  // Satellite dish on a plinth (north-east corner).
  m.block(12.5, 0, -12.5, 1.6, 0.6, 1.6, 'concrete')
  m.block(12.5, 0.6, -12.5, 0.15, 0.9, 0.15, 'metal', deco)
  m.box({
    center: [12.5, 1.7, -12.5],
    size: [1.5, 1.5, 0.08],
    rotation: [0.5, 0.7, 0],
    material: 'plaster',
    collide: false,
  })

  // ─── Lights (dusk: lamps are starting to come on) ───────────────────────────────────────
  const warm = 0xffc078
  m.light({ kind: 'point', pos: [hx1 + 0.4, 2.6, DOOR_Z], color: warm, intensity: 10, distance: 8 }) // hut door
  m.light({ kind: 'point', pos: [-11.25, 2.8, -11.25], color: 0xdfe8ff, intensity: 8, distance: 6 }) // hut inside
  m.light({ kind: 'point', pos: [-12.5, 7, -12.5], color: 0xff3030, intensity: 6, distance: 8 }) // mast beacon
  m.light({ kind: 'point', pos: [-6.6, DECK + 1.6, 10.1], color: warm, intensity: 10, distance: 9 }) // deck
  m.light({ kind: 'point', pos: [TX - 1, 2.2, TZ], color: warm, intensity: 6, distance: 6 }) // under the deck
  for (const [x, z] of padLights.filter((_, i) => i % 2 === 0)) {
    m.light({ kind: 'point', pos: [x, 0.4, z], color: 0x9dffa0, intensity: 3, distance: 5 })
  }
  m.light({ kind: 'point', pos: [1.5, 2.6, -11], color: warm, intensity: 8, distance: 9 }) // AC bank
  m.light({ kind: 'point', pos: [12, 2.4, -5.5], color: warm, intensity: 8, distance: 8 }) // condensers
  m.light({ kind: 'point', pos: [0.5, 3, 3.1], color: warm, intensity: 8, distance: 8 }) // overrun door
  m.light({ kind: 'point', pos: [0, 2.4, 11], color: warm, intensity: 8, distance: 9 }) // south AC

  // ─── Spawns (feet), facing into the action ──────────────────────────────────────────────
  const N = 0
  const S = 180
  const E = -90
  const W = 90
  m.spawn(-11.25, 0, -11.2, E) // inside the hut
  m.spawn(-12.5, 0, 2.3, E) // west, between the solar field and the tank
  m.spawn(7, 0, -13, S) // north, beside the AC bank
  m.spawn(12.8, 0, -10, W) // north-east
  m.spawn(13.2, 0, 11, W) // south-east
  m.spawn(-1.5, 0, 13.5, N) // south edge
  m.spawn(-4, 0, 9, N) // by the tank stairs
  m.spawn(7.4, 0, -3.8, W) // equipment yard
  m.spawn(12.6, 0, 3, W) // east of the helipad
  m.spawn(-12.1, DECK, TZ, E) // on the water tank deck
  m.randomSpawnsIn([X0 + 0.5, Z0 + 0.5], [X1 - 0.5, Z1 - 0.5])

  // ─── Weapons lying around (you spawn with only the handgun) ────────────────────────────
  const RIFLE = 1
  const SNIPER = 2
  const SHOTGUN = 3
  const MP5 = 5
  m.pickup(HX, 0, HZ, SNIPER) // helipad centre: the most exposed spot on the roof
  m.pickup(TX, DECK, dz0 + 0.8, RIFLE) // tank deck, behind the tank
  m.pickup(-10.5, 0, -12.2, SHOTGUN) // inside the stairwell hut
  m.pickup(-11.5, 0, TZ, SHOTGUN) // under the tank deck, among the legs
  m.pickup(11, 0, 12.5, SHOTGUN) // south-east corner by the condenser
  m.pickup(1.5, 0, -13.5, RIFLE) // north, between the AC units
  m.pickup(-8.3, 0, -1, MP5) // solar field, by the inverter cabinet
  return m.build()
}
