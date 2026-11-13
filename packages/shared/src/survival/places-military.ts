import type { Site } from './kit.ts'
import {
  armyTent,
  armyTruck,
  barrier,
  blood,
  cabinet,
  carWreck,
  corpse,
  cot,
  decal,
  desk,
  doorway,
  drum,
  dying,
  fence,
  lampPost,
  note,
  partition,
  paving,
  pickupWreck,
  sandbags,
  shelving,
  thickWall,
} from './places-kit.ts'
import { crate, FLOOR, table } from './structures.ts'
import type { Poi } from './types.ts'

/**
 * Where the army was: the bunkers on the hills (Site 7 the worst of them), the radio tower, the
 * two checkpoints and the helicopter that came down in the south-west.
 */

const F = FLOOR
const ALARM = 0xff1a12

/** An emergency lamp: a red box on the wall and the light it barely gives. */
function alarm(s: Site, x: number, y: number, z: number, flicker = 0.55, intensity = 11): void {
  s.deco(x, y, z, 0.3, 0.16, 0.3, 'warnlight')
  s.light(x, y - 0.3, z, { color: ALARM, intensity, distance: 11, flicker })
}

/** A soldier who held his post. */
function soldier(s: Site, x: number, z: number, alongX: boolean, y = 0): void {
  corpse(s, x, z, alongX, y)
  s.deco(alongX ? x - 0.6 : x, y + 0.26, alongX ? z : z - 0.6, 0.32, 0.18, 0.32, 'canvas')
}

/** Spent brass and dark stains where somebody made a stand. */
function lastStand(s: Site, x: number, z: number, y = 0): void {
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4
    s.deco(
      x + Math.cos(a) * (0.3 + i * 0.12),
      y + 0.005,
      z + Math.sin(a) * (0.3 + i * 0.1),
      0.05,
      0.03,
      0.03,
      'accent',
    )
  }
  blood(s, x + 0.4, z - 0.3, 1.3, 1.1, y)
}

// --- Bunkers ----------------------------------------------------------------------------------

const BUNKER_NOTES = [
  '',
  'ORDERS, 3rd night: hold the bunker, admit nobody. Bitten personnel are to be "processed".\n\nWe processed Hayes at 0400. He got up at 0410.',
  "Locked ourselves in. They can't get through the door.\n\nThe problem is Martinez. Martinez was already inside.",
]

/**
 * A small hill bunker: a concrete box under a mound of earth, its door to the south, bunks and
 * a store room inside, red emergency lights still burning.
 */
