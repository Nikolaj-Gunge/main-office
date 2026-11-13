import type { PlaceWorld, Site } from './kit.ts'
import {
  blood,
  cabinet,
  corpse,
  cot,
  decal,
  desk,
  drum,
  dying,
  fence,
  lampPost,
  logPile,
  note,
  paving,
  pickupWreck,
  pupTent,
  shelving,
} from './places-kit.ts'
import { bed, campfire, counter, crate, FLOOR, stove, table } from './structures.ts'
import type { Poi } from './types.ts'

/**
 * The places out in the trees: fire lookouts, ranger stations, campsites, the rangers' buried
 * caches, the fishing camp at Miller's Lake and St. Agnes' church with its graveyard.
 */

const F = FLOOR

// --- Fire lookouts ----------------------------------------------------------------------------

const TOWER_NOTES = [
  'Day 9. Smoke over Ashford again. Radioed it in. Nobody answers any more.\n\nOne of them has been standing at the bottom of the stairs since dusk. It does not climb. It just waits.',
  "They come when the generator runs, so I've stopped running it.\n\nI count them by their eyes. Eleven tonight. Twelve. They blink out when they look away, and that's worse.",
  "Out of water on day 14. If you're reading this, don't wait up here for rescue. Nobody is coming.\n\nGo down while your legs still work. — R.",
]

/** A diagonal brace across the east or west face of a tower, from bottom to top (local z). */
function brace(s: Site, x: number, y0: number, y1: number, z0: number, z1: number): void {
  const dz = z1 - z0
  const dy = y1 - y0
  const length = Math.hypot(dz, dy)
  // Rotating about x tips a box lying along +z downwards: aim it from (z0, y0) to (z1, y1).
  const tilt = -Math.atan2(dy, dz)
  s.turned(x, (y0 + y1) / 2 - 0.06, (z0 + z1) / 2, 0.1, 0.12, length, 0, 'log', tilt)
}

/** A fire lookout: a cab on stilts, a ramp of stairs up to it and a long view of the dark. */
export function tower(s: Site, _poi: Poi, variant: number): void {
  const H = 6.5
  const half = 2.4
  for (const x of [-half, half]) {
    for (const z of [-half, half]) s.block(x, 0, z, 0.3, H, 0.3, 'log')
    brace(s, x, 0.3, H - 0.4, -half, half)
    brace(s, x, 0.3, H - 0.4, half, -half)
  }
  for (const y of [2.2, 4.4]) {
    for (const z of [-half, half]) s.deco(0, y, z, half * 2, 0.14, 0.14, 'log')
  }
  // The cab: floor, railings, corner posts, a roof.
  s.block(0, H - 0.25, 0, 5.6, 0.25, 5.6, 'wood')
  const c = s.lifted(H)
  c.wall(-2.7, -2.7, 2.7, -2.7, 0, 1.05, 'wood')
  c.wall(-2.7, 2.7, 2.7, 2.7, 0, 1.05, 'wood', [[2.7, 1.6, 0, 2.2]])
  c.wall(-2.7, -2.6, -2.7, 2.6, 0, 1.05, 'wood')
  c.wall(2.7, -2.6, 2.7, 2.6, 0, 1.05, 'wood')
  for (const x of [-2.7, 2.7])
    for (const z of [-2.7, 2.7]) c.block(x, 1.05, z, 0.16, 1.4, 0.16, 'log')
  c.block(0, 2.45, 0, 6.2, 0.2, 6.2, 'shingle')
  c.deco(0, 2.65, 0, 4, 0.45, 4, 'shingle')
  c.deco(0, 3.1, 0, 1.6, 0.35, 1.6, 'shingle')
  // Stairs: one long climb from the south.
  const run = H / Math.tan((35 * Math.PI) / 180)
  s.ramp(0, 0, 2.8 + run, 1.4, run, 35, 'wood')
  for (let z = 4; z < 2.8 + run; z += 2.6) {
    const top = (2.8 + run - z) * Math.tan((35 * Math.PI) / 180)
    for (const e of [-1, 1]) s.deco(e * 0.75, 0, z, 0.1, top + 1, 0.1, 'log')
  }
  // Inside: the fire finder, a cot, a lantern, the watcher's last words.
  c.block(0.9, 0, -0.9, 0.8, 1, 0.8, 'wood')
  c.deco(0.9, 1, -0.9, 0.7, 0.08, 0.7, 'metal')
  c.loot(0.9, 1.1, -0.9, variant === 1 ? 'gun' : 'hunting')
  cot(c, -1.7, -0.6, false)
  c.loot(-1.7, 0.45, -0.2, 'camp')
  c.block(1.9, 0, 1.5, 0.6, 0.5, 0.9, 'wood')
  c.loot(1.9, 0.55, 1.5, variant === 2 ? 'medical' : 'kitchen')
  note(c, `tower_note_${variant}`, -1.7, 0.4, -1.3, TOWER_NOTES[variant % TOWER_NOTES.length] ?? '')
  c.deco(0, 2.2, 0, 0.2, 0.25, 0.2, 'lightpanel')
  c.light(0, 2, 0, { color: 0xffb060, intensity: 7, distance: 9, flicker: 0.5 })
  if (variant !== 1) blood(c, 0.4, 1.4, 1, 0.8)
  // Down below.
  blood(s, 0.3, 3 + run, 1.4, 1.1)
  drum(s, 3.4, -2, 'rust')
  s.loot(3.4, 0.95, -2, 'fuel')
  s.zombie(5, 8)
  s.zombie(-6, -5)
  s.zombie(-4, 9)
}

