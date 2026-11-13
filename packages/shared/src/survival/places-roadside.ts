import type { MaterialId } from '../maps/types.ts'
import type { Site } from './kit.ts'
import {
  blood,
  cabinet,
  carWreck,
  corpse,
  cot,
  decal,
  desk,
  drum,
  dying,
  excavator,
  fence,
  lampPost,
  logPile,
  logTruck,
  note,
  partition,
  paving,
  pickupWreck,
  shelving,
  sign,
  tractor,
} from './places-kit.ts'
import { bed, counter, crate, FLOOR, shelf, stove, table } from './structures.ts'
import type { Poi } from './types.ts'

/**
 * The places along the roads: two gas stations, the motel, the trailer park, the sawmill, the
 * quarry and the Abernathy farm. Buildings are built around their own origin with the front
 * door to the south (+z) and put down with `s.sub(x, z, turn)` (turn 1 faces west, 2 north,
 * 3 east). Roads run through the middle of each place, so the buildings keep to one side.
 */

const F = FLOOR

// --- Gas stations -----------------------------------------------------------------------------

/** The shop: a till at the front, gondolas, a store room and the back office behind. */
function gasShop(b: Site, office: boolean, n: number): void {
  b.shell(0, 0, {
    w: 12,
    d: 9,
    h: 3,
    wall: 'plaster',
    floor: 'tile',
    roof: 'concrete',
    doors: [{ side: 's', at: -3.6, width: 1.6 }],
    windows: [
      { side: 's', at: 1.6, width: 4, sill: 0.6, height: 1.8, glass: n === 0 },
      { side: 'e', at: 2, boards: true },
      { side: 'w', at: 2, boards: n === 0 },
    ],
  })
  b.deco(0, 3.1, 4.6, 12.2, 0.6, 0.2, 'accent')
  partition(b, true, -1.5, -5.9, 5.9, 3, 'plaster', [-3, 3])
  partition(b, false, 0, -4.4, -1.57, 3, 'plaster')
  // The shop floor: a till, two gondolas, drinks fridges along the wall.
  counter(b, 4.7, 1.8, false, 2.6, ['store'])
  b.deco(4.7, F + 0.95, 0.9, 0.5, 0.3, 0.4, 'screen')
  shelving(b, -0.6, 1.4, false, 3, ['store', 'kitchen'])
  shelving(b, 1.9, 1.4, false, 3, ['store', 'medical'])
  b.block(-5.5, F, 1.4, 0.7, 2.1, 3.4, 'glass')
  b.loot(-4.9, F + 0.02, 0.6, 'kitchen')
  b.loot(-4.9, F + 0.02, 2.2, 'kitchen')
  blood(b, -2.2, 3, 1.4, 1, F)
  dying(b, 0, 2.8, 1.6, 0xe8f2ff, 8)
  // The store room: oil, tools, a jerry can if you're lucky.
  shelving(b, -3, -4.05, true, 5, ['garage', 'fuel', 'store'])
  crate(b, -5.2, -2.4, 0.7, 'fuel', F)
  // The back office: whoever ran this place never left it.
  desk(b, 3.2, -3.6, 1.6, 0.8, 'office')
  b.deco(3.2, F + 0.76, -3.8, 0.45, 0.34, 0.06, 'screen')
  cabinet(b, 5.55, -3.2, 0.5, 1.5, 1.2, 'metal')
  b.loot(1, F + 0.02, -4, 'gun')
  corpse(b, 2.6, -2.3, true, F)
  if (office) b.interact('gas_north_office', 'search', 5.2, F + 1.2, -3.2, 'Search the back office')
  else
    note(
      b,
      'gas_south_note',
      3.6,
      F + 0.77,
      -3.4,
      "WE'RE CLOSED. WE'RE ALL CLOSED. Bolted the door and went out the back. Can hear them on the roof at night. Walking. Back and forth. Back and forth.",
    )
  b.light(3, 2.6, -3, { color: 0xffc070, intensity: 5, distance: 6, flicker: 0.5 })
  b.zombie(-2.2, 3, F).zombie(1.6, -2.4, F)
}

