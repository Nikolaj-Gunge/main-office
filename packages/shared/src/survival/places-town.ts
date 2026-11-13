import type { MaterialId } from '../maps/types.ts'
import type { Site } from './kit.ts'
import {
  barricade,
  barrier,
  blood,
  cabinet,
  carWreck,
  corpse,
  cot,
  decal,
  desk,
  drum,
  lampPost,
  partition,
  paving,
  pickupWreck,
  sandbags,
  shelving,
  sign,
} from './places-kit.ts'
import { bed, counter, crate, FLOOR, shelf, stove, table } from './structures.ts'
import type { Poi } from './types.ts'

/**
 * The three towns. Every building is built around its own origin with its front door to the
 * south (+z) and put on its lot with `s.sub(x, z, turn)`: turn 0 faces south, 1 west, 2 north,
 * 3 east. Two streets cross in the middle of each town; the real roads leave from there.
 */

const F = FLOOR

// --- Houses -----------------------------------------------------------------------------------

interface Home {
  /** 0: one room; 1: two rooms behind one front; 2: a main room with a bedroom built on. */
  plan: 0 | 1 | 2
  wall: MaterialId
  /** Counts a town's houses: which windows are boarded, what was left behind. */
  n: number
  /** Somebody has been sleeping here: the key of their sleeping bag. */
  bag?: string
}

/** One room: a bed in the corner, a kitchen along the back wall. */
function cottage(b: Site, o: Home): void {
  b.shell(0, 0, {
    w: 8,
    d: 6,
    h: 2.6,
    wall: o.wall,
    floor: 'wood',
    roof: 'shingle',
    pitch: 1.4,
    doors: [{ side: 's', at: -2 }],
    windows: [
      { side: 's', at: 1.8, boards: o.n % 2 === 0 },
      { side: 'e', at: 0, glass: o.n % 3 === 1 },
      { side: 'n', at: -1.6, boards: o.n % 3 === 0 },
    ],
  })
  b.block(-2, -0.3, 3.7, 2, 0.36, 1.4, 'wood')
  counter(b, 2.2, -2.5, true, 2.4, ['kitchen', 'kitchen'])
  bed(b, -2.75, -2.3, true)
  desk(b, 1.6, 0.7, 1.4, 0.8, 'kitchen')
  cabinet(b, -3.5, 0.4, 0.5, 0.9, 1.2, 'wood', 'bedroom')
  b.loot(-1.3, F + 0.02, -1.5, 'bedroom')
  if (o.bag) bed(b, 3.1, 2.2, true, o.bag, true)
  if (o.n % 2 === 1) blood(b, -0.6, 1.6, 1.2, 0.9, F)
  b.zombie(0, -0.6, F)
}

/** Two rooms: kitchen and living room to the west, a bedroom behind a wall to the east. */
function bungalow(b: Site, o: Home): void {
  const back = o.n % 2 === 1
  b.shell(0, 0, {
    w: 10,
    d: 7,
    h: 2.6,
    wall: o.wall,
    floor: 'wood',
    roof: 'shingle',
    pitch: 1.5,
    doors: [{ side: 's', at: -2.2 }, ...(back ? [{ side: 'n' as const, at: 2.4 }] : [])],
    windows: [
      { side: 's', at: 2.8, boards: o.n % 3 !== 1 },
      { side: 'n', at: -2.5, glass: o.n % 3 === 1 },
      { side: 'e', at: -0.8, boards: o.n % 2 === 0 },
      { side: 'w', at: -1.2 },
    ],
  })
  b.block(-2.2, -0.3, 4.2, 2.2, 0.36, 1.4, 'wood')
  partition(b, false, 1.2, -3.3, 3.3, 2.6, 'plaster', [1.6])
  // Kitchen and living room.
  counter(b, -3.2, -3, true, 2.4, ['kitchen', 'kitchen'])
  table(b, -1.6, -0.2, 1.4, 0.8, 'kitchen')
  shelf(b, -4.55, 2, false, ['kitchen', 'store'])
  b.block(0, F, 2.85, 1.8, 0.45, 0.8, 'fabric')
  b.deco(0, F + 0.45, 3.15, 1.8, 0.4, 0.2, 'fabric')
  // Bedroom.
  bed(b, 4.3, -2.2, false)
  cabinet(b, 3.4, 3.05, 1.2, 0.9, 0.5, 'wood', 'bedroom')
  b.loot(3.3, F + 0.02, -1.8, 'bedroom')
  if (o.bag) bed(b, 4.2, 1.2, false, o.bag, true)
  if (o.n % 3 === 0) corpse(b, 2.6, 1.6, false, F)
  b.zombie(-2.8, 1.2, F).zombie(2.6, -0.6, F)
}

