import { MapBuilder } from './builder.ts'
import {
  blood,
  boards,
  cable,
  hangingLamp,
  loosePanel,
  papers,
  rubble,
  run,
  scatter,
  tubeLight,
} from './coop-kit.ts'
import type { CoopZone, MapDef, Vec3 } from './types.ts'

/**
 * "Outbreak": the co-op zombies map. One long building the team fights through from the front
 * door to the roof of the loading tower, stage by stage; each stage's gate opens when its goal
 * is done, and each checkpoint hands out a bigger gun.
 *
 *   z = 0     front doors ─ survivors start here
 *   1 Lobby          z 0 … −22     kill the zombies in the lobby            → security gate (0)
 *   2 Open office    z −22 … −58   get to the server room door              → server room door (1)
 *   3 Server room    z −58 … −82   hold the console while the servers reboot → fire door (2)
 *   4 Parking garage z −82 … −130  hold the generator until the power is on → roll-up door (3)
 *   Loading tower    z −130 … −172, four floors joined by ramps (gated at the bottom):
 *   5 Loading bay    y 0     clear the bay                                 → ramp up (4)
 *   6 Second floor   y 4.5   get to the west ramp                          → ramp up (5)
 *   7 Third floor    y 9     clear the floor                               → ramp to the roof (6)
 *   8 Roof           y 13.5  hold the helipad until the helicopter lands   → escaped
 *
 * Narrow building (x ±12), wider garage and tower (x ±20). Dusk outside, low light inside.
 */