/** A gas station: pumps under a canopy by the road, the shop behind them to the west. */
export function gas(s: Site, poi: Poi): void {
  const north = poi.key === 'gas_north'
  // Last Stop Fuel's roads leave north, south and east: keep it a little south and west.
  const g = north ? s : s.sub(-2, 6)
  paving(g, -27, -10, 2, 10)
  // The canopy and two islands of pumps.
  const cx = -8
  for (const [x, z] of [
    [-4.5, -6],
    [-4.5, 6],
    [-11.5, -6],
    [-11.5, 6],
  ] as const) {
    g.block(x, 0, z, 0.35, 4.6, 0.35, 'metal')
  }
  g.deco(cx, 4.55, 0, 9.2, 0.4, 15.2, 'accent')
  g.block(cx, 4.95, 0, 9, 0.2, 15, 'whiteboard')
  for (const z of [-4, 0, 4]) g.deco(cx, 4.5, z, 1.4, 0.05, 0.4, 'lightpanel')
  g.light(cx, 4.2, 0, { color: 0xe8f0ff, intensity: 26, distance: 18, flicker: 0.75 })
  for (const z of [-3.5, 3.5]) {
    g.block(cx, 0, z, 1.2, 0.15, 4, 'concrete')
    for (const e of [-1, 1]) {
      g.block(cx, 0.15, z + e * 1.1, 0.7, 1.6, 0.5, north ? 'accent' : 'platform')
      g.deco(cx, 1.2, z + e * 1.1, 0.72, 0.3, 0.52, 'screen')
    }
  }
  g.loot(cx + 0.7, 0.2, -3.5, 'fuel')
  g.loot(cx - 0.7, 0.2, 3.5, 'fuel')
  carWreck(g.sub(cx - 3.4, -3.5), north ? 2 : 1)
  if (north) pickupWreck(g.sub(-1.5, 9, 1), 3, 'garage')
  else carWreck(g.sub(-18, 12), 0)
  blood(g, cx - 1.6, -1.8, 1.6, 1.2)
  // The shop faces the pumps.
  gasShop(g.sub(-21, 0, 3), north, north ? 0 : 1)
  // Air, water and a dumpster round the side.
  g.block(-15.5, 0, 8.5, 1.8, 1.4, 1.2, 'rust')
  g.loot(-15.5, 1.45, 8.5, 'garage')
  drum(g, -14, -8.2)
  drum(g, -14.8, -7.4, 'accent')
  g.loot(-14.4, 0.95, -8.2, 'fuel')
  // The sign: still lit, still promising.
  const [sx, sz] = north ? [-4, -13] : [-24, 11]
  sign(g, sx, sz, north ? 'GAS-N-GO  24 HRS' : 'LAST STOP FUEL', true, 7)
  g.deco(sx, 5.6, sz + 0.15, 3.3, 0.3, 0.08, 'lightpanel')
  g.light(sx, 5.3, sz + 1, {
    color: north ? 0xff5040 : 0x60c0ff,
    intensity: 14,
    distance: 12,
    flicker: 0.4,
  })
  g.zombie(-8, 8).zombie(-13, -9).zombie(2, 12.5).zombie(-20, 9)
}

// --- Pine Rest motel --------------------------------------------------------------------------

/** One motel room: bed, telly, a bathroom behind a wall. */
function motelRoom(b: Site, i: number): void {
  b.shell(0, 0, {
    w: 4.6,
    d: 7,
    h: 2.7,
    wall: i % 2 === 0 ? 'brick' : 'plaster',
    floor: 'carpet',
    roof: 'concrete',
    doors: [{ side: 's', at: -1.3, width: 1.2 }],
    windows: [{ side: 's', at: 1, boards: i % 3 === 0, glass: i % 3 === 1 }],
  })
  partition(b, true, -1.6, -2.2, 2.2, 2.7, 'tile', [-1.2], 1)
  b.deco(1.2, F, -2.7, 1.4, 0.55, 0.7, 'whiteboard')
  bed(b, 1.1, 0.3, false, i === 2 ? 'bed_motel' : undefined)
  cabinet(b, -1.7, 0.2, 0.6, 0.75, 1.2, 'wood', 'bedroom')
  b.deco(-1.7, F + 0.75, 0.2, 0.4, 0.4, 0.6, 'screen')
  b.loot(-1.2, F + 0.02, -2.6, i % 2 === 0 ? 'medical' : 'bedroom')
  if (i === 4) {
    // Room 5: the door was kicked in from outside.
    corpse(b, 1, -2.6, true, F)
    blood(b, 0, 1.6, 2, 1.4, F)
    blood(b, -1.2, 2.9, 1, 0.6, F)
  }
  if (i === 6) {
    // Room 7: somebody held out here, with everything they owned against the door.
    cabinet(b, 0.5, 2.9, 1.2, 1.1, 0.5, 'wood')
    crate(b, -1.5, -1, 0.7, 'pack', F)
    note(
      b,
      'motel_note',
      1.1,
      F + 0.5,
      1.1,
      "Room 7. Day 4. The manager is still at the desk. Still standing. He hasn't moved since Tuesday. When I look out he is looking at my door.",
    )
  }
  if (i % 3 === 1) b.zombie(0, -0.5, F)
}

