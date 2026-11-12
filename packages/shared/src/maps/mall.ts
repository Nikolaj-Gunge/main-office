import { MapBuilder } from './builder.ts'
import {
  car,
  DECO,
  gateAcross,
  gateDoor,
  LMG,
  MP5,
  RIFLE,
  runFor,
  SHOTGUN,
  SNIPER,
  spot,
  starts,
  WALL,
  wallAlong,
  zone,
} from './coop-kit.ts'
import type { MapDef } from './types.ts'

/**
 * "Dead Mall": a co-op zombies map. A two-storey shopping mall, from the car park out front up
 * through the shops, the food court and the cinema to the roof, where the team calls for a
 * helicopter. Ten stages, every kind of goal.
 *
 *   z = 0       car park ─ survivors start here (open air)
 *   1  Car park       z 0 … −40       clear the car park                 → front doors (0)
 *   2  Main hall      z −40 … −100    grab the 3 keycards from the shops  → food court shutter (1)
 *   3  Food court     z −100 … −140   clear the food court
 *   4  Food court     defend the generator while the escalator starts   → escalator (2)
 *   Upper floor (y 5), up the escalator in the atrium:
 *   5  Upper floor    get to the security office (front, east)
 *   6  Security       hold the office while it unlocks the cinema         → cinema doors (3)
 *   7  Cinema         z −105 … −140   clear the cinema                    → roof ramp (4)
 *   Roof (y 10), up the ramp at the back of the cinema:
 *   8  Roof           light the 3 signal flares
 *   9  Roof           defend the radio while it calls for help
 *   10 Roof           survive until the helicopter lands                  → escaped
 *
 * Mall x ±30. Night, with the shop lights still on.
 */
