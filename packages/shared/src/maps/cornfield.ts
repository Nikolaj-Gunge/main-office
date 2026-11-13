import { MapBuilder } from './builder.ts'
import { DECO, LMG, MP5, RIFLE, SHOTGUN, SNIPER, spot, starts, zone } from './coop-kit.ts'
import type { MapDef, Vec3 } from './types.ts'

/**
 * "Harvest Moon": a co-op zombies map in a corn maze at night. The team's truck dies on a
 * country road; the only way out is across the corn to the farm on the other side.
 *
 * The corn is the point: it blocks people (you walk the mown paths, and it's taller than you)
 * but zombies and bots push straight through it, and bullets and sight go through it too. You
 * can't see them coming — only the corn moving — and they can come from any side. There's no
 * corn on the minimap: you find your own way (the HUD still points at the goal).
 *
 *   z 6 … −4      Road ─ survivors start at the truck
 *   z −8 … −98    The corn: a maze of 2.6 m paths on a 6 m grid (12 × 15 cells), with clearings
 *   z −98 … −104  Farm lane, fence and gate (0)
 *   z −104 … −152 Farmyard: farmhouse (west), barn (east), silo, windmill, pasture
 *
 *   1 Roadside     kill the zombies stumbling out of the corn
 *   2 The corn     find the scarecrow clearing in the middle of the field
 *   3 Scarecrow    hold the clearing (a hay-bale lookout sees over the corn)
 *   4 Fuel         pick up the 3 fuel cans lost in the corn
 *   5 Farm gate    get the fuel to the farm gate                        → gate (0)
 *   6 Farmhouse    find the radio
 *   7 Barn         defend the barn generator while it powers the radio
 *   8 Pasture      hold the landing field until the helicopter lands   → escaped
 */

// ─── The maze grid ────────────────────────────────────────────────────────────────────────
const COLS = 12
const ROWS = 15
/** Grid pitch (m) and path width (m): corn between paths is P − W = 3.4 m thick. */
const P = 6
const W = 2.6
const X0 = -36 // west edge of the field
const Z0 = -8 // south edge of the field
const X1 = X0 + COLS * P
const Z1 = Z0 - ROWS * P
/** Corn height: taller than anyone's eyes, too tall to jump. */
const CORN = 2.6

/** Centre of cell (i, j) — column i from the west, row j from the road. */
const cx = (i: number) => X0 + P * (i + 0.5)
const cz = (j: number) => Z0 - P * (j + 0.5)
/** Grid line i (x) / j (z): the corn between cells. */
const lx = (i: number) => X0 + P * i
const lz = (j: number) => Z0 - P * j

/** Clearings, in cells (inclusive). */
const SCARECROW = { i0: 4, i1: 7, j0: 6, j1: 8 }
const CAN_CLEARINGS = [
  { i0: 1, i1: 2, j0: 4, j1: 5 }, // west: the tractor
  { i0: 9, i1: 10, j0: 2, j1: 3 }, // east: the crashed crop duster
  { i0: 8, i1: 9, j0: 11, j1: 12 }, // north-east: the pump house
]
/** Ways into the corn from the road (columns) and out to the farm lane. */
const SOUTH_GAPS = [2, 5, 9]
const NORTH_GAPS = [1, 6, 10]

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The maze: which walls between cells are mown open, and which corner blocks are gone. A
 * spanning tree (every cell reachable), then most dead ends knocked through so it loops (you
 * can always go round a zombie), then the clearings. Seeded: every server and client grows the
 * same field.
 */
