import { MapBuilder } from './builder.ts'
import type { MapDef, MaterialId } from './types.ts'

/**
 * "Campus" — an outdoor office courtyard, 100 × 70 m, between three low buildings.
 *
 *   z=-35 ┌ side ┬─ A: glass atrium building (2 floors) ──────┬ yard ┬─ alley ────────────┐
 *         │ yard │ west wing │ atrium + grand stairs │ east   │ ═bridge═ B: lab (roof    │
 *   z=-15 │ ┌stairs balcony (4.5) ─┘                 └ wing   │      │  terrace at 4.5)  │
 *         │ │                                                │      └──────────────────┤
 *   z=-2  │ café pavilion        courtyard: planters,          │  B stairs  service yard │
 *         │ + terrace            low walls, trees, benches     │                         │
 *   z=16  ├── low wall with gaps ──────────────────────────────────────────────────────┤
 *         │ parking: two rows of cars, light poles                                     │
 *   z=35  └────────────────────────────────────────────────────────────────────────────┘
 *        x=-50                                                                      x=50
 *
 * Levels: ground 0 and 4.5 (A's upper floor + west balcony, the bridge, B's roof terrace).
 * Three ways up: A's grand stairs (inside), the exterior stairs to A's balcony (west) and
 * B's exterior stairs (south-east). The balcony and B's roof are the sniper perches over the
 * courtyard; the café, B's server hall and A's IT room are the close-quarters spots.
 */