/** The office at the end of the row: reception, a key board, a back room. */
function motelOffice(b: Site): void {
  b.shell(0, 0, {
    w: 7,
    d: 7,
    h: 2.9,
    wall: 'plaster',
    floor: 'tile',
    roof: 'concrete',
    doors: [{ side: 's', at: -1.8, width: 1.4 }],
    windows: [
      { side: 's', at: 1.6, width: 2, glass: true },
      { side: 'e', at: 0, boards: true },
    ],
  })
  partition(b, true, -1, -3.4, 3.4, 2.9, 'plaster', [2.2])
  counter(b, 0.2, 0.6, true, 3.6, ['office'])
  b.deco(-3.35, F + 1, -0.4, 0.06, 0.8, 1, 'wood')
  desk(b, -1.8, -2.6, 1.4, 0.7, 'office')
  cabinet(b, 2.9, -2.6, 0.6, 1.8, 1, 'metal', 'gun')
  b.zombie(0.4, -0.2, F)
  dying(b, 0, 2.6, 0.4)
}

export function motel(s: Site): void {
  paving(s, -30, 4, 26, 19)
  for (let i = 0; i < 8; i++) {
    const x = -16.8 + i * 4.8
    motelRoom(s.sub(x, 24, 2), i)
    // Room numbers, over the doors.
    s.deco(x - 0.3, 2.6, 20.35, 0.4, 0.25, 0.05, 'whiteboard')
  }
  // A walkway roof along the row.
  s.deco(0, 2.95, 19.2, 39, 0.12, 2.6, 'concrete')
  for (let i = 0; i < 9; i++) s.block(-19.2 + i * 4.8, 0, 18.1, 0.16, 2.95, 0.16, 'metal')
  motelOffice(s.sub(-25, 24, 2))
  // A light over room 5's door, swinging.
  s.light(2.4, 2.6, 19, { color: 0xffd090, intensity: 8, distance: 10, flicker: 0.8 })
  // The lot: what's left of the guests' cars.
  carWreck(s.sub(-12, 13, 1), 0)
  carWreck(s.sub(-2.5, 12, 1), 3)
  pickupWreck(s.sub(7, 13, 3), 2, 'garage')
  carWreck(s.sub(16, 12.5, 1), 1)
  for (let x = -24; x <= 20; x += 4) decal(s, x, 11, 0.12, 5, 'marker', 0.045)
  // Vending machines and the ice machine at the end of the walkway.
  s.block(20.6, 0, 18.5, 1, 1.9, 0.8, 'accent')
  s.deco(20.6, 1, 18.08, 0.8, 0.7, 0.05, 'lightpanel')
  s.loot(20.6, 1.95, 18.5, 'store')
  s.block(22, 0, 18.5, 1, 1.5, 0.8, 'whiteboard')
  s.light(20.8, 1.2, 17.6, { color: 0xff6040, intensity: 4, distance: 5, flicker: 0.3 })
  // A dumpster round the back, and what was dumped in it.
  s.block(24, 0, 29, 2, 1.4, 1.3, 'plant')
  blood(s, 22.6, 29.5, 1.2, 0.8)
  // The sign at the road.
  sign(s, 0, -14, 'PINE REST MOTEL  -  VACANCY', true, 7, 'platform')
  s.deco(0, 4.6, -13.85, 2.4, 0.4, 0.08, 'warnlight')
  s.light(0, 4.8, -13.2, { color: 0xff3020, intensity: 12, distance: 14, flicker: 0.55 })
  lampPost(s, -22, 8, undefined, 0.9)
  lampPost(s, 12, 8, { color: 0xffd9a0, flicker: 0.6 }, -0.9)
  for (const [x, z] of [
    [-14, 6],
    [-4, 8],
    [9, 7],
    [18, 15],
    [-22, 14],
    [26, 26],
    [-20, -8],
    [14, -6],
  ] as const) {
    s.zombie(x, z)
  }
}

// --- Shady Acres trailer park -----------------------------------------------------------------

interface Trailer {
  n: number
  /** Sam's family lived here. */
  sam?: boolean
  burnt?: boolean
}