/** A main room with the kitchen in it and a bedroom built on to the east. */
function lHouse(b: Site, o: Home): void {
  b.shell(0, 0, {
    w: 7,
    d: 6,
    h: 2.7,
    wall: o.wall,
    floor: 'wood',
    roof: 'shingle',
    pitch: 1.4,
    doors: [
      { side: 's', at: -1.5 },
      { side: 'e', at: 0 },
    ],
    windows: [
      { side: 's', at: 1.6, glass: o.n % 2 === 0 },
      { side: 'n', at: 1.2 },
      { side: 'w', at: 0, boards: true },
    ],
  })
  b.shell(6, 0, {
    w: 5,
    d: 5,
    h: 2.5,
    wall: o.wall,
    floor: 'carpet',
    roof: 'shingle',
    pitch: 1,
    doors: [{ side: 'w', at: 0 }],
    windows: [
      { side: 'e', at: 0, boards: o.n % 2 === 1 },
      { side: 's', at: 0.4 },
    ],
  })
  b.block(-1.5, -0.3, 3.7, 2, 0.36, 1.4, 'wood')
  counter(b, -1.6, -2.5, true, 2.4, ['kitchen', 'kitchen'])
  stove(b, 2.7, -2.4, 2.7, false)
  table(b, -0.3, 0.3, 1.4, 0.8, 'kitchen')
  cabinet(b, -3.05, 1.2, 0.5, 0.9, 1.2, 'wood', 'store')
  // The bedroom.
  bed(b, 7.8, -1.2, false)
  cabinet(b, 6, -2.05, 1.2, 0.9, 0.5, 'wood', 'bedroom')
  b.loot(6.8, F + 0.02, 1.7, 'bedroom')
  if (o.bag) bed(b, 5.4, 1.6, true, o.bag, true)
  if (o.n % 2 === 0) blood(b, 5.6, 0.2, 1.3, 1, F)
  b.zombie(0.9, 1.5, F)
}

function house(b: Site, o: Home): void {
  if (o.plan === 0) cottage(b, o)
  else if (o.plan === 1) bungalow(b, o)
  else lHouse(b, o)
}

// --- Shops ------------------------------------------------------------------------------------

/** The general store: aisles of shelves picked nearly clean, a counter, a back door. */
function store(b: Site, name: string): void {
  b.shell(0, 0, {
    w: 12,
    d: 9,
    h: 3,
    wall: 'brick',
    floor: 'tile',
    roof: 'concrete',
    doors: [
      { side: 's', at: 0, width: 1.8 },
      { side: 'n', at: 3 },
    ],
    windows: [
      { side: 's', at: -3.7, width: 2.4, sill: 0.9, height: 1.5, boards: true },
      { side: 's', at: 3.7, width: 2.4, sill: 0.9, height: 1.5 },
    ],
  })
  b.deco(0, 2.55, 4.95, 7, 0.12, 0.9, 'accent')
  b.label(0, 3.7, 4.6, name)
  shelving(b, -5.55, -1.5, false, 4.6, ['store', 'store'])
  shelving(b, -3, -0.8, false, 4, ['store', 'kitchen', 'store'])
  shelving(b, 0, -0.8, false, 4, ['store', 'store'])
  cabinet(b, 3.6, 1.6, 2.6, 1, 0.7, 'desk', 'store')
  b.deco(4.3, F + 1, 1.6, 0.4, 0.3, 0.4, 'rack')
  cabinet(b, 5.35, -2.2, 0.8, 1.9, 2.4, 'whiteboard')
  b.loot(4.6, F + 0.02, -2.2, 'kitchen')
  // Knocked over on the way out.
  b.turned(1.6, F, 2.6, 0.5, 0.5, 1.2, 25, 'cover')
  blood(b, -1.4, 2.6, 1.2, 0.8, F)
  b.zombie(1.6, -0.8, F).zombie(-1.5, 2.8, F)
}

/** A garage: one car that never got fixed, a bench of tools. */
function garage(b: Site, look: number): void {
  b.shell(0, 0, {
    w: 11,
    d: 9,
    h: 3.2,
    wall: 'rust',
    floor: 'concrete',
    roof: 'rust',
    doors: [
      { side: 's', at: -2, width: 3.4, height: 2.7 },
      { side: 'e', at: 1.5 },
    ],
    windows: [{ side: 'w', at: 0, width: 1.6, sill: 1.4, height: 0.8 }],
  })
  b.label(0, 3.9, 4.6, 'AUTO REPAIR')
  carWreck(b.sub(-2, -0.6, 1).lifted(F), look)
  decal(b, -2, 3, 1.5, 1, 'asphalt', F)
  cabinet(b, 2.5, -3.9, 3, 0.9, 0.8, 'metal')
  b.loot(1.7, F + 0.95, -3.9, 'garage').loot(3.3, F + 0.95, -3.9, 'garage')
  shelving(b, 5.05, -1.6, false, 3, ['garage', 'garage'])
  b.block(4.6, F, 3.6, 0.8, 0.9, 0.8, 'asphalt')
  drum(b, -4.7, 3.7, 'rust', F)
  crate(b, 1.3, 3.5, 0.8, 'melee', F)
  b.loot(0.4, F + 0.02, -2.4, 'garage')
  b.zombie(1.6, 0.4, F)
  // Out front: tyres and a drum of something.
  b.block(4.4, 0, 5.4, 0.8, 0.6, 0.8, 'asphalt')
  drum(b, 3.3, 5.3, 'platform')
}

