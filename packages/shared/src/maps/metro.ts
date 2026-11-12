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
  zone,
} from './coop-kit.ts'
import type { MapDef, Vec3 } from './types.ts'

/**
 * "Last Train": a co-op zombies map, 350 m long and going down. From a street at night, down
 * into a metro station, along the platform and a flooded tunnel to the train depot, where the
 * last train out is waiting for fuel and someone to hold the line. Eleven stages.
 *
 *   street, y 9 (open air)
 *   1  Street         z 0 … −50       clear the street
 *   2  Street         pull fuses out of 3 wrecked cars                    → station gate (0)
 *   ramp down to the concourse, y 4.5
 *   3  Ticket hall    z −62 … −80     throw the 3 breakers               → turnstiles (1)
 *   4  Concourse      z −80 … −110    survive while the escalators unlock → escalators (2)
 *   escalators down to the platform, y 0
 *   5  Platform       z −110 … −172   clear the platform
 *   6  Signal box     defend it while it switches the line               → tunnel (3)
 *   7  Tunnel         z −172 … −292   run the tunnel to the pump room
 *   8  Pump room      start the 3 pumps                                  → flood door (4)
 *   9  Depot          z −292 … −352   collect 4 fuel cans (one up on the gantry)
 *   10 Control room   hold it while the points are set (gantry, y 4.5)
 *   11 Last train     defend the train while the engine warms up         → escaped
 */
