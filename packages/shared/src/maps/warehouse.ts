import { MapBuilder } from './builder.ts'
import type { MapDef, MaterialId } from './types.ts'

/**
 * "Warehouse" — a big logistics hall, 90 × 60 m, 12 m to the roof, lit by skylight strips.
 *
 *   z=-30 ┌─ loading dock (1.25 m) ─────────────────────────────┬─ office block ─┐
 *         │ dock doors · ramps (x -32, 8) · stairs (x -9.5)     │ 2 floors,      │
 *   z=-23 │ staging: containers, forklifts, pallets             │ stairwell east │
 *   z=-15 ╞═ catwalk (4.5 m) from the west platform to the east mezzanine ═══════╡
 *         │ west │ ═══ pallet-rack row ═══ ┊ ═══ ┊ ═══════════════ │   │ east   │
 *         │ plat-│      aisle (60 m sightline)                     │   │ mezz-  │
 *         │ form │ ═══ rack ═══ ┊ ═══════════ ┊ ═════ ┊ ══════════ │   │ anine  │
 *   z=2   │ ramp │      …six rows, five aisles, cross aisles ┊      │   │ (4.5)  │
 *         │ west yard                                             │   │        │
 *   z=20  │ south yard: stacked containers, forklifts        east stairs ┘     │
 *   z=30  └──────────────────────────────────────────────────────────────────┘
 *        x=-45                                                              x=45
 *
 * Levels: hall floor 0, loading dock 1.25, mezzanine 4.5. Three ways up to 4.5 (west ramp,
 * east stairs, enclosed office stairwell), joined by an exposed catwalk. The rack aisles run
 * east–west, so both perches (west platform, east mezzanine) look straight down them; the
 * cross aisles (x 0, and staggered gaps at x -16.5 / 15) are the flanking routes.
 */
