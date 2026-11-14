import * as THREE from 'three'
import { type BodyMesh, Kit, mix, noise3, pickOf, seeded, shade, step } from './body-kit.ts'
import {
  arms,
  FIGURE,
  type Figure,
  faceZ,
  feet,
  fists,
  HEAD,
  type HeadShape,
  hairCap,
  type Legwear,
  legs,
  type Paint,
  skull,
  skullPoint,
  TORSO_SEG,
  torso,
  torsoPoint,
} from './figure.ts'

/**
 * The dead, one silhouette per kind so you can tell them apart at a glance in the dark:
 *  - walker:   a dead office worker in a ragged shirt, one arm flayed to the bone, jaw hanging off;
 *  - runner:   starved and lanky, ribs and spine showing, long greasy hair, sunken yellow eyes;
 *  - brute:    a hunched mountain in torn overalls: neck and back mass, growths, huge fists, chains;
 *  - screamer: tall stretched skull with the jaw unhinged, a bloated throat sack, long clawed fingers;
 *  - stalker:  glossy black and wiry, spines down the back, long bone claws, slit eyes.
 * Smooth skinned bodies (figure.ts) on the hitbox skeleton; baked once per kind and variant and
 * shared by every copy (one draw call for the body, one for the glowing eyes).
 */

export type ZombieLook = 'zombie' | 'runner' | 'brute' | 'screamer' | 'stalker'

const SIDES = [-1, 1] as const
/** How many looks each kind comes in (picked by the zombie's id). */
const VARIANTS = 8

const HEADS: Record<ZombieLook, HeadShape> = {
  zombie: { ...HEAD, jaw: 0.2, chin: 0 },
  runner: { ...HEAD, rx: 0.084, rz: 0.106, ry: 0.13, jaw: 0.34, chin: 0.004 },
  brute: { ...HEAD, rx: 0.092, ry: 0.112, rz: 0.104, cy: -0.01, jaw: 0.05, chin: 0.02 },
  screamer: { ...HEAD, rx: 0.084, ry: 0.13, rz: 0.104, cy: 0.03, stretch: 0.09, jaw: 0.3 },
  stalker: { ...HEAD, rx: 0.088, ry: 0.115, rz: 0.11, crest: 0.07, jaw: 0.38, chin: 0.006 },
}
const EYE_AT: Record<ZombieLook, { x: number; y: number; glow: number }> = {
  zombie: { x: 0.037, y: 0.024, glow: 0.14 },
  runner: { x: 0.034, y: 0.026, glow: 0.18 },
  brute: { x: 0.036, y: 0.0, glow: 0.16 },
  screamer: { x: 0.03, y: 0.075, glow: 0.11 },
  stalker: { x: 0.036, y: 0.02, glow: 0.08 },
}
/** Eyes: where they sit on the head (±x, y, front z) and how big their glow halo is. */
export const EYES: Record<ZombieLook, { x: number; y: number; z: number; glow: number }> =
  Object.fromEntries(
    Object.entries(EYE_AT).map(([look, e]) => [
      look,
      { ...e, z: faceZ(HEADS[look as ZombieLook], e.x, e.y) },
    ]),
  ) as Record<ZombieLook, { x: number; y: number; z: number; glow: number }>

const cache = new Map<string, BodyMesh>()

/** The baked body of one kind and variant (seed: anything stable per zombie, e.g. its id). */
export function zombieBody(look: ZombieLook, seed: number): BodyMesh {
  const variant = (Math.imul(Math.floor(seed) + 1, 2654435761) >>> 16) % VARIANTS
  const key = `${look}:${variant}`
  let mesh = cache.get(key)
  if (!mesh) {
    const k = new Kit()
    BUILD[look](k, variant, seeded(variant * 31 + look.length))
    mesh = k.build()
    cache.set(key, mesh)
  }
  return mesh
}

type Build = (k: Kit, v: number, rnd: () => number) => void