export function growMaze(seed = 20261112): {
  /** `v:i,j` — the wall on line x i, row j (between cells i−1 and i) is open. */
  open: Set<string>
  /** `p:i,j` — the corner block where lines i and j cross is gone. */
  cleared: Set<string>
} {
  const rand = mulberry32(seed)
  const open = new Set<string>()
  const cleared = new Set<string>()
  const between = (i: number, j: number, i2: number, j2: number) =>
    j === j2 ? `v:${Math.max(i, i2)},${j}` : `h:${i},${Math.max(j, j2)}`
  const neighbours = (i: number, j: number) =>
    (
      [
        [i - 1, j],
        [i + 1, j],
        [i, j - 1],
        [i, j + 1],
      ] as const
    ).filter(([a, b]) => a >= 0 && a < COLS && b >= 0 && b < ROWS)

  // Spanning tree (depth-first, iterative).
  const seen = new Set<number>([0])
  const stack: [number, number][] = [[0, 0]]
  while (stack.length > 0) {
    const [i, j] = stack[stack.length - 1] as [number, number]
    const next = neighbours(i, j).filter(([a, b]) => !seen.has(b * COLS + a))
    if (next.length === 0) {
      stack.pop()
      continue
    }
    const [a, b] = next[Math.floor(rand() * next.length)] as [number, number]
    open.add(between(i, j, a, b))
    seen.add(b * COLS + a)
    stack.push([a, b])
  }
  // Braid: knock most dead ends through to a neighbour.
  for (let j = 0; j < ROWS; j++) {
    for (let i = 0; i < COLS; i++) {
      const ways = neighbours(i, j)
      const shut = ways.filter(([a, b]) => !open.has(between(i, j, a, b)))
      if (ways.length - shut.length === 1 && rand() < 0.7) {
        const [a, b] = shut[Math.floor(rand() * shut.length)] as [number, number]
        open.add(between(i, j, a, b))
      }
    }
  }
  // Clearings: every wall inside open, every corner inside gone.
  for (const c of [SCARECROW, ...CAN_CLEARINGS]) {
    for (let j = c.j0; j <= c.j1; j++) {
      for (let i = c.i0; i <= c.i1; i++) {
        if (i < c.i1) open.add(between(i, j, i + 1, j))
        if (j < c.j1) open.add(between(i, j, i, j + 1))
        if (i > c.i0 && j > c.j0) cleared.add(`p:${i},${j}`)
      }
    }
  }
  for (const i of SOUTH_GAPS) open.add(`h:${i},0`)
  for (const i of NORTH_GAPS) open.add(`h:${i},${ROWS}`)
  return { open, cleared }
}