/** A trailer home: kitchen and living room, a bedroom at the east end. */
function trailer(b: Site, o: Trailer): void {
  const siding: MaterialId[] = ['whiteboard', 'plaster', 'platform']
  b.shell(0, 0, {
    w: 12,
    d: 3.8,
    h: 2.3,
    wall: o.burnt ? 'asphalt' : (siding[o.n % 3] as MaterialId),
    floor: 'carpet',
    ...(o.burnt ? {} : { roof: 'metal' as const }),
    doors: [{ side: 's', at: -3, width: 1.1 }],
    windows: [
      { side: 's', at: 2.5, glass: o.n % 2 === 0 },
      { side: 'n', at: -1, boards: o.n % 3 === 0 },
      { side: 'e', at: 0, boards: o.n % 2 === 1 },
    ],
  })
  b.deco(0, 0, 0, 12.1, 0.12, 3.9, 'rust')
  b.block(-3, 0, 2.35, 1.3, 0.12, 0.8, 'wood')
  partition(b, false, 2, -1.7, 1.7, 2.3, 'plaster', [0], 1)
  // Kitchen and living room.
  counter(b, -3.8, -1.35, true, 2.4, ['kitchen', 'kitchen'])
  table(b, -1, 0.6, 1, 0.7, 'kitchen')
  b.block(-5.3, F, 0.2, 0.8, 0.45, 2, 'fabric')
  // The bedroom.
  if (o.sam) {
    // A kid's room: a little bed, drawings taped to the wall.
    b.block(4.6, F, -0.6, 0.8, 0.3, 1.6, 'wood')
    b.deco(4.6, F + 0.3, -0.6, 0.76, 0.1, 1.56, 'accent')
    b.interact('trailer_bed', 'search', 4.6, F + 0.2, -0.6, 'Look under the bed')
    for (const [i, m] of (['accent', 'marker', 'plant', 'platform'] as MaterialId[]).entries()) {
      b.deco(3.4 + i * 0.6, F + 1.4 + (i % 2) * 0.2, -1.66, 0.4, 0.3, 0.02, m)
    }
    cabinet(b, 5.4, 1.2, 0.6, 0.8, 0.6, 'wood', 'bedroom')
  } else {
    bed(b, 4.4, -0.4, false)
    cabinet(b, 5.4, 1.3, 0.5, 0.9, 0.6, 'wood', 'bedroom')
  }
  b.loot(3, F + 0.02, 1.2, o.n % 3 === 2 ? 'gun' : 'bedroom')
  if (o.burnt) {
    for (const [x, z] of [
      [-4, 0.4],
      [1, -0.5],
      [4, 0.8],
    ] as const) {
      decal(b, x, z, 2, 1.4, 'asphalt', F)
    }
  }
  if (o.n % 2 === 1) blood(b, -2.4, 0.6, 1.2, 0.8, F)
  b.zombie(-2, 0.3, F)
}

export function trailers(s: Site): void {
  // North of the road, facing it.
  trailer(s.sub(-28, -21), { n: 0 })
  trailer(s.sub(-10, -21), { n: 1, sam: true })
  trailer(s.sub(8, -22), { n: 2 })
  trailer(s.sub(26, -24), { n: 3 })
  // South of it, facing back.
  trailer(s.sub(6, 18, 2), { n: 4 })
  trailer(s.sub(24, 17, 2), { n: 5 })
  trailer(s.sub(-20, 34, 2), { n: 6, burnt: true })
  // Sam's yard: a swing with nobody on it, a ball.
  for (const x of [-12.5, -9.5]) {
    s.turned(x, 0, -15.5, 0.12, 2.4, 0.12, 0, 'metal', 0.2)
    s.turned(x, 0, -16.5, 0.12, 2.4, 0.12, 0, 'metal', -0.2)
  }
  s.deco(-11, 2.3, -16, 3.2, 0.1, 0.1, 'metal')
  s.deco(-11, 0.5, -16, 0.6, 0.06, 0.3, 'wood')
  s.deco(-8, 0, -14.2, 0.3, 0.3, 0.3, 'accent')
  // Washing lines, picnic tables, a barbecue, cars.
  for (const z of [-28, -27.9]) s.deco(-19, 1.8, z, 6, 0.02, 0.02, 'plaster')
  for (const [i, x] of [-21, -19.6, -18.2, -16.8].entries()) {
    s.deco(x, 1.1, -27.95, 0.7, 0.7, 0.03, i % 2 === 0 ? 'fabric' : 'fabricAlt')
  }
  table(s, 16, -14, 1.8, 0.8, 'camp')
  table(s, 14, 10, 1.8, 0.8, 'kitchen')
  stove(s, 17, 9, 0.9, false)
  pickupWreck(s.sub(-30, -12, 0), 1, 'garage')
  carWreck(s.sub(35, -14, 1), 2)
  carWreck(s.sub(-4, 26, 0), 4)
  fence(s, [
    [-38, -30],
    [36, -30],
  ])
  crate(s, 30, 8, 0.8, 'camp')
  drum(s, 32, 9, 'rust')
  s.loot(32, 0.95, 9, 'fuel')
  lampPost(s, -2, -12, { color: 0xffd9a0, flicker: 0.7, intensity: 18 }, 0.9)
  lampPost(s, 20, 6, undefined, -0.9)
  s.light(-3, 2.2, -18.6, { color: 0xffb060, intensity: 6, distance: 8, flicker: 0.4 })
  blood(s, -6, -16, 1.4, 0.9)
  blood(s, -3.5, -12.5, 1, 0.7)
  for (const [x, z] of [
    [-20, -14],
    [0, -14],
    [18, -14],
    [-30, 6],
    [14, 12],
    [30, 14],
    [-12, 30],
  ] as const) {
    s.zombie(x, z)
  }
}