/** Dead skin: mottled, bruised, darker in the hollows. */
const mottled = (base: number, bruise: number) => (q: THREE.Vector3) => {
  const n = noise3(q.x * 13, q.y * 11, q.z * 13)
  return mix(shade(base, 0.9 + 0.2 * n), bruise, 0.5 * step(0.62, 0.8, n))
}

/** Glowing eyes in their sockets, a dark socket round each. */
function eyes(k: Kit, look: ZombieLook, size: readonly [number, number], socket = 0x140c08): void {
  const e = EYES[look]
  k.on('head')
  for (const s of SIDES) {
    k.blob(
      socket,
      [size[0] * 1.5, size[1] * 1.7, 0.01],
      [s * e.x, e.y, e.z + 0.006],
      [0, 0, 0],
      6,
      4,
    )
    k.blob('eyes', [size[0], size[1], 0.007], [s * e.x, e.y, e.z - 0.002], [0, 0, 0], 6, 4)
  }
}

/** A row of teeth along x at height y in front of z. */
function teeth(k: Kit, color: number, width: number, n: number, y: number, z: number, h = 0.02) {
  for (let i = 0; i < n; i++) {
    const x = -width / 2 + (width * (i + 0.5)) / n
    k.box(color, [(width / n) * 0.7, h * (0.8 + ((i * 7) % 3) * 0.15), 0.008], [x, y, z])
  }
}

/** A ragged skirt of cloth hanging from a torso ring (shirt tails, a gown, a torn tank top). */
function rags(
  k: Kit,
  fig: Figure,
  color: number | Paint,
  ring: number,
  min: number,
  max: number,
  rnd: () => number,
  inflate = 0.012,
): void {
  const lengths = Array.from({ length: TORSO_SEG }, () => min + rnd() * (max - min))
  k.on('torso').surface(
    typeof color === 'number' ? color : 0xffffff,
    TORSO_SEG,
    3,
    (u, v) => {
      const i = Math.round(u * TORSO_SEG) % TORSO_SEG
      const q = torsoPoint(fig, (i / TORSO_SEG) * Math.PI * 2, ring, inflate)
      const len = (lengths[i] as number) * v
      const flare = 1 + 0.12 * v
      return [q.x * flare, q.y - len, q.z * flare]
    },
    { colorFn: typeof color === 'number' ? undefined : (q) => color(q) },
  )
}

/** Clawed fingers instead of fists: long joints ending in hooks. */
function clawHands(k: Kit, skin: number, claw: number, fingers: number, length: number): void {
  for (const hand of ['handL', 'handR'] as const) {
    k.on(hand).blob(skin, [0.032, 0.045, 0.018], [0, 0.04, 0], [0, 0, 0], 8, 5)
    for (let i = 0; i < fingers; i++) {
      const x = -0.024 + (i * 0.048) / Math.max(1, fingers - 1)
      const spread = (i - (fingers - 1) / 2) * 0.14
      k.tube(
        skin,
        [
          [0.07, 0.008, 0.009, x, 0],
          [0.07 + length * 0.5, 0.007, 0.008, x + Math.sin(spread) * length * 0.5, -0.012],
          [0.07 + length, 0.005, 0.006, x + Math.sin(spread) * length, -0.03],
        ],
        5,
      )
      k.spike(
        claw,
        0.012,
        0.045,
        [x + Math.sin(spread) * length, 0.07 + length, -0.03],
        [-0.6, 0, -spread],
        4,
      )
    }
  }
}

// --- Walker: a dead office worker in rags ---------------------------------------------------------