export function buildMetro(): MapDef {
  const m = new MapBuilder('metro', 'Last Train (co-op)', {
    sunDirection: [-0.3, 0.7, 0.4],
    sunColor: 0x8a9cd0,
    sunIntensity: 0.4,
    skyColor: 0x1f2538,
    groundColor: 0x16140f,
    ambientIntensity: 1,
    fogColor: 0x12151d,
    fogNear: 22,
    fogFar: 95,
  }).withSkyline()
  const S = 9 // street
  const C = 4.5 // concourse (and the depot gantry)
  const P = 0 // platform, tunnel, depot
  const T = WALL
  const RUN = runFor(S - C) // every ramp here climbs 4.5 m
  const CEIL = 8.7 // station ceiling (concourse and platform hall)

  // ─── 1–2 · Street (y 9, z 0 … −50) ──────────────────────────────────────────────────────
  m.span([-16, S - 0.4, -50], [16, S, 0.5], 'concrete')
  m.span([-16, S, -50], [-12, S + 0.012, 0.5], 'tile', DECO) // pavements
  m.span([12, S, -50], [16, S + 0.012, 0.5], 'tile', DECO)
  for (let z = -2; z > -48; z -= 5)
    m.span([-0.08, S, z - 1.5], [0.08, S + 0.012, z], 'marker', DECO)
  // Shop fronts both sides, the barricade behind you.
  m.span([-16 - T, S, -50], [-16, S + 12, 0.5 + T], 'plaster')
  m.span([16, S, -50], [16 + T, S + 12, 0.5 + T], 'plaster')
  m.span([-16, S, 0.5], [16, S + 3, 0.5 + T], 'concrete')
  for (const z of [-8, -22, -36]) {
    m.span([-15.98, S + 0.4, z - 4], [-15.96, S + 3, z + 4], 'glass', DECO)
    m.span([15.96, S + 0.4, z - 4], [15.98, S + 3, z + 4], 'glass', DECO)
  }
  m.block(-13.2, S, -26, 2.5, 3, 11, 'accent') // the bus
  m.block(-13.2, S + 1.6, -26, 2.52, 0.8, 10, 'glass', DECO)
  // Wrecked cars (three of them still have fuses worth pulling).
  const FUSE_CARS = [
    [-6, -10, false],
    [5, -17, true],
    [-9, -43, true],
  ] as const
  for (const [x, z, along] of FUSE_CARS) car(m, x, S, z, along)
  car(m, -3, S, -29)
  car(m, 8, S, -36)
  car(m, 10, S, -6, true)
  m.block(-4, S, -6, 3, 1, 0.8, 'fabric') // sandbags
  m.block(4, S, -6, 3, 1, 0.8, 'fabric')
  // Station entrance at the end of the street, gate 0, then the ramp down (open to the sky).
  gateAcross(m, -50, -16 - T, 16 + T, -3, 3, 0, S, 6, 3, 'concrete')
  m.label(0, S + 3.6, -49.7, 'METRO')
  const SHAFT = { low: -50 - RUN, high: -50 } // z where the ramp is at C and at S
  m.ramp(0, C, SHAFT.low, 6, RUN, 20, 'ramp', 1)
  m.span([-3 - T, C, SHAFT.low], [-3, S + 4, SHAFT.high], 'concrete')
  m.span([3, C, SHAFT.low], [3 + T, S + 4, SHAFT.high], 'concrete')
  m.navLink([0, C, SHAFT.low - 1.3], [0, S, SHAFT.high + 1.8])

  // ─── 3–4 · Concourse (y 4.5, z −62 … −110) ──────────────────────────────────────────────
  const CZ0 = SHAFT.low
  const CZ1 = -110
  m.span([-20, C - 0.3, CZ1], [20, C, CZ0], 'concrete')
  m.span([-20, C, CZ1], [20, C + 0.012, CZ0], 'tile', DECO)
  m.span([-20 - T, CEIL, -172 - T], [20 + T, CEIL + 0.3, CZ0], 'ceiling') // station roof
  m.span([-20 - T, C, CZ1], [-20, CEIL, CZ0], 'wall')
  m.span([20, C, CZ1], [20 + T, CEIL, CZ0], 'wall')
  m.span([-20, C, CZ0], [-3 - T, CEIL, CZ0 + T], 'wall')
  m.span([3 + T, C, CZ0], [20, CEIL, CZ0 + T], 'wall')
  m.span([-3 - T, C + 3.2, CZ0], [3 + T, CEIL, CZ0 + T], 'wall')
  // Ticket hall: machines, the manager's booth, and a breaker on each wall.
  for (const x of [-12, -10, -8]) {
    m.block(x, C, -71, 1, 1.8, 0.6, 'metal')
    m.block(x, C + 1.1, -71.31, 0.6, 0.4, 0.02, 'screen', DECO)
  }
  m.block(14, C, -74, 4, 2.6, 4, 'glass') // manager's booth
  m.block(14, C + 2.6, -74, 4.2, 0.2, 4.2, 'metal')
  const BREAKERS = [
    { panel: [-19.6, -66] as const, at: spot(-18.6, -66, C, 2.2) },
    { panel: [19.6, -66] as const, at: spot(18.6, -66, C, 2.2) },
    { panel: [11.8, -74] as const, at: spot(10.6, -74, C, 2.2) },
  ]
  for (const { panel } of BREAKERS) {
    m.block(panel[0], C + 0.8, panel[1], 0.4, 1.2, 0.9, 'metal')
    m.label(panel[0], C + 2.4, panel[1], 'BREAKER')
  }
  // Turnstiles: a glass wall across the hall, three gated gaps (1).
  m.span([-20, C, -80.2], [-14, CEIL, -79.8], 'glass')
  m.span([-10, C, -80.2], [-2, CEIL, -79.8], 'glass')
  m.span([2, C, -80.2], [10, CEIL, -79.8], 'glass')
  m.span([14, C, -80.2], [20, CEIL, -79.8], 'glass')
  for (const [g0, g1] of [
    [-14, -10],
    [-2, 2],
    [10, 14],
  ] as const) {
    m.span([g0, C + 3, -80.2], [g1, CEIL, -79.8], 'glass')
    gateDoor(m, -80, g0, g1, 1, C)
  }
  m.label(0, C + 3.4, -79.7, 'PLATFORMS')
  // Concourse: pillars, benches, a kiosk.
  for (const x of [-8, 8])
    for (const z of [-88, -100]) m.block(x, C, z, 0.8, CEIL - C, 0.8, 'concrete')
  m.block(0, C, -94, 4, 0.5, 0.8, 'wood')
  m.block(0, C, -104, 4, 0.5, 0.8, 'wood')
  m.block(-14, C, -95, 3, 2.4, 2, 'accent')
  m.block(14, C, -90, 1.2, 1.8, 0.8, 'metal') // vending machine
  // Back wall with the two escalators down (gated at the top, 2).
  const ESC_X = [-10, 10]
  m.span([-20, P, CZ1 - T / 2], [20, C, CZ1 + T / 2], 'wall') // below the concourse floor
  m.span([-20, C, CZ1 - T / 2], [-12, CEIL, CZ1 + T / 2], 'wall')
  m.span([-8, C, CZ1 - T / 2], [8, CEIL, CZ1 + T / 2], 'wall')
  m.span([12, C, CZ1 - T / 2], [20, CEIL, CZ1 + T / 2], 'wall')
  for (const x of ESC_X) {
    m.span([x - 2, C + 3, CZ1 - T / 2], [x + 2, CEIL, CZ1 + T / 2], 'wall')
    gateDoor(m, CZ1 + 0.5, x - 2, x + 2, 2, C)
    m.ramp(x, P, CZ1 - RUN, 4, RUN, 20, 'ramp', 1)
    m.span([x - 2 - 0.2, P, CZ1 - RUN], [x - 2, CEIL, CZ1], 'metal')
    m.span([x + 2, P, CZ1 - RUN], [x + 2 + 0.2, CEIL, CZ1], 'metal')
    m.navLink([x, P, CZ1 - RUN - 1.3], [x, C, CZ1 + 1.8])
  }

  // ─── 5–6 · Platform (y 0, z −110 … −172) ────────────────────────────────────────────────
  const PZ1 = -172
  m.span([-24, -0.5, -352], [24, 0, CZ1], 'concrete') // the ground under platform, tunnel, depot
  m.span([-20 - T, P, PZ1], [-20, CEIL, CZ1], 'wall')
  m.span([20, P, PZ1], [20 + T, CEIL, CZ1], 'wall')
  m.span([-12, P, PZ1 - T], [20 + T, CEIL, PZ1], 'wall')
  m.span([-20 - T, 5, PZ1 - T], [-12, CEIL, PZ1], 'wall')
  m.span([-12, P, -165], [12, 0.012, CZ1 - RUN], 'tile', DECO) // the platform itself
  for (const x of [-12, 12]) m.span([x - 0.2, P, -170], [x + 0.2, 0.014, -112], 'marker', DECO)
  /** Rails (decoration) along a track centred on x, from z0 to z1. */
  const rails = (x: number, z0: number, z1: number) => {
    for (const dx of [-0.75, 0.75]) {
      m.span(
        [x + dx - 0.05, P, Math.min(z0, z1)],
        [x + dx + 0.05, 0.1, Math.max(z0, z1)],
        'metal',
        DECO,
      )
    }
  }
  rails(-16, -350, -112)
  rails(16, -170, -112)
  // A dead train on the east track.
  m.span([12.5, 0.1, -165], [20, 3.7, -125], 'metal')
  m.span([12.48, 1.6, -164], [12.5, 2.6, -126], 'glass', DECO)
  for (const z of [-128, -140, -152, -164]) {
    m.block(-11, P, z, 0.8, CEIL, 0.8, 'concrete')
    m.block(11, P, z, 0.8, CEIL, 0.8, 'concrete')
  }
  m.block(-4, P, -135, 3, 0.5, 0.8, 'wood')
  m.block(4, P, -150, 3, 0.5, 0.8, 'wood')
  m.block(0, P, -158, 1.2, 1.8, 0.8, 'metal')
  // The signal box at the tunnel mouth (defend), then the tunnel gate (3).
  const SIGNAL = { x: -16, z: -163 }
  m.block(SIGNAL.x, P, SIGNAL.z, 2, 2.2, 1.6, 'metal')
  m.block(SIGNAL.x, P + 2.2, SIGNAL.z, 0.3, 1.2, 0.3, 'accent', DECO)
  m.label(SIGNAL.x, 2.8, SIGNAL.z, 'SIGNALS')
  gateDoor(m, PZ1 + T / 2, -20, -12, 3, P, 5)
  m.label(-16, 5.6, PZ1 + 0.3, 'TUNNEL')

  // ─── 7–8 · Tunnel (y 0, x −20 … −12, z −172 … −292) and the pump room ────────────────────
  const TZ1 = -292
  const PUMP_ROOM = { x0: -12, x1: 4, z0: -246, z1: -222, door: [-240, -228] as const }
  m.span([-20 - T, P, TZ1], [-20, 5, PZ1], 'concrete')
  m.span([-12, P, PUMP_ROOM.door[1]], [-12 + T, 5, PZ1], 'concrete')
  m.span([-12, P, TZ1], [-12 + T, 5, PUMP_ROOM.door[0]], 'concrete')
  m.span([-20 - T, 5, TZ1], [-12 + T, 5.3, PZ1], 'concrete')
  m.span(
    [-12 + T, 3.2, PUMP_ROOM.door[0]],
    [-12 + T + 0.01, 5, PUMP_ROOM.door[1]],
    'concrete',
    DECO,
  )
  // Pump room.
  m.span([PUMP_ROOM.x0, P, PUMP_ROOM.z1], [PUMP_ROOM.x1 + T, 5, PUMP_ROOM.z1 + T], 'concrete')
  m.span([PUMP_ROOM.x0, P, PUMP_ROOM.z0 - T], [PUMP_ROOM.x1 + T, 5, PUMP_ROOM.z0], 'concrete')
  m.span([PUMP_ROOM.x1, P, PUMP_ROOM.z0], [PUMP_ROOM.x1 + T, 5, PUMP_ROOM.z1], 'concrete')
  m.span([PUMP_ROOM.x0, 5, PUMP_ROOM.z0 - T], [PUMP_ROOM.x1 + T, 5.3, PUMP_ROOM.z1 + T], 'concrete')
  m.span([-11, P, -239], [3.5, 0.012, -223], 'floor', DECO)
  m.block(-4, P, -224, 6, 1.2, 0.8, 'metal') // pipework
  m.block(-6, P, -244.6, 1, 2.2, 1.2, 'rack')
  // Junk in the tunnel to weave round.
  m.block(-15, P, -190, 1.6, 1.3, 3, 'metal')
  m.block(-18.5, P, -205, 2.2, 0.9, 1.5, 'concrete')
  m.block(-14, P, -276, 1.6, 1.3, 3, 'metal')
  m.block(-18, P, -283, 2.2, 0.9, 1.5, 'concrete')
  const PUMPS: { at: Vec3; size: [number, number]; spot: [number, number] }[] = [
    { at: [1.5, P, -225.5], size: [1.6, 1.6], spot: [-0.7, -225.5] },
    { at: [1.5, P, -243.2], size: [1.6, 1.6], spot: [-0.7, -243.2] },
    { at: [-18.9, P, -255], size: [1.2, 1.6], spot: [-16.5, -255] },
  ]
  for (const { at, size } of PUMPS) {
    m.block(at[0], at[1], at[2], size[0], 1.4, size[1], 'metal')
    m.block(at[0], 1.4, at[2], 0.4, 0.5, 0.4, 'accent', DECO)
    m.label(at[0], 2, at[2], 'PUMP')
  }
  m.label(-12.2, 3.6, -234, 'PUMP ROOM')
  // Flood door across the tunnel (4).
  gateDoor(m, -262, -20, -12, 4, P, 5)
  m.label(-16, 4.4, -261.7, 'FLOOD DOOR')

  // ─── 9–11 · Depot (y 0, z −292 … −352), gantry along the east side (y 4.5) ───────────────
  const DZ1 = -352
  const DH = 9
  m.span([-24 - T, P, TZ1], [-20 - T, DH, TZ1 + T], 'concrete')
  m.span([-12 + T, P, TZ1], [24 + T, DH, TZ1 + T], 'concrete')
  m.span([-20 - T, 5, TZ1], [-12 + T, DH, TZ1 + T], 'concrete')
  m.span([-24 - T, P, DZ1 - T], [-24, DH, TZ1], 'concrete')
  m.span([24, P, DZ1 - T], [24 + T, DH, TZ1], 'concrete')
  m.span([-24 - T, P, DZ1 - T], [24 + T, DH, DZ1], 'concrete')
  m.span([-24 - T, DH, DZ1 - T], [24 + T, DH + 0.3, TZ1 + T], 'ceiling')
  rails(0, -350, -296)
  // The last train (defend) on the middle track, a derailed carriage on the west one.
  const TRAIN = { x0: -1.7, x1: 1.7, z0: -342, z1: -306 }
  m.span([TRAIN.x0, 0.1, TRAIN.z0], [TRAIN.x1, 3.9, TRAIN.z1], 'accent')
  m.span([TRAIN.x0 - 0.02, 1.8, TRAIN.z0 + 1], [TRAIN.x1 + 0.02, 2.8, TRAIN.z1 - 3], 'glass', DECO)
  m.span([-1.2, 1.8, TRAIN.z1 - 0.02], [1.2, 3, TRAIN.z1], 'glass', DECO)
  m.label(0, 4.4, TRAIN.z1, 'LAST TRAIN')
  m.block(-16, 0.1, -320, 3.2, 3.6, 16, 'metal')
  m.block(-9, P, -335, 2, 2, 2, 'wood')
  m.block(-20, P, -300, 2, 2, 2, 'wood')
  m.block(8, P, -322, 2, 1.2, 4, 'metal')
  // Gantry: the ramp up the east wall, the control room on top, a workshop underneath.
  const GANTRY = { x0: 12, z0: DZ1, z1: -300 - RUN }
  m.ramp(20, P, -300, 8, RUN, 20)
  m.span([15.8, P, GANTRY.z1], [16, C + 1.1, -299.4], 'metal')
  m.span([16, P, GANTRY.z1 - 0.2], [24, C - 0.3, GANTRY.z1], 'metal') // closes it off underneath
  m.span([GANTRY.x0, C - 0.3, GANTRY.z0], [24, C, GANTRY.z1], 'concrete')
  m.span([GANTRY.x0 - 0.2, C, GANTRY.z0], [GANTRY.x0, C + 1.1, GANTRY.z1], 'metal')
  m.span([GANTRY.x0, C, GANTRY.z1], [15.8, C + 1.1, GANTRY.z1 + 0.2], 'metal')
  m.navLink([20, P, -298.7], [20, C, GANTRY.z1 - 1.3])
  m.block(20, C, -340, 4, 0.95, 1, 'desk') // control desk
  m.block(19.4, C + 0.95, -340.3, 0.6, 0.45, 0.06, 'screen', DECO)
  m.block(20.6, C + 0.95, -340.3, 0.6, 0.45, 0.06, 'screen', DECO)
  m.label(20, C + 2.2, -340, 'CONTROL')
  m.block(22.5, P, -322, 2, 0.95, 3, 'desk') // workbenches below
  m.block(22.5, P, -342, 2, 0.95, 3, 'desk')
  const FUEL: Vec3[] = [
    [-21.5, P, -349],
    [-8, P, -297],
    [16, P, -346],
    [14.5, C, -322],
  ]
  for (const [x, y, z] of FUEL) m.block(x, y, z, 0.4, 0.6, 0.3, 'accent', DECO)

  // ─── Lights ─────────────────────────────────────────────────────────────────────────────
  const lamp = (x: number, y: number, z: number, color = 0xffe2b8, intensity = 7, d = 13) =>
    m.light({ kind: 'point', pos: [x, y, z], color, intensity, distance: d })
  for (const [x, z] of [
    [-11, -8],
    [11, -20],
    [-11, -34],
    [11, -46],
  ] as const) {
    lamp(x, S + 5, z, 0xffb070, 9, 16)
  }
  lamp(0, S + 1, -56, 0xdfe8ff, 5, 10)
  for (const z of [-68, -86, -102]) for (const x of [-10, 10]) lamp(x, CEIL - 0.4, z, 0xdfe8ff)
  for (const z of [-122, -140, -158])
    for (const x of [-8, 6]) lamp(x, CEIL - 0.4, z, 0xe0ffe8, 7, 14)
  lamp(SIGNAL.x, 4, SIGNAL.z, 0xff6040, 6, 9)
  for (let z = -182; z > -292; z -= 16) lamp(-16, 4.5, z, 0xffd080, 5, 11)
  lamp(-4, 4.5, -228, 0x9fe0ff, 6, 12)
  lamp(-4, 4.5, -240, 0x9fe0ff, 6, 12)
  for (const z of [-302, -322, -342]) {
    lamp(-14, DH - 0.5, z, 0xffe2b8, 8, 16)
    lamp(4, DH - 0.5, z, 0xffe2b8, 8, 16)
  }
  lamp(20, DH - 0.5, -330, 0x9fd0ff, 7, 12)
  lamp(20, C - 0.6, -330, 0xffd080, 5, 9)

  // ─── Weapons (back 20 s after they're taken) ────────────────────────────────────────────
  m.pickup(0, S, -7, SHOTGUN, 20)
  m.pickup(-2, S, -7, MP5, 20)
  m.pickup(0, C, -68, RIFLE, 20)
  m.pickup(-4, C, -90, SHOTGUN, 20)
  m.pickup(0, P, -128, MP5, 20)
  m.pickup(-4, P, -145, RIFLE, 20)
  m.pickup(4, P, -160, SHOTGUN, 20)
  m.pickup(-6, P, -230, RIFLE, 20)
  m.pickup(-8, P, -302, LMG, 20)
  m.pickup(8, P, -345, SHOTGUN, 20)
  m.pickup(14.5, C, -332, SNIPER, 20)

  // ─── Stages ─────────────────────────────────────────────────────────────────────────────
  const streetSpawns = [
    [-14.5, S, -12],
    [14.5, S, -9],
    [14.5, S, -22],
    [-14.5, S, -17],
    [14.5, S, -34],
    [-14.5, S, -38],
    [0, S, -47],
    [10, S, -47],
    [-10, S, -47],
  ] as const
  const platformSpawns = [
    [-18, P, -113],
    [0, P, -113],
    [-16, P, -140],
    [-16, P, -150],
    [0, P, -170],
    [8, P, -170],
    [-6, P, -165],
  ] as const
  const depotSpawns = [
    [-22, P, -350],
    [22, P, -296],
    [-8, P, -350],
    [8, P, -350],
    [-22, P, -310],
    [8, P, -300],
    [19, P, -332],
    [17, C, -348],
  ] as const

  m.stage({
    name: 'Street',
    task: 'Clear the street',
    goal: { kind: 'kill', count: 16 },
    start: starts(-3, [-3, -1.5, 0, 1.5, 3, -2.2, 2.2], S),
    zombieSpawns: [...streetSpawns],
    intensity: 0.8,
    runners: 0,
  })
  m.stage({
    name: 'Wrecks',
    task: 'Pull the fuses out of 3 wrecked cars',
    goal: {
      kind: 'activate',
      spots: [spot(-6, -12.3, S, 2.2), spot(7.3, -17, S, 2.2), spot(-6.7, -43, S, 2.2)],
      seconds: 1.5,
      what: 'Fuse',
    },
    start: starts(-8, [-2, -1, 0, 1, 2], S),
    zombieSpawns: [...streetSpawns],
    opens: 0,
    intensity: 0.9,
    runners: 0.05,
  })
  m.stage({
    name: 'Ticket hall',
    task: 'Throw the 3 breakers to free the turnstiles',
    goal: { kind: 'activate', spots: BREAKERS.map((b) => b.at), seconds: 3, what: 'Breaker' },
    start: starts(-65, [-2.4, -1.2, 0, 1.2, 2.4], C),
    zombieSpawns: [
      [-18.5, C, -76],
      [18.5, C, -78],
      [-15, C, -64.5],
      [15, C, -64.5],
      [6, C, -77.5],
      [-5, C, -77.5],
    ],
    opens: 1,
    intensity: 1,
    runners: 0.1,
    armory: MP5,
  })
  m.stage({
    name: 'Concourse',
    task: 'Hold out while the escalators unlock',
    goal: { kind: 'survive', seconds: 50 },
    start: starts(-83, [-3, -1.5, 0, 1.5, 3], C),
    zombieSpawns: [
      [-18.5, C, -108],
      [18.5, C, -108],
      [-18.5, C, -84],
      [18.5, C, -84],
      [0, C, -108],
      [-5, C, -100],
      [14, C, -100],
      [-18.5, C, -76],
      [18.5, C, -66],
    ],
    opens: 2,
    intensity: 1.2,
    runners: 0.15,
  })
  m.stage({
    name: 'Platform',
    task: 'Clear the platform',
    goal: { kind: 'kill', count: 24 },
    start: starts(-125, [-11, -10, -9, 9, 10, 11], P),
    zombieSpawns: [...platformSpawns],
    intensity: 1.3,
    runners: 0.2,
    armory: RIFLE,
  })
  m.stage({
    name: 'Signal box',
    task: 'Defend the signal box while it switches the line',
    goal: {
      kind: 'defend',
      zone: zone(SIGNAL.x - 1.1, SIGNAL.z - 0.9, SIGNAL.x + 1.1, SIGNAL.z + 0.9, P, 2.4),
      seconds: 45,
      health: 1000,
      what: 'Signal box',
    },
    start: starts(-155, [-9, -7, -5, -3], P),
    zombieSpawns: [...platformSpawns],
    opens: 3,
    intensity: 1.4,
    runners: 0.25,
  })
  m.stage({
    name: 'Tunnel',
    task: 'Run the tunnel to the pump room',
    goal: { kind: 'reach', zone: zone(-10, -238, -2, -230, P) },
    start: starts(-175, [-18, -16.5, -15, -13.5], P),
    zombieSpawns: [
      [-16, P, -200],
      [-16, P, -215],
      [-6, P, -244],
      [-16, P, -258],
      [-16, P, -185],
      [-16, P, -232],
    ],
    intensity: 1.5,
    runners: 0.3,
  })
  m.stage({
    name: 'Pump room',
    task: 'Start the 3 pumps to drain the tunnel',
    goal: {
      kind: 'activate',
      spots: PUMPS.map((p) => spot(p.spot[0], p.spot[1], P, 2)),
      seconds: 4,
      what: 'Pump',
    },
    start: starts(-234, [-8, -6, -4, -2], P),
    zombieSpawns: [
      [-16, P, -180],
      [-16, P, -200],
      [-16, P, -259],
      [-9, P, -227],
      [2, P, -234],
      [-16, P, -215],
    ],
    opens: 4,
    intensity: 1.7,
    runners: 0.35,
    armory: LMG,
  })
  m.stage({
    name: 'Depot',
    task: 'Collect 4 fuel cans for the train',
    goal: {
      kind: 'activate',
      spots: FUEL.map(([x, y, z]) => spot(x, z, y, 1.6)),
      seconds: 0,
      what: 'Fuel',
    },
    start: starts(-295, [-18, -16.5, -15, -13.5], P),
    zombieSpawns: [...depotSpawns],
    intensity: 1.9,
    runners: 0.4,
  })
  m.stage({
    name: 'Control room',
    task: 'Hold the control room while the points are set',
    goal: { kind: 'hold', zone: zone(16.5, -338.8, 23.5, -333, C), seconds: 35 },
    start: starts(-297, [17, 19, 21, 23], P),
    zombieSpawns: [...depotSpawns],
    intensity: 2.1,
    runners: 0.45,
  })
  m.stage({
    name: 'Last train',
    task: 'Defend the train while the engine warms up',
    goal: {
      kind: 'defend',
      zone: zone(TRAIN.x0, TRAIN.z0, TRAIN.x1, TRAIN.z1, P, 4),
      seconds: 60,
      health: 1600,
      what: 'Train',
    },
    start: starts(-300, [-6, -4, 4, 6], P),
    zombieSpawns: [...depotSpawns],
    intensity: 2.5,
    runners: 0.5,
  })

  m.spawn(0, S, -3, 0)
  m.spawn(0, C, -85, 0)
  m.spawn(0, P, -140, 0)
  m.randomSpawnsIn([-24, -352], [24, 0.5])
  return m.build()
}
