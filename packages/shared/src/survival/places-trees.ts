import { DECO, type Site } from './kit.ts'
import { blood, corpse, decal, dying, note, pupTent } from './places-kit.ts'
import { bed, campfire, crate, FLOOR } from './structures.ts'
import type { Poi } from './types.ts'

/**
 * Up in the trees: treehouses (a kids' fort, a two-tree hideout with a rope bridge, an old one
 * gone to rot) and hunting stands. Every climb starts on the ground south of its platform and
 * goes north (−z): plank stairs, a ladder, or a pile of crates to scramble up (jump and climb). `treehouseClimb` / `standClimb` say where, for the tests.
 */

const F = FLOOR

/** Where a climb starts (local x, z, on the ground, facing −z) and the height it gets you to. */
export interface Climb {
  x: number
  z: number
  top: number
}

const deg = (d: number) => (d * Math.PI) / 180

/** A ramp from the ground up to `top` at `edge` (local z), climbing north at `angle`. */
function stairs(
  s: Site,
  x: number,
  edge: number,
  top: number,
  width: number,
  angle: number,
): number {
  const run = top / Math.tan(deg(angle))
  s.ramp(x, 0, edge + run, width, run, angle, 'wood')
  return edge + run
}

/** Plank stairs climb at this angle. */
const STAIR_ANGLE = 36
/** Ladders lean at this angle: as steep as the feet can still take (see maxSlopeDeg). */
const LADDER_ANGLE = 42

/**
 * A ladder from the ground up to `top` at `edge` (local z), leaning north: rails and rungs to
 * look at, and under them a steep ramp you can't see that does the climbing. Returns where its
 * foot is (local z).
 */
function ladder(s: Site, x: number, edge: number, top: number, width = 0.7): number {
  const a = deg(LADDER_ANGLE)
  const run = top / Math.tan(a)
  const foot = edge + run
  s.ramp(x, 0, foot, width, run, LADDER_ANGLE, 'wood', -1, { render: false })
  for (const e of [-1, 1]) {
    s.ramp(x + e * (width / 2 - 0.04), 0.12, foot, 0.08, run, LADDER_ANGLE, 'log', -1, DECO, 0.1)
  }
  for (let y = 0.3; y < top - 0.1; y += 0.32) {
    s.deco(x, y + 0.04, edge + (top - y) / Math.tan(a), width - 0.1, 0.05, 0.06, 'wood')
  }
  return foot
}

/** Handrail posts either side of a ramp. */
function stairPosts(
  s: Site,
  x: number,
  edge: number,
  foot: number,
  top: number,
  width: number,
): void {
  const run = foot - edge
  for (let z = edge + 1.2; z < foot - 0.4; z += 1.8) {
    const h = ((foot - z) / run) * top
    for (const e of [-1, 1]) s.deco(x + e * (width / 2 + 0.06), 0, z, 0.08, h + 0.95, 0.08, 'log')
  }
}

/**
 * A big old tree: a trunk you bump into, a crown of dark boxes. The crown is drawn only (you see
 * the platform through gaps in it, and it never gets in the way).
 */
function bigTree(s: Site, x: number, z: number, height: number, girth = 1.2): void {
  s.deco(x, 0, z, girth + 0.5, 0.5, girth + 0.5, 'log')
  s.block(x, 0, z, girth, height, girth, 'log')
  s.deco(x, height, z, girth * 0.7, 5, girth * 0.7, 'log')
  // Branches reaching out (flat, so they look right whichever way the site is turned).
  s.turned(x, height - 1.4, z, 0.3, 0.3, 4.2, 35, 'log')
  s.turned(x, height + 1.2, z, 0.25, 0.25, 3.6, -50, 'log')
  for (const [dx, y, dz, w, h, d] of [
    [0, height + 1.8, 0, 6.5, 2.4, 6],
    [0.8, height + 3.8, -0.6, 4.8, 2.2, 4.6],
    [-0.4, height + 5.6, 0.4, 2.8, 2, 3],
  ] as const) {
    s.deco(x + dx, y, z + dz, w, h, d, 'grass')
  }
  s.turned(x - 1.2, height + 2.6, z + 1.4, 3.4, 1.6, 3, 30, 'grass')
}