// --- Pinewatch ---------------------------------------------------------------------------------

/** The police station: front desk, a cell with its door open, and the armoury behind. */
function police(b: Site): void {
  b.shell(0, 0, {
    w: 14,
    d: 10,
    h: 2.9,
    wall: 'brick',
    floor: 'tile',
    roof: 'concrete',
    doors: [{ side: 's', at: -2, width: 1.6 }],
    windows: [
      { side: 's', at: 3.5, width: 1.6, glass: true },
      { side: 's', at: -5.2, boards: true },
      { side: 'e', at: 2.5 },
      { side: 'w', at: 2.5, boards: true },
    ],
  })
  b.deco(-2, 2.6, 5.4, 3, 0.12, 0.9, 'platform')
  b.label(-2, 3.6, 5.1, 'POLICE')
  partition(b, true, -0.4, -6.8, 6.8, 2.9, 'plaster', [-1.9, 3.4])
  partition(b, false, 0, -4.8, -0.47, 2.9, 'plaster')
  // Front office.
  cabinet(b, 1.2, 1.4, 3.2, 1.05, 0.6, 'desk')
  desk(b, 5.2, 3.3, 1.6, 0.8, 'office')
  b.deco(5.2, F + 0.76, 3.5, 0.5, 0.36, 0.06, 'metal')
  b.block(-6.45, F, 3.6, 0.5, 0.45, 2.2, 'wood')
  cabinet(b, 6.5, 0.6, 0.5, 1.2, 0.8, 'whiteboard', 'medical')
  b.loot(1.9, F + 1.1, 1.4, 'office')
  corpse(b, -4, 1.2, true, F)
  b.light(0, 2.5, 2.4, { color: 0xcfe0ff, intensity: 9, distance: 10, flicker: 0.55 })
  // The cell: bars you can shoot through, the door left open.
  for (let z = -4.65; z < -2.1; z += 0.3) b.block(-3.6, F, z, 0.05, 2.9, 0.05, 'metal')
  b.block(-3.6, F, -0.6, 0.05, 2.9, 0.05, 'metal')
  b.deco(-3.6, F + 2.2, -2.63, 0.07, 0.08, 4.3, 'metal')
  b.turned(-4.25, F, -2.15, 1.3, 2.1, 0.05, 12, 'metal')
  cot(b, -6.3, -3.3, false, F)
  blood(b, -5.2, -1.4, 1.2, 0.9, F)
  desk(b, -1, -4.25, 1.4, 0.7, 'police')
  // The armoury.
  shelving(b, 3.5, -4.55, true, 5, ['police', 'police', 'police'])
  cabinet(b, 6.45, -2.4, 0.6, 1.9, 1.6, 'metal')
  b.interact('police_locker', 'search', 6.05, F + 1.1, -2.4, 'Search the evidence locker')
  cabinet(b, 0.45, -2.7, 0.5, 1.9, 2, 'rack')
  crate(b, 5.8, -0.95, 0.6, 'police', F)
  b.zombie(-3.5, 2.6, F).zombie(-5, -2, F).zombie(3.4, -2.4, F)
}

/** The clinic: a waiting room, an examination room and the dispensary with its fridge. */
function clinic(b: Site): void {
  b.shell(0, 0, {
    w: 12,
    d: 9,
    h: 2.8,
    wall: 'plaster',
    floor: 'tile',
    roof: 'concrete',
    doors: [{ side: 's', at: 0, width: 1.8 }],
    windows: [
      { side: 's', at: -3.8, glass: true },
      { side: 's', at: 3.8 },
      { side: 'n', at: -3 },
      { side: 'n', at: 3, boards: true },
    ],
  })
  // A red cross over the door.
  b.deco(0, 2.3, 4.52, 0.9, 0.28, 0.03, 'accent')
  b.deco(0, 1.99, 4.53, 0.28, 0.9, 0.03, 'accent')
  b.label(0, 3.5, 4.6, 'CLINIC')
  partition(b, true, 0.2, -5.8, 5.8, 2.8, 'plaster', [-2.8, 3])
  partition(b, false, 0.3, -4.3, 0.13, 2.8, 'plaster')
  // Waiting room.
  cabinet(b, 3.9, 2.4, 2.4, 1, 0.6, 'desk', 'office')
  b.block(-4.6, F, 3.9, 2.2, 0.45, 0.6, 'fabric')
  corpse(b, -1.6, 1.6, true, F)
  // Examination room.
  cot(b, -5.2, -2.8, false, F)
  cot(b, -1, -3.5, true, F)
  b.deco(-4.5, F, -2.8, 0.04, 1.9, 2, 'canvas')
  cabinet(b, -3.3, -4, 1.2, 0.9, 0.5, 'whiteboard', 'medical')
  b.loot(-4.1, F + 0.02, -1.4, 'medical')
  blood(b, -1, -2.4, 1, 0.8, F)
  // Dispensary.
  shelving(b, 3.2, -4.05, true, 4.4, ['medical', 'medical'], 'whiteboard')
  cabinet(b, 5.4, -1.6, 0.7, 1.8, 0.9, 'whiteboard')
  b.interact('clinic_fridge', 'search', 4.95, F + 1.1, -1.6, 'Search the fridge')
  desk(b, 1.3, -1.8, 0.8, 1.4, 'medical')
  b.light(3, 2.4, -2, { color: 0xbfe6ff, intensity: 7, distance: 8, flicker: 0.4 })
  b.zombie(-1, 2.9, F).zombie(-3, -1.6, F)
}

