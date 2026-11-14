import type { MaterialId } from '../maps/types.ts'
import type { Site } from './kit.ts'
import {
  blood,
  cabinet,
  carWreck,
  corpse,
  decal,
  desk,
  drum,
  dying,
  fence,
  logPile,
  note,
  partition,
  pickupWreck,
  shelving,
} from './places-kit.ts'
import { bed, campfire, counter, crate, FLOOR, shelf, stove, table } from './structures.ts'
import type { Poi } from './types.ts'

/**
 * The places people lived and left: lone houses down the woods, their sheds and outhouses, and
 * campers pulled off the road. Each is built around its own origin with its front to the south
 * (+z); the world turns it to face the road.
 */

const F = FLOOR

const FAMILIES = [
  'Pruitt',
  'Kowalski',
  'Harlan',
  'Dufresne',
  'Okafor',
  'Lindqvist',
  'Mercer',
  'Bellamy',
  'Tran',
  'Castellanos',
  'Whitlock',
  'Yoder',
  'Brannigan',
  'Sorensen',
  'Adeyemi',
  'Faulkner',
  'Novak',
  'Greer',
]

const HOUSE_KINDS = ['farmhouse', 'house', 'cottage', 'ruin'] as const

/** What the map calls a lone house: by the family that lived there. */
export function houseName(variant: number): string {
  const family = FAMILIES[variant % FAMILIES.length] as string
  const kind = HOUSE_KINDS[variant % HOUSE_KINDS.length]
  if (kind === 'farmhouse') return `${family} farmhouse`
  if (kind === 'ruin') return `Burnt-out house`
  return `The ${family} place`
}

export function shedName(variant: number): string {
  return (['Tool shed', 'Woodshed', 'Greenhouse', 'Pump house'] as const)[variant % 4] ?? 'Shed'
}

export function camperName(variant: number): string {
  return (['Camper', 'Travel trailer', 'Burnt-out RV'] as const)[variant % 3] ?? 'Camper'
}

const HOUSE_NOTES = [
  "Jim went out to see about the dog. That was yesterday.\n\nThe dog came back. Jim didn't. I've locked the doors. The dog keeps scratching at the back one and I can't let it in, because it's not just the dog out there.",
  'Kids — we went to Haven, south of the highway. The radio said they have walls.\n\nIf you get here before us, stay upstairs and pull the stairs boards up. Love you. Mum.',
  "GRANDPA IS IN THE CELLAR. DON'T OPEN IT.\n\nWe didn't have a cellar. We nailed the pantry shut instead. Same thing.",
  'Insurance says fire is covered. I laughed so hard I cried.\n\nIt was the only thing that kept them away. For a while.',
  "To whoever finds this house: there's food in the high cupboard. Take it.\n\nPlease don't sleep in the back bedroom. I'm still in there. I don't think I'm me any more.",
  'Day 3 no power. Day 5 no water. Day 8 Mr. Pruitt from up the road knocked.\n\nMr. Pruitt has been dead since spring.',
]

/** A porch: boards on the ground before a door, posts and a little roof. */
function porch(b: Site, x: number, z: number, w: number, roof: MaterialId = 'shingle'): void {
  b.block(x, -0.3, z, w, 0.36, 1.6, 'wood')
  for (const e of [-1, 1]) b.deco(x + e * (w / 2 - 0.1), 0.06, z + 0.65, 0.12, 2.3, 0.12, 'log')
  b.deco(x, 2.36, z + 0.1, w + 0.2, 0.1, 1.9, roof)
}

/** A hand pump over a well: water, if you work it. */
function pump(s: Site, key: string, x: number, z: number): void {
  s.block(x, 0, z, 1.1, 0.6, 1.1, 'concrete')
  s.block(x, 0.6, z, 0.18, 0.9, 0.18, 'metal')
  s.deco(x + 0.25, 1.35, z, 0.5, 0.06, 0.06, 'metal')
  s.interact(key, 'water', x, 0.9, z, 'Drink from the pump')
}

