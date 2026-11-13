import type { MaterialId } from '../maps/types.ts'
import type { LootTable } from './items.ts'
import type { Site } from './kit.ts'

/**
 * Furniture and the smaller places of the survival world (cabins, the start, the survivor camp).
 * Everything stands on its site's ground (y = 0); building floors are 0.12 m above that.
 */

/** Height of a building's floor above the ground. */
export const FLOOR = 0.12

/** A table with something on it. */
export function table(s: Site, x: number, z: number, w = 1.4, d = 0.8, loot?: LootTable): void {
  s.block(x, FLOOR + 0.72, z, w, 0.06, d, 'desk')
  for (const [dx, dz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    s.deco(x + dx * (w / 2 - 0.08), FLOOR, z + dz * (d / 2 - 0.08), 0.07, 0.72, 0.07, 'wood')
  }
  s.block(x, FLOOR, z, w - 0.1, 0.72, d - 0.1, 'wood', { render: false })
  if (loot) s.loot(x, FLOOR + 0.8, z, loot)
}

/** A bed (or a sleeping bag on the floor): `key` makes it one you can sleep in. */
export function bed(s: Site, x: number, z: number, alongX: boolean, key?: string, bag = false): void {
  const [w, d] = alongX ? [2, 0.95] : [0.95, 2]
  if (bag) s.deco(x, FLOOR, z, w, 0.1, d * 0.75, 'fabric')
  else {
    s.block(x, FLOOR, z, w, 0.35, d, 'wood')
    s.deco(x, FLOOR + 0.35, z, w - 0.06, 0.14, d - 0.06, 'fabricAlt')
    s.deco(alongX ? x - w / 2 + 0.25 : x, FLOOR + 0.49, alongX ? z : z - d / 2 + 0.25, alongX ? 0.4 : 0.7, 0.1, alongX ? 0.7 : 0.4, 'plaster')
  }
  if (key) s.interact(key, 'bed', x, FLOOR + 0.5, z, 'Sleep')
}

/** Shelves against a wall: `side` is the wall they stand at, so loot faces into the room. */
export function shelf(s: Site, x: number, z: number, alongX: boolean, loot: LootTable[] = [], material: MaterialId = 'wood'): void {
  const [w, d] = alongX ? [1.6, 0.4] : [0.4, 1.6]
  s.block(x, FLOOR, z, w, 1.8, d, material, { render: false })
  for (const y of [0.05, 0.6, 1.15, 1.7]) s.deco(x, FLOOR + y, z, w, 0.05, d, material)
  for (const e of [-1, 1]) {
    s.deco(alongX ? x + e * (w / 2 - 0.03) : x, FLOOR, alongX ? z : z + e * (d / 2 - 0.03), alongX ? 0.05 : d, 1.8, alongX ? d : 0.05, material)
  }
  loot.forEach((t, i) => {
    const y = [0.68, 1.23, 0.13][i % 3] as number
    const off = (i % 2 === 0 ? -1 : 1) * 0.35
    s.loot(alongX ? x + off : x, FLOOR + y, alongX ? z : z + off, t)
  })
}

/** A wooden crate; loot lies on top. */
export function crate(s: Site, x: number, z: number, size = 0.8, loot?: LootTable, y = 0): void {
  s.block(x, y, z, size, size, size, 'cover')
  if (loot) s.loot(x, y + size + 0.05, z, loot)
}

/** A kitchen counter with a cupboard above. */
export function counter(s: Site, x: number, z: number, alongX: boolean, length = 2, loot: LootTable[] = ['kitchen']): void {
  const [w, d] = alongX ? [length, 0.6] : [0.6, length]
  s.block(x, FLOOR, z, w, 0.9, d, 'desk')
  s.deco(x, FLOOR + 0.9, z, w + 0.04, 0.04, d + 0.04, 'concrete')
  loot.forEach((t, i) => {
    const off = (i - (loot.length - 1) / 2) * 0.7
    s.loot(alongX ? x + off : x, FLOOR + 1, alongX ? z : z + off, t)
  })
}

/** A wood stove with a glowing door and a pipe through the roof. */
export function stove(s: Site, x: number, z: number, h: number, lit: boolean): void {
  s.block(x, FLOOR, z, 0.7, 0.8, 0.6, 'metal')
  s.deco(x, FLOOR + 0.8, z, 0.16, h - 0.8, 0.16, 'metal')
  if (lit) {
    s.deco(x, FLOOR + 0.25, z + 0.31, 0.3, 0.22, 0.02, 'lightpanel')
    s.light(x, FLOOR + 0.6, z + 0.8, { color: 0xff7a30, intensity: 9, distance: 8, flicker: 0.35 })
  }
}

/** A campfire: stones, logs and (if lit) a flickering light. */
export function campfire(s: Site, x: number, z: number, lit = true): void {
  for (const [dx, dz] of [
    [0.45, 0],
    [-0.45, 0],
    [0, 0.45],
    [0, -0.45],
    [0.32, 0.32],
    [-0.32, 0.32],
    [0.32, -0.32],
    [-0.32, -0.32],
  ] as const) {
    s.deco(x + dx, 0, z + dz, 0.22, 0.16, 0.22, 'concrete')
  }
  s.turned(x, 0.02, z, 0.7, 0.12, 0.12, 30, 'wood')
  s.turned(x, 0.1, z, 0.7, 0.12, 0.12, -40, 'wood')
  if (lit) {
    s.deco(x, 0.16, z, 0.22, 0.3, 0.22, 'lightpanel')
    s.light(x, 1, z, { color: 0xff7a2a, intensity: 26, distance: 16, flicker: 0.45 })
  }
}

/** A hunter's or hermit's cabin in the woods: one room, a porch, things left behind. */
export function cabin(s: Site, variant: number): void {
  const w = 6 + (variant % 2) * 1.5
  const d = 5
  s.shell(0, 0, {
    w,
    d,
    h: 2.5,
    wall: 'log',
    floor: 'wood',
    roof: 'shingle',
    pitch: 1.4,
    doors: [{ side: 's', at: -w / 4 }],
    windows: [
      { side: 's', at: w / 4, boards: variant % 3 === 0 },
      { side: 'e', at: 0, glass: variant % 3 === 1 },
      { side: 'n', at: -w / 4, boards: variant % 2 === 0 },
    ],
  })
  // Porch.
  s.block(-w / 4, -0.3, d / 2 + 0.8, 2.4, 0.36, 1.6, 'wood')
  s.deco(-w / 4 - 1.1, 0.06, d / 2 + 1.5, 0.12, 2.3, 0.12, 'log')
  s.deco(-w / 4 + 1.1, 0.06, d / 2 + 1.5, 0.12, 2.3, 0.12, 'log')
  s.deco(-w / 4, 2.36, d / 2 + 0.9, 2.6, 0.1, 1.9, 'shingle')

  bed(s, w / 2 - 1.25, -d / 2 + 0.75, true, `bed_${s.poi.key}`, variant % 4 === 3)
  stove(s, -w / 2 + 0.7, -d / 2 + 0.6, 2.5, variant % 5 === 0)
  table(s, 0.3, 0.4, 1.4, 0.8, variant % 2 === 0 ? 'kitchen' : 'camp')
  shelf(s, -w / 2 + 0.45, 0.6, false, variant % 2 === 0 ? ['kitchen', 'hunting'] : ['camp', 'garage'])
  crate(s, w / 2 - 0.7, d / 2 - 0.75, 0.7, (['hunting', 'bedroom', 'medical', 'gun', 'melee'] as const)[variant % 5])
  s.loot(w / 2 - 1.2, FLOOR + 0.02, -d / 2 + 1.7, 'bedroom')
  if (variant % 5 !== 0) s.light(0, 2.1, 0, { color: 0xffb060, intensity: variant % 2 ? 5 : 0, distance: 7, flicker: 0.5 })
  // Outside: a woodpile, a chopping block, maybe an outhouse.
  s.block(w / 2 + 0.9, 0, -0.5, 0.8, 0.9, 2, 'log')
  s.block(-w / 2 - 1.6, 0, 1.5, 0.5, 0.45, 0.5, 'log')
  if (variant % 3 === 0) {
    s.sub(-w / 2 - 4, -3).shell(0, 0, { w: 1.4, d: 1.4, h: 2.1, wall: 'wood', roof: 'shingle', doors: [{ side: 'e', at: 0, width: 0.9 }], noRoom: true })
  }
  s.zombie(2.5, d / 2 + 4)
  if (variant % 2 === 0) s.zombie(-w / 2 - 3, -1)
}

/** Where you wake up: a cabin with a note on the table. */
export function startCabin(s: Site): void {
  s.shell(0, 0, {
    w: 7,
    d: 5,
    h: 2.5,
    wall: 'log',
    floor: 'wood',
    roof: 'shingle',
    pitch: 1.4,
    doors: [{ side: 'n', at: 1.5 }],
    windows: [
      { side: 'n', at: -1.5, boards: true },
      { side: 'e', at: 0, boards: true },
      { side: 'w', at: 0, boards: true },
    ],
  })
  bed(s, -2.3, 1.6, true, 'bed_start')
  stove(s, 2.8, 1.8, 2.5, true)
  table(s, 0.2, -0.3)
  s.deco(0.2, FLOOR + 0.79, -0.3, 0.3, 0.01, 0.22, 'whiteboard')
  s.interact(
    'start_note',
    'note',
    0.2,
    FLOOR + 0.85,
    -0.3,
    'Read the note',
    "If you're reading this, I didn't make it back.\n\nFollow the road NORTH to Haven. They'll take you in if you pull your weight.\n\nTake the pistol. Twelve rounds is all there is, so don't waste them on the slow ones — and don't use the torch unless you have to. They see it.\n\nDon't sleep outside the walls.\n— Hollis",
  )
  shelf(s, -3.05, -1.2, false, ['kitchen', 'kitchen'])
  crate(s, 2.7, -1.7, 0.7, 'medical')
  s.light(0, 2.1, 0.5, { color: 0xffb060, intensity: 6, distance: 8, flicker: 0.3 })
  campfire(s, 3, -6, false)
}

/**
 * Haven, the survivor camp: a palisade with one gate, tents and huts, a fire in the middle, and
 * the people you trade and talk with. The dead never get in.
 */
export function haven(s: Site): void {
  const R = 30
  // Palisade: log walls on four sides, a gate to the north (towards the road).
  const gate = 5
  s.wall(-R, -R, -gate / 2, -R, 0, 3.4, 'log')
  s.wall(gate / 2, -R, R, -R, 0, 3.4, 'log')
  s.wall(-R, R, R, R, 0, 3.4, 'log')
  s.wall(-R, -R, -R, R, 0, 3.4, 'log')
  s.wall(R, -R, R, R, 0, 3.4, 'log')
  // Gate posts, a walkway over it and two watch lights.
  for (const e of [-1, 1]) {
    s.block(e * (gate / 2 + 0.3), 0, -R, 0.6, 4.6, 0.6, 'log')
    s.light(e * (gate / 2 + 0.3), 4.2, -R - 1.5, { color: 0xffd9a0, intensity: 30, distance: 22 })
    s.deco(e * (gate / 2 + 0.3), 4.6, -R, 0.3, 0.25, 0.3, 'lightpanel')
  }
  s.block(0, 3.6, -R, gate + 1.8, 0.2, 1.2, 'wood')
  s.label(0, 5.2, -R, 'HAVEN')
  s.npc('ortiz', 'Ortiz', 'guard', gate / 2 + 1.6, -R + 2, 0, 5)

  // The fire, and logs to sit on.
  campfire(s, 0, 2)
  for (const [x, z, deg] of [
    [2.6, 2, 90],
    [-2.6, 2, 90],
    [0, 4.6, 0],
  ] as const) {
    s.turned(x, 0, z, 2, 0.35, 0.4, deg, 'log')
  }
  s.npc('mara', 'Mara', 'leader', 0, -1.2, 0, 3)

  // Trader's stall (east): a roofed counter with crates behind.
  const stall = s.sub(17, -6, 1)
  stall.block(0, 0, 0, 5, 1, 0.8, 'wood')
  stall.block(-2.4, 0, 1.6, 0.2, 2.6, 0.2, 'log').block(2.4, 0, 1.6, 0.2, 2.6, 0.2, 'log')
  stall.block(-2.4, 0, -1.2, 0.2, 2.6, 0.2, 'log').block(2.4, 0, -1.2, 0.2, 2.6, 0.2, 'log')
  stall.deco(0, 2.6, 0.2, 5.6, 0.12, 3.6, 'canvas')
  crate(stall, -1.6, 1.3, 0.8)
  crate(stall, -0.7, 1.4, 0.7)
  crate(stall, 1.5, 1.3, 0.9)
  stall.light(0, 2.3, 0, { color: 0xffc880, intensity: 12, distance: 9 })
  stall.npc('gus', 'Gus', 'trader', 0, 0.9, 0, 4)
  stall.label(0, 3.2, 0, 'TRADE')

  // Infirmary (west): a hut with beds.
  const clinic = s.sub(-18, -4)
  clinic.shell(0, 0, {
    w: 8,
    d: 6,
    h: 2.6,
    wall: 'wood',
    floor: 'wood',
    roof: 'canvas',
    doors: [{ side: 'e', at: 0 }],
    windows: [{ side: 's', at: 0 }],
    noRoom: true,
  })
  bed(clinic, -2.6, -1.9, true)
  bed(clinic, -2.6, 1.9, true)
  shelf(clinic, 0.5, -2.6, true, [], 'metal')
  clinic.light(0, 2.2, 0, { color: 0xdfe8ff, intensity: 10, distance: 9 })
  clinic.npc('lena', 'Lena', 'medic', 1.6, 0.4, -90, 8)
  clinic.label(4.3, 3.1, 0, 'INFIRMARY')

  // Bunkhouse (south-west): where you sleep.
  const bunks = s.sub(-16, 16)
  bunks.shell(0, 0, {
    w: 10,
    d: 6,
    h: 2.6,
    wall: 'log',
    floor: 'wood',
    roof: 'shingle',
    pitch: 1.2,
    doors: [{ side: 'n', at: 2 }],
    windows: [{ side: 'n', at: -2.5 }],
    noRoom: true,
  })
  bed(bunks, -3.7, 1.9, true, 'bed_haven_1')
  bed(bunks, -0.9, 1.9, true, 'bed_haven_2')
  bed(bunks, 3.4, 1.9, true, 'bed_haven_3')
  bed(bunks, -3.7, -1.9, true, 'bed_haven_4')
  bunks.light(0, 2.2, 0, { color: 0xffb870, intensity: 8, distance: 9 })
  bunks.label(2, 3.4, -3.2, 'BUNKHOUSE')

  // Workshop (south-east): Ray's generator and bench.
  const shop = s.sub(16, 15)
  shop.shell(0, 0, {
    w: 8,
    d: 6,
    h: 2.8,
    wall: 'rust',
    floor: 'concrete',
    roof: 'rust',
    doors: [{ side: 'n', at: 0, width: 2.6 }],
    noRoom: true,
  })
  shop.block(-2.6, FLOOR, 2.3, 2.4, 0.9, 0.8, 'metal')
  shop.block(2.6, FLOOR, 1.8, 1.4, 1.1, 1.6, 'rack')
  shop.light(0, 2.4, 0, { color: 0xfff0c0, intensity: 12, distance: 10, flicker: 0.15 })
  shop.npc('ray', 'Ray', 'mechanic', -1.5, 1, 0, 6)
  shop.label(0, 3.5, -3.2, 'WORKSHOP')

  // Kitchen tent (north-west) and the water barrels.
  const kitchen = s.sub(-12, -18)
  kitchen.block(-2.5, 0, -2, 0.15, 2.4, 0.15, 'log').block(2.5, 0, -2, 0.15, 2.4, 0.15, 'log')
  kitchen.block(-2.5, 0, 2, 0.15, 2.4, 0.15, 'log').block(2.5, 0, 2, 0.15, 2.4, 0.15, 'log')
  kitchen.deco(0, 2.4, 0, 5.6, 0.1, 4.6, 'canvas')
  kitchen.block(0, 0, -1.2, 3, 0.9, 0.7, 'wood')
  kitchen.block(1.9, 0, 1.2, 0.7, 1, 0.7, 'metal')
  kitchen.block(-1.9, 0, 1.3, 0.6, 0.95, 0.6, 'platform')
  kitchen.interact('haven_water', 'water', -1.9, 1.1, 1.3, 'Drink')
  kitchen.light(0, 2.1, 0, { color: 0xffc880, intensity: 9, distance: 8 })
  kitchen.npc('dot', 'Dot', 'cook', 0, -0.2, 180, 10)

  // Tom the hunter by the east wall, Sam the kid by the fire.
  s.npc('tom', 'Tom', 'hunter', 12, 6, 90, 2)
  s.block(13.5, 0, 6, 0.9, 0.9, 1.6, 'cover')
  s.npc('sam', 'Sam', 'kid', -3, 4.4, 180, 1)

  // Tents along the north wall.
  for (const x of [8, 14, 20]) {
    s.deco(x, 0, -22, 3, 0.05, 3.4, 'canvas')
    for (let i = 0; i < 4; i++) {
      s.deco(x, 0.05 + i * 0.4, -22, 3 * (1 - i / 4.5), 0.4, 3.4, 'canvas')
    }
  }
  // Lamp posts in the corners.
  for (const [x, z] of [
    [-24, -24],
    [24, -24],
    [-24, 24],
    [24, 24],
  ] as const) {
    s.block(x, 0, z, 0.2, 3.6, 0.2, 'log')
    s.deco(x, 3.6, z, 0.4, 0.3, 0.4, 'lightpanel')
    s.light(x, 3.4, z, { color: 0xffd9a0, intensity: 22, distance: 20 })
  }
}
