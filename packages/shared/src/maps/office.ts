import { MapBuilder } from './builder.ts'
import type { MapDef, MaterialId } from './types.ts'

/**
 * "Main Office" — a modern two-level office (PLAN.md §7). 60 × 40 m, built from boxes so it can
 * be iterated quickly; real photos of the office will reshape it later.
 *
 *   z=-20 ┌─ north wing, two floors ──────────────────────────────────────────┐
 *         │ UP:  stairwell │ games room │ office │ office │ lounge │ CEO      │
 *         │ GND: stairwell │ boardroom  │ storage         │ quiet  │ servers  │
 *   z=-6  ├═ gallery edge with glass railing (high ground) — grand + east stairs ═┤
 *         │ reception     │ open-plan desks (double height hall) │ kitchen    │
 *         │               │ glass meeting rooms along the south  │            │
 *   z=20  └──────────── windows all round, city skyline outside ──────────────┘
 *        x=-30                                                             x=30
 *
 * Metrics follow the gym: low cover 1.0–1.25 m, high cover ≥ 1.9 m, doors 1.4–2 m, stairs
 * 0.25 rise / 0.3 run, floor-to-floor 4.5 m. Three ways up to the gallery (wide and exposed in
 * the middle, kitchen stairs east, enclosed stairwell west) so high ground is never safe.
 */