function pinewatch(s: Site): void {
  streets(s, 62)
  police(s.sub(20, -16.5))
  store(s.sub(43, -21), 'PINEWATCH GENERAL')
  house(s.sub(13.5, -42, 1), { plan: 1, wall: 'wood', n: 0 })
  clinic(s.sub(-22, -15.5))
  house(s.sub(-45, -14), { plan: 0, wall: 'plaster', n: 1 })
  garage(s.sub(-20, -44, 3), 3)
  house(s.sub(-36, 13, 2), { plan: 2, wall: 'wood', n: 2 })
  house(s.sub(-13.5, 46, 3), { plan: 1, wall: 'brick', n: 3, bag: 'bed_pinewatch' })
  house(s.sub(24, 14, 2), { plan: 0, wall: 'brick', n: 4 })
  house(s.sub(13, 42, 1), { plan: 2, wall: 'plaster', n: 5 })

  // The crossroads: one lamp still trying.
  lampPost(s, 5.6, -5.6, { color: 0xffd9a0, flicker: 0.5 }, -0.9)
  lampPost(s, -5.6, 5.6)
  lampPost(s, 32, 5.6, undefined, 0, -0.9)
  lampPost(s, -32, -5.6, undefined, 0, 0.9)
  lampPost(s, 5.6, -34, undefined, -0.9)
  lampPost(s, -5.6, 32)
  // A patrol car that never left, a pile-up at the crossing, a pickup that tried the north road.
  carWreck(s.sub(22, -8.4), 4)
  carWreck(s.sub(-9, 1.9), 1)
  carWreck(s.sub(1.9, 24, 1), 2)
  pickupWreck(s.sub(-1.7, -26, 3), 0, 'pack')
  blood(s, -6.5, 3.6, 1.6, 1)
  // Somebody tried to close the west street, and the road east.
  barricade(s, -34, -1.6, false, 4.4)
  barricade(s, -35.2, 3, false, 1.8)
  barrier(s, 52, -2.2, false)
  barrier(s, 53.6, 1.6, false)
  sandbags(s, 50.4, 2.9, true, 2.6)
  corpse(s, 49, 0.6, true)
  for (const [x, z] of [
    [9, 0.5],
    [-15, -1.5],
    [0.5, -13],
    [-1, 15],
    [31, 1.5],
    [-27, 2],
    [2, -36],
    [-2, 36],
    [44, -11],
    [-11, -9],
    [9, 9],
    [-30, -8],
  ] as const) {
    s.zombie(x, z)
  }
}

// --- Mill Creek --------------------------------------------------------------------------------