export function buildCampus(): MapDef {
  const m = new MapBuilder('campus', 'Campus', {
    sunDirection: [0.45, 0.9, 0.55],
    sunColor: 0xfff3dd,
    sunIntensity: 2.8,
    skyColor: 0xa9cdf5,
    groundColor: 0x6f6656,
    ambientIntensity: 1.2,
    fogColor: 0xc4d6ea,
    fogNear: 80,
    fogFar: 300,
  }).withSkyline()

  const X0 = -50
  const X1 = 50
  const Z0 = -35
  const Z1 = 35
  const UP = 4.5
  const SLAB = 0.3
  const T = 0.3 // wall thickness
  const A = { x0: -40, x1: 10, z0: Z0, z1: -15, roof: 9 } // glass atrium building
  const ATRIUM = { x0: -18, x1: -2, z: -28 } // double-height void x0..x1, from z to the facade
  const B = { x0: 22, x1: 45, z0: -28, z1: 2 } // lab, roof terrace at UP
  const C = { x0: -36, x1: -22, z0: -2, z1: 8, h: 3.2 } // café pavilion
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
  /** Solid wall with a window band (sill 0–1 m, glass 1–2.4 m, solid above) and doors. */
  const windowWallX = (
    x0: number,
    x1: number,
    z: number,
    y0: number,
    h: number,
    doors: [number, number][] = [],
    mat: MaterialId = 'plaster',
  ) => {
    wallX(x0, x1, z, y0, 1, mat, doors)
    wallX(x0, x1, z, y0 + 1, 1.4, 'glass', doors)
    m.span([x0, y0 + 2.4, z - T / 2], [x1, y0 + h, z + T / 2], mat)
  }
  const windowWallZ = (
    z0: number,
    z1: number,
    x: number,
    y0: number,
    h: number,
    doors: [number, number][] = [],
    mat: MaterialId = 'plaster',
  ) => {
    wallZ(z0, z1, x, y0, 1, mat, doors)
    wallZ(z0, z1, x, y0 + 1, 1.4, 'glass', doors)
    m.span([x - T / 2, y0 + 2.4, z0], [x + T / 2, y0 + h, z1], mat)
  }
  /** Straight stairs from (zStart, y0) climbing towards -Z, full-width solid treads. */
  const stairs = (x0: number, x1: number, zStart: number, y0: number, rise: number) => {
    const steps = Math.round(rise / 0.25)
    for (let i = 1; i <= steps; i++) {
      const zNear = zStart - (i - 1) * 0.3
      m.span([x0, y0, zNear], [x1, y0 + i * 0.25, zNear - 0.3], 'concrete')
    }
    return zStart - steps * 0.3
  }
  /** Low (1.1 m) parapet / railing on a deck at y. */
  const parapet = (
    a: [number, number],
    b: [number, number],
    y: number,
    mat: MaterialId = 'concrete',
  ) => m.span([a[0], y, a[1]], [b[0], y + 1.1, b[1]], mat)
  /** Two facing desks with screens and a privacy panel: low cover (1.2 m at the panel). */
  const deskCluster = (x: number, z: number, y = 0) => {
    m.block(x, y, z, 3.2, 0.75, 1.6, 'desk', solid)
    m.block(x, y + 0.72, z, 3.2, 0.03, 1.6, 'desk', deco)
    for (const sx of [-1.5, 1.5])
      for (const sz of [-0.7, 0.7]) m.block(x + sx, y, z + sz, 0.06, 0.72, 0.06, 'metal', deco)
    m.block(x, y + 0.75, z, 3.2, 0.5, 0.04, 'fabric')
    for (const sx of [-0.8, 0.8]) {
      for (const sz of [-0.35, 0.35]) {
        m.block(x + sx, y + 0.75, z + sz, 0.55, 0.34, 0.03, 'screen', deco)
        const cz = z + sz * 3
        m.block(x + sx, y, cz, 0.5, 0.48, 0.5, 'fabricAlt', deco)
        m.block(x + sx, y + 0.48, cz + Math.sign(sz) * 0.22, 0.5, 0.5, 0.06, 'fabricAlt', deco)
      }
    }
  }
  const plant = (x: number, z: number, y = 0, tall = 1.6) => {
    m.block(x, y, z, 0.5, 0.45, 0.5, 'concrete')
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
  /** Tree in a concrete pot (or on a planter at y): solid pot and trunk, walk-through canopy. */
  const tree = (x: number, z: number, y = 0, pot = true) => {
    const base = pot ? y + 0.6 : y
    if (pot) m.block(x, y, z, 1.2, 0.6, 1.2, 'concrete')
    m.block(x, base, z, 0.3, 2.4, 0.3, 'wood')
    m.block(x, base + 2.0, z, 3.2, 1.8, 3.2, 'plant', deco)
    m.block(x, base + 3.8, z, 2.0, 0.8, 2.0, 'plant', deco)
  }
  /** Bench (0.45 m) along X or Z. */
  const bench = (x: number, z: number, axis: 'x' | 'z') => {
    const [w, d] = axis === 'x' ? [1.8, 0.5] : [0.5, 1.8]
    m.block(x, 0.35, z, w, 0.1, d, 'wood', deco)
    m.block(x, 0, z, w, 0.45, d, 'wood', solid)
    for (const s of [-0.7, 0.7]) {
      const [dx, dz] = axis === 'x' ? [s, 0] : [0, s]
      m.block(
        x + dx,
        0,
        z + dz,
        axis === 'x' ? 0.08 : 0.4,
        0.35,
        axis === 'x' ? 0.4 : 0.08,
        'metal',
        deco,
      )
    }
  }
  /** Raised planter (low cover 1.0 m) with shrubs on top. */
  const planter = (x: number, z: number, w: number, d: number) => {
    m.block(x, 0, z, w, 1.0, d, 'concrete')
    m.block(x, 1.0, z, w - 0.3, 0.45, d - 0.3, 'plant', deco)
  }
  /** Box car, nose towards -Z or +Z: solid body (1.05 m) and see-through cabin (1.6 m). */
  const car = (x: number, z: number, nose: 'n' | 's', paint: MaterialId) => {
    const f = nose === 'n' ? -1 : 1
    m.block(x, 0.25, z, 1.8, 0.8, 4.3, paint)
    m.block(x, 0, z, 1.7, 0.25, 3.9, 'metal', solid) // under the body: nothing crawls through
    m.block(x, 1.05, z - f * 0.2, 1.6, 0.55, 2.2, 'glass')
    m.block(x, 1.6, z - f * 0.2, 1.62, 0.06, 2.0, paint, deco)
    for (const sx of [-0.86, 0.86]) {
      for (const sz of [-1.35, 1.35]) m.block(x + sx, 0, z + sz, 0.2, 0.6, 0.6, 'fabricAlt', deco)
    }
    for (const sx of [-0.6, 0.6])
      m.block(x + sx, 0.65, z + f * 2.15, 0.35, 0.15, 0.04, 'lightpanel', deco)
  }
  const lightPanels = (x0: number, x1: number, z0: number, z1: number, y: number, step = 4) => {
    for (let x = x0 + step / 2; x < x1; x += step) {
      for (let z = z0 + step / 2; z < z1; z += step) {
        m.block(x, y - 0.06, z, 1.2, 0.05, 0.6, 'lightpanel', deco)
      }
    }
  }
  const finish = (x0: number, z0: number, x1: number, z1: number, mat: MaterialId, y = 0) =>
    m.span([x0, y, z0], [x1, y + 0.012, z1], mat, deco)

  // ─── Ground, paths, lawns, invisible boundary ───────────────────────────────────────────
  m.span([X0 - 12, -0.5, Z0 - 12], [X1 + 12, 0, Z1 + 12], 'concrete')
  finish(-21, -12.5, 21, 16, 'tile') // courtyard paving
  finish(X0, -15, C.x0 - 1, 16, 'plant') // west lawn
  finish(X0, -35, A.x0, -15, 'plant') // side yard
  finish(-19, -11.5, -10, -7.5, 'plant') // courtyard lawns
  finish(10, -11.5, 19, -7.5, 'plant')
  finish(X0 - 12, Z1 + 1, X1 + 12, Z1 + 8, 'floor') // street outside the fence
  for (const [a, b] of [
    [
      [X0 - 1, Z0 - 1],
      [X0, Z1 + 1],
    ],
    [
      [X1, Z0 - 1],
      [X1 + 1, Z1 + 1],
    ],
    [
      [X0, Z0 - 1],
      [X1, Z0],
    ],
    [
      [X0, Z1],
      [X1, Z1 + 1],
    ],
  ] as const) {
    m.span([a[0], 0, a[1]], [b[0], 20, b[1]], 'concrete', solid)
  }
  // Visible edge: hedges west/south/east, a wall behind the alley.
  m.span([X0, 0, Z1 - 1], [X1, 1.4, Z1], 'plant')
  m.span([X0, 0, A.z1], [X0 + 1, 1.4, Z1 - 1], 'plant')
  m.span([X0, 0, Z0], [X0 + 1, 1.4, A.z1], 'plant')
  m.span([X1 - 1, 0, B.z1], [X1, 1.4, Z1 - 1], 'plant')
  m.span([A.x1, 0, Z0], [X1, 3, Z0 + 0.4], 'concrete')
  m.span([X1 - 0.4, 0, Z0 + 0.4], [X1, 3, B.z1], 'concrete')
  m.span([X0 + 1, 0, Z0], [A.x0, 1.4, Z0 + 1], 'plant')

  // ─── Building A: glass atrium office, two floors ────────────────────────────────────────
  finish(A.x0, A.z0, ATRIUM.x0, A.z1, 'carpet')
  finish(ATRIUM.x0, A.z0, ATRIUM.x1, A.z1, 'tile')
  finish(ATRIUM.x1, A.z0, A.x1, A.z1, 'carpet')
  finish(A.x0, A.z0, A.x1, A.z1, 'carpet', UP)
  // Upper slab with the atrium void (x -18..-2, z -28..-15).
  m.span([A.x0, UP - SLAB, A.z0], [ATRIUM.x0, UP, A.z1], 'concrete')
  m.span([ATRIUM.x0, UP - SLAB, A.z0], [ATRIUM.x1, UP, ATRIUM.z], 'concrete')
  m.span([ATRIUM.x1, UP - SLAB, A.z0], [A.x1, UP, A.z1], 'concrete')
  // Roof with a skylight over the atrium.
  const R = A.roof
  m.span([A.x0 - T, R, A.z0], [-16, R + SLAB, A.z1 + T], 'concrete')
  m.span([-4, R, A.z0], [A.x1 + T, R + SLAB, A.z1 + T], 'concrete')
  m.span([-16, R, A.z0], [-4, R + SLAB, -27], 'concrete')
  m.span([-16, R, -17], [-4, R + SLAB, A.z1 + T], 'concrete')
  m.span([-16, R + 0.1, -27], [-4, R + 0.2, -17], 'glass')
  // North wall (back, on the boundary): solid.
  m.span([A.x0 - T, 0, A.z0], [A.x1 + T, R, A.z0 + T], 'concrete')
  // West and east walls: window bands, an upper door onto the bridge (east) and a side door.
  for (const y0 of [0, UP]) {
    windowWallZ(A.z0, A.z1, A.x0, y0, y0 === 0 ? UP - SLAB : R - UP, [], 'concrete')
  }
  windowWallZ(A.z0, A.z1, A.x1, 0, UP - SLAB, [[-20, 1.8]], 'concrete')
  windowWallZ(A.z0, A.z1, A.x1, UP, R - UP, [[-24.5, 2]], 'concrete')
  for (const x of [A.x0, A.x1])
    m.span([x - T / 2, UP - SLAB, A.z0], [x + T / 2, UP, A.z1], 'concrete')
  // South facade: curtain wall. Ground doors (west wing, atrium ×2, east wing), balcony doors upstairs.
  wallX(A.x0, A.x1, A.z1, 0, UP - SLAB, 'glass', [
    [-34, 1.8],
    [-14, 2],
    [-6, 2],
    [4, 1.8],
  ])
  m.span([A.x0, UP - SLAB, A.z1 - T / 2], [ATRIUM.x0, UP, A.z1 + T / 2], 'concrete')
  m.span([ATRIUM.x0, UP - SLAB, A.z1 - T / 2], [ATRIUM.x1, UP, A.z1 + T / 2], 'glass')
  m.span([ATRIUM.x1, UP - SLAB, A.z1 - T / 2], [A.x1, UP, A.z1 + T / 2], 'concrete')
  wallX(A.x0, ATRIUM.x0, A.z1, UP, R - UP, 'glass', [
    [-36, 1.6],
    [-24, 1.6],
  ])
  m.span([ATRIUM.x0, UP, A.z1 - T / 2], [ATRIUM.x1, R, A.z1 + T / 2], 'glass')
  wallX(ATRIUM.x1, A.x1, A.z1, UP, R - UP, 'glass')
  for (let x = A.x0; x <= A.x1 + 0.01; x += 5) {
    m.span([x - 0.08, 0, A.z1 + T / 2], [x + 0.08, R, A.z1 + T / 2 + 0.1], 'metal', deco) // mullions
  }

  // Atrium: grand stairs up to the north gallery, glass railings round the void.
  const atriumTop = stairs(-12, -8, -22.6, 0, UP)
  m.span([-12.1, 0, atriumTop], [-12, UP + 1.1, -22.6], 'glass')
  m.span([-8, 0, atriumTop], [-7.9, UP + 1.1, -22.6], 'glass')
  m.span([ATRIUM.x0 - 0.1, UP, ATRIUM.z], [ATRIUM.x0, UP + 1.1, A.z1], 'glass')
  m.span([ATRIUM.x1, UP, ATRIUM.z], [ATRIUM.x1 + 0.1, UP + 1.1, A.z1], 'glass')
  m.span([ATRIUM.x0, UP, ATRIUM.z - 0.1], [-12, UP + 1.1, ATRIUM.z], 'glass')
  m.span([-8, UP, ATRIUM.z - 0.1], [ATRIUM.x1, UP + 1.1, ATRIUM.z], 'glass')
  m.span([-6, 0, -27], [-3, 1.1, -26.2], 'desk') // reception
  m.span([-3.8, 0, -26.2], [-3, 1.1, -24], 'desk')
  m.span([-6.05, 0.1, -26.2], [-3, 1, -26.15], 'accent', deco)
  sofa(-15.5, -24, 1, 3, 'e')
  plant(-17.2, -16)
  plant(-2.8, -16)
  plant(-17.2, -34.2)
  m.span([-10.5, 0.8, -34.7], [-5.5, 3.6, -34.66], 'accent', deco) // logo wall
  // Ground floor walls between wings and atrium (glass, two doors each).
  for (const x of [ATRIUM.x0, ATRIUM.x1]) {
    wallZ(A.z0, A.z1, x, 0, UP - SLAB, 'glass', [
      [-31, 1.6],
      [-20, 1.8],
    ])
  }

  // West wing, ground: open-plan desks and a glass meeting room in the corner.
  wallX(A.x0, -32, -28, 0, UP - SLAB, 'glass', [[-35, 1.6]])
  wallZ(A.z0, -28, -32, 0, UP - SLAB, 'glass')
  m.block(-36, 0, -31.5, 4, 0.75, 1.6, 'desk')
  for (const [x, z] of [
    [-35.5, -20.5],
    [-28.5, -20.5],
    [-22, -20.5],
    [-28.5, -25.5],
    [-22, -25.5],
  ] as const) {
    deskCluster(x, z)
  }
  plant(-24, -33.5)
  // East wing, ground: lobby in front, IT room with server racks behind (close quarters).
  wallX(ATRIUM.x1, A.x1, -25, 0, UP - SLAB, 'plaster', [
    [1, 1.6],
    [7, 1.6],
  ])
  for (const z of [-32.2, -29]) {
    m.span([-1, 0, z - 0.4], [4.4, 2.1, z + 0.4], 'rack')
    m.span([5.8, 0, z - 0.4], [9, 2.1, z + 0.4], 'rack')
  }
  sofa(0, -16.2, 3, 1, 's')
  plant(9.2, -15.8)

  // Upper floor: west wing offices + exec room, gallery lounge, east wing meeting room.
  wallX(A.x0, -31, -27, UP, R - UP, 'plaster', [[-35, 1.6]])
  wallZ(A.z0, -27, -31, UP, R - UP, 'glass')
  m.block(-36, UP, -31, 3, 0.78, 1.4, 'desk')
  sofa(-38.8, -29, 1, 2.6, 'e', UP)
  deskCluster(-34, -20.5, UP)
  deskCluster(-25, -20.5, UP)
  deskCluster(-24, -31, UP)
  plant(-19, -16, UP, 1.3)
  sofa(-15, -33.6, 3, 1, 's', UP)
  sofa(-5, -33.6, 3, 1, 's', UP)
  m.block(-10, UP, -33.6, 2, 0.45, 1, 'desk')
  wallX(ATRIUM.x1, A.x1, -29, UP, R - UP, 'glass', [[4, 1.6]])
  m.block(4, UP, -32, 4, 0.75, 1.6, 'desk')
  deskCluster(3, -19.5, UP)
  plant(9, -28, UP, 1.3)

  // West balcony (4.5) along the wing, reached by exterior stairs from the lawn.
  m.span([-44, UP - SLAB, A.z1], [ATRIUM.x0, UP, -12.5], 'concrete')
  parapet([-41, -12.65], [ATRIUM.x0, -12.5], UP)
  parapet([-44, A.z1], [-43.85, -12.5], UP)
  parapet([ATRIUM.x0 - 0.15, A.z1], [ATRIUM.x0, -12.5], UP)
  parapet([-44, A.z1 - 0.15], [A.x0 - T / 2, A.z1], UP)
  for (const x of [-43.6, -32, -20]) m.block(x, 0, -12.8, 0.4, UP - SLAB, 0.4, 'concrete')
  const westTop = stairs(-44, -41, -7.1, 0, UP)
  m.span([-41, 0, westTop], [-40.9, UP + 1.1, -7.1], 'metal')
  m.span([-44.1, 0, westTop], [-44, UP + 1.1, -7.1], 'metal')

  // ─── Bridge (4.5) from A's east wing to B's roof terrace ───────────────────────────────
  m.span([A.x1 + T / 2, UP - SLAB, -26], [B.x0, UP, -23], 'concrete')
  parapet([A.x1 + T / 2, -26], [B.x0, -25.9], UP, 'glass')
  parapet([A.x1 + T / 2, -23.1], [B.x0, -23], UP, 'glass')
  m.block(16, 0, -24.5, 0.5, UP - SLAB, 0.5, 'concrete')

  // ─── Building B: lab with server hall, roof terrace ─────────────────────────────────────
  finish(B.x0, B.z0, B.x1, B.z1, 'tile')
  windowWallZ(B.z0, B.z1, B.x0, 0, UP - SLAB, [[-10, 2]])
  windowWallZ(B.z0, B.z1, B.x1, 0, UP - SLAB, [[-12, 1.6]])
  windowWallX(B.x0, B.x1, B.z1, 0, UP - SLAB, [[30, 2]])
  windowWallX(B.x0, B.x1, B.z0, 0, UP - SLAB, [[34, 1.6]])
  m.span([B.x0 - T / 2, UP - SLAB, B.z0 - T / 2], [B.x1 + T / 2, UP, B.z1 + T / 2], 'concrete')
  wallX(B.x0, B.x1, -14, 0, 3, 'plaster', [
    [26, 1.6],
    [36, 2],
    [42, 1.6],
  ])
  // Server hall (north): rack rows with gaps.
  for (const [x0, x1, z] of [
    [24, 31, -24],
    [33, 43, -24],
    [24, 29, -19.5],
    [31, 38, -19.5],
    [40, 43, -19.5],
  ] as const) {
    m.span([x0, 0, z - 0.4], [x1, 2.1, z + 0.4], 'rack')
  }
  // Lab (south): benches (low cover).
  for (const [x0, x1, z] of [
    [26, 36, -9],
    [38, 43, -9],
    [24, 29, -4],
    [33, 40, -4],
  ] as const) {
    m.span([x0, 0, z - 0.6], [x1, 0.95, z + 0.6], 'desk')
  }
  plant(23, 1, 0, 1.3)
  // Roof terrace: parapet with gaps for the bridge (west) and the stairs (south), HVAC units.
  finish(B.x0, B.z0, B.x1, B.z1, 'concrete', UP)
  parapet([B.x0, B.z0], [B.x1, B.z0 + 0.3], UP)
  parapet([B.x1 - 0.3, B.z0], [B.x1, B.z1], UP)
  parapet([B.x0, B.z1 - 0.3], [40, B.z1], UP)
  parapet([43, B.z1 - 0.3], [B.x1, B.z1], UP)
  parapet([B.x0, B.z0], [B.x0 + 0.3, -26], UP)
  parapet([B.x0, -23], [B.x0 + 0.3, B.z1], UP)
  m.block(28, UP, -17, 2.4, 2.0, 1.6, 'metal') // HVAC (high cover)
  m.block(38, UP, -8, 1.6, 2.0, 2.4, 'metal')
  m.block(34, UP, -24, 2.4, 2.0, 1.6, 'metal')
  m.block(30, UP, -5, 1.2, 1.1, 1.2, 'metal') // vents (low cover)
  m.block(41, UP, -18, 1.2, 1.1, 1.2, 'metal')
  m.block(25, UP, -9, 1.2, 1.1, 1.2, 'metal')
  const bTop = stairs(40, 43, 7.4, 0, UP)
  m.span([39.9, 0, bTop], [40, UP + 1.1, 7.4], 'metal')
  m.span([43, 0, bTop], [43.1, UP + 1.1, 7.4], 'metal')

  // ─── Café pavilion with a terrace ───────────────────────────────────────────────────────
  finish(C.x0, C.z0, C.x1, C.z1, 'wood')
  wallX(C.x0, C.x1, C.z0, 0, C.h, 'glass', [[-29, 2]])
  wallX(C.x0, C.x1, C.z1, 0, C.h, 'glass', [[-26, 2]])
  wallZ(C.z0, C.z1, C.x0, 0, C.h, 'glass')
  wallZ(C.z0, C.z1, C.x1, 0, C.h, 'glass', [[3, 2]])
  m.span([C.x0 - 1, C.h, C.z0 - 1], [C.x1 + 1, C.h + 0.3, C.z1 + 1], 'wood')
  for (const [x, z] of [
    [C.x0 - 0.8, C.z0 - 0.8],
    [C.x1 + 0.8, C.z0 - 0.8],
    [C.x0 - 0.8, C.z1 + 0.8],
    [C.x1 + 0.8, C.z1 + 0.8],
  ] as const) {
    m.block(x, 0, z, 0.2, C.h, 0.2, 'metal')
  }
  m.span([-33, 0, -1], [-32.2, 1.1, 6], 'desk') // counter
  m.span([-35.85, 0, -1.5], [-35.3, 2.2, 7], 'wood') // back shelves
  m.block(-32.6, 1.1, 1, 0.6, 0.5, 0.5, 'accent', deco) // coffee machine
  m.span([-35.84, 2.3, -0.5], [-35.8, 3.0, 5], 'whiteboard', deco) // menu board
  for (const [x, z] of [
    [-28, 1],
    [-24.8, 1],
    [-28, 5],
    [-24.8, 5],
  ] as const) {
    m.block(x, 0, z, 1, 0.75, 1, 'desk')
    for (const dx of [-0.85, 0.85]) m.block(x + dx, 0, z, 0.4, 0.45, 0.4, 'fabricAlt', deco)
  }
  for (const x of [-33, -28, -23]) {
    m.block(x, 0, 11.5, 1, 0.75, 1, 'desk') // terrace table
    m.block(x, 0.75, 11.5, 0.08, 1.5, 0.08, 'metal', deco)
    m.block(x, 2.25, 11.5, 2.4, 0.1, 2.4, 'accent', deco) // umbrella
  }
  plant(C.x0 - 1.5, -3.5)
  plant(C.x1 + 1.5, -3.5)

  // ─── Courtyard: central planter with a tree, low walls, planters, benches, trees ────────
  m.block(0, 0, 2, 6, 0.7, 6, 'concrete')
  m.block(0, 0.7, 2, 5.6, 0.05, 5.6, 'plant', deco)
  tree(0, 2, 0.7, false)
  bench(0, -1.25, 'x')
  bench(0, 5.25, 'x')
  bench(-3.25, 2, 'z')
  bench(3.25, 2, 'z')
  for (const s of [-1, 1]) {
    m.span([s * 7, 0, -6.3], [s * 14, 1, -6], 'concrete')
    m.span([s * 13.7, 0, -6], [s * 14, 1, -2], 'concrete')
    m.span([s * 7, 0, 10], [s * 14, 1, 10.3], 'concrete')
    m.span([s * 13.7, 0, 6], [s * 14, 1, 10], 'concrete')
    planter(s * 17.5, 2, 2, 5)
    planter(s * 6, -10, 4, 1.5)
    planter(s * 6, 13.5, 4, 1.5)
    tree(s * 17, -9.5)
    tree(s * 17, 12.5)
    bench(s * 10.5, -10.5, 'x')
  }

  // ─── Yards: side yard (bike shed), A–B yard, alley, service yard, west lawn ─────────────
  for (const [x, z] of [
    [-48.8, -33],
    [-43.2, -33],
    [-48.8, -27],
    [-43.2, -27],
  ] as const) {
    m.block(x, 0, z, 0.15, 2.4, 0.15, 'metal')
  }
  m.span([-49.2, 2.4, -33.4], [-42.8, 2.55, -26.6], 'metal', deco) // shed roof
  for (let z = -32.4; z <= -27.6; z += 0.8) m.block(-46, 0, z, 1.6, 0.9, 0.06, 'metal', deco) // bikes
  tree(-46, -19)
  tree(-46, -3)
  tree(-44, 9)
  bench(-47, 3, 'z')
  tree(19, -18)
  m.block(13.2, 0, -32.6, 2.0, 1.4, 1.3, 'platform') // dumpsters
  m.block(16, 0, -33, 2.4, 1.6, 2.0, 'metal') // generator
  m.block(30, 0, -32.8, 2.0, 1.4, 1.3, 'accent')
  m.block(32.4, 0, -32.8, 2.0, 1.4, 1.3, 'platform')
  m.span([38, 0, -34.6], [44, 2.0, -33.6], 'metal') // AC units against the back wall
  m.block(47.6, 0, -20, 1.6, 1.6, 2.4, 'metal') // transformer
  m.block(26, 0, 4.6, 2.0, 1.4, 1.3, 'platform')
  m.block(28.4, 0, 4.6, 2.0, 1.4, 1.3, 'accent')
  // Delivery van (high cover).
  m.block(34, 0.3, 11, 5.2, 2.0, 2.0, 'plaster')
  m.block(34, 0, 11, 4.6, 0.3, 1.8, 'metal', solid)
  m.block(36.62, 1.2, 11, 0.04, 0.8, 1.8, 'glass', deco)
  for (const dx of [-1.7, 1.7]) {
    for (const dz of [-1, 1]) m.block(34 + dx, 0, 11 + dz, 0.65, 0.65, 0.2, 'fabricAlt', deco)
  }
  m.block(46.5, 0, 6, 1.2, 1.1, 1.0, 'desk') // pallets
  m.block(46.5, 0, 8, 1.2, 2.0, 1.0, 'desk')

  // ─── Parking: low wall with gaps, two rows of cars, light poles ─────────────────────────
  for (const [a, b] of [
    [-49, -32],
    [-27, -3],
    [3, 27],
    [32, 49],
  ] as const) {
    m.span([a, 0, 16], [b, 0.9, 16.4], 'concrete')
    m.span([a, 0.9, 16.05], [b, 1.3, 16.35], 'plant', deco)
  }
  const bayX = (k: number) => -42.9 + k * 2.6
  for (let k = 0; k <= 33; k++) {
    const x = bayX(k) - 1.3
    m.span([x - 0.05, 0, 17], [x + 0.05, 0.012, 22], 'plaster', deco)
    m.span([x - 0.05, 0, 28.5], [x + 0.05, 0.012, 33.5], 'plaster', deco)
  }
  const paints: MaterialId[] = ['accent', 'platform', 'plaster', 'metal', 'marker', 'fabric']
  const row1 = [1, 2, 5, 8, 9, 13, 16, 20, 21, 24, 28, 31]
  const row2 = [0, 3, 4, 7, 11, 12, 15, 18, 22, 26, 27, 30]
  row1.forEach((k, i) => {
    car(bayX(k), 19.5, 'n', paints[i % paints.length] ?? 'accent')
  })
  row2.forEach((k, i) => {
    car(bayX(k), 31, 's', paints[(i + 3) % paints.length] ?? 'accent')
  })
  for (const x of [-36, -18, 0, 18, 36]) {
    m.block(x, 0, 25.25, 0.25, 6, 0.25, 'metal')
    m.block(x, 5.8, 25.25, 1.6, 0.15, 0.4, 'metal', deco)
    m.block(x, 5.7, 25.25, 1.2, 0.1, 0.3, 'lightpanel', deco)
  }

  // ─── Lights (indoors; the sun does the outside) ─────────────────────────────────────────
  lightPanels(A.x0, ATRIUM.x0, A.z0, A.z1, UP - SLAB)
  lightPanels(ATRIUM.x1, A.x1, A.z0, A.z1, UP - SLAB)
  lightPanels(A.x0, A.x1, A.z0, A.z1, R)
  lightPanels(B.x0, B.x1, B.z0, B.z1, UP - SLAB)
  const neutral = 0xfff1df
  const pt = (
    x: number,
    y: number,
    z: number,
    intensity: number,
    distance: number,
    color = neutral,
  ) => m.light({ kind: 'point', pos: [x, y, z], color, intensity, distance })
  pt(-29, 3.6, -24, 20, 16) // A west wing
  pt(-29, 8, -24, 20, 16)
  pt(-10, 7.5, -24, 30, 18) // atrium
  pt(4, 3.6, -20, 14, 12) // A east lobby
  pt(4, 3.4, -30.5, 16, 10, 0x5fa8ff) // IT room
  pt(4, 8, -24, 16, 14)
  pt(-29, 2.9, 3, 14, 12, 0xffcf8a) // café
  pt(33, 3.6, -6, 18, 14) // B lab
  pt(33, 3.6, -21.5, 16, 12, 0x5fa8ff) // B servers

  // ─── Spawns (feet) ──────────────────────────────────────────────────────────────────────
  const N = 0
  const S = 180
  const E = -90
  const W = 90
  m.spawn(-46, 0, -23, E) // side yard
  m.spawn(-46, 0, 6, E) // west lawn
  m.spawn(-30.5, 0, 3, E) // café
  m.spawn(0, 0, -9, S) // courtyard
  m.spawn(16, 0, 7, W)
  m.spawn(-38, 0, 25, E) // parking
  m.spawn(38, 0, 25, W)
  m.spawn(0, 0, 24, N)
  m.spawn(16, 0, -29, S) // A–B yard
  m.spawn(27, 0, -31.5, E) // alley
  m.spawn(30, 0, -12, S) // B lab
  m.spawn(-29, 0, -17.2, N) // A west wing
  m.spawn(-10, 0, -18, N) // atrium
  m.spawn(4, 0, -20, W) // A east lobby
  m.spawn(-30, UP, -13.75, S) // balcony
  m.spawn(-29, UP, -24, S) // A upper west
  m.spawn(-14, UP, -31, S) // gallery
  m.spawn(6, UP, -24.5, E) // A upper east, by the bridge door
  m.spawn(30, UP, -11, S) // B roof
  m.spawn(41, UP, -1, W)
  m.randomSpawnsIn([X0 + 0.5, Z0 + 0.5], [X1 - 0.5, Z1 - 0.5])

  // ─── Weapons lying around (you spawn with only the handgun) ────────────────────────────
  const RIFLE = 1
  const SNIPER = 2
  const SHOTGUN = 3
  m.pickup(43, UP, -26, SNIPER) // B roof, back corner
  m.pickup(-20, UP, -13.75, SNIPER) // balcony, east end
  m.pickup(-9.5, 0, 2, RIFLE) // courtyard, between the low walls
  m.pickup(-20, 0, 25, RIFLE) // parking aisle
  m.pickup(31.5, 0, 7.5, RIFLE) // service yard, by the van
  m.pickup(-10, UP, -30.5, RIFLE) // gallery, top of the grand stairs
  m.pickup(16, 0, -30.5, RIFLE) // A–B yard, under the bridge
  m.pickup(-34.2, 0, 2.5, SHOTGUN) // behind the café counter
  m.pickup(34, 0, -21.75, SHOTGUN) // B server hall
  m.pickup(2, 0, -30.6, SHOTGUN) // A's IT room
  m.pickup(40, 0, -31.5, SHOTGUN) // alley behind B
  return m.build()
}