// --- Mill Creek sawmill -----------------------------------------------------------------------

/** The mill office: a desk, the fusebox, the foreman's coffee. */
function millOffice(b: Site): void {
  b.shell(0, 0, {
    w: 7,
    d: 5,
    h: 2.7,
    wall: 'wood',
    floor: 'wood',
    roof: 'metal',
    doors: [{ side: 's', at: -2 }],
    windows: [
      { side: 's', at: 1.4, glass: true },
      { side: 'w', at: 0, boards: true },
    ],
  })
  desk(b, 1.3, -1.4, 1.6, 0.8, 'office')
  cabinet(b, -3, -1.6, 0.5, 1.4, 1, 'metal', 'office')
  // The fusebox on the back wall: a grey box, one red lamp still glowing.
  b.block(-0.8, F + 1, -2.32, 0.7, 0.9, 0.22, 'metal')
  b.deco(-0.6, F + 1.75, -2.2, 0.08, 0.08, 0.04, 'warnlight')
  b.interact('sawmill_fusebox', 'search', -0.8, F + 1.4, -2.1, 'Open the fusebox')
  b.deco(2.6, F + 1.2, -2.38, 1, 0.7, 0.03, 'whiteboard')
  shelf(b, 3.15, 0.8, false, ['garage', 'office'])
  b.light(0, 2.4, 0, { color: 0xffc070, intensity: 5, distance: 7, flicker: 0.6 })
  note(
    b,
    'sawmill_note',
    1.6,
    F + 0.77,
    -1.2,
    'Night shift: DO NOT run the big saw after dark. The noise brings them out of the trees. Ed ran it anyway. We found most of Ed.',
  )
  b.zombie(-1, 0.6, F)
}

export function sawmill(site: Site): void {
  const s = site
  // The mill shed: a roof on posts over the big saw (south of where the road ends).
  const m = site.sub(0, 3)
  const [x0, x1, z0, z1] = [-6, 20, -2, 10]
  for (let x = x0; x <= x1; x += 6.5) {
    for (const z of [z0, z1]) m.block(x, 0, z, 0.4, 6, 0.4, 'log')
  }
  m.block((x0 + x1) / 2, 6, (z0 + z1) / 2, x1 - x0 + 1.5, 0.25, z1 - z0 + 1.5, 'metal')
  m.deco((x0 + x1) / 2, 6.25, (z0 + z1) / 2, x1 - x0 + 1.5, 1, (z1 - z0) * 0.5, 'metal')
  paving(m, x0, z0, x1, z1, 'concrete', 0.06)
  // The saw: a long bench, rollers, and the blade.
  m.block(7, 0, 4, 14, 0.9, 1.4, 'metal')
  for (let x = 1; x <= 13; x += 1.5) m.deco(x, 0.9, 4, 0.18, 0.18, 1.3, 'rust')
  m.deco(7, 0.5, 4, 1.8, 1.8, 0.06, 'metal')
  m.block(5, 0.9, 4, 3, 0.55, 0.55, 'log')
  blood(m, 7.3, 4, 1.4, 1.2, 0.9)
  blood(m, 8.6, 5.6, 1.6, 1)
  // Sawdust heaps and planks.
  for (const [x, z, w] of [
    [16, 7, 3],
    [-3, 7.5, 2.4],
  ] as const) {
    m.block(x, 0, z, w, 0.5, w, 'dirt')
    m.deco(x, 0.5, z, w * 0.6, 0.4, w * 0.6, 'dirt')
  }
  logPile(m, 14, 0.5, true, 6, 'wood')
  crate(m, -4, 0, 0.8, 'garage')
  crate(m, 19, 1, 0.7, 'melee')
  m.light(7, 5.4, 4, { color: 0xffe0b0, intensity: 22, distance: 18, flicker: 0.7 })
  // The yard: logs waiting for a saw that won't run again.
  logPile(s, -18, 20, true, 11)
  logPile(s, -18, 27, true, 9)
  logPile(s, 22, 26, false, 11)
  logPile(s, 30, 6, false, 9)
  logTruck(s.sub(10, -16))
  tractor(s.sub(30, -14, 1))
  // The office and the generator shed by the gate.
  millOffice(s.sub(-22, -4, 3))
  s.block(-22, 0, 8, 3, 0.15, 3, 'concrete')
  s.block(-22, 0.15, 8, 1.7, 1.1, 0.9, 'rust')
  s.deco(-21.4, 1.25, 8, 0.12, 1.2, 0.12, 'metal')
  s.deco(-22, 2.6, 8, 3.4, 0.12, 3.4, 'metal')
  for (const [x, z] of [
    [-23.5, 6.5],
    [-20.5, 9.5],
  ] as const) {
    s.block(x, 0, z, 0.12, 2.6, 0.12, 'metal')
  }
  drum(s, -24.2, 9.5)
  s.loot(-24.2, 0.95, 9.5, 'fuel')
  sign(s, -16, -6, 'MILL CREEK LUMBER CO.', false, 5, 'wood')
  lampPost(s, -10, 14, { color: 0xffd9a0, flicker: 0.5 }, 0.9)
  for (const [x, z] of [
    [2, 10.5],
    [12, 1],
    [18, 12],
    [-12, 12],
    [-16, 24],
    [14, 22],
    [28, 18],
    [24, -6],
    [-4, -12],
    [4, 20],
    [-26, 2],
    [32, 30],
  ] as const) {
    s.zombie(x, z)
  }
}