/** Dr. Voss's house: bigger than its neighbours, with the office he never came back to. */
function vossHouse(b: Site): void {
  b.shell(0, 0, {
    w: 11,
    d: 8,
    h: 2.8,
    wall: 'plaster',
    floor: 'wood',
    roof: 'shingle',
    pitch: 1.6,
    doors: [
      { side: 's', at: -2 },
      { side: 'e', at: 0.5 },
    ],
    windows: [
      { side: 's', at: 2.6, glass: true },
      { side: 's', at: -4.4, boards: true },
      { side: 'n', at: 2.5, glass: true },
      { side: 'w', at: 0, boards: true },
    ],
  })
  b.shell(8.5, 0.5, {
    w: 6,
    d: 6,
    h: 2.6,
    wall: 'plaster',
    floor: 'carpet',
    roof: 'shingle',
    pitch: 1,
    doors: [{ side: 'w', at: 0 }],
    windows: [
      { side: 'e', at: 0, boards: true },
      { side: 's', at: 0.8, glass: true },
    ],
  })
  b.block(-2, -0.3, 4.8, 2.4, 0.36, 1.6, 'wood')
  b.label(-2, 3.2, 4.3, 'DR. E. VOSS')
  partition(b, false, -0.6, -3.8, 3.8, 2.8, 'plaster', [1.8])
  // Kitchen.
  counter(b, -3.7, -3.5, true, 2.6, ['kitchen', 'kitchen'])
  stove(b, -1.3, -3.4, 2.8, false)
  table(b, -3.1, 0.2, 1.6, 0.9, 'kitchen')
  // Living room and bed.
  bed(b, 4.25, -2.7, true)
  cabinet(b, 1, -3.5, 1.4, 0.9, 0.5, 'wood', 'bedroom')
  b.block(2.2, F, 3.3, 2, 0.45, 0.8, 'fabric')
  b.deco(2.2, F + 0.45, 3.6, 2, 0.4, 0.2, 'fabric')
  b.loot(2.8, F + 0.02, -1.6, 'bedroom')
  // The office: his screens still on, the wall covered in his sums.
  desk(b, 9.6, -1.3, 2, 0.9, 'office')
  b.deco(9.15, F + 0.76, -1.6, 0.56, 0.38, 0.05, 'screen')
  b.deco(10.05, F + 0.76, -1.6, 0.56, 0.38, 0.05, 'screen')
  b.interact('voss_desk', 'search', 9.6, F + 0.9, -1.1, "Search Voss's desk")
  b.deco(8.5, F + 1, -2.26, 2.6, 1.2, 0.04, 'whiteboard')
  shelving(b, 5.95, 2.4, false, 1.6, ['office', 'medical'], 'wood')
  cabinet(b, 6.2, -1.8, 0.6, 1.3, 0.6, 'metal', 'office')
  decal(b, 8.2, 1.4, 0.5, 0.35, 'whiteboard', F)
  decal(b, 9.1, 2.1, 0.35, 0.5, 'whiteboard', F)
  b.light(9.4, 1.6, -0.4, { color: 0x9fd0ff, intensity: 5, distance: 6, flicker: 0.3 })
  b.zombie(2.4, 0.9, F)
}

/** The diner: a counter, four booths by the windows, the kitchen behind. */
function diner(b: Site): void {
  b.shell(0, 0, {
    w: 14,
    d: 8,
    h: 2.9,
    wall: 'metal',
    floor: 'tile',
    roof: 'metal',
    doors: [
      { side: 's', at: 0, width: 1.8 },
      { side: 'e', at: -2.6 },
    ],
    windows: [
      { side: 's', at: -4.2, width: 2.6, sill: 0.9, height: 1.4, glass: true },
      { side: 's', at: 4.2, width: 2.6, sill: 0.9, height: 1.4 },
      { side: 'w', at: 1.4, width: 2, glass: true },
    ],
  })
  b.deco(0, 3.2, 3.6, 5, 0.9, 0.3, 'accent')
  b.label(0, 4.6, 3.6, 'DINER')
  partition(b, true, -1.4, -6.8, 6.8, 2.9, 'plaster', [4.6])
  // The bar and its stools.
  cabinet(b, -1.6, -1, 8, 1.05, 0.6, 'desk')
  b.loot(-4, F + 1.1, -1, 'kitchen').loot(-0.4, F + 1.1, -1, 'kitchen').loot(1.9, F + 1.1, -1, 'store')
  for (const x of [-4.6, -2.6, -0.6, 1.4]) b.deco(x, F, -0.25, 0.35, 0.62, 0.35, 'accent')
  // Booths.
  for (const e of [-1, 1]) {
    for (const x of [2.5, 4.2, 5.9]) b.block(e * x, F, 3.1, 0.5, 0.5, 1.3, 'accent')
    desk(b, e * 3.35, 3.1, 0.8, 1.2, e < 0 ? 'kitchen' : undefined)
    desk(b, e * 5.05, 3.1, 0.8, 1.2, e > 0 ? 'kitchen' : undefined)
  }
  blood(b, 2, 1.2, 1.5, 1.1, F)
  // Kitchen.
  cabinet(b, -4.4, -3.45, 1.6, 0.9, 0.7, 'metal')
  counter(b, -1.4, -3.5, true, 3, ['kitchen', 'kitchen'])
  cabinet(b, 1.6, -3.4, 0.9, 1.9, 0.8, 'whiteboard')
  b.loot(1.6, F + 0.02, -2.6, 'kitchen')
  b.light(-2, 2.5, 1.2, { color: 0xff6a60, intensity: 9, distance: 10, flicker: 0.6 })
  b.zombie(0, 1.3, F).zombie(5.4, -2.6, F)
}