// --- Ranger stations --------------------------------------------------------------------------

const RANGER_NOTES = [
  'Incident log, Station North-West.\n\nHikers reported "a man standing in the river, not moving". Went to check. He was there. He was still there at dark.\n\nPulled the crew back. Locked the caches. Map is on the board.',
  'To whoever relieves me: the dog will not go outside any more. Neither will I.\n\nCache locations are on the board. Take them. Use them. Do not come back for me.',
  "They don't like the flare gun. They don't like anything loud, except they come to it.\n\nI know that doesn't make sense. Nothing makes sense. The map is on the wall.",
]

/** A log ranger station: an office with the cache map on its wall, a shed and a flagpole. */
export function ranger(s: Site, _poi: Poi, variant: number): void {
  s.shell(0, -4, {
    w: 10,
    d: 7,
    h: 2.8,
    wall: 'log',
    floor: 'wood',
    roof: 'shingle',
    pitch: 1.6,
    doors: [{ side: 's', at: -2.5 }],
    windows: [
      { side: 's', at: 2, glass: variant === 0 },
      { side: 'e', at: 0, boards: true },
      { side: 'w', at: 1, boards: variant !== 2 },
      { side: 'n', at: 3, glass: true },
    ],
  })
  // Porch and steps.
  s.block(-2.5, -0.3, 0.4, 3.2, 0.42, 1.6, 'wood')
  // The map board on the north wall: what Mara wants.
  s.deco(-1.5, F + 1, -7.28, 2.2, 1.3, 0.06, 'whiteboard')
  s.deco(-1.6, F + 1.15, -7.24, 1.4, 0.9, 0.02, 'canvas')
  s.interact(`ranger_map_${variant + 1}`, 'search', -1.5, F + 1.5, -6.8, 'Take the cache map')
  desk(s, 2.6, -6.4, 1.6, 0.8, 'office')
  s.deco(3, F + 0.76, -6.6, 0.5, 0.3, 0.3, 'metal')
  cabinet(s, 4.4, -3.6, 0.6, 1.8, 1.4, 'wood', 'hunting')
  for (const z of [-4, -3.6, -3.2]) s.deco(4.05, F + 0.9, z, 0.05, 1.1, 0.1, 'log')
  cot(s, -3.9, -4.2, false, F)
  s.loot(-3.9, F + 0.45, -4.6, 'camp')
  stove(s, -4.1, -6.6, 0.9, false)
  counter(s, 0.6, -7, true, 1.6, ['kitchen'])
  s.loot(2.2, F + 0.05, -2.2, 'medical')
  note(
    s,
    `ranger_note_${variant}`,
    2.2,
    F + 0.76,
    -6.2,
    RANGER_NOTES[variant % RANGER_NOTES.length] ?? '',
  )
  dying(s, 0, 2.6, -4, 0xffe2b0, 7)
  if (variant !== 0) {
    blood(s, -1.4, -2.8, 1.6, 1.1, F)
    corpse(s, 1.2, -4.6, true, F)
  }
  // Outside: a shed, a flagpole with what's left of the flag, the station truck.
  s.shell(11, -4, {
    w: 4,
    d: 3.4,
    h: 2.3,
    wall: 'wood',
    floor: 'wood',
    roof: 'metal',
    doors: [{ side: 'w', at: 0 }],
    noRoom: true,
  })
  drum(s, 12, -4.8, 'rust')
  s.loot(12, F + 0.95, -4.8, 'fuel')
  crate(s, 12.3, -3, 0.7, 'garage', F)
  s.block(6, 0, 4, 0.14, 8, 0.14, 'metal')
  s.turned(6.7, 6.9, 4, 1.4, 0.8, 0.03, 8, 'canvas')
  pickupWreck(s.sub(-9, 6), variant, 'garage')
  logPile(s, -12, -4, false, 5)
  campfire(s, 6, 9, false)
  lampPost(s, -6, 2, undefined, 0.9)
  s.zombie(-4, 10)
  s.zombie(9, 8)
  s.zombie(1, -4, F)
}