// --- The quarry -------------------------------------------------------------------------------

/** A heap of broken stone. */
function rocks(s: Site, x: number, z: number, size: number): void {
  s.block(x, 0, z, size, size * 0.4, size * 0.8, 'concrete')
  s.block(
    x + size * 0.1,
    size * 0.4,
    z - size * 0.05,
    size * 0.6,
    size * 0.3,
    size * 0.5,
    'concrete',
  )
  s.deco(x - size * 0.1, size * 0.7, z, size * 0.3, size * 0.2, size * 0.3, 'concrete')
}

export function quarry(s: Site): void {
  excavator(s.sub(14, -16))
  rocks(s, -20, -18, 6)
  rocks(s, 24, 12, 7)
  rocks(s, -26, -4, 5)
  rocks(s, 6, 30, 8)
  rocks(s, 36, -18, 5)
  // A dump truck with its bed up.
  const t = s.sub(-6, 18, 0)
  t.block(3, 0.5, 0, 2.2, 2.2, 2.6, 'accent')
  t.block(-1.2, 0.6, 0, 5.4, 0.5, 2.6, 'rust')
  t.turned(-1.6, 1.4, 0, 5.2, 1.4, 2.5, 0, 'rust')
  t.deco(-1.2, 0, 0, 5.4, 1, 2.8, 'asphalt')
  // The site office: a portable cabin somebody barricaded themselves into.
  const o = s.sub(30, -30)
  o.shell(0, 0, {
    w: 8,
    d: 3.6,
    h: 2.5,
    wall: 'platform',
    floor: 'wood',
    roof: 'metal',
    doors: [{ side: 's', at: 2.6 }],
    windows: [
      { side: 's', at: -1.4, boards: true },
      { side: 'n', at: 0, boards: true },
    ],
  })
  desk(o, -2.4, -1, 1.6, 0.7, 'office')
  cot(o, 1, -1, true, F)
  shelf(o, -3.7, 0.6, false, ['garage', 'fuel'])
  crate(o, 0.8, 1.1, 0.6, 'garage', F)
  o.deco(-1, F + 1.2, -1.72, 1.4, 0.8, 0.03, 'whiteboard')
  note(
    o,
    'quarry_note',
    -2.2,
    F + 0.77,
    -0.9,
    "It lives down in the pit. Too big to be one of them, but it is one of them. It picked Danny up with ONE HAND. If you can read this get out of the pit. Don't run. It hears running.",
  )
  o.light(0, 2.2, 0, { color: 0xffb060, intensity: 4, distance: 6, flicker: 0.6 })
  // Explosives store: steel boxes, mostly empty.
  for (const [i, x] of [-8, -6.8, -5.6].entries())
    crate(s, x, -30, 1, i === 1 ? 'military' : 'garage')
  s.light(0, 6, 0, { color: 0xdde8ff, intensity: 20, distance: 22, flicker: 0.8 })
  s.block(0, 0, -1.5, 0.3, 6.3, 0.3, 'metal')
  corpse(s, 4, 6, true)
  blood(s, 2, 5, 2.4, 1.6)
  blood(s, -2, 9, 1.4, 1)
  for (const [x, z] of [
    [0, 4],
    [-16, -6],
    [20, 20],
    [-22, 26],
  ] as const) {
    s.zombie(x, z)
  }
}