/** The gun shop: the first place everybody went. */
function gunShop(b: Site): void {
  b.shell(0, 0, {
    w: 9,
    d: 8,
    h: 2.8,
    wall: 'brick',
    floor: 'concrete',
    roof: 'concrete',
    doors: [{ side: 's', at: -1.5 }],
    windows: [{ side: 's', at: 2, width: 1.8, boards: true }],
  })
  b.label(0, 3.5, 4.1, 'GUNS & AMMO')
  cabinet(b, 0.9, -0.4, 6, 1, 0.7, 'desk')
  b.block(0.9, F + 1, -0.4, 5.6, 0.25, 0.6, 'glass')
  shelving(b, 0, -3.55, true, 6, ['gun', 'gun', 'gun'], 'rack')
  crate(b, -3.7, -3.1, 0.7, 'gun', F)
  b.loot(2.2, F + 0.02, -1.9, 'gun')
  cabinet(b, 3.95, 2.2, 0.5, 1, 2, 'wood', 'melee')
  corpse(b, 0.2, -2, true, F)
  // Brass on the floor.
  decal(b, -2.6, 1.4, 0.5, 0.4, 'marker', F)
  b.zombie(-0.5, 1.8, F)
}

function millcreek(s: Site): void {
  streets(s, 60)
  vossHouse(s.sub(19, -15))
  diner(s.sub(14, -41, 1))
  house(s.sub(47, -14.5), { plan: 1, wall: 'wood', n: 1 })
  house(s.sub(-34, -14), { plan: 0, wall: 'brick', n: 0 })
  gunShop(s.sub(-14, -45, 3))
  store(s.sub(-30, 14.5, 2), 'MILL CREEK MARKET')
  garage(s.sub(-15, 52, 3), 0)
  house(s.sub(34, 13, 2), { plan: 2, wall: 'plaster', n: 3 })
  house(s.sub(13, 41, 1), { plan: 0, wall: 'wood', n: 2, bag: 'bed_millcreek' })
  house(s.sub(55, 13.5, 2), { plan: 1, wall: 'brick', n: 4 })

  lampPost(s, -5.6, -5.6, undefined, 0.9)
  lampPost(s, 5.6, 5.6, { color: 0xffe2b0, flicker: 0.45 }, -0.9)
  lampPost(s, 30, -5.6, undefined, 0, 0.9)
  lampPost(s, -30, 5.6, undefined, 0, -0.9)
  lampPost(s, 5.6, -30, undefined, -0.9)
  lampPost(s, -5.6, 30)
  // Cars left where the queue out of town stopped moving.
  carWreck(s.sub(-12, -1.9), 0)
  carWreck(s.sub(-18.5, -1.7), 2)
  pickupWreck(s.sub(-25.5, 1.8, 2), 1, 'pack')
  carWreck(s.sub(-1.9, 22, 3), 3)
  blood(s, -15, 1.2, 1.4, 1)
  corpse(s, 3, 9, false)
  barricade(s, 40, 1.4, false, 4.6)
  barrier(s, 41, -2.7, false)
  barricade(s, 1.6, -27, true, 4.4)
  drum(s, -2.8, -27.2)
  for (const [x, z] of [
    [8, -1],
    [-7, 2.2],
    [1, -14],
    [-1, 13],
    [28, 1],
    [-32, -1.5],
    [-1.5, -36],
    [1.5, 34],
    [22, -7.5],
    [-22, 7],
    [8, 26],
    [48, -6],
  ] as const) {
    s.zombie(x, z)
  }
}

// --- Ashford -----------------------------------------------------------------------------------

/** Ashford General: a lobby, a ward of three beds and the theatre with the drug shelves. */
function hospital(b: Site): void {
  b.shell(0, 0, {
    w: 20,
    d: 14,
    h: 3,
    wall: 'plaster',
    floor: 'tile',
    roof: 'concrete',
    doors: [
      { side: 's', at: 0, width: 2.2 },
      { side: 'e', at: -3.5 },
    ],
    windows: [
      { side: 's', at: -6, width: 2, glass: true },
      { side: 's', at: 6, width: 2 },
      { side: 'n', at: -6 },
      { side: 'n', at: 5, boards: true },
      { side: 'w', at: -3.5 },
      { side: 'w', at: 3.5, boards: true },
    ],
  })
  b.deco(0, 2.6, 7.5, 5, 0.14, 1.2, 'concrete')
  b.deco(0, 3.3, 7.02, 1, 0.3, 0.03, 'accent')
  b.deco(0, 2.95, 7.03, 0.3, 1, 0.03, 'accent')
  b.label(0, 4.4, 7.1, 'ASHFORD GENERAL')
  partition(b, true, 0.6, -9.8, 9.8, 3, 'plaster', [-5, 5])
  partition(b, false, 0, -6.8, 0.53, 3, 'plaster', [-3])
  // Lobby.
  cabinet(b, 4.2, 2.6, 3.6, 1.05, 0.7, 'desk', 'office')
  b.block(-6, F, 6.2, 3, 0.45, 0.6, 'fabric')
  cot(b, -3.4, 3, true, F)
  cabinet(b, 9.3, 4.6, 0.8, 1.9, 1, 'accent')
  b.loot(8.5, F + 0.02, 4.6, 'store')
  corpse(b, -7, 3.2, false, F)
  blood(b, -5, 2, 0.6, 2.2, F)
  b.light(0, 2.6, 3.6, { color: 0xcfe4ff, intensity: 11, distance: 12, flicker: 0.6 })
  // The ward.
  for (const x of [-8.6, -6, -3.4]) cot(b, x, -5.6, false, F)
  for (const x of [-7.3, -4.7]) {
    b.deco(x, F, -5.3, 0.04, 2, 2.4, 'canvas')
    cabinet(b, x, -6.5, 0.5, 0.7, 0.5, 'whiteboard', 'medical')
  }
  b.loot(-8.8, F + 0.02, -3.9, 'bedroom')
  blood(b, -3.4, -5.4, 0.7, 1.2, F + 0.38)
  // The theatre.
  cabinet(b, 3.2, -3.2, 2, 0.85, 0.8, 'metal')
  blood(b, 3.2, -3.2, 1.2, 0.6, F + 0.85)
  b.deco(3.2, F + 2.3, -3.2, 0.7, 0.2, 0.7, 'metal')
  shelving(b, 5.5, -6.55, true, 6, ['medical', 'medical', 'medical'], 'whiteboard')
  cabinet(b, 9.4, -1.2, 0.7, 1.8, 0.9, 'whiteboard')
  desk(b, 1.3, -0.3, 1.6, 0.8, 'medical')
  b.zombie(-2, 5, F).zombie(-6, -2.4, F).zombie(6.5, -3, F).zombie(5.5, 4.8, F)
}