/** A two-storey farmhouse: kitchen, parlour and a study below, bedrooms up the outside stairs. */
function farmhouse(b: Site, poi: Poi, v: number, wall: MaterialId): void {
  const W = 9
  const D = 7
  b.shell(0, 0, {
    w: W,
    d: D,
    h: 2.6,
    wall,
    floor: 'wood',
    roof: 'wood',
    doors: [
      { side: 's', at: -2 },
      { side: 'n', at: 2.6 },
    ],
    windows: [
      { side: 's', at: 2, boards: v % 2 === 0 },
      { side: 'w', at: 0, glass: v % 3 === 1 },
      { side: 'n', at: -2, boards: v % 3 === 0 },
    ],
  })
  porch(b, -2, D / 2 + 0.8, 2.6)
  partition(b, false, 1.5, -3.3, 3.3, 2.6, 'plaster', [1.6])
  // Kitchen and parlour (west).
  counter(b, -2.5, -3, true, 2.6, ['kitchen', 'kitchen'])
  stove(b, -3.85, 0.6, 2.6, false)
  table(b, -1.4, 0, 1.4, 0.8, 'kitchen')
  b.block(-1.6, F, 2.75, 2, 0.45, 0.8, 'fabric')
  b.deco(-1.6, F + 0.45, 3.1, 2, 0.45, 0.16, 'fabric')
  // The study (east).
  desk(b, 3, -2.7, 1.6, 0.8, 'office')
  shelf(b, 4.05, 0.2, false, ['store', 'garage'])
  b.loot(2.6, F + 0.02, 2.4, 'bedroom')

  // Upstairs: up the outside stairs on the east wall to a landing and a door.
  const UP = 2.9
  const up = b.lifted(UP)
  up.shell(0, 0, {
    w: W,
    d: D,
    h: 2.3,
    wall,
    floor: 'wood',
    roof: 'shingle',
    pitch: 1.6,
    doors: [{ side: 'e', at: -2.2, width: 1.2 }],
    windows: [
      { side: 's', at: -1.5, glass: v % 2 === 1 },
      { side: 'n', at: 1.5, boards: true },
      { side: 'w', at: 0 },
    ],
    noRoom: true,
  })
  const top = UP + F
  const sx = W / 2 + 0.75
  b.block(sx, 0, -2.2, 1.5, top, 1.6, 'wood')
  const run = top / Math.tan((35 * Math.PI) / 180)
  b.ramp(sx, 0, -1.4 + run, 1.2, run, 35, 'wood')
  for (let z = 0; z < -1.4 + run - 0.4; z += 1.6) {
    const h = ((-1.4 + run - z) / run) * top
    b.deco(sx + 0.66, 0, z, 0.08, h + 0.95, 0.08, 'log')
  }
  partition(up, true, 0.3, -4.3, 4.3, 2.3, 'plaster', [2.4])
  bed(up, -2.8, -2.3, true, `bed_${poi.key}`)
  cabinet(up, -0.6, -2.95, 1.2, 0.9, 0.5, 'wood', 'bedroom')
  up.block(3.6, F, -2.4, 0.8, 0.3, 1.6, 'wood')
  up.deco(3.6, F + 0.3, -2.4, 0.76, 0.1, 1.56, 'accent')
  crate(up, -3.6, 2.6, 0.7, v % 3 === 0 ? 'gun' : 'medical', F)
  up.loot(1.8, F + 0.02, 2.2, 'bedroom')
  up.loot(-1.2, F + 0.02, 1.4, v % 2 === 0 ? 'pack' : 'bedroom')
  note(up, `house_note_${v}`, -2.8, F + 0.5, -1.5, HOUSE_NOTES[v % HOUSE_NOTES.length] ?? '')
  if (v % 2 === 1) corpse(up, 2.4, 1.2, true, F)
  blood(b, -0.2, 1.8, 1.4, 1, F)
  if (v % 3 === 1)
    up.lantern(-2, 2.3, 1.4, 0.5, { color: 0xffb870, intensity: 5, distance: 7, flicker: 0.4 })
  b.zombie(-1, -1.2, F)
  b.zombie(-5, 6)
}