// --- The Abernathy farm -----------------------------------------------------------------------

/** The farmhouse: kitchen and pantry, a parlour, a bedroom at the back. */
function farmhouse(b: Site): void {
  b.shell(0, 0, {
    w: 12,
    d: 9,
    h: 2.8,
    wall: 'wood',
    floor: 'wood',
    roof: 'shingle',
    pitch: 2,
    doors: [
      { side: 's', at: -2 },
      { side: 'n', at: 4.2 },
    ],
    windows: [
      { side: 's', at: 2.8, glass: true },
      { side: 's', at: -4.5, boards: true },
      { side: 'e', at: 1 },
      { side: 'w', at: -1, boards: true },
      { side: 'n', at: -3 },
    ],
  })
  // A porch.
  b.block(-1, -0.3, 5.6, 9, 0.45, 2.2, 'wood')
  b.deco(-1, 2.9, 5.6, 9.4, 0.12, 2.4, 'shingle')
  for (const x of [-5.2, 3.2]) b.block(x, 0.15, 6.5, 0.14, 2.75, 0.14, 'wood')
  b.block(1.8, 0.15, 5.4, 0.7, 0.9, 0.7, 'wood')
  partition(b, true, -0.5, -5.9, 5.9, 2.8, 'plaster', [-2, 3.2])
  partition(b, false, 1, -4.4, -0.57, 2.8, 'plaster')
  partition(b, false, -3.6, -4.4, -2.2, 2.8, 'plaster')
  // Kitchen (north-east) with the pantry in its corner.
  counter(b, 3.8, -4, true, 3.6, ['kitchen', 'kitchen'])
  stove(b, 5.2, -2.4, 0.9, false)
  table(b, 3.2, -2, 1.4, 0.8, 'kitchen')
  shelf(b, -5.5, -3.2, false, ['kitchen', 'store'])
  b.interact('farm_pantry', 'search', -4.9, F + 1.2, -3.2, 'Search the pantry')
  // Bedroom (north-west).
  bed(b, -1.4, -3.2, true)
  cabinet(b, -2.9, -1.2, 1, 0.9, 0.5, 'wood', 'bedroom')
  // Parlour (south).
  b.block(-4, F, 2.5, 0.8, 0.45, 2.2, 'fabric')
  b.deco(-4.3, F + 0.45, 2.5, 0.2, 0.45, 2.2, 'fabric')
  table(b, 2.4, 2, 1.2, 0.8, 'bedroom')
  b.block(5.4, F, 3.4, 0.5, 1.9, 1.4, 'rack')
  b.loot(5.1, F + 1.95, 3.4, 'hunting')
  corpse(b, 0, 2.8, true, F)
  b.light(-1.5, 2.2, 2.5, { color: 0xffa050, intensity: 6, distance: 8, flicker: 0.5 })
  note(
    b,
    'farm_note',
    3.4,
    F + 0.85,
    -2,
    "Ma came back up out of the ground Sunday. Pa won't let me shoot her. He's out in the corn with her every night now. I can hear them out there. Rows and rows.",
  )
  b.zombie(0.6, 1.4, F).zombie(1.8, -1.1, F)
}