/** The deck of a platform: boards, a rim joist (to grab when climbing) and railings with gaps. */
function deck(
  s: Site,
  cx: number,
  cz: number,
  w: number,
  d: number,
  top: number,
  gaps: { side: 'n' | 's' | 'e' | 'w'; at: number; width: number }[],
  rail = 1,
): void {
  s.block(cx, top - 0.25, cz, w, 0.25, d, 'wood')
  // The joist round the edge, under the boards.
  s.block(cx, top - 0.55, cz - d / 2 + 0.08, w, 0.3, 0.16, 'wood')
  s.block(cx, top - 0.55, cz + d / 2 - 0.08, w, 0.3, 0.16, 'wood')
  const c = s.lifted(top)
  const sides = [
    ['n', cx - w / 2, cz - d / 2, cx + w / 2, cz - d / 2],
    ['s', cx - w / 2, cz + d / 2, cx + w / 2, cz + d / 2],
    ['w', cx - w / 2, cz - d / 2 + 0.2, cx - w / 2, cz + d / 2 - 0.2],
    ['e', cx + w / 2, cz - d / 2 + 0.2, cx + w / 2, cz + d / 2 - 0.2],
  ] as const
  for (const [side, x0, z0, x1, z1] of sides) {
    const alongX = side === 'n' || side === 's'
    const start = alongX ? x0 : z0
    const holes = gaps
      .filter((g) => g.side === side)
      .map((g): [number, number, number, number] => [g.at - start, g.width, 0, 3])
    c.wall(x0, z0, x1, z1, 0, rail, 'wood', holes)
  }
}

// --- Treehouses -------------------------------------------------------------------------------

const TREEHOUSE_NOTES = [
  'CLUB RULES\n1. No grown-ups.\n2. No grown-ups EVEN IF THEY KNOCK.\n3. Password is "badger".\n\nUnderneath, messier: Dad knocked. He did not know the password. I did not open.',
  "Day 6 up here. They can't do stairs very well, but they try. They try all night.\n\nThe ladder creaks when one gets halfway. That's how I sleep now: one ear on the ladder.",
  "Mikey says the man under the tree is his uncle and we should let him up.\n\nHis uncle has been standing there since Tuesday. He hasn't blinked. Not once.",
  'If you find this, the cans are in the box and the water is gone. I went to find my mum.\n\nI took the torch. Sorry. — Lucy, age 11',
]

/** How you get up each kind of treehouse: 0 stairs, 1 a ladder, 2 a pile of crates. */
const TREEHOUSE_HEIGHT = [3.6, 4.6, 3]

/** The hideout (kind 1) is shifted west so it and its second tree are centred on the site. */
const HIDEOUT_SHIFT = -4

export function treehouseClimb(variant: number): Climb {
  const kind = variant % 3
  const top = TREEHOUSE_HEIGHT[kind] as number
  const half = PLATFORM_D / 2
  if (kind === 2) return { x: CLIMB_X, z: half + 2.6, top }
  const angle = kind === 0 ? STAIR_ANGLE : LADDER_ANGLE
  const x = kind === 1 ? CLIMB_X + HIDEOUT_SHIFT : CLIMB_X
  return { x, z: half + top / Math.tan(deg(angle)) + 1, top }
}

const PLATFORM_W = 7
const PLATFORM_D = 5.5
const CLIMB_X = 2.3

/**
 * A treehouse in a big tree: a deck round the trunk, a hut on it with something worth the climb,
 * and a way up from the south. One in three is a hideout with a rope bridge to a second tree;
 * one in three has rotted, and you scramble up a pile of crates to get in.
 */
