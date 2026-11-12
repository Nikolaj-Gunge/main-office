import { MapBuilder } from './builder.ts'
import type { CoopZone, MapDef, Vec3 } from './types.ts'

/**
 * "Outbreak": the co-op zombies map. One long building on one floor that the team fights
 * through from the front door to the loading yard, stage by stage. Each stage's gate opens when
 * its goal is done:
 *
 *   z = 0     front doors ─ survivors start here
 *   1 Lobby          z 0 … −22     kill the zombies in the lobby            → security gate (0)
 *   2 Open office    z −22 … −58   get to the server room door              → server room door (1)
 *   3 Server room    z −58 … −82   hold the console while the servers reboot → fire door (2)
 *   4 Parking garage z −82 … −130  hold the generator until the power is on → roll-up door (3)
 *   5 Loading yard   z −130 … −160 hold the van until it starts            → escaped
 *
 * Narrow building (x ±12), wider garage and yard (x ±20). Dusk outside, low light inside.
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
  m.span([-20.5, -0.5, -160.5], [20.5, 0, 0.5], 'concrete')
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
  // Yard: tall walls, open sky.
  m.span([-20 - T, 0, -160 - T], [-20, 4.5, -130], 'concrete')
  m.span([20, 0, -160 - T], [20 + T, 4.5, -130], 'concrete')
  m.span([-20 - T, 0, -160 - T], [20 + T, 4.5, -160], 'concrete')

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
  m.label(0, 2.9, -129.7, 'LOADING YARD')

  // ─── 5 · Loading yard (z −130 … −160) ───────────────────────────────────────────────────
  m.block(-12, 0, -142, 2.4, 2.6, 6, 'metal') // shipping containers
  m.block(11, 0, -146, 6, 2.6, 2.4, 'metal')
  m.block(14, 0, -137, 2.4, 2.6, 4, 'metal')
  m.block(-6, 0, -150, 1.2, 1.2, 1.2, 'wood') // crates
  m.block(-4.8, 0, -150.3, 1.2, 1.2, 1.2, 'wood')
  m.block(6, 0, -138, 1.2, 1.2, 1.2, 'wood')
  m.block(0, 0, -156, 2.2, 2.3, 5, 'accent') // the van
  m.block(0, 1.2, -153.3, 2, 0.8, 0.4, 'glass', deco)
  m.label(0, 3, -156, 'VAN')

  // ─── Lights ─────────────────────────────────────────────────────────────────────────────
  for (let z = -4; z > -80; z -= 9) {
    for (const x of [-6, 6]) {
      m.light({ kind: 'point', pos: [x, H - 0.4, z], color: 0xd9e4ff, intensity: 7, distance: 11 })
    }
  }
  m.light({ kind: 'point', pos: [0, H - 0.4, -76], color: 0x6fd0ff, intensity: 9, distance: 10 })
  for (let z = -88; z > -130; z -= 12) {
    for (const x of [-10, 10]) {
      m.light({ kind: 'point', pos: [x, H - 0.4, z], color: 0xffd9a0, intensity: 7, distance: 12 })
    }
  }
  m.light({ kind: 'point', pos: [16, H - 0.4, -124], color: 0xffa040, intensity: 9, distance: 9 })
  m.light({ kind: 'point', pos: [0, 4, -150], color: 0xffe0b0, intensity: 12, distance: 18 })

  // ─── Weapons (back 20 s after they're taken) ────────────────────────────────────────────
  const RIFLE = 1
  const SHOTGUN = 3
  const MP5 = 5
  m.pickup(-2.5, 0, -8.8, MP5, 20) // in front of reception
  m.pickup(2.5, 0, -8.8, SHOTGUN, 20)
  m.pickup(0, 0, -24.5, RIFLE, 20) // just past the security gate
  m.pickup(8, 0, -55.8, SHOTGUN, 20) // kitchen
  m.pickup(-9, 0, -52.3, MP5, 20) // meeting room
  m.pickup(1.8, 0, -74.4, RIFLE, 20) // by the console
  m.pickup(-2, 0, -84.5, MP5, 20) // garage entrance
  m.pickup(2, 0, -84.5, SHOTGUN, 20)
  m.pickup(-5.4, 0, -148.6, RIFLE, 20) // by the crates in the yard

  // ─── Stages ─────────────────────────────────────────────────────────────────────────────
  const zone = (x0: number, z0: number, x1: number, z1: number): CoopZone => ({
    min: [Math.min(x0, x1), 0, Math.min(z0, z1)],
    max: [Math.max(x0, x1), 3, Math.max(z0, z1)],
  })
  /** A row of start spots across x, facing north (−Z). */
  const starts = (z: number, xs: number[]) => xs.map((x) => ({ pos: [x, 0, z] as Vec3, yaw: 0 }))

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
    intensity: 1.15,
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
    intensity: 1.3,
    runners: 0.25,
  })
  m.stage({
    name: 'Loading yard',
    task: 'Hold out by the van until it starts',
    goal: { kind: 'hold', zone: zone(-5, -159.5, 5, -150.5), seconds: 30 },
    start: starts(-132, [-3, -1.5, 0, 1.5, 3, -0.8, 0.8]),
    zombieSpawns: [
      [-18.5, 0, -158.5],
      [18.5, 0, -158.5],
      [-18.5, 0, -133],
      [18.5, 0, -133],
      [-9, 0, -158.5],
      [9, 0, -158.5],
      [-18, 0, -146],
      [18, 0, -152],
    ],
    intensity: 1.5,
    runners: 0.35,
  })

  m.spawn(0, 0, -2.5, 0)
  m.randomSpawnsIn([-20, -160], [20, 0])
  return m.build()
}