/** The barn: hay, the tractor's bay, and Abernathy's workbench along the back. */
function barn(b: Site): void {
  b.shell(0, 0, {
    w: 16,
    d: 12,
    h: 5,
    wall: 'barn',
    floor: 'dirt',
    roof: 'shingle',
    pitch: 3,
    doors: [
      { side: 's', at: 0, width: 4, height: 3.8 },
      { side: 'n', at: 5 },
    ],
    windows: [
      { side: 'e', at: 0, boards: true },
      { side: 'w', at: -2, sill: 2.4 },
    ],
  })
  // Hay bales, stacked and fallen.
  for (const [x, z, y] of [
    [-6.2, -4.4, 0],
    [-4.8, -4.4, 0],
    [-6.2, -3.2, 0],
    [-5.5, -4.4, 0.6],
    [-6.6, 3.8, 0],
    [-6.6, 2.6, 0],
    [6.4, 4, 0],
  ] as const) {
    b.block(x, F + y, z, 1.2, 0.6, 1.1, 'hay')
  }
  b.loot(-5.5, F + 1.25, -4.4, 'hunting')
  // Stalls along the east wall.
  for (const z of [-3, 0.5]) b.block(5.5, F, z, 3.8, 1.4, 0.12, 'wood')
  b.loot(6.6, F + 0.02, -1.2, 'garage')
  // The workbench and its toolbox.
  b.block(0, F, -5.45, 4.2, 0.9, 0.8, 'wood')
  b.deco(0.8, F + 0.9, -5.45, 0.8, 0.35, 0.4, 'accent')
  b.deco(0, F + 1.4, -5.86, 3.6, 1.1, 0.04, 'wood')
  b.interact('farm_workbench', 'search', 0.8, F + 1.1, -5.2, 'Take the toolbox')
  b.loot(-1.2, F + 0.95, -5.45, 'garage')
  crate(b, 2.8, -4.8, 0.7, 'fuel', F)
  tractor(b.sub(-1, 1, 1))
  b.light(0, 4.2, 0, { color: 0xffb060, intensity: 7, distance: 11, flicker: 0.6 })
  blood(b, 3, 2, 1.6, 1.2, F)
  b.zombie(-2, -2, F).zombie(3, 3.5, F)
}

/** A scarecrow in the corn. From far away its eyes look red. */
function scarecrow(s: Site, x: number, z: number): void {
  s.block(x, 0, z, 0.14, 2.6, 0.14, 'log')
  s.deco(x, 1.85, z, 1.8, 0.12, 0.12, 'log')
  s.deco(x, 1.05, z, 0.55, 0.9, 0.3, 'fabricAlt')
  s.deco(x, 1.95, z, 0.36, 0.4, 0.34, 'hay')
  s.deco(x, 2.35, z, 0.6, 0.06, 0.6, 'hay')
  for (const e of [-1, 1]) s.deco(x + e * 0.08, 2.08, z + 0.18, 0.05, 0.03, 0.02, 'warnlight')
}

export function farm(s: Site): void {
  farmhouse(s.sub(-18, -6, 3))
  barn(s.sub(20, -6, 1))
  // The silo.
  for (let i = 0; i < 4; i++) s.block(34, i * 3, -22, 4.2, 3, 4.2, i % 2 === 0 ? 'metal' : 'rust')
  s.deco(34, 12, -22, 3.4, 1, 3.4, 'metal')
  // The yard: a pump, a trough, the coop.
  s.block(-8, 0, -14, 0.3, 1.1, 0.3, 'metal')
  s.deco(-7.8, 0.9, -14, 0.5, 0.08, 0.1, 'metal')
  s.block(-8, 0, -12.8, 1.8, 0.6, 0.7, 'wood')
  s.interact('farm_pump', 'water', -8, 1, -13.6, 'Drink from the pump')
  s.shell(-30, 12, {
    w: 4,
    d: 3,
    h: 1.6,
    wall: 'wood',
    roof: 'shingle',
    doors: [{ side: 'e', at: 0, width: 0.8, height: 1 }],
    noRoom: true,
  })
  for (const [x, z] of [
    [-27, 14],
    [-26, 10.5],
    [-29, 15.5],
  ] as const) {
    decal(s, x, z, 0.5, 0.4, 'whiteboard')
  }
  blood(s, -27, 13, 1.4, 1.2)
  pickupWreck(s.sub(-6, 6, 3), 0, 'garage')
  drum(s, 10, -16)
  s.loot(10, 0.95, -16, 'fuel')
  // Fences round the yard (the drive in from the north stays open).
  fence(s, [
    [-3, -40],
    [-44, -40],
    [-44, 12],
  ])
  fence(s, [
    [3, -40],
    [44, -40],
    [44, 12],
  ])
  // The corn: rows you can walk between, and the dead push straight through.
  for (let z = 16; z < 45; z += 3) {
    s.block(-22, 0, z, 36, 2.4, 1.3, 'corn')
    s.block(22, 0, z, 36, 2.4, 1.3, 'corn')
  }
  scarecrow(s, 0, 36)
  s.light(-18, 3, -2, { color: 0xffd9a0, intensity: 16, distance: 16, flicker: 0.4 })
  for (const [x, z] of [
    [-20, 20.5],
    [18, 26.5],
    [-8, 38.5],
    [26, 41.5],
    [0, 14],
    [-34, 32.5],
  ] as const) {
    s.zombie(x, z)
  }
}