// --- Campsites --------------------------------------------------------------------------------

const CAMP_NOTES = [
  "Ben went for firewood at six. It's past midnight.\n\nSomething keeps walking round the tents. It stops when I stop breathing.",
  'Do NOT light a fire. Do NOT use the torch. They see it from miles away.\n\nI learned that from the Hendersons. The Hendersons are the ones by the creek now.',
  "Mum says we're safe here because nobody knows where we are.\n\nBut the man at the edge of the trees knows. He's been there all day.",
]

/** Somebody's last camping trip: tents, a cold fire, a cooler, and whatever came for them. */
export function campsite(s: Site, poi: Poi, variant: number): void {
  const kind = variant % 3
  campfire(s, 0, 0, false)
  for (const [x, z] of [
    [-1.3, 1.2],
    [1.4, -1.1],
  ] as const) {
    s.block(x, 0, z, 0.55, 0.42, 0.55, 'log')
  }
  pupTent(s, -4, -2.5, true)
  if (kind !== 1) pupTent(s, 4, -3, false)
  else {
    // A tent torn down and dragged.
    s.turned(4, 0.02, -3, 2.8, 0.06, 2.2, 25, 'canvas')
    blood(s, 4.6, -1.5, 1.8, 1.4)
    blood(s, 6, 0.6, 1.2, 1)
  }
  bed(s, -1.4, -1.6, true, variant % 2 === 0 ? `bed_${poi.key}` : undefined, true)
  crate(s, 2.2, 1.6, 0.6, 'camp')
  s.loot(-4, 0.05, -0.6, kind === 2 ? 'pack' : 'camp')
  if (kind === 0) s.loot(3.8, 0.05, -1.4, 'hunting')
  if (kind === 2) pickupWreck(s.sub(1, 5.5), variant, 'camp')
  // A lantern hung on a branch, still trying.
  s.block(-6.5, 0, 2.5, 0.14, 2.1, 0.14, 'log')
  s.deco(-6.2, 1.9, 2.5, 0.2, 0.25, 0.2, 'lightpanel')
  s.light(-6.2, 1.8, 2.5, { color: 0xffb36a, intensity: 6, distance: 8, flicker: 0.8 })
  if (kind === 1) corpse(s, -1.5, 4, true)
  if (variant % 2 === 1)
    note(
      s,
      `campsite_note_${variant}`,
      1.4,
      0.43,
      -1.1,
      CAMP_NOTES[variant % CAMP_NOTES.length] ?? '',
    )
  s.zombie(5, 5)
  s.zombie(-5, 5)
  s.zombie(0, -6)
}

// --- The rangers' caches ----------------------------------------------------------------------

/** A ranger cache: crates under a tarp, a post with a strip of orange paint to find it by. */
export function cache(s: Site, _poi: Poi, variant: number): void {
  s.block(0, 0, 0, 1.2, 0.7, 0.9, 'metal')
  s.loot(0, 0.75, 0, 'cache')
  crate(s, 1.2, 0.6, 0.7, 'cache')
  s.deco(0.5, 0.7, 0.2, 2.4, 0.04, 1.8, 'canvas')
  for (const [x, z] of [
    [-0.7, -0.7],
    [1.8, 1.3],
  ] as const) {
    s.deco(x, 0, z, 0.4, 0.35, 0.4, 'concrete')
  }
  s.block(-1.6, 0, 1, 0.18, 1.6, 0.18, 'log')
  s.deco(-1.6, 1.25, 1, 0.22, 0.2, 0.22, 'accent')
  if (variant % 2 === 0) crate(s, -1, -1.2, 0.6, 'medical')
  else drum(s, -1, -1.2, 'rust')
}