function smallBunker(s: Site, variant: number): void {
  // The store room first (the dead path out of the inner room before the outer one).
  s.room(1.6, -9.7, 5.7, -0.4, [[0.6, -2.2]])
  s.shell(0, -5, {
    w: 12,
    d: 10,
    h: 2.8,
    wall: 'concrete',
    floor: 'concrete',
    roof: 'concrete',
    doors: [{ side: 's', at: -1, width: 1.6 }],
    windows: [
      { side: 's', at: 3.5, width: 1.4, sill: 1.5, height: 0.3 },
      { side: 's', at: -4.2, width: 1.2, sill: 1.5, height: 0.3 },
    ],
  })
  partition(s, false, 1.5, -9.8, -0.2, 2.8, 'concrete', [-2.2])
  // The mound over it.
  for (const [i, w] of [3.6, 2.4, 1.2].entries()) {
    const h = 1.2 + i * 1
    s.block(-6 - w / 2 - 0.05, 0, -5.4, w, h, 11.2, 'dirt')
    s.block(6 + w / 2 + 0.05, 0, -5.4, w, h, 11.2, 'dirt')
    s.block(0, 0, -10 - w / 2 - 0.05, 12 + 2 * w, h, w, 'dirt')
  }
  s.block(0, F + 2.98, -5.6, 14, 0.7, 11.4, 'dirt')
  s.deco(0, F + 3.68, -5.6, 12, 0.3, 9.6, 'grass')
  // The entrance: a trench between two retaining walls, sandbags on top.
  for (const x of [-2.6, 0.6]) {
    s.block(x, 0, 2, 0.4, 2, 4, 'concrete')
    s.block(x, 2, 2, 0.6, 0.35, 4, 'sandbag')
  }
  s.turned(-0.2, F, 0.9, 1.5, 2.2, 0.12, 50, 'rust')
  blood(s, -1, 1.5, 1, 2.4)
  soldier(s, -1, 4.4, true)
  // Inside: bunks, a table, lockers, the store room.
  for (const z of [-8.7, -6.2]) {
    cot(s, -4.6, z, true, F)
    s.block(-5.5, F, z, 0.08, 1.6, 0.8, 'metal')
    s.deco(-4.6, F + 1.2, z, 1.9, 0.1, 0.8, 'canvas')
  }
  s.loot(-4.2, F + 1.32, -8.7, 'military')
  table(s, -2, -3.6, 1.6, 0.9)
  s.loot(-2.2, F + 0.82, -3.6, 'kitchen')
  for (const x of [-1.2, -0.5])
    cabinet(s, x, -9.5, 0.6, 1.9, 0.5, 'metal', x < -1 ? 'military' : undefined)
  note(s, `bunker_note_${variant}`, -1.6, F + 0.82, -3.3, BUNKER_NOTES[variant] ?? '')
  shelving(s, 5.5, -6, false, 6, ['military', 'medical', 'kitchen', 'gun'])
  crate(s, 3, -9, 0.9, 'military', F)
  crate(s, 3, -7.9, 0.7, 'gun', F)
  s.block(3.2, F, -3.5, 1.4, 1, 0.9, 'rust')
  s.loot(3.2, F + 1.05, -3.5, 'fuel')
  corpse(s, 3.5, -1.4, true, F)
  alarm(s, -3, 2.6, -9.75)
  alarm(s, 3.6, 2.6, -9.75, 0.8, 8)
  // Outside: a ring of sandbags, a dead antenna, a truck that never left.
  sandbags(s, -8, 6, true, 5)
  sandbags(s, 7, 7, true, 4)
  lastStand(s, -8, 7.2)
  s.block(11.5, 0, -12, 0.2, 9, 0.2, 'metal')
  armyTruck(s.sub(-12, 13))
  drum(s, 12, 4)
  drum(s, 12.7, 4.6)
  s.loot(12.3, 0.95, 4.3, 'fuel')
  // Two inside, three around.
  s.zombie(-3, -6, F)
  s.zombie(3.5, -5.5, F)
  s.zombie(4, 8)
  s.zombie(-9, 10)
  s.zombie(13, -3)
}

const SITE7_NOTE =
  'E.V. — personal.\n\nSubject 31 walked again after six hours. Subject 31 should not be walking: Subject 31 has no heart.\n\nThe serum stops the turn in the living. In the dead it does nothing at all. The general wants the dead. I have hidden the last case in the lab safe.\n\nAgnes, forgive me.'
const SECURITY_NOTE =
  'SECURITY LOG — SITE 7\n\n0200 Containment breach, lab B.\n0214 Lockdown. Blast door sealed.\n0230 Power to the lab cut from the generator room. Lab door will not open without power AND a level 2 card.\n0300 Still hear them in the hall.\n0340 I am going to try for the generator room.'