export function treehouse(s: Site, poi: Poi, variant: number): void {
  const kind = variant % 3
  const H = TREEHOUSE_HEIGHT[kind] as number
  // The hideout's second tree is to the east: shift everything so the pair is centred.
  const t = kind === 1 ? s.sub(HIDEOUT_SHIFT, 0) : s
  const half = PLATFORM_D / 2
  bigTree(t, -2.2, 0, H + 2.5 + (variant % 2), 1.2)
  for (const e of [-1, 1])
    t.block(PLATFORM_W / 2 - 0.2, 0, e * (half - 0.2), 0.22, H - 0.25, 0.22, 'log')
  deck(t, 0, 0, PLATFORM_W, PLATFORM_D, H, [
    { side: 's', at: CLIMB_X, width: 1.3 },
    ...(kind === 1 ? [{ side: 'e' as const, at: 0, width: 1.2 }] : []),
  ])
  const c = t.lifted(H)
  // The hut.
  c.shell(1, -0.75, {
    w: 3.6,
    d: 3.2,
    h: 2.1,
    wall: kind === 2 ? 'rust' : 'wood',
    floor: 'wood',
    ...(kind === 2 ? {} : { roof: 'shingle' as const, pitch: 0.9 }),
    doors: [{ side: 's', at: -0.6, width: 1 }],
    windows: [
      { side: 'e', at: 0, width: 0.8, height: 0.7, boards: variant % 4 === 1 },
      { side: 'n', at: 0.6, width: 0.8, height: 0.7, glass: kind === 0 },
    ],
    noRoom: true,
  })
  const inside = { x: 1, z: -0.75 }
  // What's in it.
  bed(c, inside.x + 0.5, inside.z - 0.6, true, undefined, true)
  crate(c, inside.x - 1.2, inside.z - 0.9, 0.6, kind === 1 ? 'cache' : 'bedroom', F)
  c.loot(inside.x + 1.1, F + 0.02, inside.z + 0.8, kind === 0 ? 'kitchen' : 'camp')
  c.loot(-1.6, 0.02, 1.9, (['pack', 'hunting', 'bedroom'] as const)[variant % 3] ?? 'pack')
  note(
    c,
    `treehouse_note_${variant}`,
    inside.x + 0.2,
    F + 0.01,
    inside.z + 0.3,
    TREEHOUSE_NOTES[variant % TREEHOUSE_NOTES.length] ?? '',
  )
  // Drawings taped up inside (kids'), or tally marks (somebody counting nights).
  for (let i = 0; i < 3; i++) {
    c.deco(
      inside.x - 0.9 + i * 0.6,
      F + 1.2 + (i % 2) * 0.2,
      inside.z - 1.38,
      0.38,
      0.3,
      0.02,
      i % 2 ? 'accent' : 'whiteboard',
    )
  }
  if (variant % 4 === 2) dying(c, inside.x, 1.9, inside.z, 0xffc070, 5)

  if (kind === 0) {
    stairPosts(t, CLIMB_X, half, stairs(t, CLIMB_X, half, H, 1.1, STAIR_ANGLE), H, 1.1)
    // A sign on the rail, a tire swing on a low branch, a bike dropped in the leaves.
    c.deco(-1.5, 0.3, half + 0.12, 1.4, 0.5, 0.04, 'accent')
    c.label(-1.5, 1.2, half + 0.2, 'KEEP OUT')
    t.deco(-2.8, 1.2, 2, 0.05, H - 1.45, 0.05, 'canvas')
    t.deco(-2.8, 0.6, 2, 0.7, 0.6, 0.22, 'asphalt')
    t.turned(-1, 0, 5.5, 1.6, 0.5, 0.08, 20, 'accent')
  } else if (kind === 1) {
    // A ladder nailed together from branches.
    ladder(t, CLIMB_X, half, H, 0.8)
    // The bridge to the second tree and its little platform.
    const far = 11
    bigTree(t, far + 0.8, -0.8, H + 2, 0.9)
    deck(t, far, 0, 3.2, 3.2, H, [{ side: 'w', at: 0, width: 1.2 }])
    const from = PLATFORM_W / 2
    const to = far - 1.6
    t.block((from + to) / 2, H - 0.2, 0, to - from, 0.2, 1, 'wood')
    for (const e of [-1, 1]) {
      c.deco((from + to) / 2, 0.9, e * 0.55, to - from, 0.05, 0.05, 'canvas')
      for (let x = from + 1; x < to; x += 1.5) c.deco(x, 0, e * 0.55, 0.04, 0.9, 0.04, 'canvas')
    }
    const p = c.sub(far, 0)
    bed(p, -0.5, 0.7, true, `bed_${poi.key}`, true)
    crate(p, 0.9, 0.9, 0.6, 'hunting')
    p.loot(-0.9, 0.02, 0.9, 'medical')
    p.deco(0.8, 2.6, -0.2, 0.1, 0.1, 1.3, 'log')
    if (variant % 2)
      p.lantern(0.8, 2.6, 0.4, 0.6, { color: 0xffb060, intensity: 5, distance: 8, flicker: 0.5 })
  } else {
    // Gone to rot: the roof fell in long ago. Crates stacked to get up.
    crate(t, CLIMB_X, half + 1.4, 0.8)
    t.block(CLIMB_X, 0, half + 0.5, 1, 1.6, 1, 'cover')
    for (const [x, z, a] of [
      [-0.6, -2, 15],
      [2, 0.6, -30],
    ] as const) {
      c.turned(x, F, z, 2.6, 0.08, 0.25, a, 'shingle')
    }
    decal(c, 0.5, 1.6, 1.4, 1, 'asphalt')
    blood(t, CLIMB_X + 0.8, half + 3, 1.2, 0.9)
  }

  // On the ground: what came looking.
  if (variant % 2 === 1) blood(t, 0.4, half + 1.5, 1.1, 0.8)
  if (variant % 5 === 3) corpse(t, -3.4, 3.6, true)
  if (poi.danger > 0) t.zombie(-5, 4.5)
}

// --- Hunting stands ---------------------------------------------------------------------------

const STAND_NOTES = [
  "Opening day. Saw a buck at dawn, then a man walking through the field on all fours.\n\nThey can't climb. They can't climb. But they can wait, and so far they're better at it.",
  'Sat here 3 days. Count: 14 walking east. 2 walking west. 1 standing under me.\n\nIf the one under me is still there tomorrow, I am going to jump and run.',
  'Note to self: the bait pile works on them too.',
]

const STAND_HEIGHT = [3.2, 2.8, 0]