/** The town hall: benches in the hall, two offices behind. */
function townHall(b: Site): void {
  b.shell(0, 0, {
    w: 16,
    d: 11,
    h: 3.6,
    wall: 'brick',
    floor: 'wood',
    roof: 'shingle',
    pitch: 2,
    doors: [
      { side: 's', at: 0, width: 2 },
      { side: 'e', at: -3.4 },
    ],
    windows: [
      { side: 's', at: -5, height: 1.6 },
      { side: 's', at: 5, height: 1.6, boards: true },
      { side: 'w', at: 2, height: 1.6, glass: true },
      { side: 'n', at: -4, boards: true },
    ],
  })
  // A porch on two columns, and a clock that stopped.
  for (const e of [-1, 1]) b.block(e * 2.4, 0, 6.9, 0.45, 3.4, 0.45, 'concrete')
  b.deco(0, 3.4, 6.45, 6.2, 0.25, 1.9, 'concrete')
  b.block(0, -0.3, 6.4, 5, 0.36, 1.6, 'concrete')
  b.deco(0, 6.2, 3, 2.2, 2.4, 2.2, 'brick')
  b.deco(0, 8.6, 3, 2.6, 0.5, 2.6, 'shingle')
  b.deco(0, 6.9, 4.12, 1, 1, 0.04, 'whiteboard')
  b.label(0, 5, 5.7, 'ASHFORD TOWN HALL')
  partition(b, true, -1.6, -7.8, 7.8, 3.6, 'plaster', [-4.5, 4.5])
  partition(b, false, 0, -5.3, -1.67, 3.6, 'plaster')
  // The hall.
  for (const x of [-3.3, 3.3]) for (const z of [1.2, 3]) b.block(x, F, z, 3, 0.45, 0.5, 'wood')
  cabinet(b, 0, -0.9, 1, 1.1, 0.5, 'wood')
  b.deco(-7.76, F + 1, 0.4, 0.04, 1.2, 2, 'whiteboard')
  desk(b, -6.9, 3.6, 0.8, 1.6, 'office')
  blood(b, 1, 4, 1.4, 1, F)
  // Offices.
  desk(b, -5.5, -4.3, 1.8, 0.8, 'office')
  cabinet(b, -1, -4.9, 1.6, 1.3, 0.6, 'metal', 'office')
  shelving(b, -7.55, -3.5, false, 2.6, ['office'], 'wood')
  desk(b, 2.2, -4.3, 1.8, 0.8, 'office')
  cabinet(b, 0.5, -2.6, 0.6, 1.3, 1.2, 'metal', 'office')
  b.loot(5.6, F + 0.02, -4.6, 'office').loot(2.6, F + 0.81, -4.3, 'kitchen')
  b.zombie(0, 2.2, F).zombie(3.6, -3.1, F).zombie(-3.4, -3.2, F)
}