const walker: Build = (k, v, rnd) => {
  const flesh = 0x80907a
  const bruise = 0x4a5a48
  const blood = 0x5a1010
  const gore = 0x7e2626
  const bone = 0xd9d0b4
  const shirt = pickOf([0xb3ad98, 0x4a5a74, 0x6e4e3a, 0x5c6a52, 0x8a7a58, 0x7a3a3a], v)
  const trousers = pickOf([0x2c2f38, 0x3c3528, 0x2a3442], v >> 1)
  const hair = pickOf([0x2a2018, 0x5a3b1e, 0x161616, 0x8a8a84], v >> 1)
  const bareArm = (v >> 2) & 1 ? 'armL' : 'armR'
  const bald = v % 3 === 0
  const fig: Figure = { ...FIGURE, fem: v % 4 === 3 ? 0.8 : 0 }
  const h = HEADS.zombie
  const skin = mottled(flesh, bruise)
  const stains = (q: THREE.Vector3, c: number) => {
    const n = noise3(q.x * 7 + v, q.y * 6, q.z * 7)
    return n > 0.78 ? blood : n > 0.7 ? shade(c, 0.6) : c
  }

  // Shirt ripped open on one side over the ribs, blood down the front and back.
  torso(k, fig, (q) => {
    if (q.y < 0.93) return stains(q, trousers)
    if (q.y > 1.5) return skin(q)
    const torn = q.z < 0 && q.x < -0.02 && q.x > -0.15 && q.y > 1.1 && q.y < 1.38
    if (torn) return Math.abs(Math.sin(q.y * 75)) > 0.7 ? bone : mix(gore, flesh, 0.5)
    return stains(q, shirt)
  })
  rags(k, fig, (q) => stains(q, shirt), 3, 0.04, 0.16, rnd)
  arms(k, fig, (q) => (q.y < -0.04 ? stains(q, shirt) : skin(q)), { cuff: -0.04, baggy: 0.008 })
  // The flayed arm: grey meat and the bone through it.
  const bare = k.on(bareArm)
  bare.blob(gore, [0.05, 0.08, 0.052], [0, 0.0, 0], [0, 0, 0], 8, 5)
  bare.spike(bone, 0.022, 0.16, [0.02, 0.0, 0.0], [0, 0, -0.25], 5)
  fists(k, shade(flesh, 0.8))
  const wear: Legwear = { hem: 0.2, baggy: 0.012, straight: 0.06, cuff: false }
  legs(k, fig, wear, (q) =>
    q.y >= 0.2 + 0.05 * noise3(q.x * 30, 0, q.z * 30) ? stains(q, trousers) : skin(q),
  )
  feet(k, (q) => shade(flesh, q.y < -0.215 ? 0.5 : 0.75))

  skull(k, h, (q) => {
    if (q.z < -0.06 && Math.abs(q.x) < 0.045 && q.y < -0.04 && q.y > -0.1) return 0x120505 // no jaw
    if (q.z < -0.06 && q.x < -0.02 && q.y < -0.05) return blood
    return skin(q)
  })
  eyes(k, 'zombie', [0.013, 0.009])
  const fz = faceZ(h, 0, -0.04)
  k.on('head')
  teeth(k, bone, 0.07, 5, -0.045, fz - 0.004)
  // The jaw hanging off one hinge.
  k.blob(flesh, [0.045, 0.018, 0.04], [0.035, -0.15, -0.07], [0.6, 0, 0.55], 8, 4)
  teeth(k, bone, 0.05, 3, -0.135, -0.105, 0.016)
  k.blob(mix(flesh, 0x000000, 0.2), [0.016, 0.03, 0.01], [-0.02, 0.0, fz + 0.002], [0, 0, 0], 6, 4) // nose stump
  if (bald) {
    k.blob(gore, [0.045, 0.012, 0.04], [0.04, h.cy + h.ry - 0.005, -0.02], [0, 0, 0.3], 6, 4)
    k.blob(bone, [0.026, 0.01, 0.022], [0.045, h.cy + h.ry, -0.02], [0, 0, 0.3], 6, 4)
  } else {
    hairCap(
      k,
      h,
      (q) => (noise3(q.x * 30, q.y * 30, q.z * 30) > 0.62 ? shade(flesh, 0.85) : hair),
      {
        front: 0.28,
        side: 0.46,
        back: 0.62,
      },
      () => 0.004,
    )
    for (let i = 0; i < 3; i++) {
      const q = skullPoint(h, 0.55 * Math.PI, Math.PI * (0.3 + i * 0.2), 0.01)
      k.tube(
        hair,
        [
          [q.y, 0.008, 0.006, q.x, q.z],
          [q.y - 0.12 - rnd() * 0.06, 0.004, 0.004, q.x * 1.1, q.z + 0.02],
        ],
        4,
      )
    }
  }
}