export function buildOffice(): MapDef {
  const m = new MapBuilder('office', 'Main Office', {
    sunDirection: [-0.55, 0.75, 0.6],
    sunColor: 0xfff0d8,
    sunIntensity: 2.4,
    skyColor: 0xdfe8f5,
    groundColor: 0x6b6158,
    ambientIntensity: 1.35,
    fogColor: 0xc9d6e6,
    fogNear: 60,
    fogFar: 260,
  }).withSkyline()

  const X0 = -30
  const X1 = 30
  const Z0 = -20
  const Z1 = 20
  const UP = 4.5 // upper floor level
  const SLAB = 0.3
  const ROOF = 9
  const T = 0.3 // wall thickness
  const UNDER_STAIRS_DOOR = -16.5 // z of the door from under the west stairs to the boardroom
  const deco = { collide: false } as const
  const solid = { render: false } as const

  // ─── Shell: floor, roof, upper slab ─────────────────────────────────────────────────────
  m.span([X0 - 1, -0.5, Z0 - 1], [X1 + 1, 0, Z1 + 1], 'concrete')
  m.span([X0 - T, ROOF, Z0 - T], [X1 + T, ROOF + SLAB, Z1 + T], 'ceiling')
  // North wing upper slab, with a hole over the west stairwell (x -30..-26, z -13.4..-8).
  m.span([-26, UP - SLAB, Z0], [X1, UP, -6], 'ceiling')
  m.span([X0, UP - SLAB, Z0], [-26, UP, -13.4], 'ceiling')
  m.span([X0, UP - SLAB, -8], [-26, UP, -6], 'ceiling')

  // ─── Exterior walls with floor-to-ceiling windows ───────────────────────────────────────
  // Bands: sill 0–1, glass 1–3.6, slab band 3.6–5.4, glass 5.4–8.2, top 8.2–roof.
  const bands: [number, number, MaterialId][] = [
    [0, 1, 'concrete'],
    [1, 3.6, 'glass'],
    [3.6, 5.4, 'concrete'],
    [5.4, 8.2, 'glass'],
    [8.2, ROOF, 'concrete'],
  ]
  const facade = (axis: 'x' | 'z', fixed: number, from: number, to: number, outward: number) => {
    const a = fixed
    const b = fixed + outward * T
    for (const [y0, y1, mat] of bands) {
      if (axis === 'z') m.span([from, y0, a], [to, y1, b], mat)
      else m.span([a, y0, from], [b, y1, to], mat)
    }
    // Mullions every 6 m.
    for (let p = from; p <= to + 0.01; p += 6) {
      if (axis === 'z') m.span([p - 0.15, 0, a], [p + 0.15, ROOF, b + outward * 0.05], 'metal')
      else m.span([a, 0, p - 0.15], [b + outward * 0.05, ROOF, p + 0.15], 'metal')
    }
  }
  facade('z', Z1, X0, X1, 1)
  facade('z', Z0, X0, X1, -1)
  facade('x', X0, Z0, Z1, -1)
  facade('x', X1, Z0, Z1, 1)

  // ─── Floor finishes (thin, render-only, above the concrete) ─────────────────────────────
  const finish = (x0: number, z0: number, x1: number, z1: number, mat: MaterialId, y = 0) =>
    m.span([x0, y, z0], [x1, y + 0.012, z1], mat, deco)
  finish(X0, -6, -16, Z1, 'wood') // reception
  finish(-16, 1.5, 12, 12.5, 'carpet') // open plan
  finish(14, -6, X1, Z1, 'tile') // kitchen
  finish(-24, Z0, -10, -8, 'carpet') // boardroom
  finish(0, Z0, 16, -8, 'carpet') // quiet room
  finish(-26, Z0, X1, -6, 'carpet', UP) // upper floor
  finish(-26, Z0, -12, -13, 'wood', UP) // games room

  // ─── Helpers ────────────────────────────────────────────────────────────────────────────
  /** Wall along X (from x0 to x1 at z) with door gaps [centre, width]; door head at 2.4 m. */
  const wallX = (
    x0: number,
    x1: number,
    z: number,
    y0: number,
    h: number,
    mat: MaterialId,
    doors: [number, number][] = [],
  ) => {
    let cursor = x0
    for (const [c, w] of [...doors].sort((a, b) => a[0] - b[0])) {
      if (c - w / 2 > cursor) m.span([cursor, y0, z - T / 2], [c - w / 2, y0 + h, z + T / 2], mat)
      if (h > 2.4) m.span([c - w / 2, y0 + 2.4, z - T / 2], [c + w / 2, y0 + h, z + T / 2], mat)
      cursor = c + w / 2
    }
    if (cursor < x1) m.span([cursor, y0, z - T / 2], [x1, y0 + h, z + T / 2], mat)
  }
  const wallZ = (
    z0: number,
    z1: number,
    x: number,
    y0: number,
    h: number,
    mat: MaterialId,
    doors: [number, number][] = [],
  ) => {
    let cursor = z0
    for (const [c, w] of [...doors].sort((a, b) => a[0] - b[0])) {
      if (c - w / 2 > cursor) m.span([x - T / 2, y0, cursor], [x + T / 2, y0 + h, c - w / 2], mat)
      if (h > 2.4) m.span([x - T / 2, y0 + 2.4, c - w / 2], [x + T / 2, y0 + h, c + w / 2], mat)
      cursor = c + w / 2
    }
    if (cursor < z1) m.span([x - T / 2, y0, cursor], [x + T / 2, y0 + h, z1], mat)
  }
  /** Straight stairs from (zStart, y0) climbing towards -Z, full-width solid treads. */
  const stairs = (x0: number, x1: number, zStart: number, y0: number, rise: number) => {
    const steps = Math.round(rise / 0.25)
    for (let i = 1; i <= steps; i++) {
      const zNear = zStart - (i - 1) * 0.3
      m.span([x0, y0, zNear], [x1, y0 + i * 0.25, zNear - 0.3], 'concrete')
    }
  }
  /** Two facing desks with screens and a privacy panel: low cover (1.2 m at the panel). */
  const deskCluster = (x: number, z: number, y = 0) => {
    m.block(x, y, z, 3.2, 0.75, 1.6, 'desk', solid)
    m.block(x, y + 0.72, z, 3.2, 0.03, 1.6, 'desk', deco) // top
    for (const sx of [-1.5, 1.5])
      for (const sz of [-0.7, 0.7]) m.block(x + sx, y, z + sz, 0.06, 0.72, 0.06, 'metal', deco)
    m.block(x, y + 0.75, z, 3.2, 0.5, 0.04, 'fabric') // privacy panel
    for (const sx of [-0.8, 0.8]) {
      for (const sz of [-0.35, 0.35]) {
        m.block(x + sx, y + 0.75, z + sz, 0.55, 0.34, 0.03, 'screen', deco) // monitor
        m.block(x + sx, y + 0.75, z + sz, 0.06, 0.12, 0.06, 'metal', deco)
        // Chair: seat + back, walk-through (chairs move in real life).
        const cz = z + sz * 3
        m.block(x + sx, y, cz, 0.5, 0.48, 0.5, 'fabricAlt', deco)
        m.block(x + sx, y + 0.48, cz + Math.sign(sz) * 0.22, 0.5, 0.5, 0.06, 'fabricAlt', deco)
      }
    }
  }
  const plant = (x: number, z: number, y = 0, tall = 1.6) => {
    m.block(x, y, z, 0.5, 0.45, 0.5, 'concrete') // pot (low obstacle)
    m.block(x, y + 0.45, z, 0.8, tall - 0.45, 0.8, 'plant', deco)
  }
  const sofa = (
    x: number,
    z: number,
    w: number,
    d: number,
    facing: 'n' | 's' | 'e' | 'w',
    y = 0,
  ) => {
    m.block(x, y, z, w, 0.45, d, 'fabric')
    const back = 0.25
    if (facing === 's') m.block(x, y + 0.45, z - d / 2 + back / 2, w, 0.4, back, 'fabric')
    if (facing === 'n') m.block(x, y + 0.45, z + d / 2 - back / 2, w, 0.4, back, 'fabric')
    if (facing === 'e') m.block(x - w / 2 + back / 2, y + 0.45, z, back, 0.4, d, 'fabric')
    if (facing === 'w') m.block(x + w / 2 - back / 2, y + 0.45, z, back, 0.4, d, 'fabric')
  }
  const lightPanels = (x0: number, x1: number, z0: number, z1: number, y: number, step = 4) => {
    for (let x = x0 + step / 2; x < x1; x += step) {
      for (let z = z0 + step / 2; z < z1; z += step) {
        m.block(x, y - 0.06, z, 1.2, 0.05, 0.6, 'lightpanel', deco)
      }
    }
  }

  // ─── Gallery edge: pillars, railing, stairs ─────────────────────────────────────────────
  for (const x of [-24, -16, -8, 8, 16, 24]) m.block(x, 0, -6.3, 0.6, UP - SLAB, 0.6, 'plaster')
  // Glass railing on the gallery edge, gaps where the grand (x -2..2) and east (26.2..29.6) stairs arrive.
  for (const [a, b] of [
    [-26, -2],
    [2, 26.2],
  ] as const) {
    m.span([a, UP, -6.05], [b, UP + 1.1, -5.95], 'glass')
    m.span([a, UP + 1.1, -6.07], [b, UP + 1.16, -5.93], 'metal')
  }
  stairs(-2, 2, -0.6, 0, UP) // grand stairs
  m.span([-2.1, 0, -6], [-2, UP + 1.1, -0.6], 'glass') // stair side glass
  m.span([2, 0, -6], [2.1, UP + 1.1, -0.6], 'glass')
  stairs(26.2, 29.6, -0.6, 0, UP) // east stairs (kitchen)
  m.span([26.1, 0, -6], [26.2, UP + 1.1, -0.6], 'glass')

  // ─── West stairwell (enclosed, ground → games room) ─────────────────────────────────────
  stairs(X0, -26, -8, 0, UP)
  // Ground floor side wall. The room under the landing (z -20..-13.4) is closed in by the stair
  // flight, so it gets a door through to the boardroom (wall at x -24 has the matching door).
  wallZ(-20, -8, -26, 0, UP - SLAB, 'plaster', [[UNDER_STAIRS_DOOR, 1.6]])
  m.span([-26.05, UP, -13.4], [-25.95, UP + 1.1, -8], 'glass') // upper: railing over the hole
  m.span([X0, UP, -8.05], [-26, UP + 1.1, -7.95], 'glass')

  // ─── Ground floor, north wing rooms (behind the corridor under the gallery) ─────────────
  // Front wall at z = -8 with doors; room separators.
  wallX(-26, -24, -8, 0, UP - SLAB, 'plaster')
  wallX(-24, -10, -8, 0, UP - SLAB, 'glass', [[-17, 1.6]]) // boardroom: glass front
  m.span([-10, 0, Z0], [0, UP - SLAB, -8], 'plaster') // storage / toilets block (closed)
  m.block(-5, 0.6, -7.9, 2.2, 1.6, 0.05, 'whiteboard', deco)
  wallX(0, 16, -8, 0, UP - SLAB, 'plaster', [
    [4, 1.6],
    [12, 1.6],
  ]) // quiet room
  wallX(16, X1, -8, 0, UP - SLAB, 'plaster', [[18.4, 1.4]]) // server room: one door (choke)
  wallZ(Z0, -8, -24, 0, UP - SLAB, 'plaster', [[UNDER_STAIRS_DOOR, 1.6]])
  wallZ(Z0, -8, 16, 0, UP - SLAB, 'plaster')

  // Boardroom: long table, screen, chairs.
  m.block(-17, 0, -14, 7, 0.75, 1.8, 'desk')
  m.block(-17, 1.1, -19.75, 3.2, 1.8, 0.08, 'screen', deco)
  for (let x = -20; x <= -14; x += 1.5) {
    m.block(x, 0, -15.3, 0.5, 0.9, 0.5, 'fabricAlt', deco)
    m.block(x, 0, -12.7, 0.5, 0.9, 0.5, 'fabricAlt', deco)
  }
  plant(-23, -9)

  // Quiet room: bookshelves (high cover) and armchairs.
  for (const z of [-17.5, -12.5]) {
    m.block(4.5, 0, z, 5, 2.1, 0.5, 'desk')
    m.block(11.5, 0, z, 5, 2.1, 0.5, 'desk')
  }
  sofa(8, -15, 2.2, 1, 's')
  plant(1, -19)
  plant(15, -9.2)

  // Server room: rack rows with a cross aisle — tight close quarters, blue light.
  for (const z of [-17.6, -14.8, -12]) {
    m.span([18.6, 0, z - 0.4], [23, 2.1, z + 0.4], 'rack')
    m.span([24.4, 0, z - 0.4], [29, 2.1, z + 0.4], 'rack')
  }

  // ─── Ground floor hall ──────────────────────────────────────────────────────────────────
  // Two big pillars holding the roof.
  m.block(-16, 0, 9, 0.8, ROOF, 0.8, 'plaster')
  m.block(13.5, 0, 9, 0.8, ROOF, 0.8, 'plaster')

  // Open-plan desks: two rows of four clusters.
  for (const z of [4, 9.5]) for (const x of [-12, -6, 0, 6]) deskCluster(x, z)
  plant(-14.8, 1.8)
  plant(9.8, 1.8)
  plant(-2.8, 12.5, 0, 1.3)

  // Glass meeting rooms along the south wall (doors face the desks).
  for (const x0 of [-14, -6, 2]) {
    wallX(x0, x0 + 6, 14, 0, 2.8, 'glass', [[x0 + 1.4, 1.4]])
    wallZ(14, Z1, x0, 0, 2.8, 'glass')
    wallZ(14, Z1, x0 + 6, 0, 2.8, 'glass')
    m.block(x0 + 3, 0, 17.2, 3, 0.75, 1.4, 'desk')
    m.block(x0 + 3, 1.1, 19.8, 2.4, 1.3, 0.06, 'screen', deco)
    for (const dx of [-1, 1]) {
      m.block(x0 + 3 + dx, 0, 16, 0.5, 0.9, 0.5, 'fabricAlt', deco)
      m.block(x0 + 3 + dx, 0, 18.4, 0.5, 0.9, 0.5, 'fabricAlt', deco)
    }
  }

  // Reception: desk with accent front, logo wall, lounge.
  m.span([-23, 0, 3.6], [-18, 1.1, 4.4], 'desk')
  m.span([-23, 0, 4.4], [-22.2, 1.1, 7], 'desk')
  m.span([-23.05, 0.1, 3.55], [-18, 1, 3.6], 'accent', deco)
  m.span([X0 + 0.01, 1.4, 1], [X0 + 0.06, 4.2, 9], 'accent', deco) // logo wall
  m.span([X0 + 0.06, 2.2, 3], [X0 + 0.1, 3.4, 7], 'plaster', deco) // logo plate
  sofa(-25, 14, 3.2, 1, 'n')
  sofa(-20, 14, 3.2, 1, 'n')
  m.block(-22.5, 0, 11.8, 2, 0.45, 1, 'desk') // coffee table
  for (const [x, z] of [
    [-28.6, -4.6],
    [-28.6, 18.6],
    [-17.4, 18.6],
    [-17.4, -4.6],
  ] as const) {
    plant(x, z)
  }

  // Kitchen & lounge: island, wall counter, coffee machine, fridge, tables, ping-pong.
  m.span([19, 0, 6], [25, 1, 7.2], 'desk') // island (low cover)
  m.span([28.85, 0, 2], [X1, 0.95, 12], 'desk') // wall counter
  m.span([29.05, 0.95, 7.4], [29.7, 1.5, 8.2], 'accent') // coffee machine (landmark)
  m.span([28.9, 0, 12.2], [X1, 2.1, 13.4], 'metal') // fridge
  for (const x of [18, 23.5]) {
    m.block(x, 0, 11.5, 2.2, 0.75, 1, 'desk')
    for (const dz of [-0.9, 0.9]) m.block(x, 0, 11.5 + dz, 1.6, 0.45, 0.4, 'fabricAlt', deco)
  }
  m.span([18, 0, 15.6], [20.74, 0.76, 17.12], 'ramp') // ping-pong table
  m.span([19.36, 0.76, 15.6], [19.38, 0.92, 17.12], 'plaster', deco) // net
  sofa(24.5, 17.5, 3, 1.1, 's')
  plant(15.2, 18.6)
  plant(28.6, 18.6)

  // ─── Upper floor ────────────────────────────────────────────────────────────────────────
  // Partition between the walkway (z -13..-6) and the rooms (z -20..-13).
  wallX(-26, -12, -13, UP, ROOF - UP, 'plaster', [[-19, 1.6]]) // games room
  wallX(-12, -5, -13, UP, ROOF - UP, 'plaster', [[-8.5, 1.4]]) // office A
  wallX(-5, 2, -13, UP, ROOF - UP, 'plaster', [[-1.5, 1.4]]) // office B
  wallX(16, X1, -13, UP, ROOF - UP, 'glass', [[23, 1.6]]) // CEO office (glass)
  for (const x of [-12, -5, 2, 16]) wallZ(Z0, -13, x, UP, ROOF - UP, 'plaster')
  // Stairwell landing (x -30..-26, z -20..-13.4) opens into the games room.
  wallZ(Z0, -13.4, -26, UP, ROOF - UP, 'plaster', [[-15.3, 1.6]])

  // Games room: pool table (landmark), sofa.
  m.block(-19, UP, -17, 2.6, 0.8, 1.4, 'ramp')
  sofa(-23.5, -19, 3, 1, 's', UP)
  plant(-13, -19.3, UP)
  // Offices: desks.
  m.block(-8.5, UP, -17.5, 2.4, 0.75, 1.2, 'desk')
  m.block(-1.5, UP, -17.5, 2.4, 0.75, 1.2, 'desk')
  // Lounge (open): sofas facing the hall.
  sofa(6, -16, 3.2, 1, 's', UP)
  sofa(11, -16, 3.2, 1, 's', UP)
  m.block(8.5, UP, -18.5, 3, 0.45, 1, 'desk', {}) // low table
  plant(2.8, -19.3, UP)
  plant(15.2, -19.3, UP)
  // CEO office: big desk, sofa.
  m.block(23, UP, -17.5, 3.2, 0.78, 1.4, 'desk')
  sofa(28, -15.5, 1, 2.6, 'w', UP)

  // Walkway cover: bench desks and planters along the gallery.
  deskCluster(-18, -9.6, UP)
  deskCluster(10, -9.6, UP)
  plant(-6, -9.6, UP, 1.3)
  plant(20.5, -9.6, UP, 1.3)

  // ─── Lights ─────────────────────────────────────────────────────────────────────────────
  lightPanels(X0, X1, -6, Z1, ROOF) // hall
  lightPanels(X0, X1, Z0, -6, UP - SLAB) // ground north wing (under the slab)
  lightPanels(-26, X1, Z0, -6, ROOF) // upper floor
  const neutral = 0xfff1df
  for (const x of [-20, 0, 20]) {
    for (const z of [3, 13])
      m.light({ kind: 'point', pos: [x, 7, z], color: neutral, intensity: 60, distance: 20 })
  }
  m.light({ kind: 'point', pos: [22, 3.2, 6.6], color: 0xffcf8a, intensity: 18, distance: 10 }) // kitchen pendant
  m.light({ kind: 'point', pos: [-21, 3, 6], color: 0xffd9a8, intensity: 14, distance: 10 }) // reception
  m.light({ kind: 'point', pos: [-17, 3.5, -14], color: neutral, intensity: 14, distance: 10 }) // boardroom
  m.light({ kind: 'point', pos: [8, 3.5, -14], color: 0xffe2b8, intensity: 14, distance: 11 }) // quiet room
  m.light({ kind: 'point', pos: [21, 3.5, -16], color: 0x5fa8ff, intensity: 16, distance: 10 }) // servers
  m.light({ kind: 'point', pos: [26.5, 3.5, -11], color: 0x5fa8ff, intensity: 16, distance: 10 })
  m.light({ kind: 'point', pos: [-28, 3, -11], color: neutral, intensity: 8, distance: 9 }) // stairwell
  for (const x of [-19, -8, 2, 12, 23]) {
    m.light({ kind: 'point', pos: [x, UP + 3.6, -13], color: neutral, intensity: 22, distance: 12 })
  }

  // ─── Spawns (feet), facing into the action ──────────────────────────────────────────────
  const N = 0
  const S = 180
  const E = -90
  const W = 90
  m.spawn(-27, 0, 10, E) // reception
  m.spawn(-26, 0, 17, E)
  m.spawn(-20, 0, 0, E)
  m.spawn(27, 0, 16, W) // kitchen
  m.spawn(17, 0, 3, W)
  m.spawn(-12.8, 0, 15.3, N) // meeting rooms, just inside the door
  m.spawn(3.2, 0, 15.3, N)
  m.spawn(-17, 0, -11, S) // boardroom
  m.spawn(8, 0, -10, S) // quiet room
  m.spawn(21, 0, -10, S) // server room
  m.spawn(-28, UP, -18, W) // stairwell landing
  m.spawn(-9, UP, -16, S) // office A
  m.spawn(23, UP, -15, S) // CEO office
  m.spawn(9, UP, -12, S) // lounge
  // Players actually spawn at random free spots on both floors (see findSpawnPoints); the fixed
  // spawns above mark the floor heights and serve as a fallback.
  m.randomSpawnsIn([X0 + 0.5, Z0 + 0.5], [X1 - 0.5, Z1 - 0.5])

  // ─── Weapons lying around (you spawn with only the handgun) ────────────────────────────
  const RIFLE = 1
  const SNIPER = 2
  m.pickup(22, 1, 6.6, RIFLE) // kitchen island
  m.pickup(-20.5, 1.1, 4, RIFLE) // reception desk
  m.pickup(-3, 0, 7, RIFLE) // open-plan aisle
  m.pickup(8, 0, -10.5, RIFLE) // quiet room
  m.pickup(-22, UP, -15, RIFLE) // games room
  m.pickup(-15, 0.75, -13.3, RIFLE) // boardroom table, near the edge
  m.pickup(23, UP + 0.78, -17.5, SNIPER) // CEO desk
  m.pickup(8.5, UP + 0.45, -18.5, SNIPER) // upper lounge table
  m.pickup(-5, 0, -2.5, SNIPER) // under the gallery beside the grand stairs, in the open — risky
  return m.build()
}