/** A ranch house with three rooms, and a garage beside it with the car still in it. */
function ranch(s: Site, poi: Poi, v: number, wall: MaterialId): void {
  const b = s.sub(3, 0)
  b.shell(0, 0, {
    w: 11,
    d: 7,
    h: 2.6,
    wall,
    floor: 'wood',
    roof: 'shingle',
    pitch: 1.4,
    doors: [
      { side: 's', at: 2 },
      { side: 'n', at: -3.5 },
    ],
    windows: [
      { side: 's', at: -3, glass: v % 2 === 0 },
      { side: 's', at: 4.3, boards: true },
      { side: 'e', at: -1.6, boards: v % 3 !== 0 },
      { side: 'n', at: 2.6 },
      { side: 'w', at: 1.2, boards: v % 2 === 1 },
    ],
  })
  porch(b, 2, 4.3, 3)
  partition(b, false, -1, -3.3, 3.3, 2.6, 'plaster', [1.8])
  partition(b, true, 0, -0.93, 5.3, 2.6, 'plaster', [2.6])
  // Kitchen (west).
  counter(b, -3.2, -3, true, 2.6, ['kitchen', 'kitchen'])
  table(b, -3.2, 0.8, 1.2, 0.8, 'kitchen')
  cabinet(b, -5.05, 2.6, 0.5, 1.8, 1, 'whiteboard', 'kitchen')
  // Bedroom (north-east).
  bed(b, 4.3, -2, false, `bed_${poi.key}`)
  cabinet(b, 1.6, -3.05, 1.2, 0.9, 0.5, 'wood', 'bedroom')
  b.loot(2.6, F + 0.02, -1.2, v % 4 === 1 ? 'gun' : 'bedroom')
  // Living room (south-east).
  b.block(3.6, F, 0.7, 2, 0.45, 0.8, 'fabric')
  desk(b, 0.4, 2.6, 1.2, 0.6, v % 2 ? 'office' : 'store')
  shelf(b, 5.05, 2.2, false, ['store', 'medical'])
  if (v % 3 === 1) corpse(b, 2.4, 1.6, true, F)
  blood(b, -2.2, -1, 1.2, 0.9, F)
  note(b, `house_note_${v}`, -3.2, F + 0.79, 0.8, HOUSE_NOTES[v % HOUSE_NOTES.length] ?? '')
  if (v % 4 === 3) dying(b, 3, 2.4, 1.6, 0xffe2b0, 6)

  // The garage: the family car, a bench, the fuel.
  const g = s.sub(-8.5, 0.5)
  g.shell(0, 0, {
    w: 6,
    d: 6.5,
    h: 2.8,
    wall: 'wood',
    floor: 'concrete',
    roof: 'metal',
    doors: [
      { side: 's', at: 0, width: 3.2, height: 2.4 },
      { side: 'e', at: -1.8, width: 1 },
    ],
    noRoom: true,
  })
  carWreck(g.sub(-0.6, 0.2, 1).lifted(F), v)
  g.block(2.4, F, -1.5, 0.8, 0.9, 2.4, 'metal')
  g.loot(2.4, F + 0.95, -1.5, 'garage')
  shelving(g, 1.5, -2.95, true, 2.2, ['garage', 'fuel'])
  drum(g, 2.4, 2.4, 'rust', F)
  g.loot(2.4, F + 0.95, 2.4, 'fuel')
  b.zombie(-3, 1.6, F)
  s.zombie(0, 8)
}