// --- Runner: starved, lanky, all ribs and hair -----------------------------------------------------

const runner: Build = (k, v, rnd) => {
  const flesh = 0xb7ad82
  const hollow = 0x6a6244
  const bone = 0xe2d8b0
  const blood = 0x6a1414
  const hair = pickOf([0x18120e, 0x3a2414, 0x101010, 0x4a4030], v)
  const shorts = pickOf([0x34466a, 0x5e5638, 0x2a2a2a, 0x5a2a2a], v >> 1)
  const longHair = (v & 1) === 0
  const tank = (v >> 2) & 1
  const fig: Figure = {
    ...FIGURE,
    girth: 0.82,
    depth: 0.82,
    limb: 0.72,
    waist: 0.75,
    shoulders: 1.05,
  }
  const h = HEADS.runner
  const skin = mottled(flesh, 0x8a7a50)
  // Bare and starved: every rib in shadow, the belly sunk in, blood here and there.
  const ribbed = (q: THREE.Vector3) => {
    let c = skin(q)
    if (q.y > 1.1 && q.y < 1.4) {
      const rib = Math.abs(Math.sin((q.y - 1.1) * 62))
      if (Math.abs(q.x) > 0.02) c = mix(c, rib > 0.6 ? bone : hollow, rib > 0.6 ? 0.35 : 0.55)
      else if (q.z < 0) c = mix(c, bone, 0.4) // sternum
    }
    if (q.y > 0.95 && q.y < 1.12 && q.z < 0) c = mix(c, hollow, 0.45)
    if (noise3(q.x * 9 + v, q.y * 9, q.z * 9) > 0.8) c = blood
    return c
  }
  torso(k, fig, (q) => {
    if (q.y < 0.93) return shorts
    if (tank && q.y < 1.2 && q.y > 0.93) return 0xc0b896
    return ribbed(q)
  })
  if (tank) rags(k, fig, 0xc0b896, 4, 0.02, 0.1, rnd, 0.008)
  // The spine down the back.
  for (let i = 0; i < 6; i++) {
    const y = 1.45 - i * 0.07
    const q = torsoPoint(fig, Math.PI / 2, Math.min(15, Math.round(9 + (1.42 - y) * -10)), 0)
    k.on('torso').blob(bone, [0.014, 0.016, 0.012], [0, y, Math.max(q.z, 0.07)], [0, 0, 0], 5, 4)
  }
  arms(k, fig, skin)
  for (const arm of ['armL', 'armR'] as const)
    k.on(arm).blob(bone, [0.034, 0.03, 0.034], [0, 0, 0], [0, 0, 0], 6, 4)
  clawHands(k, shade(flesh, 0.85), 0x3a2a1a, 4, 0.06)
  const wear: Legwear = { hem: 0.62, baggy: 0.02, straight: 0, cuff: false }
  legs(k, { ...fig, limb: 0.78 }, wear, (q) => (q.y >= 0.62 ? shorts : skin(q)))
  for (const shin of ['shinL', 'shinR'] as const)
    k.on(shin).blob(bone, [0.03, 0.025, 0.02], [0, 0.2, -0.045], [0, 0, 0], 6, 4)
  feet(k, (q) => (q.y < -0.2 ? blood : shade(flesh, 0.8)))

  // A narrow skull, the eyes sunk deep, lips gone over the teeth, hollow cheeks.
  skull(k, h, (q) => {
    if (q.z < -0.06 && Math.abs(q.x) < 0.04 && q.y < -0.04 && q.y > -0.075) return 0x1a0a08
    if (q.z < 0 && Math.abs(q.x) > 0.045 && q.y < 0 && q.y > -0.08) return mix(skin(q), hollow, 0.6)
    return skin(q)
  })
  eyes(k, 'runner', [0.01, 0.008], 0x1a140c)
  k.on('head')
  teeth(k, bone, 0.07, 6, -0.058, faceZ(h, 0, -0.058) - 0.002, 0.026)
  k.blob(flesh, [0.01, 0.026, 0.014], [0, 0.0, faceZ(h, 0, 0) - 0.006], [-0.3, 0, 0], 6, 4)
  if (longHair) {
    hairCap(k, h, hair, { front: 0.25, side: 0.5, back: 0.62 }, () => 0.006)
    // Lank strands down the back and sides past the shoulders, a few across the face.
    for (let i = 0; i < 9; i++) {
      const phi = Math.PI * (0.05 + i * 0.1)
      const q = skullPoint(h, 0.45 * Math.PI, phi, 0.012)
      const len = 0.3 + rnd() * 0.16
      k.tube(
        hair,
        [
          [q.y, 0.016, 0.008, q.x, q.z],
          [q.y - len * 0.5, 0.014, 0.007, q.x * 1.2, q.z * 1.2],
          [q.y - len, 0.006, 0.004, q.x * 1.25, q.z * 1.3],
        ],
        5,
      )
    }
  } else {
    hairCap(
      k,
      h,
      (q) => (q.x < 0 && q.y > 0.1 ? blood : hair),
      { front: 0.3, side: 0.42, back: 0.6 },
      () => 0.002,
    )
    k.blob(bone, [0.025, 0.01, 0.03], [-0.04, h.cy + h.ry + 0.004, 0.02], [0, 0, 0], 6, 4)
  }
}