export function buildMall(): MapDef {
  const m = new MapBuilder('mall', 'Dead Mall (co-op)', {
    sunDirection: [0.3, 0.6, 0.5],
    sunColor: 0x8fa0d8,
    sunIntensity: 0.45,
    skyColor: 0x2a3048,
    groundColor: 0x1c1a17,
    ambientIntensity: 1.05,
    fogColor: 0x1d2130,
    fogNear: 30,
    fogFar: 120,
  }).withSkyline()
  const G = 0 // ground floor
  const U = 5 // upper floor
  const R = 10 // roof
  const SLAB = 0.3
  const TOP = 11.2 // parapet top
  const T = WALL
  const RUN = runFor(U - G)

  // ─── Shell ──────────────────────────────────────────────────────────────────────────────
  m.span([-30.5, -0.5, -140.5], [30.5, 0, 0.5], 'concrete')
  // Car park: low walls round it.
  m.span([-30 - T, 0, -40], [-30, 2.5, 0.5], 'concrete')
  m.span([30, 0, -40], [30 + T, 2.5, 0.5], 'concrete')
  m.span([-30 - T, 0, 0.5], [30 + T, 2.5, 0.5 + T], 'concrete')
  // The mall: front (with the doors, gate 0), sides, back.
  gateAcross(m, -40, -30 - T, 30 + T, -4, 4, 0, G, TOP, 3, 'plaster')
  m.span([-30 - T, 0, -140 - T], [-30, TOP, -40], 'plaster')
  m.span([30, 0, -140 - T], [30 + T, TOP, -40], 'plaster')
  m.span([-30 - T, 0, -140 - T], [30 + T, TOP, -140], 'plaster')
  m.span([-28, 0.6, -39.75], [-6, 3.6, -39.74], 'glass', DECO) // shop windows on the front
  m.span([6, 0.6, -39.75], [28, 3.6, -39.74], 'glass', DECO)
  m.label(0, 4, -39.7, 'MEGAMALL')

  // Upper floor slab, with the atrium open over the escalator (x ±8, z −55 … −85) and a bridge
  // from the top of the escalator to the south side.
  const UF = U - SLAB
  const ESC = { x0: -7, x1: -1, low: -58, high: -58 - RUN } // escalator, climbing north
  m.span([-30, UF, -55], [30, U, -40], 'concrete')
  m.span([-30, UF, -85], [-8, U, -55], 'concrete')
  m.span([8, UF, -85], [30, U, -55], 'concrete')
  m.span([ESC.x0, UF, -85], [ESC.x1, U, ESC.high], 'concrete') // bridge
  m.span([-30, UF, -140], [30, U, -85], 'concrete')
  // Roof slab, with a glass skylight over the atrium and the hole the roof ramp comes up.
  const RF = R - SLAB
  const ROOF_RAMP = { x0: 22, x1: 30, low: -112, high: -112 - RUN }
  m.span([-30, RF, -55], [30, R, -40], 'concrete')
  m.span([-30, RF, -85], [-8, R, -55], 'concrete')
  m.span([8, RF, -85], [30, R, -55], 'concrete')
  m.span([-8, RF, -85], [8, R, -55], 'glass') // skylight
  m.span([-30, RF, -112], [30, R, -85], 'concrete')
  m.span([-30, RF, -140], [ROOF_RAMP.x0, R, -112], 'concrete')
  m.span([ROOF_RAMP.x0, RF, -140], [30, R, ROOF_RAMP.high], 'concrete')

  // ─── 1 · Car park (z 0 … −40) ────────────────────────────────────────────────────────────
  for (const z of [-10, -26]) {
    for (let x = -26; x <= 26; x += 4) {
      m.span([x - 0.05, 0, z - 2.5], [x + 0.05, 0.012, z + 2.5], 'marker', DECO)
    }
  }
  car(m, -20, G, -12)
  car(m, -12, G, -13)
  car(m, 8, G, -12)
  car(m, 20, G, -28)
  car(m, -4, G, -28)
  car(m, 12, G, -27)
  car(m, -22, G, -30)
  for (const x of [-15, 15]) m.block(x, 0, -20, 0.3, 6, 0.3, 'metal') // lamp posts
  m.block(-4, 0, -6, 3, 1, 0.8, 'fabric') // sandbags by the start
  m.block(5, 0, -7, 3, 1, 0.8, 'fabric')
  m.block(-26, 0, -18, 1.6, 1.1, 1, 'metal') // trolley bay
  m.block(26, 0, -16, 1.6, 1.1, 1, 'metal')

  // ─── 2 · Main hall (ground, z −40 … −100) ───────────────────────────────────────────────
  m.span([-20, 0, -100], [20, 0.012, -40], 'tile', DECO)
  // Shop fronts, three shops a side, split at z −60 and −80.
  const shopDoors: [number, number][] = [
    [-50, 3],
    [-70, 3],
    [-90, 3],
  ]
  wallAlong(m, -20, -100, -40, G, UF, shopDoors, 'wall')
  wallAlong(m, 20, -100, -40, G, UF, shopDoors, 'wall')
  for (const z of [-60, -80]) {
    m.span([-30, 0, z - T / 2], [-20, UF, z + T / 2], 'wall')
    m.span([20, 0, z - T / 2], [30, UF, z + T / 2], 'wall')
  }
  // Shelves in each shop (the keycards lie by the back wall of three of them).
  for (const [x, z] of [
    [-25, -44],
    [-25, -66],
    [-25, -84],
    [25, -46],
    [25, -64],
    [25, -86],
  ] as const) {
    m.block(x, 0, z, 6, 1.8, 0.8, 'wood')
  }
  const KEYCARDS = [
    [-25, -55],
    [25, -75],
    [-25, -95],
  ] as const
  for (const [x, z] of KEYCARDS) {
    m.block(x, 0, z, 0.9, 0.9, 0.6, 'desk') // the dead guard's desk…
    m.block(x, 0.9, z, 0.3, 0.02, 0.2, 'accent', DECO) // …with the card on it
  }
  m.label(-25, 3.2, -50, 'SPORTS')
  m.label(25, 3.2, -70, 'PHONES')
  m.label(-25, 3.2, -90, 'BOOKS')
  // The escalator up, in its housing, gated at the bottom (2).
  m.ramp((ESC.x0 + ESC.x1) / 2, G, ESC.low, ESC.x1 - ESC.x0, RUN, 20, 'ramp')
  m.span([ESC.x0 - 0.2, 0, ESC.high], [ESC.x0, U + 1.1, ESC.low + 0.6], 'metal')
  m.span([ESC.x1, 0, ESC.high], [ESC.x1 + 0.2, U + 1.1, ESC.low + 0.6], 'metal')
  m.span([ESC.x0, 0, ESC.high - 0.2], [ESC.x1, UF, ESC.high], 'metal') // closes it off underneath
  gateDoor(m, ESC.low + 0.45, ESC.x0, ESC.x1, 2, G)
  m.navLink([-4, G, ESC.low + 1.8], [-4, U, ESC.high - 1.3])
  m.label(-4, 3.4, ESC.low + 0.5, 'ESCALATOR')
  // Fountain and benches round the atrium.
  m.block(5, 0, -70, 4, 0.6, 4, 'tile')
  m.block(5, 0.6, -70, 0.6, 1.2, 0.6, 'marker')
  for (const [x, z] of [
    [-13, -62],
    [13, -62],
    [-13, -80],
    [13, -86],
  ] as const) {
    m.block(x, 0, z, 2.4, 0.5, 0.8, 'wood')
  }
  m.block(-13, 0, -48, 0.6, 1.2, 0.6, 'plant')
  m.block(13, 0, -48, 0.6, 1.2, 0.6, 'plant')
  m.block(0, 0, -92, 3, 2.4, 2, 'accent') // information kiosk
  m.label(0, 2.8, -92, 'INFO')
  gateAcross(m, -100, -30, 30, -5, 5, 1, G, UF, 3, 'wall')
  m.label(0, 3.6, -99.7, 'FOOD COURT')

  // ─── 3–4 · Food court (ground, z −100 … −140) ───────────────────────────────────────────
  m.span([-30, 0, -140], [30, 0.012, -100], 'tile', DECO)
  for (const x of [-14, -7, 0, 7, 14]) {
    for (const z of [-110, -118, -126]) m.block(x, 0, z, 1.2, 0.75, 1.2, 'wood')
  }
  m.block(-20, 0, -137.5, 12, 1.1, 1.6, 'desk') // counters along the back
  m.block(4, 0, -137.5, 12, 1.1, 1.6, 'desk')
  m.span([-26, 1.1, -139.9], [10, 2.6, -139.6], 'screen', DECO) // menu boards
  // The generator that runs the escalator (defend).
  const GEN = { x: 22, z: -131 }
  m.block(GEN.x, 0, GEN.z, 3, 2, 2, 'metal')
  m.block(GEN.x - 1, 2, GEN.z, 0.3, 1, 0.3, 'metal', DECO) // exhaust
  m.label(GEN.x, 2.6, GEN.z, 'GENERATOR')

  // ─── 5–6 · Upper floor (y 5) ────────────────────────────────────────────────────────────
  m.span([-20, U, -105], [20, U + 0.012, -85], 'tile', DECO)
  m.span([-20, U, -55], [20, U + 0.012, -40], 'tile', DECO)
  // Railings round the atrium and along the bridge.
  m.span([-8, U, -55], [8, U + 1.1, -55 + 0.2], 'metal')
  m.span([-8 - 0.2, U, -85], [-8, U + 1.1, -55], 'metal')
  m.span([8, U, -85], [8 + 0.2, U + 1.1, -55], 'metal')
  m.span([-8, U, -85], [ESC.x0 - 0.2, U + 1.1, -85 + 0.2], 'metal')
  m.span([ESC.x1 + 0.2, U, -85], [8, U + 1.1, -85 + 0.2], 'metal')
  m.span([ESC.x0 - 0.2, U, -85], [ESC.x0, U + 1.1, ESC.high], 'metal')
  m.span([ESC.x1, U, -85], [ESC.x1 + 0.2, U + 1.1, ESC.high], 'metal')
  // West shops.
  wallAlong(m, -20, -105, -40, U, RF - U, shopDoors, 'wall')
  for (const z of [-60, -80]) m.span([-30, U, z - T / 2], [-20, RF, z + T / 2], 'wall')
  for (const [x, z] of [
    [-25, -46],
    [-25, -66],
    [-25, -86],
  ] as const) {
    m.block(x, U, z, 6, 1.8, 0.8, 'fabricAlt')
  }
  // East: the security office at the front, shops behind it.
  wallAlong(
    m,
    20,
    -105,
    -40,
    U,
    RF - U,
    [
      [-46.5, 3],
      [-70, 3],
      [-90, 3],
    ],
    'wall',
  )
  for (const z of [-55, -80]) m.span([20, U, z - T / 2], [30, RF, z + T / 2], 'wall')
  m.block(27, U, -44, 3, 0.8, 1.2, 'desk')
  m.block(26.4, U + 0.8, -44.3, 0.6, 0.45, 0.06, 'screen', DECO)
  m.block(27.6, U + 0.8, -44.3, 0.6, 0.45, 0.06, 'screen', DECO)
  m.span([29.9, U + 1, -54], [29.95, U + 2.4, -47], 'screen', DECO) // CCTV wall
  m.label(20, U + 3.1, -46.5, 'SECURITY')
  for (const [x, z] of [
    [25, -66],
    [25, -86],
  ] as const) {
    m.block(x, U, z, 6, 1.8, 0.8, 'wood')
  }
  m.block(-13, U, -95, 2.4, 0.5, 0.8, 'wood')
  m.block(13, U, -95, 2.4, 0.5, 0.8, 'wood')
  gateAcross(m, -105, -30, 30, -4, 4, 3, U, RF - U, 3, 'wall')
  m.label(0, U + 3.6, -104.7, 'CINEMA')

  // ─── 7 · Cinema (upper floor, z −105 … −140) ─────────────────────────────────────────────
  m.span([-30, U, -140], [ROOF_RAMP.x0 - 0.2, U + 0.012, -105], 'carpet', DECO)
  for (const z of [-114, -118, -122, -126, -130]) {
    m.block(-10, U, z, 14, 0.7, 0.8, 'fabric')
    m.block(8, U, z, 12, 0.7, 0.8, 'fabric')
  }
  m.span([-18, U + 1.2, -139.8], [18, U + 4.2, -139.6], 'whiteboard', DECO) // the screen
  // Roof ramp in its own lane at the back east corner, gated at the bottom (4).
  m.ramp((ROOF_RAMP.x0 + ROOF_RAMP.x1) / 2, U, ROOF_RAMP.low, ROOF_RAMP.x1 - ROOF_RAMP.x0, RUN, 20)
  m.span([ROOF_RAMP.x0 - 0.2, U, ROOF_RAMP.high], [ROOF_RAMP.x0, RF, ROOF_RAMP.low + 0.6], 'wall')
  m.span([ROOF_RAMP.x0, U, ROOF_RAMP.high - 0.2], [30, RF, ROOF_RAMP.high], 'wall')
  gateDoor(m, ROOF_RAMP.low + 0.45, ROOF_RAMP.x0, 30, 4, U)
  m.span([ROOF_RAMP.x0, U + 3, ROOF_RAMP.low + 0.3], [30, RF, ROOF_RAMP.low + 0.6], 'wall')
  m.navLink([26, U, ROOF_RAMP.low + 1.8], [26, R, ROOF_RAMP.high - 1.3])
  m.label(26, U + 3.3, ROOF_RAMP.low + 0.7, 'ROOF')

  // ─── 8–10 · Roof (y 10) ─────────────────────────────────────────────────────────────────
  m.span([ROOF_RAMP.x0 - 0.2, R, ROOF_RAMP.high], [ROOF_RAMP.x0, R + 1.1, ROOF_RAMP.low], 'metal')
  m.span([ROOF_RAMP.x0, R, ROOF_RAMP.low], [30, R + 1.1, ROOF_RAMP.low + 0.2], 'metal')
  // Helipad.
  m.span([-6, R, -106], [6, R + 0.015, -94], 'marker', DECO)
  m.span([-4.5, R, -105], [4.5, R + 0.02, -95], 'accent', DECO)
  m.label(0, R + 0.4, -100, 'H')
  // The radio (defend) and its mast.
  const RADIO = { x: -16, z: -66 }
  m.block(RADIO.x, R, RADIO.z, 1.6, 2.2, 1.2, 'metal')
  m.block(RADIO.x, R + 2.2, RADIO.z, 0.2, 5, 0.2, 'metal', DECO)
  m.label(RADIO.x, R + 2.7, RADIO.z, 'RADIO')
  // Flares at three corners.
  const FLARES = [
    [-26, -44],
    [26, -44],
    [-26, -136],
  ] as const
  for (const [x, z] of FLARES) {
    m.block(x, R, z, 0.3, 1.1, 0.3, 'accent', DECO)
    m.label(x, R + 1.5, z, 'FLARE')
  }
  // AC units and a water tank for cover.
  for (const [x, z, w, d] of [
    [-20, -100, 3, 3],
    [16, -80, 3, 2],
    [10, -122, 2, 3],
    [-10, -130, 3, 2],
    [20, -50, 2, 2],
    [-14, -45, 2, 3],
    [14, -100, 2, 2],
  ] as const) {
    m.block(x, R, z, w, 1.6, d, 'metal')
  }
  m.block(-24, R, -118, 3, 3, 3, 'metal')

  // ─── Lights ─────────────────────────────────────────────────────────────────────────────
  const lamp = (x: number, y: number, z: number, color = 0xffe2b8, intensity = 7, d = 13) =>
    m.light({ kind: 'point', pos: [x, y, z], color, intensity, distance: d })
  for (const x of [-15, 15]) lamp(x, 6, -20, 0xffc890, 10, 18)
  lamp(0, 3, -4, 0xffc890, 5, 10)
  lamp(0, 3, -36, 0xffc890, 5, 10)
  for (const z of [-50, -70, -90]) {
    lamp(-12, UF - 0.4, z, 0xdfe8ff)
    lamp(12, UF - 0.4, z, 0xdfe8ff)
    lamp(-25, UF - 0.4, z, 0xfff0d0, 6, 10)
    lamp(25, UF - 0.4, z, 0xfff0d0, 6, 10)
  }
  for (const x of [-15, 0, 15]) lamp(x, UF - 0.4, -120, 0xffd9a0, 7, 14)
  lamp(GEN.x, 3, GEN.z, 0xff9a40, 8, 9)
  for (const z of [-48, -70, -95]) lamp(0, RF - 0.4, z, 0xdfe8ff, 6, 14)
  lamp(-12, RF - 0.4, -95, 0xdfe8ff, 6, 12)
  lamp(25, RF - 0.4, -48, 0x9fd0ff, 7, 10)
  for (const z of [-66, -90]) lamp(-25, RF - 0.4, z, 0xfff0d0, 5, 10)
  for (const z of [-70, -90]) lamp(25, RF - 0.4, z, 0xfff0d0, 5, 10)
  lamp(0, RF - 0.5, -135, 0x8fb0ff, 8, 16) // screen glow
  lamp(-15, RF - 0.5, -112, 0x806040, 4, 12)
  lamp(26, RF - 0.5, -118, 0xffd9a0, 5, 10)
  lamp(0, R + 6, -100, 0xffe0b0, 12, 24)
  lamp(RADIO.x, R + 3, RADIO.z, 0x9fe0ff, 6, 9)
  for (const [x, z] of FLARES) lamp(x, R + 1.5, z, 0xff5040, 6, 8)

  // ─── Weapons (back 20 s after they're taken) ────────────────────────────────────────────
  m.pickup(0, 0, -5, SHOTGUN, 20)
  m.pickup(2, 0, -5, MP5, 20)
  m.pickup(0, 0, -44, RIFLE, 20)
  m.pickup(-25, 0, -70, SHOTGUN, 20)
  m.pickup(0, 0, -104, MP5, 20)
  m.pickup(-10, 0, -132, RIFLE, 20)
  m.pickup(0, U, -90, SHOTGUN, 20)
  m.pickup(-25, U, -70, RIFLE, 20)
  m.pickup(24, U, -50, SNIPER, 20)
  m.pickup(0, U, -108, LMG, 20)
  m.pickup(0, R, -92, LMG, 20)
  m.pickup(20, R, -130, SHOTGUN, 20)

  // ─── Stages ─────────────────────────────────────────────────────────────────────────────
  const hallSpawns = [
    [0, G, -97],
    [-12, G, -97],
    [12, G, -97],
    [-25, G, -75],
    [25, G, -55],
    [25, G, -95],
    [12, G, -60],
    [-12, G, -85],
  ] as const
  const foodSpawns = [
    [-28, G, -138],
    [28, G, -138],
    [0, G, -132],
    [-20, G, -104],
    [20, G, -104],
    [-24, G, -120],
    [26, G, -115],
  ] as const
  const upperSpawns = [
    [-25, U, -50],
    [-25, U, -75],
    [-25, U, -95],
    [25, U, -75],
    [25, U, -95],
    [0, U, -100],
    [0, U, -45],
    [-14, U, -88],
  ] as const
  const roofSpawns = [
    [-27, R, -43],
    [27, R, -80],
    [-27, R, -100],
    [0, R, -137],
    [27, R, -137],
    [-10, R, -110],
    [10, R, -50],
    [0, R, -43],
  ] as const

  m.stage({
    name: 'Car park',
    task: 'Clear the car park',
    goal: { kind: 'kill', count: 16 },
    start: starts(-3, [-3, -1.5, 0, 1.5, 3, -2.2, 2.2]),
    zombieSpawns: [
      [-27, G, -5],
      [27, G, -5],
      [-27, G, -37],
      [27, G, -37],
      [-15, G, -37],
      [15, G, -37],
      [0, G, -20],
    ],
    opens: 0,
    intensity: 0.8,
    runners: 0,
  })
  m.stage({
    name: 'Main hall',
    task: 'Grab the keycards from the 3 shops',
    goal: {
      kind: 'activate',
      spots: KEYCARDS.map(([x, z]) => spot(x, z + 1.4, G, 1.8)),
      seconds: 0,
      what: 'Keycard',
    },
    start: starts(-42.5, [-3, -1.5, 0, 1.5, 3]),
    zombieSpawns: [...hallSpawns],
    opens: 1,
    intensity: 1,
    runners: 0.05,
    armory: MP5,
  })
  m.stage({
    name: 'Food court',
    task: 'Clear the food court',
    goal: { kind: 'kill', count: 22 },
    start: starts(-102.5, [-4, -2, 0, 2, 4]),
    zombieSpawns: [...foodSpawns],
    intensity: 1.1,
    runners: 0.1,
  })
  m.stage({
    name: 'Generator',
    task: 'Keep the generator running while the escalator starts',
    goal: {
      kind: 'defend',
      zone: zone(GEN.x - 1.6, GEN.z - 1.1, GEN.x + 1.6, GEN.z + 1.1, G, 2.2),
      seconds: 45,
      health: 1000,
      what: 'Generator',
    },
    start: starts(-102.5, [-4, -2, 0, 2, 4]),
    zombieSpawns: [...foodSpawns, ...hallSpawns.slice(0, 3)],
    opens: 2,
    intensity: 1.3,
    runners: 0.15,
  })
  m.stage({
    name: 'Upper floor',
    task: 'Get to the security office',
    goal: { kind: 'reach', zone: zone(15.6, -48.5, 19.6, -44.5, U) },
    start: starts(-87, [-6, -5, -4, -3, -2], U, Math.PI),
    zombieSpawns: [...upperSpawns],
    intensity: 1.4,
    runners: 0.2,
    armory: RIFLE,
  })
  m.stage({
    name: 'Security office',
    task: 'Hold the office while it unlocks the cinema',
    goal: { kind: 'hold', zone: zone(20.6, -54.4, 29.6, -40.6, U), seconds: 35 },
    start: starts(-50, [22.5, 24, 25.5, 27], U, Math.PI / 2),
    zombieSpawns: [...upperSpawns],
    opens: 3,
    intensity: 1.5,
    runners: 0.25,
  })
  m.stage({
    name: 'Cinema',
    task: 'Clear the cinema',
    goal: { kind: 'kill', count: 28 },
    start: starts(-103, [-3, -1.5, 0, 1.5, 3], U),
    zombieSpawns: [
      [-28, U, -138],
      [16, U, -138],
      [-28, U, -108],
      [0, U, -136],
      [-20, U, -125],
      [18, U, -120],
      [0, U, -95],
      [-14, U, -88],
    ],
    opens: 4,
    intensity: 1.7,
    runners: 0.3,
    armory: LMG,
  })
  m.stage({
    name: 'Roof',
    task: 'Light the 3 signal flares',
    goal: {
      kind: 'activate',
      spots: FLARES.map(([x, z]) => spot(x + (x < 0 ? 1.4 : -1.4), z, R, 2.2)),
      seconds: 2,
      what: 'Flare',
    },
    start: starts(-128, [24, 26, 28], R, Math.PI),
    zombieSpawns: [...roofSpawns],
    intensity: 1.9,
    runners: 0.35,
  })
  m.stage({
    name: 'Radio',
    task: 'Defend the radio while it calls for help',
    goal: {
      kind: 'defend',
      zone: zone(RADIO.x - 0.9, RADIO.z - 0.7, RADIO.x + 0.9, RADIO.z + 0.7, R, 2.4),
      seconds: 50,
      health: 1200,
      what: 'Radio',
    },
    start: starts(-70, [-18, -16, -14], R),
    zombieSpawns: [...roofSpawns],
    intensity: 2.1,
    runners: 0.4,
  })
  m.stage({
    name: 'Helipad',
    task: 'Survive until the helicopter lands',
    goal: { kind: 'survive', seconds: 60 },
    start: starts(-100, [-3, -1.5, 0, 1.5, 3], R),
    zombieSpawns: [...roofSpawns],
    intensity: 2.5,
    runners: 0.5,
  })

  m.spawn(0, G, -3, 0)
  m.spawn(0, U, -45, 0)
  m.spawn(0, R, -100, 0)
  m.randomSpawnsIn([-30, -140], [30, 0.5])
  return m.build()
}