/** A plastered cottage with a bedroom built in, a barn shed, a pump and a washing line. */
function cottage(b: Site, poi: Poi, v: number, wall: MaterialId): void {
  b.shell(0, 0, {
    w: 8,
    d: 6,
    h: 2.6,
    wall,
    floor: 'wood',
    roof: 'shingle',
    pitch: 1.5,
    doors: [{ side: 's', at: -2 }],
    windows: [
      { side: 's', at: 1.8, glass: v % 2 === 1 },
      { side: 'e', at: 0, boards: true },
      { side: 'n', at: -1.6 },
      { side: 'w', at: 0.8, boards: v % 3 === 0 },
    ],
  })
  porch(b, -2, 3.8, 2.4)
  partition(b, false, 1.4, -2.8, 2.8, 2.6, 'plaster', [1.6])
  counter(b, -1.8, -2.5, true, 2.4, ['kitchen', 'store'])
  stove(b, -3.35, 0.4, 2.6, v % 5 === 2)
  table(b, -1.2, 0.6, 1.2, 0.8, 'kitchen')
  bed(b, 2.9, -1.7, false, `bed_${poi.key}`)
  cabinet(b, 3.45, 1.8, 0.5, 0.9, 1.2, 'wood', 'bedroom')
  b.loot(2.2, F + 0.02, 0.4, 'medical')
  note(b, `house_note_${v}`, -1.2, F + 0.79, 0.6, HOUSE_NOTES[v % HOUSE_NOTES.length] ?? '')
  if (v % 2 === 0) blood(b, 2.4, 1.4, 1.3, 1, F)
  if (v % 3 === 1)
    b.lantern(-1.2, 2.6, 0.6, 0.5, { color: 0xffb060, intensity: 5, distance: 7, flicker: 0.5 })

  // The barn shed out back, its door hanging open.
  const shed = b.sub(-7.5, -4, 1)
  shed.shell(0, 0, {
    w: 4.5,
    d: 3.6,
    h: 2.5,
    wall: 'barn',
    floor: 'dirt',
    roof: 'rust',
    doors: [{ side: 's', at: 0, width: 1.8 }],
    noRoom: true,
  })
  shed.block(-1.4, F, -1, 1.2, 0.6, 1, 'hay')
  shelving(shed, 0.9, -1.35, true, 2, ['garage', 'lumber'])
  shed.loot(-1.4, F + 0.65, -1, 'hunting')
  pump(b, `pump_${poi.key}`, 5.5, 4)
  for (const x of [-5, 1]) b.block(x, 0, 7, 0.1, 2, 0.1, 'log')
  b.deco(-2, 1.9, 7, 6, 0.02, 0.02, 'canvas')
  b.deco(-3.6, 1.1, 7, 1.2, 0.8, 0.03, 'fabricAlt')
  b.deco(-1.4, 1.2, 7, 0.9, 0.7, 0.03, 'fabric')
  fence(b, [
    [3, 7.5],
    [8, 7.5],
    [8, 2.5],
  ])
  b.zombie(-1.2, -1, F)
  b.zombie(4, -6)
}

/** A house that burned: black walls with no roof, a chimney, and what the fire didn't want. */
function ruin(b: Site, v: number): void {
  b.block(0, -0.4, 0, 9, 0.52, 7, 'concrete')
  const black: MaterialId = 'asphalt'
  b.wall(-4.5, -3.5, 4.5, -3.5, F, 2.2, black, [
    [2, 1.2, 1, 2.2],
    [6.5, 2.5, 0.6, 2.2],
  ])
  b.wall(-4.5, -3.4, -4.5, 3.4, F, 1.6, black, [[3.6, 1.2, 0, 2.2]])
  b.wall(-4.5, 3.5, 0.5, 3.5, F, 1.1, black, [[1.8, 1.4, 0, 2.2]])
  b.wall(4.5, -3.4, 4.5, 0.5, F, 2.5, black)
  // The chimney stands; the roof lies in the rooms.
  b.block(4.4, F, -3.2, 1.2, 5.4, 0.9, 'brick')
  for (const [x, z, a] of [
    [-1.5, -1, 20],
    [1.2, 1.2, -35],
    [-2.6, 1.8, 70],
  ] as const) {
    b.turned(x, F, z, 3.2, 0.14, 0.3, a, 'log')
  }
  for (const [x, z] of [
    [-2, -2],
    [1.5, -0.5],
    [-0.5, 2],
    [3, 2.4],
  ] as const) {
    decal(b, x, z, 2.2, 1.6, 'asphalt', F)
  }
  stove(b, 3.2, -2.6, 1.4, false)
  cabinet(b, -3.6, -2.7, 0.9, 1.1, 0.7, 'metal', v % 2 === 0 ? 'gun' : 'garage')
  b.loot(-1, F + 0.02, -1.6, 'kitchen')
  b.loot(1.8, F + 0.02, 1.4, 'bedroom')
  b.loot(-3.4, F + 0.02, 2.2, 'medical')
  b.block(2.6, F, -0.6, 0.9, 0.5, 0.5, 'rust')
  corpse(b, 0, 0.4, true, F)
  note(b, `house_note_${v}`, 2.6, F + 0.52, -0.6, HOUSE_NOTES[(v + 3) % HOUSE_NOTES.length] ?? '')
  b.zombie(-6, 4)
  b.zombie(6, 5)
}