// --- Miller's Lake ----------------------------------------------------------------------------

/** The fishing camp: a bait shack, picnic tables, and a dock out over the black water. */
export function lake(s: Site, poi: Poi, _variant: number, world: PlaceWorld): void {
  // The shack faces the lake (east).
  const b = s.sub(-6, -4, 3)
  b.shell(0, 0, {
    w: 7,
    d: 5,
    h: 2.6,
    wall: 'wood',
    floor: 'wood',
    roof: 'shingle',
    pitch: 1.2,
    doors: [{ side: 's', at: -1.6 }],
    windows: [
      { side: 's', at: 1.6, glass: true },
      { side: 'n', at: 0, boards: true },
    ],
  })
  counter(b, 1.6, -1.9, true, 2.6, ['store', 'kitchen'])
  cabinet(b, -2.9, -1.8, 0.7, 1.7, 0.7, 'whiteboard', 'kitchen')
  shelving(b, -2.9, 0.6, false, 2, ['camp', 'hunting'])
  for (const z of [0.4, 0.7, 1]) b.turned(3.05, F, z, 0.04, 2, 0.04, 0, 'wood', 0.12)
  note(
    b,
    'lake_note',
    1.6,
    F + 0.95,
    -1.6,
    "GONE FISHING. BACK AT 5.\n\nUnderneath, in pencil: The lake is the only quiet place left. They don't come near the water. I don't know why. I'm not going to ask.",
  )
  dying(b, 0, 2.4, 0, 0xffe6b8, 6)
  for (const [x, z] of [
    [6, 6],
    [10, -8],
  ] as const) {
    table(s, x, z, 1.8, 0.9)
    for (const e of [-1, 1]) s.block(x, 0, z + e * 0.85, 1.8, 0.45, 0.3, 'wood')
  }
  // Upturned rowboats on the bank, canoes on a rack.
  s.block(12, 0, 6, 3.6, 0.5, 1.3, 'wood')
  s.deco(12, 0.5, 6, 3.2, 0.12, 1, 'accent')
  s.block(-2, 0, 8, 0.15, 1.6, 0.15, 'wood')
  s.block(2, 0, 8, 0.15, 1.6, 0.15, 'wood')
  s.deco(0, 0.8, 8, 4.6, 0.3, 0.7, 'accent')
  s.deco(0, 1.3, 8, 4.6, 0.3, 0.7, 'platform')
  campfire(s, 8, 1, false)
  pickupWreck(s.sub(-8, 10), 1, 'camp')
  s.zombie(10, 3)
  s.zombie(-12, 6)
  s.zombie(4, -12)

  // The dock: from where the bank meets the water, out past the reeds.
  const water = world.lakes.reduce<(typeof world.lakes)[number] | undefined>((best, l) => {
    const d = Math.hypot(l.x - poi.x, l.z - poi.z)
    return !best || d < Math.hypot(best.x - poi.x, best.z - poi.z) ? l : best
  }, undefined)
  if (!water) return
  const ground = (x: number) => {
    const [wx, , wz] = s.world(x, 0, 0)
    return world.groundAt(wx, wz) - poi.y
  }
  const top = water.y + 0.55 - poi.y
  let start = -1
  for (let x = 0; x < 110; x += 0.5) {
    if (ground(x) <= top) {
      start = x
      break
    }
  }
  if (start < 0) return
  const end = start + 18
  s.block((start + end) / 2, top - 0.2, 0, end - start, 0.2, 2.2, 'wood')
  for (let x = start + 1; x <= end; x += 3) {
    for (const e of [-1, 1]) {
      const g = Math.min(ground(x), top - 0.2) - 1.5
      s.deco(x, g, e * 1.05, 0.2, top - g + 0.6, 0.2, 'log')
    }
  }
  const d = s.lifted(top)
  crate(d, end - 3, 0.7, 0.6, 'camp')
  d.interact('lake_water', 'water', end - 0.6, 0.3, 0, 'Drink from the lake')
  d.block(end - 0.3, 0, -0.9, 0.12, 1.1, 0.12, 'log')
  d.deco(end - 0.3, 1.1, -0.9, 0.2, 0.25, 0.2, 'lightpanel')
  d.light(end - 0.3, 1.2, -0.9, { color: 0xffd28a, intensity: 8, distance: 12, flicker: 0.6 })
  // A rowboat tied at the end, and something floating beside it.
  d.deco(end + 1.4, -0.75, 1.6, 3.6, 0.5, 1.3, 'wood')
  d.deco(end - 4, -0.6, -2.4, 1.7, 0.18, 0.6, 'fabricAlt')
  blood(d, end - 2, 0.4, 1.2, 0.8)
}