/** Site 7: the laboratory under the hill, a blast door, a breaker, and what they kept in there. */
function site7(s: Site): void {
  // The fence round the top of the hill; the track comes in through the south-west corner.
  fence(
    s,
    [
      [-22, 30],
      [30, 30],
      [30, -30],
      [-30, -30],
      [-30, 22],
    ],
    'metal',
    2.6,
    3,
  )
  for (const [x, z] of [
    [-22, 30],
    [-30, 22],
  ] as const) {
    s.block(x, 0, z, 0.5, 3.2, 0.5, 'concrete')
    s.deco(x, 3.2, z, 0.3, 0.2, 0.3, 'warnlight')
  }
  s.light(-26, 3.2, 26, { color: ALARM, intensity: 18, distance: 20, flicker: 0.9 })
  s.deco(-29.6, 1.2, 12, 0.06, 1, 1.8, 'accent')
  s.deco(8, 1.2, 29.6, 1.8, 1, 0.06, 'accent')
  s.label(-26, 4.2, 26, 'SITE 7 — RESTRICTED')
  // A watchtower in the north-east corner.
  for (const x of [23, 27]) for (const z of [-27, -23]) s.block(x, 0, z, 0.25, 4, 0.25, 'metal')
  s.block(25, 4, -25, 4.6, 0.2, 4.6, 'metal')
  s.deco(25, 4.2, -22.8, 4.6, 1, 0.08, 'sandbag')
  s.deco(25, 6.4, -25, 5, 0.15, 5, 'metal')

  // The building: 24 × 22 m of concrete, the front at z = −4.
  const H = 3.4
  s.block(0, -0.4, -15, 24.6, 0.4 + F, 22.6, 'concrete')
  thickWall(s, true, -4, -12.3, 12.3, 0, H, 0.6, 'concrete', [doorway(0, 2.6, 3)])
  thickWall(s, true, -26, -12.3, 12.3, 0, H, 0.6, 'concrete')
  thickWall(s, false, -12, -25.7, -4.3, 0, H, 0.6, 'concrete')
  thickWall(s, false, 12, -25.7, -4.3, 0, H, 0.6, 'concrete')
  s.block(0, H, -15, 25.4, 0.5, 23.4, 'concrete')
  // Earth over the roof and banked against the sides: it is part of the hill.
  s.block(0, H + 0.5, -15.4, 27, 1, 24.2, 'dirt')
  s.deco(0, H + 1.5, -15.6, 24, 0.4, 21, 'grass')
  for (const e of [-1, 1]) s.block(e * 14.1, 0, -15.4, 3.6, H + 0.6, 24.2, 'dirt')
  s.block(0, 0, -28, 31.8, H + 0.6, 3.4, 'dirt')
  // The blast door (gate 0) and its keypad.
  s.block(0, 0, -4, 2.6, 3, 0.4, 'rust', { gate: 0 })
  s.deco(0, 3.05, -3.65, 3.4, 0.35, 0.1, 'accent')
  s.deco(2, 1.1, -3.66, 0.3, 0.42, 0.08, 'screen')
  s.deco(2, 1.6, -3.66, 0.1, 0.08, 0.08, 'warnlight')
  s.interact('site7_door', 'terminal', 2, 1.3, -3.4, 'Use the keypad')
  alarm(s, -2.4, 3.1, -3.55, 0.9, 16)
  // The apron in front: where the last of the guard was put down.
  paving(s, -9, -3.7, 9, 6, 'concrete')
  for (const x of [-7, 7]) lampPost(s, x, 4, undefined, 0, -0.9)
  sandbags(s, -5, 2, true, 3.5)
  sandbags(s, 5.5, 3, true, 3)
  lastStand(s, -5, 3.2)
  soldier(s, -2.8, 1, true)
  soldier(s, 3.6, 5, false)
  soldier(s, 9, -1, true)
  armyTruck(s.sub(14, 14))
  crate(s, 12, 11.6, 0.9, 'military')
  for (const [x, z] of [
    [0.4, -1.5],
    [-1.3, -2.8],
  ] as const) {
    blood(s, x, z, 1.4, 1.2)
  }

  // Inside. Rooms that open off other rooms come first, then the building as a whole.
  const h = H - F
  s.room(1.6, -10.9, 11.7, -4.3, [[0.6, -8]])
  s.room(-11.7, -10.9, -1.6, -4.3, [[-0.6, -8]])
  s.room(-11.7, -25.7, -4.1, -16.1, [[-8, -15.1]])
  s.room(-3.9, -25.7, 3.9, -16.1, [[0, -15.1]])
  s.room(4.1, -25.7, 11.7, -16.1, [[8, -15.1]])
  s.room(-11.7, -25.7, 11.7, -4.3, [[0, -3]])
  partition(s, false, -1.5, -11, -4.3, h, 'concrete', [-8])
  partition(s, false, 1.5, -11, -4.3, h, 'concrete', [-8])
  partition(s, true, -11, -11.7, 11.7, h, 'concrete', [0], 3)
  partition(s, true, -16, -11.7, 11.7, h, 'concrete', [-8, 0, 8], 1.6)
  partition(s, false, -4, -25.7, -16, h, 'concrete')
  partition(s, false, 4, -25.7, -16, h, 'concrete')
  // The lab door (gate 1) and the card reader beside it.
  s.block(0, F, -16, 1.6, 2.2, 0.3, 'metal', { gate: 1 })
  s.deco(0, F + 2.25, -15.88, 1.8, 0.2, 0.06, 'warnlight')
  s.deco(1.6, F + 1.05, -15.9, 0.25, 0.35, 0.06, 'screen')
  s.interact('site7_lab', 'terminal', 1.6, 1.3, -15.5, 'Use the card reader')

  // Corridor and hall.
  alarm(s, 0, h - 0.1, -7)
  alarm(s, -7, h - 0.1, -13.5, 0.7)
  alarm(s, 7, h - 0.1, -13.5, 0.4)
  blood(s, 0, -9.5, 1.2, 3, F)
  corpse(s, 0.6, -12.6, true, F)
  corpse(s, -9, -13.2, true, F)
  decal(s, -5, -11.6, 3.5, 0.5, 'accent', F)
  crate(s, 10.8, -12, 0.9, 'military', F)
  drum(s, -11, -14.5, 'rust', F)
  // Security (east of the corridor): monitors, a desk, the guns they didn't get to.
  desk(s, 6, -10.2, 3, 0.8, 'police')
  for (const x of [5, 6, 7]) s.deco(x, F + 0.76, -10.4, 0.7, 0.45, 0.06, 'screen')
  note(s, 'site7_security_note', 6.8, F + 0.77, -10, SECURITY_NOTE)
  cabinet(s, 11.2, -7, 0.6, 1.9, 2, 'metal', 'gun')
  for (const z of [-7.6, -7, -6.4]) s.deco(10.85, F + 0.4, z, 0.06, 1.2, 0.1, 'metal')
  soldier(s, 4.2, -6.4, true, F)
  alarm(s, 7, h - 0.1, -7.6, 0.6, 8)
  // Storage (west of the corridor).
  shelving(s, -11.3, -7.6, false, 5, ['military', 'medical', 'kitchen', 'gun', 'military'])
  shelving(s, -6.5, -10.5, true, 4, ['medical', 'military'])
  crate(s, -4, -5.4, 0.9, 'military', F)
  crate(s, -3.2, -6.3, 0.7, 'medical', F)
  dying(s, -7, h - 0.2, -7.6, 0xd8e4ff, 6)
  // The generator room: two dead machines and the breaker on the west wall.
  for (const z of [-19, -23]) {
    s.block(-7.5, F, z, 3.4, 1.5, 1.6, 'rust')
    s.deco(-7.5, F + 1.5, z, 1.2, 0.8, 0.4, 'metal')
  }
  s.deco(-11.66, F + 0.9, -21, 0.06, 1, 0.7, 'metal')
  s.deco(-11.6, F + 1.3, -21, 0.1, 0.4, 0.12, 'warnlight')
  s.interact('site7_power', 'lever', -11.2, 1.3, -21, 'Throw the breaker')
  drum(s, -5, -25, 'rust', F)
  s.loot(-5, F + 0.95, -25, 'fuel')
  corpse(s, -9.5, -17, true, F)
  alarm(s, -8, h - 0.1, -21, 0.85, 9)
  // The lab: tanks with something in them, benches, the safe at the back.
  for (const [x, z] of [
    [-2.8, -18],
    [-2.8, -21],
    [2.8, -18],
    [2.8, -21],
  ] as const) {
    s.block(x, F, z, 1.1, 0.25, 1.1, 'metal')
    s.block(x, F + 0.25, z, 1, 2.2, 1, 'glass')
    s.deco(x, F + 0.4, z, 0.45, 1.75, 0.3, 'fabricAlt')
    s.deco(x, F + 2.45, z, 1.1, 0.2, 1.1, 'metal')
    s.light(x, F + 1.3, z, { color: 0x62ffa0, intensity: 5, distance: 5, flicker: 0.25 })
  }
  desk(s, 0, -19.5, 1.4, 0.8, 'medical', 'metal')
  s.block(0, F, -25.2, 1, 1.2, 0.8, 'metal')
  s.deco(0, F + 0.6, -24.79, 0.25, 0.25, 0.03, 'screen')
  s.interact('site7_safe', 'search', 0, 1, -24.6, 'Open the specimen safe')
  note(s, 'site7_note', 0.4, F + 0.77, -19.4, SITE7_NOTE)
  corpse(s, -1.5, -23.4, true, F)
  blood(s, 1.6, -23, 1.6, 2.2, F)
  alarm(s, 0, h - 0.1, -22, 0.35, 7)
  // Barracks: bunks in two rows.
  for (const z of [-17.4, -19.8, -22.2, -24.6]) {
    cot(s, 5.4, z, true, F)
    cot(s, 10.4, z, true, F)
  }
  for (const z of [-17.4, -22.2]) s.loot(10.4, F + 0.42, z, z < -20 ? 'military' : 'bedroom')
  s.loot(5.4, F + 0.42, -24.6, 'pack')
  cabinet(s, 7.9, -25.3, 1.8, 1.9, 0.5, 'metal', 'military')
  corpse(s, 7.9, -20.5, true, F)
  alarm(s, 8, h - 0.1, -21, 0.75, 8)

  // The dead of Site 7: the first spot is the brute in the lab; then hall, rooms, yard.
  for (const [x, z, y] of [
    [0, -21.5, F],
    [-6, -13.5, F],
    [6, -13.5, F],
    [8, -21, F],
    [-8, -21, F],
    [-7, -7, F],
    [7, -7, F],
    [0, -6, F],
    [10, 4, 0],
    [-14, 10, 0],
    [18, -12, 0],
    [-20, -14, 0],
    [20, 16, 0],
  ] as const) {
    s.zombie(x, z, y)
  }
}