const WALLS: MaterialId[] = ['plaster', 'wood', 'brick', 'log', 'whiteboard']

/**
 * A lone house in the woods. Four plans by turns: a two-storey farmhouse with stairs up the
 * side, a ranch house with its garage, a cottage with a barn shed and a well, a burnt ruin.
 */
export function house(s: Site, poi: Poi, variant: number): void {
  const wall = WALLS[(variant * 3 + 1) % WALLS.length] as MaterialId
  const plan = variant % 4
  if (plan === 0) farmhouse(s, poi, variant, wall)
  else if (plan === 1) ranch(s, poi, variant, wall)
  else if (plan === 2) cottage(s, poi, variant, wall)
  else ruin(s, variant)
  // A mailbox by where the drive was, a woodpile, maybe the family car.
  s.block(-7, 0, 9, 0.12, 1.1, 0.12, 'wood')
  s.deco(-7, 1.1, 9, 0.3, 0.25, 0.5, variant % 2 ? 'rust' : 'metal')
  if (plan !== 1) {
    logPile(s, 8, -2, false, 2.6)
    s.loot(8, 1.85, -2, 'lumber')
  }
  if (plan === 0 || plan === 3) pickupWreck(s.sub(-7, 4.5, 1), variant, 'garage')
}

// --- Sheds --------------------------------------------------------------------------------------