// --- St. Agnes' church ------------------------------------------------------------------------

/**
 * A white wooden church on the north side of the road, its graveyard across from it. Father
 * Abel has kept the candles lit; the graves he has been digging are not all filled in.
 */
export function church(s: Site, _poi: Poi, _variant: number): void {
  const c = s.sub(6, -24)
  c.shell(0, 0, {
    w: 10,
    d: 18,
    h: 5,
    wall: 'plaster',
    floor: 'wood',
    roof: 'shingle',
    pitch: 3,
    doors: [{ side: 's', at: 0, width: 1.8 }],
    windows: [
      { side: 'e', at: -5, sill: 2, height: 2.2, glass: true },
      { side: 'e', at: 0, sill: 2, height: 2.2, glass: true },
      { side: 'e', at: 5, sill: 2, height: 2.2, boards: true },
      { side: 'w', at: -5, sill: 2, height: 2.2, boards: true },
      { side: 'w', at: 0, sill: 2, height: 2.2, glass: true },
      { side: 'w', at: 5, sill: 2, height: 2.2, boards: true },
    ],
  })
  // Pews either side of the aisle.
  for (let z = -3; z <= 6; z += 1.5) {
    for (const e of [-1, 1]) {
      c.block(e * 2.55, F, z, 3.4, 0.45, 0.5, 'wood')
      c.deco(e * 2.55, F + 0.45, z + 0.22, 3.4, 0.5, 0.08, 'wood')
    }
  }
  // The altar, candles, a cross.
  c.block(0, F, -6.8, 2.6, 1, 0.9, 'wood')
  c.deco(0, F + 1, -6.8, 2.7, 0.04, 1, 'canvas')
  for (const x of [-1, -0.5, 0.5, 1]) c.deco(x, F + 1.04, -6.9, 0.07, 0.25, 0.07, 'lightpanel')
  c.light(0, F + 1.8, -6.6, { color: 0xffa040, intensity: 16, distance: 15, flicker: 0.35 })
  c.deco(0, F + 1.6, -8.85, 0.22, 2.6, 0.08, 'wood')
  c.deco(0, F + 3.1, -8.85, 1.4, 0.22, 0.08, 'wood')
  for (const x of [-3.6, 3.6]) {
    c.block(x, F, -5.6, 0.4, 1.2, 0.4, 'wood')
    c.deco(x, F + 1.2, -5.6, 0.12, 0.3, 0.12, 'lightpanel')
  }
  c.light(-3.6, F + 1.7, -5.6, { color: 0xff9a40, intensity: 6, distance: 8, flicker: 0.5 })
  c.npc('abel', 'Father Abel', 'priest', 0, -5.6, 180, 7, F)
  // Where he sleeps, what he keeps.
  bed(c, 3.7, -7.6, false, 'bed_church', true)
  c.loot(3.9, F + 0.05, -6.1, 'medical')
  cabinet(c, -4.3, -7.8, 0.6, 1, 1.4, 'wood', 'kitchen')
  c.loot(-4, F + 0.02, -6, 'bedroom')
  note(
    c,
    'church_note',
    -3.6,
    F + 1.22,
    -5.4,
    'Burial register, St. Agnes.\n\nThe last forty names are in a different hand. Beside the last nine: "Buried. Not at rest."',
  )
  // The bodies waiting for him.
  for (const x of [-3, 3]) corpse(c, x, 7.8, true, F)
  blood(c, 0, 7.6, 1.4, 2.4, F)

  // The bell tower beside the door.
  const t = c.sub(7.2, 6.8)
  t.block(0, 0, 0, 3.6, 9, 3.6, 'plaster')
  for (const x of [-1.6, 1.6]) for (const z of [-1.6, 1.6]) t.block(x, 9, z, 0.3, 2.6, 0.3, 'wood')
  t.deco(0, 9.8, 0, 1.1, 1.1, 1.1, 'rust')
  t.block(0, 11.6, 0, 4.2, 0.25, 4.2, 'shingle')
  t.deco(0, 11.85, 0, 2.8, 1.2, 2.8, 'shingle')
  t.deco(0, 13.05, 0, 1.4, 1.6, 1.4, 'shingle')
  t.deco(0, 14.65, 0, 0.1, 1.2, 0.1, 'wood')
  t.deco(0, 15.2, 0, 0.6, 0.1, 0.1, 'wood')
  t.deco(1.82, 6, 0, 0.04, 1.2, 0.8, 'lightpanel')
  t.light(2.5, 6.4, 0, { color: 0xffb070, intensity: 8, distance: 12, flicker: 0.3 })

  // The path to the road, lamps he keeps lit.
  paving(s, 5, -14.9, 7, -2, 'concrete', 0.04)
  lampPost(s, 3, -10, { color: 0xffb36a, intensity: 22, distance: 18, flicker: 0.25 }, 0.9)
  lampPost(s, 9, -10, { color: 0xffb36a, intensity: 22, distance: 18, flicker: 0.25 }, -0.9)

  // The graveyard across the road.
  fence(
    s,
    [
      [-16, 7],
      [-25, 7],
      [-25, 22],
      [-7, 22],
      [-7, 7],
      [-14, 7],
    ],
    'metal',
    1.3,
    2.5,
  )
  for (const z of [10, 13, 16, 19]) {
    for (let x = -23; x <= -9; x += 2.8) {
      if (z === 13 && Math.abs(x + 12) < 1.5) continue
      const n = Math.round(x * 7 + z * 3)
      if (n % 5 === 0) s.turned(x, 0, z, 0.6, 0.85, 0.16, 14 - (n % 3) * 9, 'concrete', 0.18)
      else s.block(x, 0, z, 0.6, 0.6 + (n % 3) * 0.15, 0.18, 'concrete')
      decal(s, x, z + 1.1, 0.9, 1.8, 'dirt')
    }
  }
  // Agnes Voss: the newest stone, the turned earth.
  s.block(-12, 0, 12.6, 0.8, 1.05, 0.22, 'plaster')
  s.deco(-12, 0, 14.3, 1, 0.22, 2, 'dirt')
  s.deco(-11.2, 0.22, 14.6, 0.25, 0.04, 0.25, 'accent')
  s.label(-12, 1.6, 12.6, 'AGNES VOSS')
  s.interact('church_grave', 'search', -12, 0.4, 14.3, 'Dig at the grave')
  // Open graves.
  for (const [x, z] of [
    [-20.2, 19],
    [-14.6, 19],
    [-17.4, 10],
  ] as const) {
    s.deco(x, -0.15, z + 1.1, 0.95, 0.17, 1.9, 'asphalt')
    s.deco(x + 1, 0, z + 1.1, 0.7, 0.5, 1.6, 'dirt')
  }
  s.turned(-15.6, 0, 20.1, 0.06, 1.4, 0.06, 0, 'wood', 0.25)
  // A dead oak over it all.
  s.block(-22, 0, 9, 0.9, 6, 0.9, 'log')
  s.turned(-21, 4.6, 9, 4, 0.3, 0.3, 30, 'log', 0.4)
  s.turned(-22.8, 5.2, 9.6, 3, 0.25, 0.25, -50, 'log', -0.3)
  s.deco(-9.5, 0.7, 7.2, 0.18, 0.18, 0.18, 'lightpanel')
  s.light(-9.5, 0.9, 7.6, { color: 0xff9a40, intensity: 5, distance: 7, flicker: 0.6 })
  // The dead of the parish.
  for (const [x, z] of [
    [-18.8, 14.5],
    [-10, 18],
    [-21.6, 17.2],
    [-13, 9],
    [-4, 12],
    [18, -6],
    [16, -30],
    [-6, -20],
    [-30, 0],
  ] as const) {
    s.zombie(x, z)
  }
}