// --- Brute: a hunched mountain in work clothes ---------------------------------------------------

const brute: Build = (k, v) => {
  const flesh = 0x5e4644
  const growth = 0x9c6a68
  const sore = 0x6a1c1c
  const bone = 0xd2c49a
  const cloth = pickOf([0x2f3e58, 0x4e4230, 0x3a4630, 0x5a3420], v)
  const iron = 0x55555a
  const rust = 0x6e4a2e
  const brass = 0xb08a3a
  const boots = 0x2a1e14
  const plated = (v & 1) === 0
  const chainSide = (v >> 1) & 1 ? -1 : 1
  const fig: Figure = {
    ...FIGURE,
    girth: 1.32,
    depth: 1.3,
    limb: 1.5,
    belly: 0.06,
    shoulders: 1.25,
  }
  const h = HEADS.brute
  const skin = mottled(flesh, 0x3a2422)
  // Overalls: trousers, a bib up the front, straps over the shoulders; skin everywhere else.
  torso(k, fig, (q) => {
    if (q.y < 1.0) return cloth
    const bib = q.z < 0 && Math.abs(q.x) < 0.13 && q.y < 1.3
    const strap = Math.abs(Math.abs(q.x) - 0.11) < 0.025 && q.y < 1.5
    if (bib || strap) return shade(cloth, 0.95 + 0.1 * noise3(q.x * 20, q.y * 20, q.z * 20))
    return skin(q)
  })
  const fz = torsoPoint(fig, Math.PI * 1.5, 7, 0.01).z
  for (const s of SIDES)
    k.blob(brass, [0.016, 0.016, 0.006], [s * 0.11, 1.28, fz - 0.016], [0, 0, 0], 6, 3)
  // Muscle heaped behind the neck and over the shoulders, a growth-covered hump.
  k.on('chest')
  k.lump(flesh, 0.11, [0, 0.18, 0.06], [1.6, 0.8, 1.1])
  k.lump(flesh, 0.13, [0, 0.06, 0.13], [1.5, 1.1, 0.8])
  k.lump(growth, 0.07, [0.1, 0.1, 0.24], [1, 1.1, 0.9])
  k.lump(growth, 0.05, [-0.08, 0.16, 0.2])
  k.lump(growth, 0.04, [0.3, 0.2, 0.06])
  k.lump(sore, 0.035, [-0.14, -0.02, 0.2])
  if (!plated)
    k.box(rust, [0.2, 0.025, 0.24], [-chainSide * 0.28, 0.24, 0.01], [0, 0, -chainSide * 0.3])
  arms(k, fig, skin, null, 12)
  for (const arm of ['armL', 'armR'] as const) {
    const s = arm === 'armR' ? 1 : -1
    k.on(arm)
    k.lump(growth, 0.045, [s * 0.06, -0.15, 0.03])
    k.tube(
      iron,
      [
        [0.13, 0.072, 0.075],
        [0.17, 0.072, 0.075],
      ],
      10,
    ) // manacle
    if (s === chainSide) {
      for (let i = 0; i < 4; i++) {
        k.box(
          iron,
          [0.025, 0.05, 0.014],
          [0, 0.15 + (i % 2) * 0.01, -0.09 - i * 0.045],
          [Math.PI / 2, i % 2 ? Math.PI / 2 : 0, 0],
        )
      }
    }
  }
  fists(k, shade(flesh, 0.8), 1.6, bone)
  const wear: Legwear = { hem: 0.12, baggy: 0.02, straight: 0.08, cuff: false }
  legs(k, { ...fig, limb: 1.35 }, wear, (q) => (q.y >= 0.12 ? cloth : skin(q)))
  feet(k, (q) => (q.y < -0.215 ? 0x140e0a : boots), { length: 0.15, width: 0.065, height: 0.065 })
  for (const shin of ['shinL', 'shinR'] as const)
    k.on(shin)
      .rigid()
      .tube(
        boots,
        [
          [-0.2, 0.066, 0.075],
          [-0.1, 0.066, 0.075],
        ],
        10,
        { caps: [false, false] },
      )
      .rigid(false)

  // A small bald head under a heavy brow, an underbite with tusks, a growth on the skull.
  skull(k, h, (q) =>
    q.z < -0.07 && Math.abs(q.x) < 0.05 && Math.abs(q.y + 0.07) < 0.008 ? 0x140606 : skin(q),
  )
  eyes(k, 'brute', [0.011, 0.007])
  k.on('head')
  k.blob(
    shade(flesh, 0.8),
    [0.085, 0.022, 0.03],
    [0, 0.03, faceZ(h, 0, 0.03) + 0.012],
    [0, 0, 0],
    8,
    4,
  ) // brow
  k.blob(flesh, [0.075, 0.03, 0.05], [0, -0.09, faceZ(h, 0, -0.09) + 0.025], [0, 0, 0], 8, 5) // jaw
  for (const s of SIDES)
    k.spike(
      bone,
      0.018,
      0.045,
      [s * 0.04, -0.075, faceZ(h, s * 0.04, -0.08) - 0.005],
      [0.2, 0, -s * 0.15],
      5,
    )
  k.blob(flesh, [0.014, 0.022, 0.018], [0, -0.01, faceZ(h, 0, -0.01) - 0.005], [0, 0, 0], 6, 4)
  k.lump(growth, 0.045, [0.07, 0.06, 0.03], [1, 1.2, 1])
  if (plated) {
    k.box(rust, [0.13, 0.016, 0.15], [-0.02, h.cy + h.ry - 0.012, -0.01], [0, 0.3, 0.08])
    for (const x of [-0.08, 0.02]) k.box(iron, [0.02, 0.016, 0.02], [x, h.cy + h.ry + 0.008, -0.04])
  }
}