/** A shed in the trees: a tool shed, a woodshed, a greenhouse, or a pump house and an outhouse. */
export function shed(s: Site, poi: Poi, variant: number): void {
  const kind = variant % 4
  if (kind === 0) {
    s.shell(0, 0, {
      w: 4,
      d: 3.2,
      h: 2.4,
      wall: variant % 2 ? 'wood' : 'rust',
      floor: 'wood',
      roof: 'metal',
      doors: [{ side: 's', at: -0.8, width: 1.2 }],
      windows: [{ side: 'e', at: 0, width: 0.8, height: 0.6, boards: true }],
    })
    s.block(0.4, F, -1.2, 2.8, 0.9, 0.6, 'wood')
    s.loot(-0.4, F + 0.95, -1.2, 'garage')
    s.loot(1.2, F + 0.95, -1.2, variant % 3 === 0 ? 'melee' : 'garage')
    shelf(s, 1.55, 0.6, false, ['fuel', 'garage'])
    for (const x of [-1, -0.6, -0.2]) s.deco(x, F + 1.3, -1.48, 0.06, 0.6, 0.04, 'metal')
    if (variant % 3 === 2) dying(s, 0, 2.1, 0, 0xfff0c0, 5)
    s.zombie(-3, 3)
  } else if (kind === 1) {
    // A woodshed: a roof on posts over stacked logs, a chopping block, an axe left in it.
    for (const x of [-2.4, 2.4]) {
      for (const z of [-1.2, 1.2]) s.block(x, 0, z, 0.16, z < 0 ? 2.6 : 2.2, 0.16, 'log')
    }
    s.deco(0, 2.4, 0, 5.4, 0.12, 3, 'shingle')
    s.block(0, 0, -1, 4.4, 0.12, 0.8, 'wood')
    logPile(s, -1, -0.6, true, 2.4)
    s.block(1.5, 0, -0.9, 1.4, 1.4, 0.8, 'log')
    s.loot(1.5, 1.45, -0.9, 'lumber')
    s.loot(-1, 1.85, -0.6, 'lumber')
    s.block(0.5, 0, 2.2, 0.5, 0.5, 0.5, 'log')
    s.loot(0.5, 0.55, 2.2, 'melee')
    if (variant % 2 === 1) blood(s, 0.8, 3, 1.4, 1)
    s.zombie(4, 4)
  } else if (kind === 2) {
    // A greenhouse: glass walls, dead plants on the benches, seed tins and a hose.
    s.shell(0, 0, {
      w: 6,
      d: 3.6,
      h: 2.3,
      wall: 'glass',
      floor: 'dirt',
      roof: 'glass',
      doors: [{ side: 'w', at: 0, width: 1.1 }],
      noRoom: true,
    })
    for (const z of [-1.1, 1.1]) {
      s.block(0.4, F, z, 4.6, 0.8, 0.7, 'wood')
      for (const x of [-1.2, 0, 1.2, 2.2]) s.deco(x, F + 0.8, z, 0.4, 0.3, 0.4, 'plant')
    }
    s.loot(-0.6, F + 0.85, -1.1, 'kitchen')
    s.loot(1.6, F + 0.85, 1.1, variant % 3 === 0 ? 'medical' : 'kitchen')
    drum(s, -4.2, 1.6, 'metal')
    s.loot(-4.2, 0.95, 1.6, 'fuel')
    if (variant % 2 === 0) corpse(s, 0.4, 0, true, F)
    s.zombie(4.5, -3)
  } else {
    // A pump house over the well, an outhouse, and the generator that ran them.
    s.shell(0, 0, {
      w: 3.4,
      d: 3,
      h: 2.3,
      wall: 'brick',
      floor: 'concrete',
      roof: 'metal',
      doors: [{ side: 's', at: 0.6, width: 1 }],
      noRoom: true,
    })
    s.block(-0.7, F, -0.6, 1, 1, 1, 'metal')
    s.interact(`pump_${poi.key}`, 'water', -0.7, F + 1.1, -0.6, 'Work the pump')
    cabinet(s, 1.1, -0.9, 0.7, 1, 0.6, 'rust', 'fuel')
    s.shell(4.5, 1, {
      w: 1.4,
      d: 1.4,
      h: 2.1,
      wall: 'wood',
      roof: 'shingle',
      doors: [{ side: 's', at: 0, width: 0.8 }],
      noRoom: true,
    })
    s.loot(4.5, F + 0.02, 0.9, 'medical')
    s.block(-3, 0, 0.5, 1.2, 0.8, 0.8, 'rust')
    s.loot(-3, 0.85, 0.5, 'fuel')
    if (variant % 2 === 1) blood(s, 4.5, 2.4, 1, 0.8)
    s.zombie(-2, 4)
  }
}

// --- Campers ------------------------------------------------------------------------------------

const CAMPER_NOTES = [
  "We drove until the gas ran out. Ron says we'll walk to Haven in the morning.\n\nIt's morning. Ron is sitting in the driver's seat and he won't turn round.",
  "Kept the generator running so the kids could watch a movie. Mistake.\n\nThey came to the noise. They're still coming. Don't run anything loud out here.",
  'RENT ME! $40 a night. Ask for Dale.\n\nUnder it: Dale is in the shower block. Do not ask for Dale.',
]