/** The square: where the helicopters were supposed to land. */
function square(s: Site): void {
  paving(s, -11, 11, 11, 33, 'concrete', 0.06)
  const y = 0.05
  // A yellow ring and a white H.
  for (const e of [-1, 1]) {
    s.deco(e * 5.2, y, 22, 0.4, 0.025, 10.8, 'marker')
    s.deco(0, y, 22 + e * 5.2, 10, 0.025, 0.4, 'marker')
    s.deco(e * 1.6, y, 22, 0.6, 0.025, 5, 'whiteboard')
  }
  s.deco(0, y, 22, 2.6, 0.025, 0.6, 'whiteboard')
  s.interact('evac_flare', 'flare', 0, 0.4, 22, 'Light the flare')
  // What the army left: sandbags at the corners, a sign nobody believed.
  sandbags(s, -9.6, 12.4, true, 2.8)
  sandbags(s, 9.6, 12.4, true, 2.8)
  sandbags(s, -10.4, 30, false, 3)
  sandbags(s, 10.4, 30, false, 3)
  sign(s, -9, 31.6, 'EVACUATION POINT', true, 4.2, 'whiteboard')
  crate(s, 8.6, 31.4, 0.9, 'military')
  crate(s, 7.6, 31.8, 0.7)
  corpse(s, -7, 15, false)
  corpse(s, 6.5, 27, true)
  lampPost(s, 12, 34, { color: 0xfff0d0, flicker: 0.4 }, -0.9, -0.9)
  for (const [x, z] of [
    [-6.5, 20],
    [6.5, 17],
    [0, 14],
    [3, 29],
    [-4, 27],
  ] as const) {
    s.zombie(x, z)
  }
}

function ashford(s: Site): void {
  streets(s, 70)
  square(s)
  hospital(s.sub(25, -18))
  store(s.sub(49, -16), 'ASHFORD FOODS')
  house(s.sub(13.5, -42, 1), { plan: 1, wall: 'brick', n: 2 })
  townHall(s.sub(-22, -16.5))
  house(s.sub(-46, -14), { plan: 0, wall: 'wood', n: 3 })
  house(s.sub(-13, -40, 3), { plan: 2, wall: 'plaster', n: 0 })
  garage(s.sub(-15, -62, 3), 1)
  house(s.sub(-31, 13.5, 2), { plan: 1, wall: 'wood', n: 1 })
  house(s.sub(-54, 14, 2), { plan: 0, wall: 'brick', n: 5 })
  house(s.sub(-16, 52, 3), { plan: 0, wall: 'plaster', n: 4, bag: 'bed_ashford' })
  house(s.sub(16, 44, 1), { plan: 2, wall: 'brick', n: 1 })
  house(s.sub(40, 44.5, 2), { plan: 1, wall: 'plaster', n: 4 })

  lampPost(s, 5.6, -5.6, { color: 0xffd9a0, flicker: 0.55 }, -0.9)
  lampPost(s, -5.6, -5.6, undefined, 0.9)
  lampPost(s, 34, 5.6, undefined, 0, -0.9)
  lampPost(s, -34, -5.6, undefined, 0, 0.9)
  lampPost(s, 5.6, -36, undefined, -0.9)
  lampPost(s, -40, 5.6, { color: 0xffd9a0, intensity: 22, flicker: 0.35 }, 0, -0.9)
  // An ambulance that got as far as the door; the rest never got out of the centre.
  pickupWreck(s.sub(23, -8.6), 4, 'medical')
  carWreck(s.sub(-10, -1.9), 1)
  carWreck(s.sub(-16.5, 1.8, 2), 0)
  carWreck(s.sub(1.9, -18, 1), 3)
  carWreck(s.sub(-1.8, -44, 3), 2)
  blood(s, -13, 0, 1.6, 1.1)
  // Roadblocks on the way in from the west and north.
  barrier(s, -38, -2.4, false)
  barrier(s, -39.6, 1.2, false)
  barricade(s, -37, 3.2, true, 2.2)
  barricade(s, -1.4, -52, true, 4.6)
  barrier(s, 2.8, -53.4, true)
  barricade(s, 56, 1.4, false, 4.4)
  drum(s, 55.2, -2.6)
  for (const [x, z] of [
    [8, 1],
    [-6, -1.5],
    [1, -10],
    [-1.5, 7],
    [30, -1.5],
    [-27, 1.5],
    [-1.5, -30],
    [44, 2],
    [20, -8],
    [-22, -8],
    [-8, -24],
    [9, -28],
    [-18, 34],
    [22, 36],
  ] as const) {
    s.zombie(x, z)
  }
}

// ---------------------------------------------------------------------------------------------

/** The two streets through the middle of a town, `reach` metres out each way. */
function streets(s: Site, reach: number): void {
  paving(s, -reach, -4, reach, 4)
  paving(s, -4, -reach, 4, -4)
  paving(s, -4, 4, 4, reach)
  // What is left of the lines.
  for (const at of [-0.72, -0.44, 0.44, 0.72]) {
    decal(s, at * reach, 0, 5, 0.16, 'marker', 0.045)
    decal(s, 0, at * reach, 0.16, 5, 'marker', 0.045)
  }
}

export function town(s: Site, poi: Poi): void {
  if (poi.key === 'pinewatch') pinewatch(s)
  else if (poi.key === 'millcreek') millcreek(s)
  else ashford(s)
}