/** Where a stand's ladder starts (the ground blind, kind 2, has none). */
export function standClimb(variant: number): Climb {
  const kind = variant % 3
  const top = (STAND_HEIGHT[kind] as number) + (kind === 1 ? F : 0)
  const edge = kind === 1 ? 1.2 : 0.95
  return { x: 0, z: edge + top / Math.tan(deg(LADDER_ANGLE)) + 1, top }
}

/** A hunting stand at the edge of the trees: a ladder stand, a box blind, or a ground blind. */
export function stand(s: Site, _poi: Poi, variant: number): void {
  const kind = variant % 3
  const H = STAND_HEIGHT[kind] as number
  if (kind === 0) {
    // A ladder stand: four poles, a platform, a rail and a seat.
    for (const x of [-0.85, 0.85]) {
      for (const z of [-0.85, 0.85]) s.block(x, 0, z, 0.14, H + 2.1, 0.14, 'log')
    }
    deck(s, 0, 0, 1.9, 1.9, H, [{ side: 's', at: 0, width: 0.9 }], 0.9)
    ladder(s, 0, 0.95, H)
    const c = s.lifted(H)
    c.block(0, 0, -0.6, 1.2, 0.45, 0.45, 'wood')
    c.loot(0, 0.5, -0.6, 'hunting')
    c.loot(-0.5, 0.02, 0.2, variant % 4 === 0 ? 'gun' : 'camp')
    c.deco(0, 2.1, 0, 2.2, 0.06, 2.2, 'canvas')
    if (variant % 2 === 0) corpse(c, 0.3, 0.1, true)
  } else if (kind === 1) {
    // A box blind on stilts: a little hut with shooting slots on three sides.
    for (const x of [-1.1, 1.1]) for (const z of [-1.1, 1.1]) s.block(x, 0, z, 0.18, H, 0.18, 'log')
    const c = s.lifted(H)
    c.shell(0, 0, {
      w: 2.4,
      d: 2.4,
      h: 2.1,
      wall: 'wood',
      floor: 'wood',
      roof: 'shingle',
      doors: [{ side: 's', at: 0, width: 0.9, height: 2 }],
      windows: [
        { side: 'n', at: 0, width: 1.6, height: 0.4, sill: 1.1 },
        { side: 'e', at: 0, width: 1.4, height: 0.4, sill: 1.1 },
        { side: 'w', at: 0, width: 1.4, height: 0.4, sill: 1.1, boards: variant % 2 === 1 },
      ],
      noRoom: true,
    })
    ladder(s, 0, 1.2, H + F)
    c.block(0, F, -0.65, 1, 0.45, 0.5, 'wood')
    c.loot(0, F + 0.5, -0.65, 'hunting')
    c.loot(0.6, F + 0.02, 0.4, variant % 4 === 1 ? 'gun' : 'kitchen')
    if (variant % 3 === 0) {
      c.lantern(-0.5, 2.2, 0.3, 0.45, { color: 0xffb060, intensity: 4, distance: 6, flicker: 0.6 })
    }
    if (variant % 2 === 0) blood(c, 0.1, 0.3, 0.9, 0.7, F)
  } else {
    // A ground blind of canvas, a feeder, a salt lick, and something hung up to bleed.
    pupTent(s, 0, 0, true)
    s.loot(0, 0.05, 1.9, 'hunting')
    crate(s, 1.8, 1.6, 0.6, 'camp')
    campfire(s, -3, 2.6, false)
  }
  // The bait pile and the feeder out front, the game pole behind.
  const out = s.sub(0, -6)
  out.block(0, 0, 0, 0.6, 0.9, 0.6, 'rust')
  for (const e of [-1, 1]) out.deco(e * 0.25, 0.9, 0, 0.06, 0.8, 0.06, 'metal')
  out.deco(0, 1.7, 0, 0.9, 0.06, 0.9, 'metal')
  out.deco(1.4, 0, 0.8, 0.35, 0.35, 0.35, 'plaster')
  decal(out, 0.3, 0.6, 2, 1.4, 'dirt')
  const pole = s.sub(4.2, 1.6)
  for (const e of [-1, 1]) pole.block(e * 1, 0, 0, 0.14, 2.6, 0.14, 'log')
  pole.deco(0, 2.5, 0, 2.2, 0.12, 0.12, 'log')
  pole.deco(0, 1.1, 0, 0.5, 1.3, 0.3, variant % 2 ? 'fabricAlt' : 'accent')
  blood(pole, 0, 0.3, 1.2, 1)
  if (variant % 2 === 1)
    note(
      s.lifted(kind === 1 ? H + F : kind === 0 ? H : 0),
      `stand_note_${variant}`,
      0.3,
      kind === 2 ? 0.02 : 0.48,
      kind === 2 ? 1.4 : -0.6,
      STAND_NOTES[variant % STAND_NOTES.length] ?? '',
    )
}