/** Bunkers: Site 7, or one of the small ones on the hills. */
export function bunker(s: Site, poi: Poi, variant: number): void {
  if (poi.key === 'site7') site7(s)
  else smallBunker(s, variant)
}

// --- The radio tower --------------------------------------------------------------------------

/**
 * The forestry transmitter on its hill in the north-west: a mast with a red light on top, the
 * operator's hut, the generator shed, and a fence that did not keep anything out.
 */
export function radio(s: Site): void {
  // The mast: four legs, rungs, a red light at the top and halfway.
  const M = 32
  const [mx, mz] = [0, -10]
  for (const x of [-1.2, 1.2])
    for (const z of [-1.2, 1.2]) s.block(mx + x, 0, mz + z, 0.2, M, 0.2, 'metal')
  for (let y = 2; y < M; y += 3) {
    for (const e of [-1.2, 1.2]) {
      s.deco(mx, y, mz + e, 2.4, 0.08, 0.08, 'metal')
      s.deco(mx + e, y, mz, 0.08, 0.08, 2.4, 'metal')
    }
  }
  s.block(mx, 0, mz, 3.4, 0.5, 3.4, 'concrete')
  for (const y of [16, M]) {
    s.deco(mx, y, mz, 0.6, 0.6, 0.6, 'warnlight')
    s.light(mx, y + 0.3, mz, {
      color: ALARM,
      intensity: y === M ? 70 : 30,
      distance: y === M ? 70 : 30,
      flicker: 0.95,
    })
  }
  s.deco(mx, M + 0.6, mz, 0.12, 4, 0.12, 'metal')
  // Guy wires to anchors north and south.
  for (const e of [-1, 1]) {
    const run = 14
    const length = Math.hypot(run, M - 2)
    const tilt = e * Math.atan2(M - 2, run)
    s.turned(mx, (M - 2) / 2 - 0.02, mz + (e * run) / 2, 0.04, 0.04, length, 0, 'metal', tilt)
    s.block(mx, 0, mz + e * run, 0.6, 0.4, 0.6, 'concrete')
  }

  // The operator's hut, its door to the yard.
  const hut = s.sub(-13, -2, 3)
  hut.shell(0, 0, {
    w: 6,
    d: 5,
    h: 2.6,
    wall: 'concrete',
    floor: 'concrete',
    roof: 'concrete',
    doors: [{ side: 's', at: 1.2 }],
    windows: [
      { side: 's', at: -1.4, glass: true },
      { side: 'e', at: 0, boards: true },
    ],
  })
  // The transmitter: a rack against the back wall.
  hut.block(-0.6, F, -2, 2.4, 1.5, 0.55, 'rack')
  for (const x of [-1.3, -0.6, 0.1]) hut.deco(x, F + 0.9, -1.71, 0.5, 0.35, 0.04, 'screen')
  hut.block(-0.6, F, -1.4, 2.4, 0.75, 0.6, 'desk')
  hut.deco(-0.2, F + 0.75, -1.4, 0.4, 0.3, 0.3, 'metal')
  hut.interact('tower_radio', 'radio', -0.6, 1.2, -1.1, 'Use the transmitter')
  cot(hut, 2.3, -0.8, false, F)
  hut.loot(2.3, F + 0.42, -0.4, 'bedroom')
  cabinet(hut, -2.5, 1, 0.5, 1.8, 1.2, 'metal', 'office')
  hut.loot(0.8, F + 0.02, 1.4, 'medical')
  corpse(hut, 1, 0.3, true, F)
  note(
    hut,
    'radio_note',
    0.5,
    F + 0.76,
    -1.3,
    'Transmitter log.\n\nDay 3: Generator fuse blew. Spare is at the mill — Ray said so before he left.\nDay 5: They are drawn to the noise of the generator. Do not run it unless you mean to.\nDay 6: I meant to.',
  )
  dying(hut, 0, 2.5, 0, 0xd8e4ff, 6)

  // The generator shed.
  const shed = s.sub(13, -4, 1)
  shed.shell(0, 0, {
    w: 5,
    d: 4,
    h: 2.4,
    wall: 'metal',
    floor: 'concrete',
    roof: 'metal',
    doors: [{ side: 's', at: 0, width: 2.2 }],
  })
  shed.block(0, F, -0.9, 2, 1.1, 1, 'rust')
  shed.deco(0.5, F + 1.1, -0.9, 0.7, 0.4, 0.5, 'metal')
  shed.deco(-0.7, F + 1.1, -1.2, 0.12, 1.6, 0.12, 'metal')
  shed.interact('tower_generator', 'generator', 0, 1, -0.2, 'Start the generator')
  drum(shed, 1.9, 0.9, 'rust', F)
  shed.loot(1.9, F + 0.95, 0.9, 'fuel')
  drum(shed, -1.9, 1, 'accent', F)

  // The fence, open at the south where the track comes in.
  fence(
    s,
    [
      [-4, 24],
      [-24, 24],
      [-24, -26],
      [24, -26],
      [24, 24],
      [4, 24],
    ],
    'metal',
    2.2,
    3,
  )
  sandbags(s, -6, 14, true, 4)
  sandbags(s, 6, 14, true, 4)
  lastStand(s, -6, 15.3)
  soldier(s, 5.5, 16, true)
  lampPost(s, -4, 8, undefined, 0.9)
  pickupWreck(s.sub(8, 18), 3, 'garage')
  crate(s, -18, -18, 0.9, 'military')
  crate(s, -17, -17.2, 0.7, 'garage')
  for (const [x, z] of [
    [-10, 6],
    [10, 6],
    [-18, 16],
    [18, -16],
    [0, 20],
    [-8, -20],
    [16, 10],
  ] as const) {
    s.zombie(x, z)
  }
}