// --- Screamer: the skull stretched long, jaw unhinged, throat sack ballooning -----------------------

const screamer: Build = (k, v, rnd) => {
  const pale = 0xd2d4c8
  const vein = 0x4a5c8c
  const mouth = 0x050202
  const bone = 0xe8e2c8
  const sack = 0xc9a08e
  const gowned = v % 3 !== 0
  const gown = pickOf([0x8a9ca2, 0x9a9a88, 0x7a8a7a], v)
  const fig: Figure = {
    ...FIGURE,
    girth: 0.86,
    depth: 0.85,
    limb: 0.7,
    waist: 0.82,
    fem: v % 2 ? 0.5 : 0,
  }
  const h = HEADS.screamer
  const veins = (q: THREE.Vector3) => {
    const n = Math.abs(Math.sin(q.x * 70 + Math.sin(q.y * 40) * 2 + q.z * 50))
    const c = shade(pale, 0.92 + 0.12 * noise3(q.x * 12, q.y * 12, q.z * 12))
    return n > 0.96 ? mix(c, vein, 0.7) : c
  }
  torso(k, fig, (q) => {
    if (gowned && q.y < 1.42 && q.y > 0.8)
      return shade(gown, 0.95 + 0.1 * noise3(q.x * 9, q.y * 9, q.z * 9))
    if (!gowned && q.y < 0.93) return 0x3a3a34
    if (q.y > 1.1 && q.y < 1.38 && Math.abs(Math.sin((q.y - 1.1) * 62)) < 0.25)
      return shade(pale, 0.7)
    return veins(q)
  })
  if (gowned) rags(k, fig, gown, 2, 0.15, 0.32, rnd, 0.014)
  // The throat sack bulging under the jaw.
  k.on('chest').lump(sack, 0.075, [0, 0.19, -0.075], [1, 0.85, 0.95])
  arms(k, fig, veins)
  clawHands(k, pale, 0x1a1414, 4, 0.11)
  legs(k, { ...fig, limb: 0.75 }, { hem: 2, baggy: 0, straight: 0, cuff: false }, veins)
  feet(k, (q) => shade(pale, q.y < -0.215 ? 0.6 : 0.85))

  // A long skull, eyes high; the mouth a black hole half the face, jaw hanging on the chest.
  skull(
    k,
    h,
    (q) => {
      if (q.z < -0.05 && Math.abs(q.x) < 0.05 && q.y < 0.03 && q.y > -0.14) return mouth
      return veins(q)
    },
    16,
    14,
  )
  eyes(k, 'screamer', [0.009, 0.006], 0x2a2a30)
  const fz = faceZ(h, 0, 0.0)
  k.on('head')
  k.blob(0x6e2a2a, [0.05, 0.01, 0.01], [0, 0.03, fz + 0.004], [0, 0, 0], 6, 3) // gum
  teeth(k, bone, 0.08, 6, 0.018, fz - 0.002, 0.022)
  k.blob(pale, [0.05, 0.016, 0.045], [0, -0.2, -0.06], [0.5, 0, 0], 8, 4) // the jaw, hanging
  teeth(k, bone, 0.07, 5, -0.18, -0.1, 0.02)
  for (const s of SIDES)
    k.tube(
      shade(pale, 0.8),
      [
        [-0.08, 0.008, 0.008, s * 0.045, -0.07],
        [-0.19, 0.006, 0.006, s * 0.04, -0.08],
      ],
      4,
    )
}