export function buildOutbreak(): MapDef {
  const m = new MapBuilder('outbreak', 'Outbreak (co-op)', {
    sunDirection: [-0.4, 0.5, 0.6],
    sunColor: 0xffb070,
    sunIntensity: 0.7,
    skyColor: 0x4a4f63,
    groundColor: 0x2b2722,
    ambientIntensity: 1.1,
    fogColor: 0x262a33,
    fogNear: 25,
    fogFar: 110,
  })
  const H = 3.4 // ceiling
  const T = 0.4 // wall thickness
  const deco = { collide: false } as const

  // ─── Shell ──────────────────────────────────────────────────────────────────────────────
  m.span([-20.5, -0.5, -172.5], [20.5, 0, 0.5], 'concrete')
  m.span([-12, 0, -82], [12, 0.012, -22], 'carpet', deco) // office + server room
  m.span([-12, 0, -22], [12, 0.012, 0], 'tile', deco) // lobby
  m.span([-12 - T, H, -82], [12 + T, H + 0.3, T], 'ceiling') // building
  m.span([-20 - T, H, -130], [20 + T, H + 0.3, -82], 'ceiling') // garage
  // Front (with glass doors you can't open: the street is overrun).
  m.span([-12 - T, 0, 0], [-3, H, T], 'wall')
  m.span([3, 0, 0], [12 + T, H, T], 'wall')
  m.span([-3, 0, 0], [3, 2.6, T], 'glass')
  m.span([-3, 2.6, 0], [3, H, T], 'wall')
  m.span([-12 - T, 0, -82], [-12, H, 0], 'wall')
  m.span([12, 0, -82], [12 + T, H, 0], 'wall')
  m.span([-20 - T, 0, -130], [-20, H, -82], 'concrete')
  m.span([20, 0, -130], [20 + T, H, -82], 'concrete')

  /** A wall across the building at `z` with a gated opening `gx` wide in the middle. */
  const gateWall = (z: number, x0: number, x1: number, gx: number, gate: number, height = H) => {
    m.span([x0, 0, z - T / 2], [-gx / 2, height, z + T / 2], 'wall')
    m.span([gx / 2, 0, z - T / 2], [x1, height, z + T / 2], 'wall')
    m.span([-gx / 2, 2.6, z - T / 2], [gx / 2, height, z + T / 2], 'wall')
    m.span([-gx / 2, 0, z - 0.15], [gx / 2, 2.6, z + 0.15], 'metal', { gate })
    // Warning stripes on the floor in front of the gate.
    m.span([-gx / 2, 0, z + T / 2], [gx / 2, 0.02, z + T / 2 + 0.3], 'marker', deco)
  }

  // ─── 1 · Lobby (z 0 … −22) ──────────────────────────────────────────────────────────────
  m.span([-4, 0, -10.5], [4, 1.1, -9.6], 'desk') // reception counter
  m.span([-4, 0, -12.5], [-3.2, 1.1, -10.5], 'desk')
  m.span([3.2, 0, -12.5], [4, 1.1, -10.5], 'desk')
  m.span([-2, 1.1, -10.3], [-1.4, 1.5, -10.2], 'screen', deco)
  m.span([1.4, 1.1, -10.3], [2, 1.5, -10.2], 'screen', deco)
  m.span([-3, 0, -21.6], [3, 2.6, -21.4], 'accent', deco) // logo wall beside the gate
  for (const [x, z] of [
    [-7, -7],
    [7, -7],
    [-7, -16],
    [7, -16],
  ] as const) {
    m.block(x, 0, z, 0.8, H, 0.8, 'plaster')
  }
  // Waiting area: sofas and a low table on the west side.
  m.block(-9.5, 0, -3.5, 2.4, 0.8, 0.9, 'fabric')
  m.block(-9.5, 0, -6.3, 2.4, 0.8, 0.9, 'fabric')
  m.block(-9.5, 0, -4.9, 1.4, 0.45, 0.8, 'wood')
  // Elevators on the east wall (zombies spill out of them).
  for (const z of [-6, -12, -18]) {
    m.span([11.7, 0, z - 1], [12, 2.5, z + 1], 'metal', deco)
    m.span([11.65, 0, z - 0.02], [11.7, 2.5, z + 0.02], 'wall', deco)
  }
  m.block(10.5, 0, -1.2, 0.6, 1.2, 0.6, 'plant')
  m.block(-10.8, 0, -20.5, 0.6, 1.2, 0.6, 'plant')
  m.label(0, 2.8, -9.8, 'RECEPTION')
  gateWall(-22, -12, 12, 4, 0)
  m.label(0, 2.9, -21.7, 'SECURITY')

  // ─── 2 · Open office (z −22 … −58) ──────────────────────────────────────────────────────
  for (const z of [-28, -34, -40, -46]) {
    for (const x of [-6, 6]) {
      m.block(x, 0, z, 4, 0.75, 1.6, 'desk')
      m.block(x, 0.75, z, 0.05, 0.35, 1.5, 'fabricAlt', deco) // divider
      m.block(x - 1, 0.75, z - 0.35, 0.5, 0.35, 0.05, 'screen', deco)
      m.block(x + 1, 0.75, z + 0.35, 0.5, 0.35, 0.05, 'screen', deco)
    }
  }
  // Glass meeting room (north-west) and kitchen counter (north-east).
  m.span([-12, 0, -50.2], [-8.5, H, -49.8], 'glass')
  m.span([-6.5, 0, -50.2], [-6, H, -49.8], 'glass')
  m.span([-6.2, 0, -58], [-5.8, H, -50.2], 'glass')
  m.block(-9, 0, -54, 3, 0.75, 1.4, 'wood')
  m.span([7, 0, -57.5], [12, 0.95, -56.8], 'desk')
  m.span([11.3, 0, -56.8], [12, 0.95, -51], 'desk')
  m.block(9, 0, -53, 0.6, 1.8, 0.6, 'metal') // fridge
  m.block(10.8, 0, -24, 0.6, 1.2, 0.6, 'plant')
  m.block(-10.8, 0, -47, 0.6, 1.2, 0.6, 'plant')
  m.span([-11.95, 1, -40], [-11.9, 2.2, -32], 'whiteboard', deco)
  gateWall(-58, -12, 12, 3, 1)
  m.label(0, 2.9, -57.7, 'SERVER ROOM')

  // ─── 3 · Server room (z −58 … −82) ──────────────────────────────────────────────────────
  for (const x of [-8, -4, 4, 8]) m.span([x - 0.4, 0, -72], [x + 0.4, 2.2, -62], 'rack')
  m.block(0, 0, -76, 2.4, 0.8, 0.9, 'desk') // the console
  m.block(-0.6, 0.8, -76.2, 0.6, 0.45, 0.06, 'screen', deco)
  m.block(0.6, 0.8, -76.2, 0.6, 0.45, 0.06, 'screen', deco)
  m.block(-10.5, 0, -79.5, 1.2, 2, 1.2, 'metal') // cooling units
  m.block(10.5, 0, -79.5, 1.2, 2, 1.2, 'metal')
  m.label(0, 1.9, -76, 'CONSOLE')
  gateWall(-82, -20, 20, 4, 2)
  m.label(0, 2.9, -81.7, 'GARAGE')

  // ─── 4 · Parking garage (z −82 … −130) ──────────────────────────────────────────────────
  for (const x of [-12, -4, 4, 12]) {
    for (const z of [-92, -102, -112, -122]) m.block(x, 0, z, 0.8, H, 0.8, 'concrete')
  }
  /** A parked car across a bay against the side wall (`side` −1 west, 1 east). */
  const car = (side: number, z: number) => {
    const x = side * 17.4
    m.block(x, 0.15, z, 4.4, 0.8, 1.9, 'accent')
    m.block(x + side * 0.3, 0.95, z, 2.4, 0.55, 1.7, 'glass')
    for (const dx of [-1.4, 1.4])
      for (const dz of [-0.85, 0.85]) m.block(x + dx, 0, z + dz, 0.6, 0.6, 0.25, 'cover', deco)
  }
  for (const z of [-88, -96, -112, -120]) car(-1, z)
  for (const z of [-92, -104, -116]) car(1, z)
  for (let z = -86; z > -128; z -= 4) {
    m.span([-20, 0, z - 0.05], [-15, 0.012, z + 0.05], 'marker', deco)
    m.span([15, 0, z - 0.05], [20, 0.012, z + 0.05], 'marker', deco)
  }
  m.block(16.5, 0, -126, 2.4, 1.6, 1.4, 'metal') // the generator
  m.block(16.5, 1.6, -126.4, 0.3, 0.9, 0.3, 'metal')
  m.label(16.5, 2.4, -126, 'GENERATOR')
  gateWall(-130, -20, 20, 8, 3)
  m.label(0, 2.9, -129.7, 'LOADING BAY')

  // ─── 5–8 · Loading tower (z −130 … −172): four floors, ramps up the sides ───────────────
  const TZ0 = -172
  const TZ1 = -130
  const FLOORS = [0, 4.5, 9, 13.5] as const
  const TOP = 14.7 // parapet top
  m.span([-20 - T, 0, TZ0 - T], [-20, TOP, TZ1], 'concrete')
  m.span([20, 0, TZ0 - T], [20 + T, TOP, TZ1], 'concrete')
  m.span([-20 - T, 0, TZ0 - T], [20 + T, TOP, TZ0], 'concrete')
  m.span([-20 - T, H, TZ1 - T / 2], [20 + T, TOP, TZ1 + T / 2], 'concrete') // above the door

  // Ramps: 20°, rising 4.5 m over 12.36 m. A and C on the east side climb north, B on the west
  // climbs south. Each runs in its own walled lane with a gate at the bottom.
  const RUN = 4.5 / Math.tan((20 * Math.PI) / 180)
  const EAST = { x0: 14, x1: 20, low: -138, high: -138 - RUN } // A and C (z falls going up)
  const WEST = { x0: -20, x1: -14, low: -162, high: -162 + RUN } // B (z rises going up)
  /** A floor slab over the whole tower, minus the hole a ramp comes up through. */
  const slab = (y: number, hole: { x0: number; x1: number; z0: number; z1: number } | null) => {
    const mat = 'concrete'
    if (!hole) {
      m.span([-20, y - 0.3, TZ0], [20, y, TZ1], mat)
      return
    }
    m.span([-20, y - 0.3, hole.z1], [20, y, TZ1], mat)
    m.span([-20, y - 0.3, TZ0], [20, y, hole.z0], mat)
    if (hole.x0 > -20) m.span([-20, y - 0.3, hole.z0], [hole.x0, y, hole.z1], mat)
    if (hole.x1 < 20) m.span([hole.x1, y - 0.3, hole.z0], [20, y, hole.z1], mat)
  }
  const eastHole = { x0: EAST.x0, x1: EAST.x1, z0: EAST.high, z1: EAST.low }
  const westHole = { x0: WEST.x0, x1: WEST.x1, z0: WEST.low, z1: WEST.high }
  slab(FLOORS[1], eastHole)
  slab(FLOORS[2], westHole)
  slab(FLOORS[3], eastHole)

  /** Ramp lane on the east side from floor `y`: side wall, gate + lintel, rail round the top. */
  const eastLane = (y: number, gate: number, ceiling: number) => {
    m.ramp(17, y, EAST.low, 6, RUN, 20, 'ramp')
    m.span([13.8, y, EAST.high], [14, ceiling, EAST.low + 0.4], 'wall')
    m.span([14, y, EAST.low + 0.4], [20, y + 3, EAST.low + 0.7], 'metal', { gate })
    m.span([14, y + 3, EAST.low + 0.4], [20, ceiling, EAST.low + 0.7], 'wall')
    m.span([14, y, EAST.low + 0.7], [20, y + 0.02, EAST.low + 1], 'marker', deco)
    const up = y + 4.5
    m.span([13.8, up, EAST.high], [14, up + 1.1, EAST.low], 'metal') // rail on the floor above
    m.span([13.8, up, EAST.low], [20, up + 1.1, EAST.low + 0.4], 'metal')
    m.navLink([17, y, EAST.low + 1.6], [17, up, EAST.high - 1.1])
  }
  eastLane(FLOORS[0], 4, FLOORS[1] - 0.3)
  eastLane(FLOORS[2], 6, FLOORS[3] - 0.3)
  // West lane (B), second floor → third floor; you walk in from the north.
  m.ramp(-17, FLOORS[1], WEST.low, 6, RUN, 20, 'ramp', 1)
  m.span([-14, FLOORS[1], WEST.low - 0.4], [-13.8, FLOORS[2] - 0.3, WEST.high], 'wall')
  m.span([-20, FLOORS[1], WEST.low - 0.7], [-14, FLOORS[1] + 3, WEST.low - 0.4], 'metal', {
    gate: 5,
  })
  m.span([-20, FLOORS[1] + 3, WEST.low - 0.7], [-14, FLOORS[2] - 0.3, WEST.low - 0.4], 'wall')
  m.span([-20, FLOORS[1], WEST.low - 1], [-14, FLOORS[1] + 0.02, WEST.low - 0.7], 'marker', deco)
  m.span([-14, FLOORS[2], WEST.low], [-13.8, FLOORS[2] + 1.1, WEST.high], 'metal')
  m.span([-20, FLOORS[2], WEST.low - 0.4], [-13.8, FLOORS[2] + 1.1, WEST.low], 'metal')
  m.navLink([-17, FLOORS[1], WEST.low - 1.6], [-17, FLOORS[2], WEST.high + 1.1])

  // Loading bay (ground): shelving, pallets, a truck.
  for (const x of [-10, -4]) m.block(x, 0, -152, 1.2, 2.6, 10, 'metal')
  m.block(-15, 0, -166, 3, 3, 7, 'accent') // truck
  for (const [x, z] of [
    [4, -142],
    [6, -160],
    [10, -168],
    [-1, -166],
  ] as const) {
    m.block(x, 0, z, 1.2, 1.2, 1.2, 'wood')
  }
  m.label(17, 3.2, -136.4, 'RAMP UP')
  // Second floor: offices.
  const L1 = FLOORS[1]
  for (const [x, z] of [
    [-6, -140],
    [-6, -146],
    [4, -158],
    [4, -164],
  ] as const) {
    m.block(x, L1, z, 4, 0.75, 1.6, 'desk')
  }
  m.span([2, L1, -153.2], [10, L1 + 2.4, -152.8], 'plaster')
  m.span([-8, L1, -170.2], [8, L1 + 2.6, -169.8], 'glass')
  m.label(-17, L1 + 3.2, -163.6, 'RAMP UP')
  // Third floor: storage.
  const L2 = FLOORS[2]
  for (const [x, z] of [
    [-6, -142],
    [-4.8, -142.3],
    [6, -146],
    [-8, -158],
    [8, -166],
    [9.2, -165.7],
  ] as const) {
    m.block(x, L2, z, 1.2, 1.2, 1.2, 'wood')
  }
  m.block(4, L2, -158, 6, 2.2, 1, 'metal')
  m.label(17, L2 + 3.2, -136.4, 'ROOF')
  // Roof: helipad, AC units, open sky.
  const R = FLOORS[3]
  m.span([-5, R, -160], [5, R + 0.015, -150], 'marker', deco)
  m.span([-3.5, R, -159], [3.5, R + 0.02, -151], 'accent', deco)
  m.label(0, R + 0.4, -155, 'H')
  m.block(-12, R, -140, 2, 1.4, 2, 'metal')
  m.block(-12, R, -165, 2, 1.4, 2, 'metal')
  m.block(8, R, -168, 2, 1.4, 2, 'metal')

  // ─── Lights and set dressing ────────────────────────────────────────────────────────────
  const rnd = scatter(5)
  // Lobby and offices: tube lights, a few on their way out.
  for (let z = -4; z > -80; z -= 9) {
    for (const x of [-6, 6]) {
      tubeLight(m, x, H, z, 'z', {
        drop: 0.35,
        color: 0xd9e4ff,
        intensity: 7,
        distance: 11,
        flicker: (x === 6 && z === -31) || (x === -6 && z === -49) ? 0.7 : 0,
      })
    }
  }
  m.light({ kind: 'point', pos: [0, H - 0.4, -76], color: 0x6fd0ff, intensity: 9, distance: 10 })
  boards(m, 0, 0, -0.15, 6, 'x') // the front doors, boarded up from inside
  blood(m, 2, 0, -14, rnd, 1.3)
  blood(m, -8, 0, -19, rnd)
  papers(m, 1, 0, -8, rnd, 6, 2)
  papers(m, -4, 0, -37, rnd, 10, 3)
  papers(m, 6, 0, -44, rnd, 8, 3)
  blood(m, 8, 0, -38, rnd, 1.4)
  blood(m, -2, 0, -52, rnd)
  rubble(m, -9, 0, -27, rnd, 6)
  for (const [x, z] of [
    [-3, -30],
    [9, -47],
    [-8, -64],
    [3, -71],
  ] as const) {
    loosePanel(m, x, H, z)
  }
  cable(m, [-12, H - 0.05, -68], [-4, H - 0.05, -66], 0.6)
  cable(m, [12, H - 0.05, -61], [5, H - 0.05, -64], 0.5)
  papers(m, 2, 0, -78, rnd, 6, 1.5)
  // Garage: lamps hanging from the slab, oil and blood on the floor.
  for (let z = -88; z > -130; z -= 12) {
    for (const x of [-10, 10]) {
      hangingLamp(m, x, H, z, {
        drop: 0.5,
        color: 0xffd9a0,
        intensity: 7,
        distance: 12,
        flicker: x === -10 && z === -112 ? 0.7 : 0,
      })
    }
  }
  m.light({ kind: 'point', pos: [16, H - 0.4, -124], color: 0xffa040, intensity: 9, distance: 9 })
  blood(m, -6, 0, -96, rnd, 1.5)
  blood(m, 7, 0, -118, rnd)
  rubble(m, 0, 0, -100, rnd, 8, 2)
  rubble(m, -14, 0, -127, rnd, 6)
  run(m, [-19.8, 3, -84], [-19.8, 3, -128], 0.2, 'metal') // pipe along the wall
  run(m, [19.8, 3, -84], [19.8, 3, -120], 0.2, 'metal')
  // Tower: a lamp hanging over each bay, floor by floor.
  for (const y of [3.8, 8.3, 12.8]) {
    for (const z of [-136, -150, -164]) {
      for (const x of [-8, 6]) {
        hangingLamp(m, x, y + 0.4, z, {
          drop: 0.6,
          intensity: 6,
          distance: 11,
          flicker:
            (y === 8.3 && z === -150 && x === 6) || (y === 12.8 && z === -164 && x === -8)
              ? 0.7
              : 0,
        })
      }
    }
  }
  m.light({ kind: 'point', pos: [0, 16, -155], color: 0xffe0b0, intensity: 14, distance: 22 })
  blood(m, -6, 0, -146, rnd, 1.4)
  rubble(m, 8, 0, -140, rnd, 7)
  papers(m, -2, 4.5, -150, rnd, 9, 3)
  blood(m, 10, 4.5, -142, rnd)
  rubble(m, -4, 9, -164, rnd, 8, 2)
  blood(m, 2, 9, -138, rnd, 1.3)
  blood(m, -10, 13.5, -150, rnd)

  // ─── Weapons (back 20 s after they're taken) ────────────────────────────────────────────
  const RIFLE = 1
  const SHOTGUN = 3
  const MP5 = 5
  const LMG = 7
  m.pickup(-2.5, 0, -8.8, MP5, 20) // in front of reception
  m.pickup(2.5, 0, -8.8, SHOTGUN, 20)
  m.pickup(0, 0, -24.5, RIFLE, 20) // just past the security gate
  m.pickup(8, 0, -55.8, SHOTGUN, 20) // kitchen
  m.pickup(-9, 0, -52.3, MP5, 20) // meeting room
  m.pickup(1.8, 0, -74.4, RIFLE, 20) // by the console
  m.pickup(-2, 0, -84.5, MP5, 20) // garage entrance
  m.pickup(2, 0, -84.5, SHOTGUN, 20)
  m.pickup(2, 0, -145, LMG, 20) // loading bay
  m.pickup(2, 0, -160, SHOTGUN, 20)
  m.pickup(0, 4.5, -145, RIFLE, 20) // second floor
  m.pickup(0, 9, -150, LMG, 20) // third floor

  // ─── Stages ─────────────────────────────────────────────────────────────────────────────
  const zone = (x0: number, z0: number, x1: number, z1: number, y = 0): CoopZone => ({
    min: [Math.min(x0, x1), y, Math.min(z0, z1)],
    max: [Math.max(x0, x1), y + 3, Math.max(z0, z1)],
  })
  /** A row of start spots across x, facing north (−Z) — or south with `yaw` π. */
  const starts = (z: number, xs: number[], y = 0, yaw = 0) =>
    xs.map((x) => ({ pos: [x, y, z] as Vec3, yaw }))

  m.stage({
    name: 'Lobby',
    task: 'Clear the lobby',
    goal: { kind: 'kill', count: 14 },
    start: starts(-2.5, [-3, -1.5, 0, 1.5, 3, -2.2, 2.2]),
    zombieSpawns: [
      [10.6, 0, -6],
      [10.6, 0, -12],
      [10.6, 0, -18],
      [-10.6, 0, -18],
      [-10.6, 0, -12],
      [0, 0, -14],
      [-5, 0, -20.5],
      [5, 0, -20.5],
    ],
    opens: 0,
    intensity: 0.8,
    runners: 0,
  })
  m.stage({
    name: 'Open office',
    task: 'Get to the server room door',
    goal: { kind: 'reach', zone: zone(-3, -57.6, 3, -55) },
    start: starts(-24.5, [-2.5, -1.2, 1.2, 2.5, -1.8, 1.8]),
    zombieSpawns: [
      [-10.5, 0, -30],
      [10.5, 0, -30],
      [-10.5, 0, -43],
      [10.5, 0, -43],
      [-9, 0, -56.5],
      [9, 0, -55],
      [0, 0, -50],
      [-10.5, 0, -19],
      [10.5, 0, -19],
    ],
    opens: 1,
    intensity: 1,
    runners: 0.1,
    armory: MP5,
  })
  m.stage({
    name: 'Server room',
    task: 'Hold the console while the servers reboot',
    goal: { kind: 'hold', zone: zone(-3.5, -79.5, 3.5, -73), seconds: 40 },
    start: starts(-60, [-2, -0.7, 0.7, 2, -1.4, 1.4]),
    zombieSpawns: [
      [-10.6, 0, -60],
      [10.6, 0, -60],
      [-10.4, 0, -70],
      [10.4, 0, -70],
      [-6, 0, -80.5],
      [6, 0, -80.5],
      [-10.5, 0, -45],
      [10.5, 0, -45],
    ],
    opens: 2,
    intensity: 1.2,
    runners: 0.15,
  })
  m.stage({
    name: 'Parking garage',
    task: 'Start the generator and keep it running',
    goal: { kind: 'hold', zone: zone(12.5, -129, 19.5, -121), seconds: 35 },
    start: starts(-84.5, [-3, -1.5, 0, 1.5, 3, -0.8, 0.8]),
    zombieSpawns: [
      [-18.5, 0, -84],
      [18.5, 0, -84],
      [-18.5, 0, -128.5],
      [-8, 0, -128.5],
      [-8, 0, -116],
      [8, 0, -98],
      [0, 0, -108],
      [-16, 0, -100],
    ],
    opens: 3,
    intensity: 1.4,
    runners: 0.2,
    armory: RIFLE,
  })
  m.stage({
    name: 'Loading bay',
    task: 'Clear the loading bay',
    goal: { kind: 'kill', count: 22 },
    start: starts(-132.5, [-3, -1.5, 0, 1.5, 3, -0.8, 0.8]),
    zombieSpawns: [
      [-18.5, 0, -170.5],
      [0, 0, -170.5],
      [10, 0, -170.5],
      [-18.5, 0, -140],
      [-7, 0, -160],
      [8, 0, -152],
      [-18.5, 0, -156],
    ],
    opens: 4,
    intensity: 1.6,
    runners: 0.25,
  })
  m.stage({
    name: 'Second floor',
    task: 'Fight your way to the west ramp',
    goal: { kind: 'reach', zone: zone(-20, -171, -14, -163.4, L1) },
    start: starts(-152, [15.5, 17, 18.5, 16.2, 17.8], L1),
    zombieSpawns: [
      [-18.5, L1, -133],
      [0, L1, -133],
      [10, L1, -133],
      [0, L1, -171],
      [10, L1, -171],
      [-8, L1, -160],
      [-18.5, L1, -140],
    ],
    opens: 5,
    intensity: 1.8,
    runners: 0.3,
    armory: LMG,
  })
  m.stage({
    name: 'Third floor',
    task: 'Clear the third floor',
    goal: { kind: 'kill', count: 28 },
    start: starts(-147.6, [-18.5, -17, -15.5, -17.8, -16.2], L2, Math.PI),
    zombieSpawns: [
      [18.5, L2, -171],
      [0, L2, -171],
      [-10, L2, -171],
      [5, L2, -133],
      [18.5, L2, -133],
      [-8, L2, -137],
      [10, L2, -155],
    ],
    opens: 6,
    intensity: 2,
    runners: 0.35,
  })
  m.stage({
    name: 'Roof',
    task: 'Hold the helipad until the helicopter lands',
    goal: { kind: 'hold', zone: zone(-5, -160, 5, -150, R), seconds: 45 },
    start: starts(-152, [15.5, 17, 18.5, 16.2, 17.8], R),
    zombieSpawns: [
      [-18.5, R, -132],
      [-18.5, R, -171],
      [18.5, R, -171],
      [5, R, -132],
      [-18.5, R, -150],
      [0, R, -171],
    ],
    intensity: 2.4,
    runners: 0.45,
  })

  m.spawn(0, 0, -2.5, 0)
  // One per tower floor too: the nav grid and random spawns cover every floor these stand on.
  for (const y of FLOORS.slice(1)) m.spawn(0, y, -140, 0)
  m.randomSpawnsIn([-20, TZ0], [20, 0])
  return m.build()
}