// --- Checkpoints ------------------------------------------------------------------------------

/**
 * The army's checkpoints. The east one (on the Ashford road) has the command tent with the Site 7
 * keycard; the south one is a roadblock where the cars queued and never moved again.
 */
export function checkpoint(s: Site, _poi: Poi, variant: number): void {
  if (variant === 0) {
    // The road comes in from the north-west and leaves to the north-east: the camp is south.
    barrier(s, -4, -3, true, 3)
    barrier(s, 4, -4.5, true, 3)
    barrier(s, 0, -8, false, 3)
    // A boom gate, a red lamp on its post.
    s.block(-7, 0, 1, 0.4, 1.2, 0.4, 'metal')
    s.deco(-7, 1.2, 1, 0.4, 0.3, 0.4, 'warnlight')
    s.light(-7, 1.7, 1, { color: ALARM, intensity: 12, distance: 14, flicker: 0.9 })
    s.turned(-4.6, 1, 1.2, 5, 0.12, 0.12, 70, 'accent', 0.4)
  } else {
    // The road runs east–west along z ≈ 0: a wall of barriers and a truck across it, a jam of
    // cars behind.
    for (const z of [-2.6, 0.4, 3.4, 6.4]) barrier(s, 6, z, false, 2.6)
    armyTruck(s.sub(10, 2, 1))
    for (const [x, z, look] of [
      [-6, 1.5, 0],
      [-13, 0.5, 1],
      [-20, 2.2, 2],
      [-27, 1.2, 3],
    ] as const) {
      carWreck(s.sub(x, z), look)
    }
    for (const [x, z] of [
      [-9.5, 3.8],
      [-16, -1.4],
      [-23, 4.6],
    ] as const) {
      corpse(s, x, z, true)
    }
  }
  // The command tent: it opens to the south (east checkpoint) or to the road (south).
  const tentAt: [number, number] = variant === 0 ? [-10, 14] : [-8, -16]
  const tent = s.sub(tentAt[0], tentAt[1])
  armyTent(tent, 6, 5)
  desk(tent, 0, -1.6, 2, 0.9, variant === 0 ? 'office' : 'military')
  tent.deco(0, 0.88, -1.7, 1.4, 0.02, 0.7, 'canvas')
  tent.deco(-0.7, 0.88, -1.9, 0.4, 0.25, 0.3, 'metal')
  if (variant === 0)
    tent.interact('checkpoint_tent', 'search', 0, 0.9, -1.1, 'Search the command tent')
  cot(tent, -2.3, 0.6, false)
  crate(tent, 2.2, 0.8, 0.8, 'military')
  crate(tent, 2.2, -1.5, 0.7, 'gun')
  soldier(tent, -0.4, 1.1, true)
  tent.deco(0, 2.25, 0, 0.2, 0.25, 0.2, 'lightpanel')
  tent.light(0, 2.1, 0, { color: 0xffd7a0, intensity: 9, distance: 9, flicker: 0.6 })
  // The aid tent, where the bitten were taken.
  const aid = variant === 0 ? s.sub(4, 18) : s.sub(4, -16)
  armyTent(aid, 6, 5)
  for (const x of [-1.8, 0, 1.8]) {
    cot(aid, x, -0.6, false)
    corpse(aid, x, -0.6, false, 0.38)
  }
  aid.loot(2.2, 0.05, 1.4, 'medical')
  aid.loot(-2.2, 0.05, 1.4, 'medical')
  blood(aid, 0, 1.5, 3, 1.4)
  dying(aid, 0, 2.2, 0, 0xffffff, 6)
  // A sandbag nest, and in it the man Ortiz wants remembered.
  const [nx, nz] = variant === 0 ? [16, 6] : [12, 12]
  sandbags(s, nx, nz - 1.8, true, 4)
  sandbags(s, nx - 2.2, nz, false, 3)
  sandbags(s, nx + 2.2, nz, false, 3)
  lastStand(s, nx, nz)
  soldier(s, nx, nz + 0.4, true)
  s.interact(variant === 0 ? 'tags_1' : 'tags_2', 'search', nx, 0.4, nz + 0.4, 'Take the dog tags')
  crate(s, nx + 1.2, nz + 1.2, 0.6, 'gun')
  // The rest: a truck, floodlights, crates, drums.
  if (variant === 0) armyTruck(s.sub(-22, 6))
  lampPost(
    s,
    variant === 0 ? -3 : -2,
    variant === 0 ? 6 : 8,
    { color: 0xeef4ff, intensity: 26, distance: 22, flicker: 0.85 },
    0,
    -0.9,
  )
  lampPost(s, 10, variant === 0 ? 22 : -8, undefined, 0.9)
  crate(s, -16, variant === 0 ? 16 : -10, 0.9, 'military')
  drum(s, -15, variant === 0 ? 18 : -12)
  s.loot(-15, 0.95, variant === 0 ? 18 : -12, 'fuel')
  soldier(s, variant === 0 ? -14 : 2, variant === 0 ? 2 : 10, false)
  const spots: [number, number][] =
    variant === 0
      ? [
          [-10, 15],
          [4, 19.6],
          [16, 9],
          [-20, 12],
          [8, 4],
          [-4, 24],
          [20, 20],
          [-24, -2],
          [24, -4],
          [0, 12],
        ]
      : [
          [-8, -15],
          [4, -15],
          [12, 15],
          [-18, 6],
          [-24, -6],
          [18, -6],
          [0, 18],
        ]
  for (const [x, z] of spots) s.zombie(x, z)
}