/** A camper on a pull-off: an RV with its awning out, a trailer behind a pickup, or a burnt one. */
export function camper(s: Site, _poi: Poi, variant: number): void {
  const kind = variant % 3
  const burnt = kind === 2
  const LIFT = 0.45
  const rv = s.lifted(LIFT)
  const W = kind === 1 ? 6.5 : 7.5
  rv.shell(0, 0, {
    w: W,
    d: 2.6,
    h: 2.1,
    wall: burnt ? 'asphalt' : 'whiteboard',
    floor: 'carpet',
    ...(burnt ? {} : { roof: 'whiteboard' as const }),
    doors: [{ side: 's', at: -1.6, width: 0.9 }],
    windows: [
      { side: 's', at: 1.4, width: 1.4, height: 0.7, glass: !burnt },
      { side: 'n', at: 0, width: 1.6, height: 0.7, glass: kind === 0 },
      { side: 'w', at: 0, width: 1, height: 0.6, boards: variant % 2 === 1 },
    ],
  })
  s.block(-1.6, 0, 1.75, 1, 0.3, 0.6, 'metal')
  s.deco(0, 0.05, 0, W - 0.2, LIFT, 2.4, 'metal')
  for (const x of [-W / 2 + 1.2, W / 2 - 1.4]) {
    for (const e of [-1, 1]) s.deco(x, 0, e * 1.32, 0.7, 0.7, 0.24, 'asphalt')
  }
  if (!burnt) s.deco(0, LIFT + 1.2, 1.32, W - 0.4, 0.12, 0.03, 'accent')
  if (kind === 0) {
    // The cab at the front (east).
    s.block(W / 2 + 0.8, LIFT, 0, 1.6, 1.4, 2.4, 'whiteboard')
    s.deco(W / 2 + 1.62, LIFT + 0.9, 0, 0.04, 0.5, 2, 'glass')
  } else if (kind === 1) {
    // Hitched to a pickup.
    s.deco(W / 2 + 0.5, 0.35, 0, 1, 0.1, 0.1, 'metal')
    pickupWreck(s.sub(W / 2 + 3.6, 0), variant, 'garage')
  }
  // Inside: the bed at the back, kitchen, a table with benches.
  rv.block(-W / 2 + 1.1, F, 0, 1.8, 0.45, 2.2, 'wood')
  rv.deco(-W / 2 + 1.1, F + 0.45, 0, 1.7, 0.12, 2.1, 'fabricAlt')
  rv.loot(-W / 2 + 1.1, F + 0.6, 0.5, 'bedroom')
  counter(rv, 0.4, -0.95, true, 2, ['kitchen', 'kitchen'])
  rv.block(W / 2 - 1, F, 0.3, 0.8, 0.7, 0.8, 'desk')
  rv.loot(W / 2 - 1, F + 0.75, 0.3, kind === 1 ? 'gun' : 'camp')
  rv.loot(0.6, F + 0.02, 0.6, burnt ? 'garage' : 'medical')
  note(
    rv,
    `camper_note_${variant}`,
    W / 2 - 1.1,
    F + 0.71,
    0.05,
    CAMPER_NOTES[variant % CAMPER_NOTES.length] ?? '',
  )
  if (burnt) {
    for (const x of [-2, 1.5]) decal(rv, x, 0, 1.6, 1.6, 'asphalt', F)
    corpse(rv, -0.8, 0.4, true, F)
  } else {
    // The awning, two chairs, a cold fire, the generator.
    s.deco(0.3, 2.5, 2.4, 3.4, 0.06, 2.2, 'canvas')
    for (const x of [-1.3, 1.9]) s.deco(x, 0, 3.4, 0.05, 2.5, 0.05, 'metal')
    for (const x of [-0.6, 1]) s.block(x, 0, 3.4, 0.5, 0.45, 0.5, 'canvas')
    campfire(s, 0.2, 5.6, false)
    s.block(-W / 2 - 1.2, 0, 1, 0.9, 0.7, 0.6, 'accent')
    s.loot(-W / 2 - 1.2, 0.75, 1, 'fuel')
    if (variant % 3 === 0)
      rv.lantern(0, 2.2, 0.3, 0.4, { color: 0xffc080, intensity: 4, distance: 7, flicker: 0.6 })
    if (variant % 2 === 1) blood(s, -1.6, 3, 1.2, 1)
  }
  crate(s, -W / 2 - 1.2, -1, 0.6, 'camp')
  rv.zombie(0.4, 0.4, F)
  s.zombie(3, 6)
}