// --- Stalker: a shape of the dark itself ----------------------------------------------------------

const stalker: Build = (k, v, rnd) => {
  const skin = 0x0f0f14
  const ridge = 0x23232c
  const bony = 0x4e4858
  const tip = 0xc4bccc
  const claw = 0xb8b09c
  const grin = 0x8a8478
  const big = 1 + (v % 4) * 0.1
  const fig: Figure = { ...FIGURE, girth: 0.9, depth: 0.9, limb: 0.72, waist: 0.8, shoulders: 1.1 }
  const h = HEADS.stalker
  const sinew = (q: THREE.Vector3) => {
    const n = Math.abs(Math.sin(q.x * 40 + q.y * 25))
    return n > 0.93 ? ridge : skin
  }
  /** A spine: dark bone fading to a pale point (the points catch the light). */
  const spine = (
    width: number,
    length: number,
    at: readonly [number, number, number],
    rot: readonly [number, number, number],
  ) => {
    const dir = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(rot[0], rot[1], rot[2]))
    k.spike(bony, width, length * 0.7, at, rot)
    k.spike(
      tip,
      width * 0.45,
      length * 0.45,
      [at[0] + dir.x * length * 0.55, at[1] + dir.y * length * 0.55, at[2] + dir.z * length * 0.55],
      rot,
    )
  }
  torso(k, fig, sinew)
  arms(k, fig, sinew)
  legs(k, fig, { hem: 2, baggy: 0, straight: 0, cuff: false }, sinew)
  for (const hand of ['handL', 'handR'] as const) {
    k.on(hand).blob(skin, [0.03, 0.045, 0.02], [0, 0.04, 0], [0, 0, 0], 8, 5)
    for (let i = 0; i < 3; i++)
      k.spike(claw, 0.018, 0.24, [(i - 1) * 0.02, 0.06, -0.005], [0.25, 0, -(i - 1) * 0.22], 4)
  }
  feet(k, () => skin)
  // Spines down the back and over the shoulders; spurs on elbows and heels; toe claws.
  for (let i = 0; i < 7; i++) {
    const y = 1.45 - i * 0.075
    const ring = 13 - Math.round(i * 1.4)
    const z = torsoPoint(fig, Math.PI / 2, Math.max(2, ring), 0).z
    k.on('torso').rigid()
    spine(0.04, (0.16 + rnd() * 0.08) * big, [0, y, z - 0.01], [1.0, 0, 0])
    k.rigid(false)
  }
  for (const s of SIDES) {
    k.on('chest').rigid()
    spine(0.045, 0.18 * big, [s * 0.17, 0.12, 0.03], [0.7, 0, -s * 0.7])
    k.rigid(false)
  }
  for (const arm of ['armL', 'armR'] as const)
    k.on(arm)
      .rigid()
      .spike(bony, 0.03, 0.1, [0, 0, 0.03], [Math.PI / 2 + 0.6, 0, 0])
      .rigid(false)
  for (const shin of ['shinL', 'shinR'] as const) {
    k.on(shin).rigid()
    spine(0.03, 0.1, [0, -0.16, 0.04], [1.9, 0, 0])
    for (let i = 0; i < 3; i++)
      k.spike(claw, 0.016, 0.07, [(i - 1) * 0.025, -0.225, -0.13], [-Math.PI / 2 + 0.1, 0, 0], 4)
    k.rigid(false)
  }

  // A long skull swept back into a crest; slit eyes; a thin grin of needle teeth.
  skull(k, h, (q) =>
    q.z < -0.07 && Math.abs(q.x) < 0.05 && Math.abs(q.y + 0.055) < 0.006 ? 0x030304 : skin,
  )
  k.on('head')
  const e = EYES.stalker
  for (const s of SIDES)
    k.blob('eyes', [0.022, 0.0045, 0.006], [s * e.x, e.y, e.z - 0.002], [0, 0, s * 0.3], 6, 3)
  teeth(k, grin, 0.085, 9, -0.055, faceZ(h, 0, -0.055) - 0.003, 0.014)
  for (let i = 0; i < 3; i++)
    spine(0.03, 0.1 + i * 0.03, [0, 0.11 - i * 0.03, 0.08 + i * 0.05], [1.2, 0, 0])
}

const BUILD: Record<ZombieLook, Build> = { zombie: walker, runner, brute, screamer, stalker }

/** Glowing eyes per kind (HDR: they bloom, and fog doesn't touch them). */
export const ZOMBIE_EYES: Record<ZombieLook, THREE.MeshBasicMaterial> = {
  zombie: new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 0.35, 0.2), fog: false }),
  runner: new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5, 0.3), fog: false }),
  brute: new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 2.4, 0.1), fog: false }),
  screamer: new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6, 6.5), fog: false }),
  stalker: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.5, 5.5, 8), fog: false }),
}
/** Colour of the halo round each kind's eyes. */
export const EYE_HALO: Record<ZombieLook, THREE.Color> = {
  zombie: new THREE.Color(2.4, 0.08, 0.04),
  runner: new THREE.Color(2.2, 1.8, 0.06),
  brute: new THREE.Color(3, 0.8, 0.03),
  screamer: new THREE.Color(1.6, 1.6, 1.7),
  stalker: new THREE.Color(1.0, 1.6, 2.4),
}