export function buildWarehouse(): MapDef {
  const m = new MapBuilder('warehouse', 'Warehouse', {
    sunDirection: [0.35, 1, 0.25],
    sunColor: 0xfff2dc,
    sunIntensity: 2.2,
    skyColor: 0xd6dde6,
    groundColor: 0x5e5850,
    ambientIntensity: 1.25,
    fogColor: 0x8d949c,
    fogNear: 50,
    fogFar: 160,
  })

  const X0 = -45
  const X1 = 45
  const Z0 = -30
  const Z1 = 30
  const ROOF = 12
  const UP = 4.5 // mezzanine / catwalk / office upper floor
  const SLAB = 0.3
  const DOCK = 1.25 // loading dock platform (five 0.25 m steps)
  const T = 0.3 // interior wall thickness
  const WT = 0.4 // exterior wall thickness
  const RACK_H = 7.2 // tall enough that nobody can jump onto a rack from the catwalk
  const OB = { x0: 28, x1: X1, z0: Z0, z1: -16, roof: 8.7 } // office block
  const deco = { collide: false } as const
  const solid = { render: false } as const

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
  /** Office-style wall with a window band (sill 0–1 m, glass 1–2.4 m, header above). */
  const windowWallX = (
    x0: number,
    x1: number,
    z: number,
    y0: number,
    h: number,
    doors: [number, number][] = [],
  ) => {
    wallX(x0, x1, z, y0, 1, 'plaster', doors)
    wallX(x0, x1, z, y0 + 1, 1.4, 'glass', doors)
    m.span([x0, y0 + 2.4, z - T / 2], [x1, y0 + h, z + T / 2], 'plaster')
  }
  const windowWallZ = (
    z0: number,
    z1: number,
    x: number,
    y0: number,
    h: number,
    doors: [number, number][] = [],
  ) => {
    wallZ(z0, z1, x, y0, 1, 'plaster', doors)
    wallZ(z0, z1, x, y0 + 1, 1.4, 'glass', doors)
    m.span([x - T / 2, y0 + 2.4, z0], [x + T / 2, y0 + h, z1], 'plaster')
  }
  /** Straight stairs from (zStart, y0) climbing towards -Z, full-width solid treads. */
  const stairs = (x0: number, x1: number, zStart: number, y0: number, rise: number) => {
    const steps = Math.round(rise / 0.25)
    for (let i = 1; i <= steps; i++) {
      const zNear = zStart - (i - 1) * 0.3
      m.span([x0, y0, zNear], [x1, y0 + i * 0.25, zNear - 0.3], 'metal')
    }
    return zStart - steps * 0.3
  }
  /** A pallet of shrink-wrapped goods: low cover (1.1) or high cover (≥ 1.9). */
  const pallet = (x: number, z: number, h: number, y = 0, w = 1.2, d = 1.0) => {
    m.block(x, y, z, w, h, d, 'desk')
    m.block(x, y, z, w + 0.04, 0.15, d + 0.04, 'wood', deco)
  }
  /** Shipping container (2.44 × 2.6), `len` long along `axis`, from (x0, z0). */
  const container = (
    x0: number,
    z0: number,
    len: number,
    axis: 'x' | 'z',
    mat: MaterialId,
    y = 0,
  ) => {
    const [x1, z1] = axis === 'x' ? [x0 + len, z0 + 2.44] : [x0 + 2.44, z0 + len]
    m.span([x0, y, z0], [x1, y + 2.6, z1], mat)
    // Door end (darker) and a top rail so stacks read as separate boxes.
    if (axis === 'x') m.span([x1, y + 0.1, z0 + 0.1], [x1 + 0.04, y + 2.5, z1 - 0.1], 'metal', deco)
    else m.span([x0 + 0.1, y + 0.1, z1], [x1 - 0.1, y + 2.5, z1 + 0.04], 'metal', deco)
    m.span([x0 - 0.02, y + 2.5, z0 - 0.02], [x1 + 0.02, y + 2.6, z1 + 0.02], 'metal', deco)
  }
  /** Walk-in 20 ft container along X, open at the east end: a close-quarters box. */
  const openContainer = (x0: number, z0: number, mat: MaterialId) => {
    const x1 = x0 + 6.06
    const z1 = z0 + 2.44
    const w = 0.1
    m.span([x0, 0, z0], [x0 + w, 2.6, z1], mat) // closed end
    m.span([x0, 0, z0], [x1, 2.6, z0 + w], mat)
    m.span([x0, 0, z1 - w], [x1, 2.6, z1], mat)
    m.span([x0, 2.5, z0], [x1, 2.6, z1], mat) // roof
    // Open doors swung back against the sides.
    m.span([x1, 0.05, z0 - 0.08], [x1 + 1.2, 2.55, z0], 'metal', deco)
    m.span([x1, 0.05, z1], [x1 + 1.2, 2.55, z1 + 0.08], 'metal', deco)
  }
  /** Counterbalance forklift: yellow body (low cover), mast and forks toward `dir`. */
  const forklift = (x: number, z: number, dir: 'n' | 's' | 'e' | 'w') => {
    // Local frame: `a` along the forks, `s` sideways.
    const dirs: Record<typeof dir, readonly [number, number]> = {
      n: [0, -1],
      s: [0, 1],
      e: [1, 0],
      w: [-1, 0],
    }
    const [ax, az] = dirs[dir]
    const box = (
      a: number,
      s: number,
      y: number,
      la: number,
      ls: number,
      h: number,
      mat: MaterialId,
      flags = {},
    ) => {
      const cx = x + ax * a + az * s
      const cz = z + az * a - ax * s
      const [w, d] = ax !== 0 ? [la, ls] : [ls, la]
      m.block(cx, y, cz, w, h, d, mat, flags)
    }
    box(0, 0, 0, 2.2, 1.2, 1.1, 'marker') // body
    box(-1.0, 0, 1.1, 0.5, 1.15, 0.4, 'metal', deco) // counterweight hump
    box(-0.2, 0, 1.1, 0.5, 1.15, 0.5, 'fabricAlt', deco) // seat
    for (const sa of [-0.8, 0.6]) {
      for (const ss of [-0.5, 0.5]) box(sa, ss, 1.1, 0.06, 1.0, 0.06, 'metal', deco) // guard posts
    }
    box(-0.1, 0, 2.1, 1.5, 0.06, 1.1, 'metal', deco) // overhead guard
    for (const ss of [-0.4, 0.4]) {
      box(1.2, ss, 0, 0.12, 2.6, 0.12, 'metal', deco) // mast
      box(1.85, ss, 0.08, 1.2, 0.06, 0.12, 'metal', deco) // forks
    }
    for (const sa of [-0.7, 0.7]) {
      for (const ss of [-0.58, 0.58]) box(sa, ss, 0, 0.55, 0.55, 0.12, 'fabricAlt', deco) // wheels
    }
  }
  /** Deterministic "random" in [0, 1) for rack contents. */
  const hash = (a: number, b: number, c: number) => {
    let h =
      Math.imul(a + 7919, 374761393) ^
      Math.imul(b + 104729, 668265263) ^
      Math.imul(c + 13, 2246822519)
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296
  }
  /**
   * Back-to-back pallet rack (2.2 m deep, 7.2 m tall) from x0 to x1 centred on z: one solid
   * collider, with uprights, beams and goods as decoration. Ground bays are always full so
   * nothing looks walkable that isn't.
   */
  const GOODS: MaterialId[] = ['desk', 'desk', 'desk', 'wood', 'concrete', 'fabricAlt', 'accent']
  const rack = (x0: number, x1: number, z: number, row: number) => {
    m.span([x0, 0, z - 1.1], [x1, RACK_H, z + 1.1], 'metal', solid)
    m.span([x0, 0, z - 0.03], [x1, RACK_H, z + 0.03], 'metal', deco) // mesh back
    const bays = Math.max(1, Math.round((x1 - x0) / 2.7))
    const bay = (x1 - x0) / bays
    for (let i = 0; i <= bays; i++) {
      for (const s of [-1, 1])
        m.block(x0 + i * bay, 0, z + s * 1.04, 0.12, RACK_H, 0.12, 'platform', deco)
    }
    for (const y of [1.8, 3.6, 5.4, RACK_H]) {
      for (const s of [-1, 1]) {
        m.span([x0, y - 0.14, z + s * 1.1], [x1, y, z + s * 0.98], 'cover', deco)
      }
    }
    for (let i = 0; i < bays; i++) {
      for (let level = 0; level < 4; level++) {
        const r = hash(row, i, level)
        if (level > 0 && r < 0.22) continue // empty bay
        const h = level === 3 ? 1.1 + r * 0.5 : 1.25 + r * 0.35
        const mat = GOODS[Math.floor(hash(i, row, level + 9) * GOODS.length)] ?? 'desk'
        m.block(x0 + (i + 0.5) * bay, level * 1.8 + 0.02, z, bay - 0.3, h, 2.02, mat, deco)
      }
    }
  }
  /** High-bay lamp: fixture plus a point light. */
  const lamp = (x: number, z: number, y = 9.6) => {
    m.block(x, y, z, 1.4, 0.12, 0.7, 'lightpanel', deco)
    m.block(x, y + 0.12, z, 0.05, ROOF - y - 0.12, 0.05, 'metal', deco)
    m.light({ kind: 'point', pos: [x, y - 0.4, z], color: 0xfff1df, intensity: 75, distance: 24 })
  }

  // ─── Shell: floor, walls, roof with skylight strips ─────────────────────────────────────
  m.span([X0 - 1, -0.5, Z0 - 1], [X1 + 1, 0, Z1 + 1], 'concrete')
  const bands: [number, number, MaterialId][] = [
    [0, 3, 'concrete'],
    [3, 9.5, 'metal'],
    [9.5, 11, 'glass'], // clerestory
    [11, ROOF, 'metal'],
  ]
  for (const [y0, y1, mat] of bands) {
    m.span([X0 - WT, y0, Z0 - WT], [X1 + WT, y1, Z0], mat)
    m.span([X0 - WT, y0, Z1], [X1 + WT, y1, Z1 + WT], mat)
    m.span([X0 - WT, y0, Z0], [X0, y1, Z1], mat)
    m.span([X1, y0, Z0], [X1 + WT, y1, Z1], mat)
  }
  // Roof: solid strips with three skylights running east–west.
  const skylights: [number, number][] = [
    [-20, -17],
    [-4, -1],
    [12, 15],
  ]
  let rz = Z0 - WT
  for (const [a, b] of skylights) {
    m.span([X0 - WT, ROOF, rz], [X1 + WT, ROOF + SLAB, a], 'concrete')
    m.span([X0 + 1, ROOF + 0.1, a], [X1 - 1, ROOF + 0.2, b], 'glass')
    m.span([X0 - WT, ROOF, a], [X0 + 1, ROOF + SLAB, b], 'concrete')
    m.span([X1 - 1, ROOF, a], [X1 + WT, ROOF + SLAB, b], 'concrete')
    rz = b
  }
  m.span([X0 - WT, ROOF, rz], [X1 + WT, ROOF + SLAB, Z1 + WT], 'concrete')
  // Roof trusses (decoration).
  for (let x = -40; x <= 40; x += 10)
    m.span([x - 0.15, ROOF - 0.7, Z0], [x + 0.15, ROOF, Z1], 'metal', deco)

  // Painted floor: walkway lines and dock-edge warning stripe.
  const line = (x0: number, z0: number, x1: number, z1: number) =>
    m.span([x0, 0, z0], [x1, 0.012, z1], 'marker', deco)
  line(X0, -11.2, OB.x0, -11)
  line(X0, 21, 35, 21.2)
  line(-31.6, -10, -31.4, 20.2)
  line(29.4, -10, 29.6, 20.2)

  // ─── Loading dock (north wall, 1.25 m) ──────────────────────────────────────────────────
  m.span([X0, 0, Z0], [20, DOCK, -23], 'concrete')
  m.span([X0, DOCK, -23.4], [20, DOCK + 0.012, -23], 'marker', deco) // edge stripe
  for (let x = -42; x <= 18; x += 6)
    m.span([x - 0.2, 0.25, -23.05], [x + 0.2, 1.05, -22.9], 'fabricAlt', deco) // bumpers
  // Dock doors (closed roller shutters) with leveller plates in front.
  for (const x of [-38, -26, -14, -2, 10]) {
    m.block(x, DOCK, Z0 + 0.03, 3.2, 3.4, 0.06, 'platform', deco)
    m.block(x, DOCK + 3.4, Z0 + 0.06, 3.6, 0.3, 0.12, 'marker', deco)
    m.block(x, DOCK, Z0 + 1.2, 2.4, 0.02, 2.2, 'metal', deco)
  }
  const dockAngle = (Math.atan(DOCK / 4.5) * 180) / Math.PI
  m.ramp(-32, 0, -18.5, 3.5, 4.5, dockAngle, 'concrete')
  m.ramp(8, 0, -18.5, 3.5, 4.5, dockAngle, 'concrete')
  stairs(-11, -8, -21.5, 0, DOCK)
  // Dock clutter.
  pallet(-41, -27.5, 1.1, DOCK, 1.2, 1.0)
  pallet(-34.5, -26, 2.0, DOCK, 2.4, 1.0)
  pallet(-20, -27.8, 2.0, DOCK, 2.4, 1.2)
  pallet(-19, -25, 1.1, DOCK)
  pallet(-6, -26.5, 1.1, DOCK, 2.4, 1.0)
  pallet(4, -27.8, 2.0, DOCK, 1.2, 1.2)
  pallet(15, -26, 1.1, DOCK, 1.2, 2.0)
  m.block(-28.5, DOCK, -25.5, 0.7, 0.1, 1.6, 'metal', deco) // pallet jack
  m.block(-28.5, DOCK, -26.4, 0.1, 1.1, 0.1, 'metal', deco)

  // ─── Staging area: containers, forklifts, pallets ───────────────────────────────────────
  container(-27, -20.6, 12.2, 'x', 'accent')
  openContainer(-5, -20.6, 'metal')
  container(14, -22.5, 6.06, 'z', 'metal')
  forklift(20.5, -19.5, 'w')
  forklift(-9, -12, 'e')
  pallet(-37, -20, 2.0, 0, 2.4, 1.2)
  pallet(-12.5, -16.5, 1.1)
  pallet(4, -12, 1.1, 0, 2.4, 1.0)
  pallet(24.5, -12, 2.0, 0, 1.2, 2.4)
  pallet(-23, -12, 1.1, 0, 1.2, 2.0)
  pallet(25, -26.5, 1.1, 0, 2.0, 1.2)

  // ─── Pallet racks: six back-to-back rows, cross aisle at x 0, staggered side gaps ────────
  const RACK_X0 = -31
  const RACK_X1 = 29
  const rows = [-8.9, -3.3, 2.3, 7.9, 13.5, 19.1]
  rows.forEach((z, row) => {
    const gap: [number, number] = row % 2 === 0 ? [-17.5, -15.5] : [14, 16]
    const cuts = [gap, [-2, 2] as [number, number]].sort((a, b) => a[0] - b[0])
    let cursor = RACK_X0
    for (const [a, b] of cuts) {
      rack(cursor, a, z, row * 3 + (a > 0 ? 1 : 0))
      cursor = b
    }
    rack(cursor, RACK_X1, z, row * 3 + 2)
  })

  // ─── West platform (4.5) with its ramp, overlooking the aisles ──────────────────────────
  m.span([X0, UP - SLAB, -16], [-38, UP, 2], 'metal')
  const rail = (a: [number, number], b: [number, number]) =>
    m.span([a[0], UP, a[1]], [b[0], UP + 1.1, b[1]], 'metal')
  rail([-38.15, -16], [-38, -15]) // east edge, gap for the catwalk at z -15..-13
  rail([-38.15, -13], [-38, 2])
  rail([X0, -16], [-38, -15.85]) // north edge
  rail([-42, 1.85], [-38, 2]) // south edge, ramp arrives at x -45..-42
  m.ramp(-43.5, 0, 12, 3, 10, (Math.atan(UP / 10) * 180) / Math.PI, 'metal')
  for (const z of [-15.7, -7, 1.7]) m.block(-38.3, 0, z, 0.4, UP - SLAB, 0.4, 'metal')
  pallet(-41, -10, 1.1, UP, 2.4, 1.0) // cover up top
  pallet(-43.5, -3, 1.1, UP, 1.0, 1.2)
  // Under the platform: storage.
  pallet(-42.5, -11, 2.0, 0, 2.4, 1.2)
  pallet(-40, -3.5, 1.1)

  // ─── Catwalk (4.5) across the hall: exposed, waist-high solid parapets ──────────────────
  m.span([-38, UP - SLAB, -15], [35, UP, -13], 'metal')
  rail([-38, -15], [35, -14.88])
  rail([-38, -13.12], [35, -13])
  for (const x of [-26, -14, -2, 10, 22]) m.block(x, 0, -14, 0.4, UP - SLAB, 0.4, 'metal')

  // ─── East mezzanine (4.5) over a pallet store, east stairs ──────────────────────────────
  m.span([35, UP - SLAB, -16], [X1, UP, 22], 'metal')
  rail([35, -16], [35.15, -15])
  rail([35, -13], [35.15, 22])
  rail([35, 21.85], [36, 22])
  rail([39, 21.85], [X1, 22])
  const eastTop = stairs(36, 39, 27.4, 0, UP)
  m.span([39, 0, eastTop], [39.1, UP + 1.1, 27.4], 'metal') // stair side rail
  for (const z of [-5, 8]) m.block(35.3, 0, z, 0.4, UP - SLAB, 0.4, 'metal')
  // Up top: crates for cover; below: a tight pallet maze.
  pallet(40, -4, 1.1, UP, 2.4, 1.0)
  pallet(42, 6, 2.0, UP, 1.2, 2.4)
  pallet(38.5, 14, 1.1, UP, 2.0, 1.2)
  pallet(39, -8, 2.0, 0, 2.4, 1.2)
  pallet(42.8, -2, 1.1, 0, 2.4, 1.2)
  pallet(38.5, 4, 2.0, 0, 1.2, 2.4)
  pallet(42.5, 10, 1.1, 0, 1.2, 2.4)
  pallet(38.8, 15.5, 2.0, 0, 2.4, 1.2)

  // ─── Office block (NE corner, two floors) ───────────────────────────────────────────────
  // Ground: corridor (z -23..-16), break room and lockers behind; stairs up along the east wall.
  windowWallZ(OB.z0, OB.z1, OB.x0, 0, UP - SLAB, [[-19.5, 1.6]])
  windowWallX(OB.x0, 41.5, OB.z1, 0, UP - SLAB, [[31, 1.6]])
  wallX(41.5, OB.x1, OB.z1, 0, UP - SLAB, 'plaster', [[43.25, 2]]) // stair door
  wallX(OB.x0, OB.x1, -23, 0, UP - SLAB, 'plaster', [
    [32, 1.6],
    [39, 1.6],
  ])
  wallZ(OB.z0, -23, 36, 0, UP - SLAB, 'plaster')
  wallZ(-23, OB.z1, 41.5, 0, UP - SLAB, 'plaster')
  const obTop = stairs(41.65, OB.x1, -16.4, 0, UP)
  m.span([41.65, 0, -23], [OB.x1, UP - SLAB, obTop], 'concrete') // fill under the landing
  // Upper slab (hole over the stairs), upper walls and roof.
  m.span([OB.x0, UP - SLAB, OB.z0], [OB.x1, UP, obTop], 'concrete')
  m.span([OB.x0, UP - SLAB, obTop], [41.5, UP, OB.z1], 'concrete')
  windowWallZ(OB.z0, OB.z1, OB.x0, UP, OB.roof - UP)
  windowWallX(OB.x0, 35, OB.z1, UP, OB.roof - UP)
  m.span([35, UP + 2.4, OB.z1 - T / 2], [OB.x1, OB.roof, OB.z1 + T / 2], 'plaster') // header over the mezzanine opening
  wallX(OB.x0, 41.5, -24, UP, OB.roof - UP, 'plaster', [
    [32, 1.6],
    [38.75, 1.6],
  ])
  wallZ(OB.z0, -24, 36, UP, OB.roof - UP, 'plaster')
  wallZ(OB.z0, -24, 41.5, UP, OB.roof - UP, 'plaster', [[-27, 1.6]])
  m.span([41.5, UP, obTop], [41.6, UP + 1.1, OB.z1], 'glass') // railings round the stair hole
  m.span([41.5, UP, OB.z1 - 0.1], [OB.x1, UP + 1.1, OB.z1], 'glass')
  m.span([OB.x0 - 0.2, OB.roof, OB.z0], [OB.x1, OB.roof + 0.3, OB.z1 + 0.2], 'concrete')
  m.span([OB.x0, 0, -23], [OB.x1, 0.012, OB.z1], 'tile', deco)
  m.span([OB.x0, 0, OB.z0], [OB.x1, 0.012, -23], 'tile', deco)
  m.span([OB.x0, UP, OB.z0], [41.5, UP + 0.012, OB.z1], 'carpet', deco)

  // Break room: table, vending machine, counter.
  m.block(31.5, 0, -26.5, 2.4, 0.75, 1.2, 'desk')
  for (const dx of [-0.7, 0.7]) {
    for (const dz of [-1, 1]) m.block(31.5 + dx, 0, -26.5 + dz, 0.45, 0.9, 0.45, 'fabricAlt', deco)
  }
  m.span([28.15, 0, -29.85], [29, 1.9, -28.6], 'accent') // vending machine
  m.span([33, 0, -29.85], [35.85, 0.95, -29.2], 'desk') // counter
  // Lockers (high cover) in rows.
  m.span([36.5, 0, -29.85], [41, 1.9, -29.35], 'metal')
  m.span([37.5, 0, -27], [40.5, 1.9, -26.5], 'metal')
  m.span([42, 0, -29.85], [44.85, 1.9, -29.35], 'metal')
  m.block(30, 0, -17, 0.4, 1.2, 0.4, 'whiteboard') // water cooler
  // Upper: manager's office and a records room with filing cabinets.
  m.block(32, UP, -27.8, 2.6, 0.78, 1.2, 'desk')
  m.block(32, UP + 0.78, -28.1, 0.6, 0.4, 0.04, 'screen', deco)
  m.span([28.15, UP, -29.85], [29.2, UP + 2, -26], 'desk') // shelf
  for (const x of [37, 38.6, 40.2]) m.block(x, UP, -29.4, 1.2, 1.3, 0.7, 'metal')
  m.block(38.6, UP, -26.6, 2.4, 1.3, 0.7, 'metal')

  // ─── West yard and south yard ───────────────────────────────────────────────────────────
  container(-37.5, 6, 6.06, 'z', 'metal')
  forklift(-34, 17, 'n')
  pallet(-35, -2, 1.1, 0, 1.2, 2.0)
  pallet(-41, 19, 2.0, 0, 2.4, 1.2)
  container(-22, 24.5, 12.2, 'x', 'metal') // double stack: high cover
  container(-22, 24.5, 12.2, 'x', 'accent', 2.6)
  container(6, 25, 6.06, 'x', 'accent')
  forklift(-30, 25.5, 'e')
  forklift(24, 27, 'w')
  pallet(0, 23.5, 1.1, 0, 2.4, 1.0)
  pallet(18, 24, 2.0, 0, 1.2, 2.4)
  pallet(29, 25.5, 1.1, 0, 1.2, 2.0)
  pallet(-38, 27, 1.1, 0, 2.4, 1.2)

  // ─── Lights ─────────────────────────────────────────────────────────────────────────────
  for (const x of [-36, -18, 0, 18]) for (const z of [-19, 1, 21]) lamp(x, z)
  m.light({ kind: 'point', pos: [40, 3.6, 3], color: 0xffd9a8, intensity: 16, distance: 14 }) // under the mezzanine
  m.light({ kind: 'point', pos: [40, 8.5, 3], color: 0xfff1df, intensity: 30, distance: 18 })
  m.light({ kind: 'point', pos: [33, 3.5, -24.5], color: 0xfff1df, intensity: 14, distance: 12 }) // office block
  m.light({ kind: 'point', pos: [35, 8, -24], color: 0xfff1df, intensity: 14, distance: 12 })

  // ─── Spawns (feet) ──────────────────────────────────────────────────────────────────────
  const N = 0
  const S = 180
  const E = -90
  const W = 90
  m.spawn(-42, 0, -13, E) // under the west platform
  m.spawn(-40, 0, 15, E) // west yard
  m.spawn(-28, 0, 22.5, E) // south yard
  m.spawn(14, 0, 28, N)
  m.spawn(0, 0, -11.5, S) // staging, under the catwalk
  m.spawn(22, 0, -22, W)
  m.spawn(-25, 0, -6.1, E) // aisles
  m.spawn(25, 0, 10.7, W)
  m.spawn(32, 0, -19.5, W) // office block corridor
  m.spawn(40, 0, 0, W) // under the mezzanine
  m.spawn(-40, DOCK, -25, E) // dock
  m.spawn(10, DOCK, -25.5, W)
  m.spawn(-42, UP, -6, E) // west platform
  m.spawn(40, UP, 18, W) // east mezzanine
  m.spawn(38, UP, -10, W)
  m.spawn(32, UP, -25.5, S) // manager's office
  // Players actually spawn at random free spots on all three levels (see findSpawnPoints).
  m.randomSpawnsIn([X0 + 0.5, Z0 + 0.5], [X1 - 0.5, Z1 - 0.5])

  // ─── Weapons lying around (you spawn with only the handgun) ────────────────────────────
  const RIFLE = 1
  const SNIPER = 2
  const SHOTGUN = 3
  m.pickup(-43, UP, -14.5, SNIPER) // west platform, back corner
  m.pickup(43.5, UP, 20.5, SNIPER) // east mezzanine, south end
  m.pickup(0, UP, -14, SNIPER) // middle of the catwalk: exposed
  m.pickup(-26, DOCK, -25, RIFLE) // dock
  m.pickup(-38, 0, 16, RIFLE) // west yard
  m.pickup(-4, 0, 27, RIFLE) // south yard, behind the stacked containers
  m.pickup(0, 0, 5.1, RIFLE) // cross aisle
  m.pickup(-2.5, 0, -19.4, SHOTGUN) // inside the open container
  m.pickup(41, 0, -12.5, SHOTGUN) // pallet maze under the mezzanine
  m.pickup(33.5, 0, -25, SHOTGUN) // break room
  m.pickup(39, UP, -25, SHOTGUN) // records room
  return m.build()
}