// --- The crash site ---------------------------------------------------------------------------

/** The helicopter Reyes flew: on its belly in a scar through the trees, the crew still aboard. */
export function crash(s: Site): void {
  // The scar: burnt ground, broken trees, pieces all the way down it.
  decal(s, -6, 6, 20, 12, 'asphalt')
  decal(s, 8, -2, 18, 4, 'dirt')
  for (const [x, z, deg] of [
    [-22, -10, 20],
    [16, 2, -35],
    [4, 14, 70],
  ] as const) {
    s.block(x, 0, z, 0.8, 1.4, 0.8, 'log')
    s.turned(x + 2, 0, z + 1, 6, 0.6, 0.6, deg, 'log')
  }
  for (const [x, z] of [
    [6, -1],
    [12, -3],
    [2, 2],
  ] as const) {
    s.turned(x, 0, z, 1.4, 0.4, 0.9, x * 13, 'metal')
  }

  // The fuselage: a cabin open on the south side, the cockpit to the east.
  const v = s.sub(-6, 6)
  v.room(-3.9, -1.15, 3.9, 1.15, [[0, 2.2]])
  v.block(0, 0, 0, 8, 0.5, 2.6, 'metal')
  v.block(0, 0, 1.6, 2.6, 0.25, 0.6, 'metal')
  v.block(0, 0.5, -1.25, 8, 1.8, 0.1, 'metal')
  for (const x of [-2.75, 2.75]) v.block(x, 0.5, 1.25, 2.5, 1.8, 0.1, 'metal')
  v.block(-4, 0.5, 0, 0.1, 1.8, 2.6, 'metal')
  v.block(0, 2.3, 0, 8, 0.3, 2.6, 'metal')
  v.deco(0.5, 2.6, 0, 3, 0.7, 1.6, 'metal')
  v.deco(0.5, 3.3, 0, 0.3, 0.6, 0.3, 'metal')
  // The rotor: one blade still on, three thrown.
  v.turned(0.5, 3.8, 0, 7, 0.06, 0.4, 25, 'metal', 0.08)
  s.turned(-15, 0, -3, 6, 0.08, 0.4, 70, 'metal')
  s.turned(2, 0, 16, 6, 0.08, 0.4, -20, 'metal')
  // The cockpit: smashed glass, two seats, the pilot.
  v.block(4.9, 0.4, 0, 1.8, 0.6, 2.4, 'metal')
  v.block(4.9, 1, -1.15, 1.8, 1.1, 0.1, 'metal')
  v.block(4.9, 2.1, 0, 1.8, 0.2, 2.4, 'metal')
  v.block(5.75, 1, 0, 0.1, 1.1, 2.4, 'glass')
  v.turned(4.4, 1, 1.15, 0.7, 0.5, 0.03, 18, 'glass')
  for (const z of [-0.55, 0.55]) v.deco(4.5, 1, z, 0.5, 0.5, 0.5, 'canvas')
  v.deco(4.6, 1.2, 0.55, 0.36, 0.55, 0.36, 'fabricAlt')
  v.deco(4.6, 1.75, 0.55, 0.24, 0.24, 0.24, 'plaster')
  v.interact('crash_cockpit', 'search', 4.6, 1.3, 1.6, 'Search the cockpit')
  // The tail broke off and lies behind it.
  s.block(-15, 0, 4, 6, 0.8, 0.8, 'metal')
  s.deco(-18, 0.8, 4, 0.5, 2, 0.12, 'metal')
  s.turned(-18.2, 2.4, 4, 1.8, 0.08, 0.3, 90, 'metal', 0.6)
  // Inside: seats along the walls, the crew, the cargo.
  for (const x of [-3, -1.6, -0.2, 1.2]) v.deco(x, 0.5, -1, 0.9, 0.5, 0.4, 'canvas')
  corpse(v, -2, 0.2, true, 0.5)
  crate(v, -3.4, 0.6, 0.6, 'military', 0.5)
  crate(v, 2.6, -0.6, 0.7, 'medical', 0.5)
  v.loot(1, 0.55, 0.4, 'gun')
  blood(v, 0.4, 0, 2.4, 1.6, 0.5)
  // Embers deep in the engine, still.
  v.deco(0.5, 2.62, 0.82, 0.8, 0.2, 0.05, 'warnlight')
  v.light(0.5, 3, 1.3, { color: 0xff5a1a, intensity: 10, distance: 9, flicker: 0.7 })
  // The crew chief made it out, almost: the tags Ortiz wants.
  soldier(s, -3, 11.2, true)
  s.interact('tags_3', 'search', -3, 0.4, 11.2, 'Take the dog tags')
  lastStand(s, -3.6, 12)
  // Cargo thrown clear, a flare that burnt out, a camp somebody tried.
  for (const [x, z, loot] of [
    [-12, 12, 'military'],
    [-10.8, 13.2, 'gun'],
    [-17, -6, 'medical'],
  ] as const) {
    crate(s, x, z, 0.9, loot)
  }
  s.deco(-9, 0, 16, 0.08, 0.08, 0.35, 'accent')
  table(s, -16, 14, 1.4, 0.8)
  s.loot(-16, 0.9, 14, 'camp')
  for (const [x, z] of [
    [-8, 14],
    [-14, -4],
    [6, 10],
    [-20, 10],
    [-2, -8],
    [14, 12],
    [-22, -2],
  ] as const) {
    s.zombie(x, z)
  }
}