export function buildCornfield(): MapDef {
  const m = new MapBuilder('cornfield', 'Harvest Moon (co-op)', {
    // Moonlight.
    sunDirection: [0.45, 0.75, -0.35],
    sunColor: 0x9fb4e8,
    sunIntensity: 0.55,
    skyColor: 0x182036,
    groundColor: 0x16130e,
    ambientIntensity: 1.05,
    fogColor: 0x171d2c,
    fogNear: 14,
    fogFar: 75,
  })

  // ─── Ground, edges ──────────────────────────────────────────────────────────────────────
  m.span([-62, -0.5, 16], [62, 0, -162], 'dirt')
  m.span([-62, 0, 5], [62, 0.012, -4], 'concrete', DECO) // the road
  for (let x = -60; x < 60; x += 6) m.span([x, 0, 0.45], [x + 3, 0.02, 0.55], 'marker', DECO)
  m.span([-62, 0, 16], [62, 0.01, 5], 'grass', DECO) // verges
  m.span([-62, 0, -4], [62, 0.01, Z0], 'grass', DECO)
  m.span([X0, 0, -104], [X1, 0.01, -152], 'grass', DECO) // farmyard
  // Out of bounds: invisible walls round the playable area (trees and corn beyond them).
  const bound = { render: false } as const
  m.span([-36.4, 0, 10], [-36, 8, -152], 'wall', bound)
  m.span([36, 0, 10], [36.4, 8, -152], 'wall', bound)
  m.span([-36.4, 0, 10.4], [36.4, 8, 10], 'wall', bound)
  m.span([-36.4, 0, -152], [36.4, 8, -152.4], 'wall', bound)

  /** A tree: trunk and a blocky crown, `h` tall. */
  const tree = (x: number, z: number, h: number) => {
    m.block(x, 0, z, 0.6, h * 0.45, 0.6, 'wood')
    m.block(x, h * 0.35, z, h * 0.5, h * 0.45, h * 0.5, 'plant')
    m.block(x, h * 0.75, z, h * 0.3, h * 0.25, h * 0.3, 'plant')
  }
  const jitter = mulberry32(7)
  for (let x = -58; x <= 58; x += 5) tree(x + jitter() * 2, 12 + jitter() * 3, 7 + jitter() * 4)
  for (let x = -40; x <= 40; x += 5) tree(x + jitter() * 2, -156 - jitter() * 3, 8 + jitter() * 4)
  for (let z = -102; z >= -150; z -= 5) {
    tree(-39 - jitter() * 2, z + jitter() * 2, 7 + jitter() * 4)
    tree(39 + jitter() * 2, z + jitter() * 2, 7 + jitter() * 4)
  }
  // The road is blocked both ways: a wreck and a fallen tree.
  m.block(-33, 0, 0.5, 1.9, 1.1, 4.4, 'accent')
  m.block(-33, 1.1, 0.2, 1.7, 0.5, 2.2, 'glass')
  m.box({ center: [33, 0.45, 0.5], size: [1, 0.9, 11], rotation: [0, 0.3, 0], material: 'wood' })
  m.block(31, 0, -3.5, 4, 2.2, 3, 'plant', DECO)

  // ─── The corn ───────────────────────────────────────────────────────────────────────────
  const { open, cleared } = growMaze()
  const half = (P - W) / 2
  /** Corn over x a…b, z c…d, clipped to the field so neighbouring blocks never overlap. */
  const corn = (a: number, b: number, c: number, d: number) => {
    const x0 = Math.max(X0, Math.min(a, b))
    const x1 = Math.min(X1, Math.max(a, b))
    const z0 = Math.max(Z1, Math.min(c, d))
    const z1 = Math.min(Z0, Math.max(c, d))
    if (x1 - x0 < 0.01 || z1 - z0 < 0.01) return
    m.span([x0, 0, z0], [x1, CORN, z1], 'corn')
  }
  for (let j = 0; j <= ROWS; j++) {
    for (let i = 0; i <= COLS; i++) {
      // Corner block where grid lines i and j cross.
      if (!cleared.has(`p:${i},${j}`)) corn(lx(i) - half, lx(i) + half, lz(j) - half, lz(j) + half)
      // Wall on line i between rows (cells i−1 and i in row j).
      if (j < ROWS && !open.has(`v:${i},${j}`)) {
        corn(lx(i) - half, lx(i) + half, cz(j) - W / 2, cz(j) + W / 2)
      }
      // Wall on line j between columns (cells j−1 and j in column i).
      if (i < COLS && !open.has(`h:${i},${j}`)) {
        corn(cx(i) - W / 2, cx(i) + W / 2, lz(j) - half, lz(j) + half)
      }
    }
  }
  // More corn beyond the edges, as far as the fog lets you see.
  m.span([-50, 0, Z1], [X0, CORN, Z0], 'corn')
  m.span([X1, 0, Z1], [50, CORN, Z0], 'corn')

  // ─── Road: the truck ────────────────────────────────────────────────────────────────────
  m.block(-7, 0.4, 0.5, 5.6, 0.9, 2.1, 'metal') // pickup: chassis + bed
  m.block(-5.6, 1.3, 0.5, 2.2, 0.9, 2, 'accent') // cab
  m.block(-4.7, 1.45, 0.5, 0.05, 0.6, 1.8, 'glass', DECO)
  m.span([-9.8, 1.3, -0.5], [-7, 1.7, -0.45], 'metal', DECO) // bed sides
  m.span([-9.8, 1.3, 1.45], [-7, 1.7, 1.5], 'metal', DECO)
  m.box({
    center: [-3.6, 1.6, 0.5],
    size: [0.05, 1.1, 1.9],
    rotation: [0, 0, -0.9],
    material: 'metal',
    collide: false,
  }) // the hood, propped up
  for (const [x, z] of [
    [-8.8, -0.55],
    [-8.8, 1.55],
    [-5, -0.55],
    [-5, 1.55],
  ] as const) {
    m.block(x, 0, z, 0.8, 0.8, 0.3, 'cover', DECO)
  }
  m.label(-7, 2.8, 0.5, 'OUT OF GAS')
  m.light({ kind: 'point', pos: [-3.2, 1, 0.5], color: 0xfff1c4, intensity: 6, distance: 12 })
  m.light({ kind: 'point', pos: [-7, 3, 3], color: 0xffd28a, intensity: 4, distance: 10 })

  // ─── Scarecrow clearing (middle of the field) ───────────────────────────────────────────
  const SX = (cx(SCARECROW.i0) + cx(SCARECROW.i1)) / 2
  const SZ = (cz(SCARECROW.j0) + cz(SCARECROW.j1)) / 2
  m.block(SX + 2, 0, SZ + 1, 0.2, 2.9, 0.2, 'wood') // scarecrow: post, arms, body, head
  m.block(SX + 2, 2.1, SZ + 1, 1.8, 0.12, 0.12, 'wood', DECO)
  m.block(SX + 2, 1.5, SZ + 1, 0.6, 0.8, 0.35, 'fabricAlt', DECO)
  m.block(SX + 2, 2.35, SZ + 1, 0.42, 0.42, 0.42, 'hay', DECO)
  m.block(SX + 2, 2.77, SZ + 1, 0.6, 0.08, 0.6, 'wood', DECO) // hat
  // Lookout: a hay-bale stair up to a deck that sees over the corn.
  const LX = cx(SCARECROW.i0) - 1.1 // deck's west edge sits on the clearing's west side
  const DECK = 1.9
  const deckZ0 = SZ - 4.4
  m.span([LX - 0.2, 0, deckZ0 - 2.8], [LX + 2.8, DECK, deckZ0 + 0.2], 'wood')
  m.span([LX - 0.2, DECK, deckZ0 - 2.8], [LX - 0.1, DECK + 1, deckZ0 + 0.2], 'wood', DECO)
  m.span([LX - 0.2, DECK, deckZ0 - 2.8], [LX + 2.8, DECK + 1, deckZ0 - 2.7], 'wood', DECO)
  for (let k = 1; k <= 4; k++) {
    const top = DECK - 0.38 * k
    m.span(
      [LX + 2.8 + 0.9 * (k - 1), 0, deckZ0 - 2.2],
      [LX + 2.8 + 0.9 * k, top, deckZ0 - 0.4],
      'hay',
    )
  }
  m.navLink([LX + 7.2, 0, deckZ0 - 1.3], [LX + 1.3, DECK, deckZ0 - 1.3])
  m.light({ kind: 'point', pos: [SX, 3.2, SZ], color: 0xffb060, intensity: 7, distance: 14 })
  m.label(SX + 2, 3.3, SZ + 1, 'SCARECROW')

  // ─── Fuel cans, each in its own clearing with a landmark ────────────────────────────────
  const cans: [number, number][] = CAN_CLEARINGS.map((c) => [
    (cx(c.i0) + cx(c.i1)) / 2,
    (cz(c.j0) + cz(c.j1)) / 2,
  ])
  for (const [x, z] of cans) {
    m.block(x, 0, z, 0.35, 0.5, 0.22, 'accent')
    m.light({ kind: 'point', pos: [x, 1.2, z], color: 0xff5a3c, intensity: 4, distance: 9 })
  }
  {
    // Tractor (west clearing), parked beside the can.
    const [x, z] = cans[0] as [number, number]
    m.block(x - 2.4, 0.5, z + 1.6, 2, 1, 3.2, 'accent')
    m.block(x - 2.4, 1.5, z + 2.2, 1.4, 1.2, 1.4, 'glass')
    m.block(x - 2.4, 0, z + 0.6, 2.4, 1.5, 0.6, 'cover')
    m.block(x - 2.4, 0, z + 3.2, 2.2, 0.9, 0.5, 'cover')
    // Crashed crop duster (east): fuselage, a wing in the corn, the tail up.
    const [px, pz] = cans[1] as [number, number]
    m.box({
      center: [px + 1.5, 0.7, pz - 2],
      size: [1.2, 1.2, 5],
      rotation: [0.15, 0.6, 0],
      material: 'metal',
    })
    m.box({
      center: [px - 1.2, 0.3, pz - 0.6],
      size: [6, 0.15, 1.3],
      rotation: [0, 0.6, 0.2],
      material: 'whiteboard',
      collide: false,
    })
    m.box({
      center: [px + 2.8, 1.8, pz - 4],
      size: [0.12, 1.4, 1],
      rotation: [0, 0.6, 0],
      material: 'whiteboard',
      collide: false,
    })
    // Pump house (north-east): a little shed and a water tank.
    const [hx, hz] = cans[2] as [number, number]
    m.block(hx + 2.2, 0, hz - 2.2, 2.4, 2.4, 2.4, 'wood')
    m.block(hx + 2.2, 2.4, hz - 2.2, 2.8, 0.15, 2.8, 'metal', DECO)
    m.block(hx - 2.4, 0, hz + 2.2, 1.6, 3.6, 1.6, 'metal')
  }

  // ─── Farm lane, fence and gate (0) ──────────────────────────────────────────────────────
  const FENCE = -104
  m.span([X0, 0, FENCE - 0.15], [-2.2, 2, FENCE + 0.15], 'wood', { render: false })
  m.span([2.2, 0, FENCE - 0.15], [X1, 2, FENCE + 0.15], 'wood', { render: false })
  for (let x = X0; x <= X1; x += 3) {
    if (Math.abs(x) < 2.2) continue
    m.block(x, 0, FENCE, 0.18, 1.9, 0.18, 'wood', DECO)
  }
  for (const y of [0.6, 1.4]) {
    m.span([X0, y, FENCE - 0.05], [-2.2, y + 0.15, FENCE + 0.05], 'wood', DECO)
    m.span([2.2, y, FENCE - 0.05], [X1, y + 0.15, FENCE + 0.05], 'wood', DECO)
  }
  m.span([-2.2, 0, FENCE - 0.12], [2.2, 1.9, FENCE + 0.12], 'wood', { gate: 0 })
  m.span([-2.2, 0, FENCE + 0.15], [2.2, 0.02, FENCE + 0.45], 'marker', DECO)
  m.block(-2.5, 0, FENCE, 0.3, 2.6, 0.3, 'wood')
  m.block(2.5, 0, FENCE, 0.3, 2.6, 0.3, 'wood')
  m.label(0, 2.9, FENCE, 'FARM')
  m.light({ kind: 'point', pos: [0, 3.2, FENCE + 1], color: 0xffd28a, intensity: 5, distance: 11 })
  m.span([-2, 0, FENCE], [2, 0.015, -146], 'dirt', DECO) // drive up the yard

  // ─── Farmhouse (west) ───────────────────────────────────────────────────────────────────
  {
    const x0 = -31
    const x1 = -17
    const z0 = -122
    const z1 = -110
    const H = 3.2
    const t = 0.3
    m.span([x0, 0, z1 - t], [-25.2, H, z1], 'plaster') // front, door in the middle
    m.span([-22.8, 0, z1 - t], [x1, H, z1], 'plaster')
    m.span([-25.2, 2.3, z1 - t], [-22.8, H, z1], 'plaster')
    m.span([x0, 0, z0], [x1, H, z0 + t], 'plaster')
    m.span([x0, 0, z0], [x0 + t, H, z1], 'plaster')
    m.span([x1 - t, 0, z0], [x1, H, z1], 'plaster')
    m.span([x0, H, z0], [x1, 6, z1], 'plaster') // upstairs (shut)
    m.box({
      center: [(x0 + x1) / 2, 7.4, (z0 + z1) / 2 + 3.2],
      size: [x1 - x0 + 0.8, 0.25, 7.4],
      rotation: [0.42, 0, 0],
      material: 'metal',
      collide: false,
    })
    m.box({
      center: [(x0 + x1) / 2, 7.4, (z0 + z1) / 2 - 3.2],
      size: [x1 - x0 + 0.8, 0.25, 7.4],
      rotation: [-0.42, 0, 0],
      material: 'metal',
      collide: false,
    })
    // Gable ends, stepped (pixel triangles).
    for (let k = 0; k < 4; k++) {
      const d = 6 * (1 - (k + 0.5) / 4)
      for (const x of [x0, x1 - t])
        m.span([x, 6 + 0.6 * k, -116 - d], [x + t, 6.6 + 0.6 * k, -116 + d], 'plaster', DECO)
    }
    for (const x of [-29, -20])
      m.span([x - 0.8, 1, z1 + 0.01], [x + 0.8, 2.1, z1 + 0.03], 'lightpanel', DECO)
    for (const x of [-28, -20])
      m.span([x - 0.7, 4, z1 + 0.01], [x + 0.7, 5, z1 + 0.03], 'lightpanel', DECO)
    // Porch: deck, posts, roof.
    m.span([x0 + 1, 0, z1], [x1 - 1, 0.03, z1 + 2.4], 'wood', DECO)
    for (const x of [x0 + 1.2, -25.4, -22.6, x1 - 1.2])
      m.block(x, 0, z1 + 2.2, 0.2, 2.8, 0.2, 'wood')
    m.span([x0 + 1, 2.8, z1], [x1 - 1, 2.95, z1 + 2.5], 'wood', DECO)
    m.light({
      kind: 'point',
      pos: [-24, 2.5, z1 + 1.4],
      color: 0xffd28a,
      intensity: 6,
      distance: 12,
    })
    // Inside: kitchen table, dresser, a lamp.
    m.block(-28, 0, -117, 2, 0.78, 1.1, 'wood')
    m.block(-30, 0, -119, 1.2, 1.6, 0.6, 'wood')
    m.block(-19, 0, -120.5, 2.4, 0.9, 0.7, 'desk')
    m.light({ kind: 'point', pos: [-24, 2.8, -116], color: 0xffc070, intensity: 5, distance: 9 })
  }

  // ─── Barn (east), with the generator ────────────────────────────────────────────────────
  const GEN: Vec3 = [24, 0, -131]
  {
    const x0 = 10
    const x1 = 30
    const z0 = -138
    const z1 = -110
    const H = 6
    const t = 0.3
    m.span([x0, 0, z1 - t], [16, H, z1], 'barn') // front: big doors 16…24
    m.span([24, 0, z1 - t], [x1, H, z1], 'barn')
    m.span([16, 4.5, z1 - t], [24, H, z1], 'barn')
    m.span([x0, 0, z0], [x1, H, z0 + t], 'barn')
    m.span([x0, 0, z0], [x0 + t, H, -127], 'barn') // west: small door at −127 … −125.6
    m.span([x0, 0, -125.6], [x0 + t, H, z1], 'barn')
    m.span([x0, 2.3, -127], [x0 + t, H, -125.6], 'barn')
    m.span([x1 - t, 0, z0], [x1, H, z1], 'barn')
    m.span([x0, H, z0], [x1, H + 0.2, z1], 'wood') // loft floor / ceiling
    for (const side of [-1, 1]) {
      m.box({
        center: [(x0 + x1) / 2 + side * 5.2, H + 2.5, (z0 + z1) / 2],
        size: [11.6, 0.25, z1 - z0 + 0.8],
        rotation: [0, 0, side * -0.42],
        material: 'barn',
        collide: false,
      })
    }
    for (let k = 0; k < 5; k++) {
      const d = 10 * (1 - (k + 0.5) / 5)
      for (const z of [z0, z1 - t])
        m.span([20 - d, H + 0.2 + 0.9 * k, z], [20 + d, H + 1.1 + 0.9 * k, z + t], 'barn', DECO)
    }
    // Doors swung open.
    m.span([12.2, 0, z1 + 0.1], [16, 4.4, z1 + 0.25], 'barn', DECO)
    m.span([24, 0, z1 + 0.1], [27.8, 4.4, z1 + 0.25], 'barn', DECO)
    m.span([x0, 0, z1], [x1, 0.012, z0], 'dirt', DECO)
    // Hay bales and stalls.
    for (const [x, z, h] of [
      [12, -114, 2],
      [12, -116, 1],
      [28, -114, 2],
      [28, -118, 1],
      [12, -134, 3],
      [14, -136, 2],
      [17, -136, 1],
      [28, -136, 1],
    ] as const) {
      for (let k = 0; k < h; k++) m.block(x, 0.9 * k, z, 1.8, 0.9, 1.2, 'hay')
    }
    for (const z of [-118, -124]) m.span([18, 0, z - 0.1], [21, 1.4, z + 0.1], 'wood')
    // The generator.
    m.block(GEN[0], 0, GEN[2], 2.4, 1.4, 1.4, 'metal')
    m.block(GEN[0] + 0.7, 1.4, GEN[2] - 0.3, 0.25, 1, 0.25, 'metal')
    m.block(GEN[0] - 1.6, 0, GEN[2], 0.6, 0.9, 0.6, 'accent') // fuel drum
    m.label(GEN[0], 2.2, GEN[2], 'GENERATOR')
    for (const z of [-115, -124, -133]) {
      m.light({ kind: 'point', pos: [20, H - 0.6, z], color: 0xffcf8a, intensity: 6, distance: 13 })
    }
    m.light({ kind: 'point', pos: [20, 5.2, z1 + 1], color: 0xfff1c4, intensity: 7, distance: 14 })
  }
  // Silo and windmill: landmarks you can see from inside the corn.
  m.block(33, 0, -144, 4, 14, 4, 'metal')
  m.block(33, 14, -144, 3, 1.2, 3, 'metal', DECO)
  m.block(-33, 0, -145, 0.6, 10, 0.6, 'metal')
  m.box({
    center: [-33, 10, -144.6],
    size: [4.5, 0.4, 0.08],
    rotation: [0, 0, 0.5],
    material: 'metal',
    collide: false,
  })
  m.box({
    center: [-33, 10, -144.6],
    size: [4.5, 0.4, 0.08],
    rotation: [0, 0, -1.07],
    material: 'metal',
    collide: false,
  })
  m.light({ kind: 'point', pos: [32, 3, -140], color: 0xffd28a, intensity: 5, distance: 12 })

  // ─── Pasture (landing field, north-west) ────────────────────────────────────────────────
  const LAND = { x: -16, z: -140 }
  m.span([LAND.x - 5, 0, LAND.z - 5], [LAND.x + 5, 0.015, LAND.z + 5], 'marker', DECO)
  m.span([LAND.x - 3.5, 0, LAND.z - 3.5], [LAND.x + 3.5, 0.02, LAND.z + 3.5], 'accent', DECO)
  m.label(LAND.x, 0.4, LAND.z, 'H')
  for (const [x, z] of [
    [-27, -130],
    [-24, -149],
    [-8, -150],
    [-6, -131],
    [-29, -139],
    [-10, -127],
  ] as const) {
    m.block(x, 0, z, 1.6, 1.2, 1.6, 'hay') // round bales (square, it's a pixel game)
  }
  m.light({ kind: 'point', pos: [LAND.x, 4, LAND.z], color: 0xc8d8ff, intensity: 6, distance: 16 })
  m.light({ kind: 'point', pos: [-6, 3.5, -118], color: 0xffd28a, intensity: 5, distance: 12 })

  // ─── Weapons (back 20 s after they're taken) ────────────────────────────────────────────
  m.pickup(-3.2, 0, 3, SHOTGUN, 20) // at the truck
  m.pickup(-3.2, 0, -2, MP5, 20)
  m.pickup(SX + 5, 0, SZ - 2, RIFLE, 20) // scarecrow clearing
  m.pickup(SX - 3, 0, SZ + 4, SHOTGUN, 20)
  m.pickup(LX + 1.3, DECK, deckZ0 - 1.3, SNIPER, 25) // up on the lookout
  m.pickup(-6, 0, -100.8, RIFLE, 20) // farm lane
  m.pickup(6, 0, -100.8, MP5, 20)
  m.pickup(20, 0, -121, LMG, 20) // barn
  m.pickup(14, 0, -128, SHOTGUN, 20)
  m.pickup(-6, 0, -136, LMG, 20) // pasture

  // ─── Stages ─────────────────────────────────────────────────────────────────────────────
  /** Deep in the corn where grid lines i and j cross (zombies start in the corn). */
  const inCorn = (i: number, j: number): Vec3 => [lx(i), 0, lz(j)]
  const fieldWide: Vec3[] = [
    inCorn(1, 3),
    inCorn(4, 2),
    inCorn(8, 3),
    inCorn(11, 5),
    inCorn(2, 8),
    inCorn(10, 9),
    inCorn(3, 12),
    inCorn(7, 12),
    inCorn(11, 13),
    inCorn(5, 5),
  ]
  const LANE_Z = -101

  m.stage({
    name: 'Roadside',
    task: 'Fight off the dead coming out of the corn',
    goal: { kind: 'kill', count: 12 },
    start: starts(1.5, [-1, 0.5, 2, 3.5, 5, 1.2, 2.8]),
    zombieSpawns: [
      inCorn(1, 1),
      inCorn(3, 1),
      inCorn(5, 1),
      inCorn(7, 1),
      inCorn(9, 1),
      inCorn(11, 1),
      inCorn(4, 2),
      inCorn(8, 2),
    ],
    intensity: 0.8,
    runners: 0,
  })
  m.stage({
    name: 'The corn',
    task: 'Find the scarecrow in the middle of the field',
    goal: { kind: 'reach', zone: zone(SX - 4, SZ - 4, SX + 4, SZ + 4) },
    start: starts(-2.5, [-1, 0.5, 2, 3.5, 5, 1.2, 2.8]),
    zombieSpawns: [
      inCorn(2, 4),
      inCorn(6, 3),
      inCorn(10, 4),
      inCorn(3, 7),
      inCorn(9, 7),
      inCorn(1, 1),
      inCorn(11, 2),
    ],
    intensity: 1,
    runners: 0.1,
    armory: MP5,
  })
  m.stage({
    name: 'Scarecrow',
    task: 'Hold the clearing — watch the corn',
    goal: { kind: 'hold', zone: zone(SX - 6, SZ - 5, SX + 6, SZ + 5), seconds: 40 },
    start: starts(SZ + 3, [SX - 3, SX - 1.5, SX, SX + 1.5, SX + 3, SX - 0.8, SX + 0.8]),
    zombieSpawns: [
      inCorn(3, 5),
      inCorn(6, 5),
      inCorn(9, 5),
      inCorn(3, 7),
      inCorn(9, 8),
      inCorn(3, 10),
      inCorn(6, 10),
      inCorn(9, 10),
    ],
    intensity: 1.3,
    runners: 0.15,
  })
  m.stage({
    name: 'Fuel',
    task: 'Find the fuel cans lost in the corn',
    goal: {
      kind: 'activate',
      spots: cans.map(([x, z]) => spot(x, z, 0, 3)),
      seconds: 2,
      what: 'Fuel can',
    },
    start: starts(SZ + 3, [SX - 3, SX - 1.5, SX, SX + 1.5, SX + 3, SX - 0.8, SX + 0.8]),
    zombieSpawns: fieldWide,
    intensity: 1.4,
    runners: 0.2,
    armory: RIFLE,
  })
  m.stage({
    name: 'Farm gate',
    task: 'Get the fuel to the farm gate',
    goal: { kind: 'reach', zone: zone(-3, LANE_Z - 2.5, 3, LANE_Z + 1.5) },
    start: starts(SZ - 3, [SX - 3, SX - 1.5, SX, SX + 1.5, SX + 3, SX - 0.8, SX + 0.8]),
    zombieSpawns: [
      inCorn(2, 11),
      inCorn(5, 12),
      inCorn(8, 13),
      inCorn(11, 11),
      inCorn(3, 14),
      inCorn(10, 14),
      inCorn(6, 9),
      [-30, 0, LANE_Z],
      [30, 0, LANE_Z],
    ],
    opens: 0,
    intensity: 1.5,
    runners: 0.25,
  })
  m.stage({
    name: 'Farmhouse',
    task: 'Find the radio in the farmhouse',
    goal: { kind: 'reach', zone: zone(-28, -119, -20, -113) },
    start: starts(LANE_Z, [-3, -1.5, 0, 1.5, 3, -0.8, 0.8]),
    zombieSpawns: [
      [-33.5, 0, -114],
      [-33.5, 0, -128],
      [-14, 0, -150],
      [6, 0, -127],
      [26, 0, -148],
      [-30, 0, LANE_Z],
      [30, 0, LANE_Z],
      inCorn(3, 14),
      inCorn(9, 14),
    ],
    intensity: 1.6,
    runners: 0.25,
  })
  m.stage({
    name: 'Barn',
    task: 'Keep the generator running while the radio calls for help',
    goal: {
      kind: 'defend',
      zone: zone(GEN[0] - 1.6, GEN[2] - 1.1, GEN[0] + 1.6, GEN[2] + 1.1, 0, 2.4),
      seconds: 45,
      health: 1000,
      what: 'Generator',
    },
    start: starts(-106, [17, 18.5, 20, 21.5, 23, 19.2, 20.8]),
    zombieSpawns: [
      [0, 0, -150],
      [-14, 0, -150],
      [6, 0, -127],
      [-30, 0, -126],
      [26, 0, -148],
      inCorn(4, 14),
      inCorn(8, 14),
      [-30, 0, LANE_Z],
      [30, 0, LANE_Z],
    ],
    intensity: 1.7,
    runners: 0.3,
    armory: LMG,
  })
  m.stage({
    name: 'Pasture',
    task: 'Hold the landing field until the helicopter lands',
    goal: { kind: 'hold', zone: zone(LAND.x - 5, LAND.z - 5, LAND.x + 5, LAND.z + 5), seconds: 50 },
    start: starts(-128, [-19, -17.5, -16, -14.5, -13, -16.8, -15.2]),
    zombieSpawns: [
      [-30, 0, -150],
      [-4, 0, -150],
      [-33.5, 0, -114],
      [8, 0, -112],
      [6, 0, -146],
      inCorn(2, 14),
      inCorn(6, 14),
      inCorn(10, 14),
    ],
    intensity: 2.2,
    runners: 0.45,
  })

  m.spawn(1, 0, 1.5, 0)
  // The lookout deck gets nav nodes too (the grid covers every floor a spawn stands on).
  m.spawn(LX + 1.3, DECK, deckZ0 - 1.3, 0)
  m.randomSpawnsIn([X0, -152], [X1, 10])
  return m.build()
}
