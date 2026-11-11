import { MapBuilder } from './builder.ts'
import type { MapDef, MaterialId } from './types.ts'

/**
 * "Meeting Room": a small one-floor office block, 24 × 18 m, for 2–6 players. Close quarters,
 * everything loops: a hallway runs all the way round, and the rooms in the middle are shortcuts.
 *
 *   z=-9  ┌─────────────── north hallway (shelf / vending machine break the lane) ──────────┐
 *         │ ┌────────── door ──────────────────────────┬───── glass ─────┐ │
 *         │W│ boardroom                                │ glass room      │E│
 *         │ │  TV  ═══════ long table (low cover) ═══  door       sofa   door│
 *         │h│   whiteboards, mobile whiteboards        ├─────────────────┤ │
 *         │ │                                          │ kitchenette     door│
 *         │ └──────────────── door ────────────────────┴───── door ─────┘ │
 *   z=9   └──── south hallway: lounge corner, column, print station, bookcase ────────┘
 *        x=-12                                                                  x=12
 *
 * Boardroom: two doors (north and south hallway) plus a glass door into the glass room, which
 * has its own door out to the east hallway. The kitchenette joins the east and south hallways.
 * Windows all round with the city outside. Ceiling 3 m.
 */
export function buildMeetingRoom(): MapDef {
  const m = new MapBuilder('meetingroom', 'Meeting Room', {
    sunDirection: [-0.5, 0.8, 0.45],
    sunColor: 0xfff0d8,
    sunIntensity: 2.2,
    skyColor: 0xdfe8f5,
    groundColor: 0x6b6158,
    ambientIntensity: 1.4,
    fogColor: 0xc9d6e6,
    fogNear: 60,
    fogFar: 260,
  }).withSkyline()

  const X0 = -12
  const X1 = 12
  const Z0 = -9
  const Z1 = 9
  const CEIL = 3
  const T = 0.3 // wall thickness
  const WX = 9.5 // inner hallway walls at x = ±WX
  const NZ = -6.5 // north inner wall
  const SZ = 5.5 // south inner wall
  const PX = 3.5 // boardroom | side rooms
  const KZ = 1.5 // glass room | kitchenette
  const deco = { collide: false } as const
  const solid = { render: false } as const

  // ─── Shell: floor, ceiling, exterior walls with windows ─────────────────────────────────
  m.span([X0 - 0.5, -0.5, Z0 - 0.5], [X1 + 0.5, 0, Z1 + 0.5], 'concrete')
  m.span([X0 - T, CEIL, Z0 - T], [X1 + T, CEIL + 0.3, Z1 + T], 'ceiling')
  const bands: [number, number, MaterialId][] = [
    [0, 1, 'concrete'],
    [1, 2.6, 'glass'],
    [2.6, CEIL, 'concrete'],
  ]
  /** Exterior wall just outside the playable area, mullions every 3 m. */
  const facade = (axis: 'x' | 'z', fixed: number, from: number, to: number, outward: number) => {
    const a = fixed
    const b = fixed + outward * T
    for (const [y0, y1, mat] of bands) {
      if (axis === 'z') m.span([from, y0, a], [to, y1, b], mat)
      else m.span([a, y0, from], [b, y1, to], mat)
    }
    for (let p = from; p <= to + 0.01; p += 3) {
      if (axis === 'z') m.span([p - 0.1, 0, a], [p + 0.1, CEIL, b + outward * 0.05], 'metal')
      else m.span([a, 0, p - 0.1], [b + outward * 0.05, CEIL, p + 0.1], 'metal')
    }
  }
  facade('z', Z1, X0 - T, X1 + T, 1)
  facade('z', Z0, X0 - T, X1 + T, -1)
  facade('x', X0, Z0, Z1, -1)
  facade('x', X1, Z0, Z1, 1)

  // ─── Floor finishes ─────────────────────────────────────────────────────────────────────
  const finish = (x0: number, z0: number, x1: number, z1: number, mat: MaterialId) =>
    m.span([x0, 0, z0], [x1, 0.012, z1], mat, deco)
  finish(X0, Z0, X1, Z1, 'wood') // hallways
  finish(-WX, NZ, PX, SZ, 'carpet') // boardroom
  finish(PX, NZ, WX, KZ, 'carpet') // glass room
  finish(PX, KZ, WX, SZ, 'tile') // kitchenette

  // ─── Helpers (as in office.ts) ──────────────────────────────────────────────────────────
  /** Wall along X (from x0 to x1 at z) with door gaps [centre, width]; door head at 2.4 m. */
  const wallX = (
    x0: number,
    x1: number,
    z: number,
    mat: MaterialId,
    doors: [number, number][] = [],
  ) => {
    let cursor = x0
    for (const [c, w] of [...doors].sort((a, b) => a[0] - b[0])) {
      if (c - w / 2 > cursor) m.span([cursor, 0, z - T / 2], [c - w / 2, CEIL, z + T / 2], mat)
      m.span([c - w / 2, 2.4, z - T / 2], [c + w / 2, CEIL, z + T / 2], mat)
      cursor = c + w / 2
    }
    if (cursor < x1) m.span([cursor, 0, z - T / 2], [x1, CEIL, z + T / 2], mat)
  }
  const wallZ = (
    z0: number,
    z1: number,
    x: number,
    mat: MaterialId,
    doors: [number, number][] = [],
  ) => {
    let cursor = z0
    for (const [c, w] of [...doors].sort((a, b) => a[0] - b[0])) {
      if (c - w / 2 > cursor) m.span([x - T / 2, 0, cursor], [x + T / 2, CEIL, c - w / 2], mat)
      m.span([x - T / 2, 2.4, c - w / 2], [x + T / 2, CEIL, c + w / 2], mat)
      cursor = c + w / 2
    }
    if (cursor < z1) m.span([x - T / 2, 0, cursor], [x + T / 2, CEIL, z1], mat)
  }
  const plant = (x: number, z: number, tall = 1.6) => {
    m.block(x, 0, z, 0.5, 0.45, 0.5, 'concrete') // pot (low obstacle)
    m.block(x, 0.45, z, 0.8, tall - 0.45, 0.8, 'plant', deco)
  }
  const sofa = (x: number, z: number, w: number, d: number, facing: 'n' | 's' | 'e' | 'w') => {
    m.block(x, 0, z, w, 0.45, d, 'fabric')
    const back = 0.25
    if (facing === 's') m.block(x, 0.45, z - d / 2 + back / 2, w, 0.4, back, 'fabric')
    if (facing === 'n') m.block(x, 0.45, z + d / 2 - back / 2, w, 0.4, back, 'fabric')
    if (facing === 'e') m.block(x - w / 2 + back / 2, 0.45, z, back, 0.4, d, 'fabric')
    if (facing === 'w') m.block(x + w / 2 - back / 2, 0.45, z, back, 0.4, d, 'fabric')
  }
  /** Office chair, walk-through. `back` = which side the backrest is on (+1 / -1 along z). */
  const chair = (x: number, z: number, back: number) => {
    m.block(x, 0, z, 0.5, 0.48, 0.5, 'fabricAlt', deco)
    m.block(x, 0.48, z + back * 0.22, 0.5, 0.5, 0.06, 'fabricAlt', deco)
  }
  /** Whiteboard on wheels: high cover (1.95 m), one solid collider. */
  const mobileWhiteboard = (x: number, z: number) => {
    m.block(x, 0, z, 2, 1.95, 0.3, 'whiteboard', solid)
    m.block(x, 0.7, z, 2, 1.25, 0.06, 'whiteboard', deco)
    for (const dx of [-0.95, 0.95]) {
      m.block(x + dx, 0, z, 0.05, 1.95, 0.05, 'metal', deco)
      m.block(x + dx, 0, z, 0.08, 0.06, 0.6, 'metal', deco) // foot
    }
  }
  const lightPanels = (x0: number, x1: number, z0: number, z1: number, step = 3) => {
    for (let x = x0 + step / 2; x < x1; x += step) {
      for (let z = z0 + step / 2; z < z1; z += step) {
        m.block(x, CEIL - 0.06, z, 1.2, 0.05, 0.6, 'lightpanel', deco)
      }
    }
  }

  // ─── Inner walls: the ring hallway around the rooms ─────────────────────────────────────
  wallX(-WX - T / 2, PX, NZ, 'plaster', [[-6, 1.6]]) // boardroom north door
  wallX(PX, WX + T / 2, NZ, 'glass') // glass room, north side
  wallX(-WX - T / 2, PX, SZ, 'plaster', [[-1, 1.6]]) // boardroom south door
  wallX(PX, WX + T / 2, SZ, 'plaster', [[6.5, 1.6]]) // kitchenette south door
  wallZ(NZ, SZ, -WX, 'plaster') // boardroom west wall (TV wall)
  wallZ(NZ, KZ, WX, 'glass', [[-2.5, 1.4]]) // glass room east door
  wallZ(KZ, SZ, WX, 'plaster', [[3.5, 1.4]]) // kitchenette east door
  wallZ(NZ, KZ, PX, 'glass', [[-4.5, 1.4]]) // boardroom ↔ glass room
  wallZ(KZ, SZ, PX, 'plaster')
  wallX(PX, WX, KZ, 'plaster') // glass room | kitchenette

  // ─── Boardroom (x -9.5..3.5, z -6.5..5.5) ───────────────────────────────────────────────
  // Long table: top at 0.78 m with a raised cable spine down the middle (1.1 m: low cover).
  const TX = -3
  const TZ = -0.5
  m.block(TX, 0, TZ, 7.5, 0.78, 1.6, 'desk', solid)
  m.block(TX, 0.74, TZ, 7.5, 0.04, 1.6, 'desk', deco) // top
  for (const sx of [-3.4, 0, 3.4]) m.block(TX + sx, 0, TZ, 0.5, 0.74, 1.0, 'wood', deco) // pedestals
  m.block(TX, 0.78, TZ, 7, 0.32, 0.3, 'wood') // spine
  for (let x = TX - 3.15; x <= TX + 3.16; x += 1.05) {
    chair(x, TZ - 1.25, -1)
    chair(x, TZ + 1.25, 1)
  }
  // TV wall: screen over a low credenza.
  m.block(-WX + T / 2 + 0.03, 1.0, TZ, 0.06, 1.3, 2.4, 'screen', deco)
  m.block(-WX + T / 2 + 0.25, 0, TZ, 0.5, 0.8, 2.4, 'desk')
  // Whiteboards on the walls, two on wheels for cover.
  m.block(-1, 0.9, NZ + T / 2 + 0.02, 3, 1.2, 0.04, 'whiteboard', deco)
  m.block(-5.5, 0.9, SZ - T / 2 - 0.02, 3, 1.2, 0.04, 'whiteboard', deco)
  mobileWhiteboard(1.5, -4.2)
  mobileWhiteboard(-7.4, 3.6)
  plant(-8.9, -5.9)
  plant(2.9, 4.9)

  // ─── Glass room (x 3.5..9.5, z -6.5..1.5) ───────────────────────────────────────────────
  m.block(6.2, 0, -0.9, 1.4, 0.75, 2.4, 'desk')
  for (const dz of [-0.6, 0.6]) {
    m.block(5.2, 0, -0.9 + dz, 0.5, 0.48, 0.5, 'fabricAlt', deco)
    m.block(7.2, 0, -0.9 + dz, 0.5, 0.48, 0.5, 'fabricAlt', deco)
  }
  m.block(6.2, 1.0, KZ - T / 2 - 0.03, 2.2, 1.2, 0.06, 'screen', deco)
  sofa(6.5, -5.85, 2.6, 0.9, 's')

  // ─── Kitchenette (x 3.5..9.5, z 1.5..5.5) ───────────────────────────────────────────────
  const KW = KZ + T / 2 // inner face of the north wall
  m.span([4.4, 0, KW], [8.2, 0.95, KW + 0.65], 'desk') // counter
  m.span([4.4, 1.7, KW], [8.2, 2.4, KW + 0.35], 'wood', deco) // wall cabinets
  m.span([PX + T / 2, 0, KW], [4.4, 2.0, KW + 0.7], 'metal') // fridge
  m.span([7.2, 0.95, KW + 0.05], [7.6, 1.35, KW + 0.35], 'accent', deco) // coffee machine
  m.span([5.4, 0.95, KW + 0.1], [6.0, 0.97, KW + 0.5], 'metal', deco) // sink
  m.block(5.2, 0, 4.0, 1.0, 1.05, 0.7, 'wood') // high table (low cover)

  // ─── Hallways ───────────────────────────────────────────────────────────────────────────
  // North: shelf on the outer wall and a vending machine on the inner wall, overlapping so the
  // 24 m hallway is never one straight lane.
  m.span([-2.7, 0, Z0], [-1.3, 2.0, Z0 + 1.2], 'desk') // bookshelf
  m.span([4.3, 0, NZ - T / 2 - 1.2], [5.7, 1.95, NZ - T / 2], 'metal') // vending machine
  m.span([4.4, 0.4, NZ - T / 2 - 1.22], [5.6, 1.8, NZ - T / 2 - 1.2], 'accent', deco)
  // South: lounge corner, a column, the print station and a bookcase.
  sofa(-8, Z1 - 0.5, 2.8, 0.9, 'n')
  m.block(-8, 0, 7.3, 1.4, 0.45, 0.6, 'desk') // coffee table
  m.span([-4, 0, SZ + T / 2], [-3, CEIL, 7.0], 'plaster') // column
  m.span([0.8, 0, 6.9], [2.2, 1.95, 7.8], 'metal') // print station (copier + shelving)
  m.span([0.9, 0.9, 6.88], [2.1, 1.0, 6.9], 'screen', deco)
  m.span([3.6, 0, 7.8], [5.2, 2.0, Z1], 'desk') // bookcase
  // West: filing cabinets. East: water cooler + tall cupboard.
  m.span([X0, 0, -1.8], [X0 + 1.0, 1.95, -0.2], 'metal')
  plant(-WX - T / 2 - 0.4, 3)
  m.span([X1 - 1.0, 0, 0], [X1, 1.95, 1.0], 'wood')
  m.span([X1 - 0.5, 0, 1.2], [X1 - 0.1, 1.2, 1.6], 'plaster') // water cooler
  m.span([X1 - 0.45, 1.2, 1.25], [X1 - 0.15, 1.6, 1.55], 'glass', deco)
  plant(X0 + 0.6, Z0 + 0.6)
  plant(X1 - 0.6, Z0 + 0.6)
  plant(X1 - 0.6, Z1 - 0.6)

  // ─── Lights ─────────────────────────────────────────────────────────────────────────────
  lightPanels(-WX, PX, NZ, SZ) // boardroom
  lightPanels(PX, WX, NZ, KZ) // glass room
  lightPanels(PX, WX, KZ, SZ) // kitchenette
  for (let x = X0 + 1.5; x < X1; x += 3) {
    m.block(x, CEIL - 0.06, (Z0 + NZ) / 2, 1.2, 0.05, 0.4, 'lightpanel', deco)
    m.block(x, CEIL - 0.06, (Z1 + SZ) / 2, 1.2, 0.05, 0.4, 'lightpanel', deco)
  }
  for (let z = NZ + 1.5; z < SZ; z += 3) {
    m.block((X0 - WX) / 2, CEIL - 0.06, z, 0.4, 0.05, 1.2, 'lightpanel', deco)
    m.block((X1 + WX) / 2, CEIL - 0.06, z, 0.4, 0.05, 1.2, 'lightpanel', deco)
  }
  const neutral = 0xfff1df
  m.light({ kind: 'point', pos: [-6, 2.6, TZ], color: neutral, intensity: 14, distance: 10 }) // boardroom
  m.light({ kind: 'point', pos: [0, 2.6, TZ], color: neutral, intensity: 14, distance: 10 })
  m.light({ kind: 'point', pos: [6.5, 2.6, -3], color: 0xdbe8ff, intensity: 12, distance: 9 }) // glass room
  m.light({ kind: 'point', pos: [6.5, 2.6, 3.5], color: 0xffcf8a, intensity: 12, distance: 8 }) // kitchenette
  for (const [x, z] of [
    [-6, (Z0 + NZ) / 2],
    [6, (Z0 + NZ) / 2],
    [-6, (Z1 + SZ) / 2],
    [6, (Z1 + SZ) / 2],
    [(X0 - WX) / 2, 0],
    [(X1 + WX) / 2, 0],
  ] as const) {
    m.light({ kind: 'point', pos: [x, 2.6, z], color: neutral, intensity: 8, distance: 9 })
  }

  // ─── Spawns (feet), facing into the action ──────────────────────────────────────────────
  const N = 0
  const S = 180
  const E = -90
  const W = 90
  m.spawn(-10.8, 0, -4.5, S) // west hallway
  m.spawn(10.8, 0, -5.5, S) // east hallway
  m.spawn(-1.5, 0, 8.0, N) // south hallway, by the boardroom door
  m.spawn(2, 0, -7.8, W) // north hallway
  m.spawn(-8, 0, -5, E) // boardroom, by the north door
  m.spawn(2.2, 0, 1.8, W) // boardroom, east end
  m.spawn(8.3, 0, -4.6, S) // glass room
  m.spawn(8.4, 0, 4.4, W) // kitchenette
  m.randomSpawnsIn([X0 + 0.5, Z0 + 0.5], [X1 - 0.5, Z1 - 0.5])

  // ─── Weapons lying around (you spawn with only the handgun) ────────────────────────────
  const RIFLE = 1
  const SNIPER = 2
  m.pickup(-1.5, 0.78, TZ + 0.6, RIFLE) // boardroom table, south edge
  m.pickup(-WX + T / 2 + 0.25, 0.8, TZ, SNIPER) // TV credenza: down the boardroom's long axis
  m.pickup(8.3, 0, -0.9, RIFLE) // SHOTGUN — glass room, beside the table
  m.pickup(6.5, 0.95, KW + 0.35, RIFLE) // SHOTGUN — kitchenette counter
  m.pickup(-10.8, 0, -7.8, RIFLE) // SHOTGUN — north-west hallway corner
  m.pickup(10.8, 0, 7.6, RIFLE) // south-east hallway corner
  m.pickup(-8, 0.45, 7.3, RIFLE) // lounge coffee table
  return m.build()
}
