import { PART_SIZES } from '@office-fps/shared'
import * as THREE from 'three'
import { ARM_LENGTH, type Baked, Kit, pickOf, seeded, type Vec } from './body-kit.ts'

/**
 * The dead, one silhouette per kind so you can tell them apart at a glance in the dark:
 *  - walker:   ragged shirt in strips, one arm flayed to the bone, jaw hanging off;
 *  - runner:   starved and lanky, ribs showing, long greasy hair, sunken yellow eyes;
 *  - brute:    a hunched mountain in torn overalls: neck and back mass, tumours, huge fists, chains;
 *  - screamer: tall skull with the jaw unhinged, a bloated throat sack, long clawed fingers;
 *  - stalker:  glossy black and wiry, spines down the back, long bone claws, slit eyes.
 * Everything is decoration on the hitbox parts (part sizes stay the hit volumes) and is baked per
 * kind and variant into one vertex-coloured mesh per part, cached and shared by every copy.
 */

export type ZombieLook = 'zombie' | 'runner' | 'brute' | 'screamer' | 'stalker'

const H = PART_SIZES.head
const C = PART_SIZES.chest
const S = PART_SIZES.stomach
const T = PART_SIZES.thighL
const N = PART_SIZES.shinL
const L = ARM_LENGTH
const SIDES = [-1, 1] as const

/** How many looks each kind comes in (picked by the zombie's id). */
const VARIANTS = 8

/** Eyes: where they sit on the head (±x, y) and how big their glow halo is. */
export const EYES: Record<ZombieLook, { x: number; y: number; glow: number }> = {
  zombie: { x: 0.07, y: 0.03, glow: 0.2 },
  runner: { x: 0.065, y: 0.03, glow: 0.26 },
  brute: { x: 0.07, y: 0.01, glow: 0.22 },
  screamer: { x: 0.055, y: 0.13, glow: 0.15 },
  stalker: { x: 0.065, y: 0.02, glow: 0.1 },
}

const cache = new Map<string, Baked>()

/** The baked body of one kind and variant (seed: anything stable per zombie, e.g. its id). */
export function zombieBody(look: ZombieLook, seed: number): Baked {
  const variant = (Math.imul(Math.floor(seed) + 1, 2654435761) >>> 16) % VARIANTS
  const key = `${look}:${variant}`
  let baked = cache.get(key)
  if (!baked) {
    const k = new Kit()
    BUILD[look](k, variant, seeded(variant * 31 + look.length))
    baked = k.bake()
    cache.set(key, baked)
  }
  return baked
}

type Build = (k: Kit, v: number, rnd: () => number) => void

/** A strip of cloth (or hair) hanging down `length` from `at`, swinging a little. */
function hang(
  k: Kit,
  color: number,
  at: Vec,
  length: number,
  width: number,
  rnd: () => number,
  ry = 0,
  thick = 0.014,
): void {
  const tiltX = (rnd() - 0.5) * 0.35
  const tiltZ = (rnd() - 0.5) * 0.45
  k.box(color, [width, length, thick], [at[0], at[1] - length / 2, at[2]], [tiltX, ry, tiltZ])
}

/** Ragged hem: strips hanging all round the bottom of a box of half-size (hx, hz) at height y. */
function hem(
  k: Kit,
  color: number,
  hx: number,
  hz: number,
  y: number,
  count: number,
  min: number,
  max: number,
  rnd: () => number,
  width = 0.05,
): void {
  for (let i = 0; i < count; i++) {
    const len = min + rnd() * (max - min)
    const u = (i + rnd() * 0.6) / count
    // Walk round the rectangle: front, side, back, side.
    const w = 2 * hx
    const dz = 2 * hz
    const d = u * 2 * (w + dz)
    let at: Vec
    let ry = 0
    if (d < w) at = [-hx + d, y, -hz - 0.008]
    else if (d < w + dz) {
      at = [hx + 0.008, y, -hz + (d - w)]
      ry = Math.PI / 2
    } else if (d < 2 * w + dz) at = [hx - (d - w - dz), y, hz + 0.008]
    else {
      at = [-hx - 0.008, y, hz - (d - 2 * w - dz)]
      ry = Math.PI / 2
    }
    hang(k, color, at, len, width * (0.7 + rnd() * 0.6), rnd, ry)
  }
}

/** Ribs across a front face at z, between y0 (top) and y1. */
function ribs(k: Kit, color: number, width: number, y0: number, y1: number, z: number, n: number) {
  for (let i = 0; i < n; i++) {
    const y = y0 + ((y1 - y0) * i) / Math.max(1, n - 1)
    const w = width * (1 - i * 0.06)
    for (const s of SIDES)
      k.box(color, [w / 2 - 0.02, 0.022, 0.014], [(s * w) / 4 + s * 0.012, y, z])
  }
}

/** A row of teeth along x at height y in front of z. */
function teeth(k: Kit, color: number, width: number, n: number, y: number, z: number, h = 0.03) {
  for (let i = 0; i < n; i++) {
    const x = -width / 2 + (width * (i + 0.5)) / n
    k.box(color, [(width / n) * 0.7, h * (0.8 + ((i * 7) % 3) * 0.15), 0.02], [x, y, z])
  }
}

// --- Walker: a dead office worker in rags ---------------------------------------------------------

const walker: Build = (k, v, rnd) => {
  const flesh = 0x80907a
  const shade = 0x4d5947
  const blood = 0x5a1010
  const gore = 0x7e2626
  const bone = 0xd9d0b4
  const mouth = 0x120505
  const shirt = pickOf([0xb3ad98, 0x4a5a74, 0x6e4e3a, 0x5c6a52, 0x8a7a58, 0x7a3a3a], v)
  const trousers = pickOf([0x2c2f38, 0x3c3528, 0x2a3442], v >> 1)
  const hair = pickOf([0x2a2018, 0x5a3b1e, 0x161616, 0x8a8a84], v >> 1)
  const bareArm = (v >> 2) & 1 ? 'armL' : 'armR'
  const bald = v % 3 === 0
  const fz = -H.z - 0.006

  k.on('head').box(flesh, [H.x * 2, H.y * 2, H.z * 2])
  if (bald) {
    k.box(gore, [0.11, 0.02, 0.09], [0.04, H.y + 0.005, -0.02])
    k.box(bone, [0.06, 0.022, 0.05], [0.05, H.y + 0.008, -0.025]) // skull through the scalp
  } else {
    k.box(hair, [0.22, 0.05, 0.24], [-0.04, H.y + 0.012, 0.03]) // patchy hair
    for (let i = 0; i < 3; i++) hang(k, hair, [-0.12 + i * 0.05, H.y, H.z + 0.01], 0.14, 0.03, rnd)
  }
  k.box('eyes', [0.06, 0.04, 0.02], [-0.07, EYES.zombie.y, fz])
  k.box('eyes', [0.06, 0.04, 0.02], [0.07, EYES.zombie.y, fz])
  k.box(shade, [0.1, 0.08, 0.012], [0.07, 0.03, -H.z - 0.001]) // a bruised, sunken socket
  // No lower jaw: a dark hole, upper teeth, the jaw hanging off one hinge, blood down the chin.
  k.box(mouth, [0.18, 0.1, 0.02], [0, -0.085, fz + 0.002])
  teeth(k, bone, 0.15, 5, -0.045, fz - 0.004)
  k.box(flesh, [0.13, 0.045, 0.11], [0.06, -0.19, -0.13], [0.6, 0, 0.55])
  teeth(k, bone, 0.09, 3, -0.165, -0.18, 0.025)
  k.box(blood, [0.05, 0.12, 0.016], [-0.05, -0.15, fz])

  // Shirt, ripped open on one side over the ribs, stained, the collar torn.
  const cz = -C.z - 0.006
  k.on('chest').box(shirt, [C.x * 2, C.y * 2, C.z * 2])
  k.box(shade, [0.16, 0.2, 0.012], [-0.11, 0.0, cz + 0.003])
  ribs(k, bone, 0.16, 0.06, -0.07, cz - 0.004, 4)
  k.box(blood, [0.15, 0.11, 0.012], [0.08, -0.07, cz])
  k.box(blood, [0.2, 0.16, 0.012], [0.03, 0.02, C.z + 0.006]) // smeared down the back
  hang(k, shirt, [-0.1, C.y, cz - 0.004], 0.12, 0.06, rnd) // collar hanging loose

  const sz = -S.z - 0.006
  k.on('stomach').box(shirt, [S.x * 2, S.y * 2, S.z * 2])
  k.box(blood, [0.12, 0.12, 0.012], [-0.06, 0.02, sz])
  k.box(gore, [0.07, 0.16, 0.05], [-0.05, -0.1, sz - 0.02], [0.2, 0, 0.1]) // guts
  k.box(0x1c1a18, [S.x * 2 + 0.012, 0.05, S.z * 2 + 0.012], [0, -S.y + 0.03, 0])
  hem(k, shirt, S.x, S.z, -S.y + 0.06, 9, 0.1, 0.24, rnd)

  for (const arm of ['armL', 'armR'] as const) {
    k.on(arm)
    if (arm === bareArm) {
      // Flayed: grey meat, the forearm bone sticking out of a wound.
      k.box(flesh, [0.11, L, 0.12])
      k.box(gore, [0.125, 0.12, 0.135], [0, 0.04, 0])
      k.box(bone, [0.035, 0.22, 0.035], [0.045, 0.08, 0.02], [0, 0, -0.2])
      k.box(blood, [0.12, 0.1, 0.13], [0, -0.16, 0])
    } else {
      k.box(shirt, [0.13, L * 0.6, 0.15], [0, -L * 0.2, 0])
      k.box(flesh, [0.1, L * 0.45, 0.11], [0, L * 0.27, 0])
      // Torn cuff: rags past the end of the sleeve, towards the hand.
      for (const s of SIDES) {
        const tilt = (rnd() - 0.5) * 0.4
        k.box(shirt, [0.014, 0.13, 0.05], [s * 0.068, L * 0.1 + 0.06, 0.02 * s], [tilt, 0, 0])
      }
    }
    k.box(shade, [0.11, 0.08, 0.12], [0, L / 2 - 0.02, 0]) // dirty hands
  }

  for (const thigh of ['thighL', 'thighR'] as const) {
    k.on(thigh).box(trousers, [T.x * 2, T.y * 2, T.z * 2])
  }
  k.on('thighL').box(flesh, [0.08, 0.12, 0.012], [0.02, -0.05, -T.z - 0.006])
  for (const shin of ['shinL', 'shinR'] as const) {
    k.on(shin)
    k.box(trousers, [N.x * 2, N.y, N.z * 2], [0, N.y / 2, 0])
    k.box(flesh, [0.13, N.y, 0.14], [0, -N.y / 2, 0])
    k.box(shade, [0.15, 0.06, 0.24], [0, -N.y + 0.02, -0.04]) // bare, filthy feet
    hem(k, trousers, N.x, N.z, 0.01, 5, 0.08, 0.16, rnd, 0.045)
  }
}

// --- Runner: starved, lanky, all ribs and hair -----------------------------------------------------

const runner: Build = (k, v, rnd) => {
  const flesh = 0xb7ad82
  const shade = 0x6a6244
  const bone = 0xe2d8b0
  const blood = 0x6a1414
  const hair = pickOf([0x18120e, 0x3a2414, 0x101010, 0x4a4030], v)
  const shorts = pickOf([0x34466a, 0x5e5638, 0x2a2a2a, 0x5a2a2a], v >> 1)
  const longHair = (v & 1) === 0
  const tank = (v >> 2) & 1
  const fz = -H.z + 0.01

  // A narrow skull, the eyes sunk deep into dark sockets, lips gone over the teeth.
  k.on('head').box(flesh, [0.26, H.y * 2, 0.28])
  for (const s of SIDES) {
    k.box(0x1a140c, [0.1, 0.075, 0.012], [s * 0.065, 0.03, fz - 0.001])
    k.box('eyes', [0.045, 0.03, 0.02], [s * EYES.runner.x, EYES.runner.y, fz - 0.005])
    k.box(shade, [0.03, 0.12, 0.05], [s * 0.115, -0.04, -0.1]) // hollow cheeks
  }
  k.box(0x1a0a08, [0.16, 0.05, 0.012], [0, -0.08, fz - 0.002])
  teeth(k, bone, 0.15, 6, -0.07, fz - 0.008, 0.04)
  if (longHair) {
    k.box(hair, [0.28, 0.05, 0.3], [0, H.y + 0.01, 0.01])
    // Lank strands down the back and sides, past the shoulders.
    for (let i = 0; i < 7; i++) {
      const x = -0.12 + i * 0.04
      hang(k, hair, [x, H.y + 0.01, 0.15], 0.36 + rnd() * 0.16, 0.04, rnd, 0, 0.02)
    }
    for (const s of SIDES) {
      // Curtains down the sides of the face, and a few strands hanging in front of it.
      for (let i = 0; i < 3; i++) {
        const at: Vec = [s * 0.145, H.y + 0.01, -0.1 + i * 0.09]
        hang(k, hair, at, 0.3 + rnd() * 0.16, 0.06, rnd, Math.PI / 2, 0.02)
      }
      hang(k, hair, [s * 0.1, H.y + 0.01, fz - 0.012], 0.22 + rnd() * 0.08, 0.035, rnd, 0, 0.016)
    }
  } else {
    k.box(blood, [0.1, 0.02, 0.12], [-0.03, H.y + 0.004, 0.02]) // torn scalp
    k.box(bone, [0.05, 0.022, 0.06], [-0.04, H.y + 0.008, 0.02])
    k.box(blood, [0.02, 0.14, 0.012], [0.09, 0.02, fz - 0.002], [0, 0, 0.3]) // a gash
    k.lump(shade, 0.04, [-0.13, 0.08, 0.04])
  }

  // Bare and starved: a narrow ribcage, sternum, the spine through the back.
  const cz = -0.105
  k.on('chest').box(flesh, [0.38, C.y * 2, 0.21])
  k.box(shade, [0.3, 0.22, 0.01], [0, -0.03, cz - 0.002])
  ribs(k, bone, 0.32, 0.06, -0.12, cz - 0.008, 5)
  k.box(bone, [0.03, 0.2, 0.016], [0, -0.02, cz - 0.01])
  for (const s of SIDES)
    k.box(bone, [0.14, 0.025, 0.03], [s * 0.09, C.y - 0.02, cz], [0, 0, s * 0.15])
  for (let i = 0; i < 4; i++) k.box(bone, [0.035, 0.03, 0.03], [0, C.y - 0.04 - i * 0.07, 0.105])
  if (tank) {
    const top = 0xc0b896
    k.box(top, [0.39, 0.16, 0.22], [0, -0.08, 0])
    for (const s of SIDES) k.box(top, [0.05, 0.18, 0.225], [s * 0.1, 0.07, 0])
    k.box(blood, [0.12, 0.08, 0.01], [0.06, -0.09, -0.116])
  }

  k.on('stomach').box(shade, [0.32, S.y * 2, 0.17]) // the belly sunk in
  k.box(flesh, [0.34, 0.12, 0.18], [0, 0.08, 0])
  k.box(shorts, [0.36, 0.1, 0.2], [0, -S.y + 0.05, 0])
  if (tank) hem(k, 0xc0b896, 0.17, 0.09, 0.02, 6, 0.06, 0.16, rnd, 0.04)

  for (const arm of ['armL', 'armR'] as const) {
    k.on(arm).box(flesh, [0.075, L, 0.085])
    k.box(bone, [0.095, 0.06, 0.1], [0, 0.02, 0]) // knobbly elbows
    k.box(shade, [0.09, 0.06, 0.1], [0, L / 2 - 0.03, 0])
    for (let i = 0; i < 3; i++) {
      k.box(shade, [0.018, 0.1, 0.018], [-0.03 + i * 0.03, L / 2 + 0.04, 0.01], [0.3, 0, 0])
    }
    k.box(blood, [0.08, 0.1, 0.09], [0, -0.14 + rnd() * 0.1, 0])
  }

  for (const thigh of ['thighL', 'thighR'] as const) {
    k.on(thigh).box(flesh, [0.11, T.y * 2, 0.12])
    k.box(shorts, [0.16, 0.22, 0.18], [0, T.y - 0.11, 0])
    hem(k, shorts, 0.08, 0.09, T.y - 0.2, 4, 0.04, 0.1, rnd, 0.04)
  }
  for (const shin of ['shinL', 'shinR'] as const) {
    k.on(shin).box(flesh, [0.1, N.y * 2, 0.11])
    k.box(bone, [0.11, 0.06, 0.06], [0, N.y - 0.02, -0.03]) // knee
    k.box(blood, [0.12, 0.05, 0.2], [0, -N.y + 0.02, -0.04]) // bloody bare feet
  }
}

// --- Brute: a hunched mountain in work clothes ---------------------------------------------------

const brute: Build = (k, v, rnd) => {
  const flesh = 0x6c4a4e
  const shade = 0x42282c
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

  // A small bald head under a heavy brow, an underbite with tusks, a growth on the skull.
  k.on('head').box(flesh, [H.x * 2, H.y * 2, H.z * 2])
  k.box(shade, [0.31, 0.06, 0.07], [0, 0.07, -H.z + 0.02])
  k.box('eyes', [0.05, 0.03, 0.02], [-EYES.brute.x, EYES.brute.y, -H.z - 0.006])
  k.box('eyes', [0.05, 0.03, 0.02], [EYES.brute.x, EYES.brute.y, -H.z - 0.006])
  k.box(flesh, [0.26, 0.09, 0.1], [0, -0.12, -0.12])
  k.box(0x140606, [0.18, 0.025, 0.012], [0, -0.085, -H.z - 0.012])
  for (const s of SIDES) k.spike(bone, 0.035, 0.07, [s * 0.08, -0.1, -0.16], [0, 0, -s * 0.1])
  k.lump(growth, 0.07, [0.13, 0.1, 0.03], [1, 1.2, 1])
  k.box(sore, [0.02, 0.12, 0.012], [-0.06, 0.06, -H.z - 0.004], [0, 0, 0.4]) // scar
  if (plated) {
    k.box(rust, [0.18, 0.025, 0.2], [-0.05, H.y + 0.01, -0.01], [0, 0.3, 0.15])
    for (const x of [-0.11, 0.0]) k.box(iron, [0.025, 0.02, 0.025], [x, H.y + 0.025, -0.04])
  }

  // Massive: muscle heaped up behind the neck and over the shoulders, a growth-covered hump,
  // overalls straining over it all.
  const cz = -C.z - 0.006
  k.on('chest').box(flesh, [C.x * 2, C.y * 2, C.z * 2])
  k.box(flesh, [0.42, 0.16, 0.26], [0, C.y + 0.05, 0.05]) // the neck mass
  k.box(flesh, [0.44, 0.26, 0.14], [0, 0.04, C.z + 0.05]) // the hump
  for (const s of SIDES) {
    k.box(flesh, [0.2, 0.2, 0.24], [s * 0.27, C.y - 0.03, 0.01], [0, 0, s * 0.2])
    k.box(shade, [0.17, 0.09, 0.03], [s * 0.1, 0.07, cz - 0.01]) // pecs
  }
  k.lump(growth, 0.11, [0.12, 0.08, C.z + 0.12], [1, 1.1, 0.9])
  k.lump(growth, 0.08, [-0.08, 0.14, C.z + 0.1])
  k.lump(growth, 0.06, [0.3, C.y + 0.06, 0.08])
  k.lump(sore, 0.05, [-0.15, -0.04, C.z + 0.11])
  k.box(cloth, [0.3, 0.2, 0.012], [0, -0.06, cz - 0.022]) // overall bib
  k.box(0x00000, [0.08, 0.06, 0.008], [0.05, -0.05, cz - 0.03]) // its pocket
  for (const s of SIDES) {
    k.box(cloth, [0.06, 0.012, 0.3], [s * 0.12, C.y + 0.13, 0.03])
    k.box(cloth, [0.06, 0.28, 0.012], [s * 0.12, 0.02, cz - 0.022])
    k.box(cloth, [0.06, 0.3, 0.012], [s * 0.12, 0.02, C.z + 0.125])
    k.box(brass, [0.035, 0.035, 0.012], [s * 0.12, 0.03, cz - 0.03])
  }
  if (!plated) {
    // A rusted plate chained over one shoulder.
    k.box(rust, [0.22, 0.03, 0.26], [-chainSide * 0.27, C.y + 0.09, 0.01], [0, 0, -chainSide * 0.3])
  }

  // A gut in work trousers, torn open on one side.
  k.on('stomach').box(cloth, [0.46, S.y * 2, 0.28], [0, 0, -0.01])
  k.box(flesh, [0.12, 0.12, 0.012], [-0.09, 0.03, -0.157])
  k.lump(growth, 0.06, [-0.1, 0.04, -0.16])
  k.box(0x1c1814, [0.47, 0.05, 0.29], [0, -S.y + 0.03, -0.01])
  hem(k, cloth, 0.23, 0.14, 0.12, 4, 0.06, 0.12, rnd, 0.06)

  for (const arm of ['armL', 'armR'] as const) {
    const s = arm === 'armR' ? 1 : -1
    k.on(arm)
    k.box(flesh, [0.17, L * 0.52, 0.19], [0, -L * 0.25, 0]) // upper arm
    k.box(flesh, [0.21, L * 0.42, 0.23], [0, L * 0.2, 0]) // forearm
    k.box(shade, [0.22, 0.16, 0.22], [0, L / 2 + 0.03, 0]) // fist
    k.box(bone, [0.2, 0.03, 0.04], [0, L / 2 + 0.1, -0.06]) // knuckles
    k.lump(growth, 0.07, [s * 0.08, -L * 0.25, 0.04])
    k.box(iron, [0.24, 0.07, 0.26], [0, L * 0.38, 0]) // manacle
    if (s === chainSide) {
      // The broken chain swinging from it.
      for (let i = 0; i < 4; i++) {
        const z = -0.15 - i * 0.055
        k.box(
          iron,
          [0.035, 0.065, 0.02],
          [0, L * 0.38, z],
          [Math.PI / 2, i % 2 ? Math.PI / 2 : 0, 0],
        )
      }
    }
  }

  for (const thigh of ['thighL', 'thighR'] as const) {
    k.on(thigh).box(cloth, [0.2, T.y * 2, 0.22])
  }
  k.on('thighR').box(flesh, [0.1, 0.1, 0.012], [0, -0.1, -0.117])
  for (const shin of ['shinL', 'shinR'] as const) {
    k.on(shin).box(cloth, [0.19, N.y * 2 - 0.08, 0.21], [0, 0.04, 0])
    k.box(boots, [0.21, 0.16, 0.24], [0, -N.y + 0.06, -0.02])
    k.box(boots, [0.21, 0.07, 0.3], [0, -N.y + 0.01, -0.05])
  }
}

// --- Screamer: the skull stretched long, jaw unhinged, throat sack ballooning -----------------------

const screamer: Build = (k, v, rnd) => {
  const pale = 0xd2d4c8
  const shade = 0x9a9c8e
  const vein = 0x4a5c8c
  const mouth = 0x050202
  const gum = 0x6e2a2a
  const bone = 0xe8e2c8
  const sack = 0xc9a08e
  const claw = 0x1a1414
  const gowned = v % 3 !== 0
  const gown = pickOf([0x8a9ca2, 0x9a9a88, 0x7a8a7a], v)

  // A long skull: tall, narrow, eyes high; the mouth a black hole half the face.
  k.on('head').box(pale, [0.26, 0.4, 0.28], [0, 0.06, 0])
  const fz = -0.146
  for (const s of SIDES) {
    k.box(0x2a2a30, [0.07, 0.05, 0.01], [s * EYES.screamer.x, EYES.screamer.y, fz])
    k.box('eyes', [0.04, 0.025, 0.02], [s * EYES.screamer.x, EYES.screamer.y, fz - 0.006])
    k.box(vein, [0.012, 0.16, 0.012], [s * 0.1, 0.12, fz], [0, 0, s * 0.3])
    k.box(vein, [0.012, 0.012, 0.18], [s * 0.132, 0.18, 0.02], [0.3, 0, 0])
    k.box(shade, [0.018, 0.16, 0.018], [s * 0.095, -0.17, -0.12], [0.3, 0, s * 0.1]) // stretched tendons
  }
  k.box(mouth, [0.19, 0.24, 0.02], [0, -0.06, fz - 0.002])
  k.box(gum, [0.19, 0.03, 0.022], [0, 0.055, fz - 0.004])
  teeth(k, bone, 0.17, 6, 0.035, fz - 0.01, 0.04)
  // The lower jaw hanging open on the chest, teeth up.
  k.box(pale, [0.2, 0.05, 0.16], [0, -0.21, -0.13], [0.5, 0, 0])
  k.box(mouth, [0.15, 0.01, 0.12], [0, -0.18, -0.14], [0.5, 0, 0])
  teeth(k, bone, 0.16, 5, -0.17, -0.205, 0.035)
  k.box(vein, [0.15, 0.012, 0.012], [0, 0.24, -0.08])

  // Emaciated, veined; the throat sack bulging under the jaw.
  const cz = -0.096
  k.on('chest').box(pale, [0.36, C.y * 2, 0.19])
  k.lump(sack, 0.12, [0, C.y + 0.0, -0.1], [1, 0.85, 0.95])
  k.box(vein, [0.012, 0.14, 0.012], [0.04, C.y, -0.205], [0.4, 0, 0.3])
  k.box(vein, [0.012, 0.12, 0.012], [-0.06, C.y - 0.01, -0.2], [0.4, 0, -0.4])
  ribs(k, shade, 0.3, 0.03, -0.12, cz - 0.006, 4)
  for (let i = 0; i < 4; i++) k.box(shade, [0.035, 0.03, 0.03], [0, C.y - 0.04 - i * 0.07, 0.097])
  if (gowned) {
    k.box(gown, [0.37, 0.18, 0.2], [0, -0.07, 0])
    for (const s of SIDES) k.box(gown, [0.06, 0.16, 0.2], [s * 0.13, 0.08, 0])
  }

  k.on('stomach').box(gowned ? gown : pale, [0.3, S.y * 2, 0.17])
  if (gowned) hem(k, gown, 0.16, 0.09, -S.y + 0.02, 9, 0.18, 0.34, rnd, 0.06)
  else k.box(0x3a3a34, [0.31, 0.08, 0.18], [0, -S.y + 0.04, 0])

  for (const arm of ['armL', 'armR'] as const) {
    k.on(arm).box(pale, [0.07, L, 0.08])
    k.box(shade, [0.085, 0.05, 0.09], [0, 0.02, 0])
    k.box(vein, [0.012, L * 0.8, 0.012], [0.036, 0, -0.01], [0, 0, 0.05])
    // Long, many-jointed fingers ending in black hooks.
    for (let i = 0; i < 4; i++) {
      const x = -0.045 + i * 0.03
      const spread = (i - 1.5) * 0.12
      k.box(pale, [0.02, 0.2, 0.02], [x, L / 2 + 0.1, 0], [0, 0, -spread])
      k.spike(claw, 0.02, 0.07, [x - Math.sin(spread) * 0.2, L / 2 + 0.19, 0], [-0.4, 0, -spread])
    }
  }

  for (const thigh of ['thighL', 'thighR'] as const) {
    k.on(thigh).box(pale, [0.1, T.y * 2, 0.11])
  }
  for (const shin of ['shinL', 'shinR'] as const) {
    k.on(shin).box(pale, [0.09, N.y * 2, 0.1])
    k.box(shade, [0.1, 0.06, 0.06], [0, N.y - 0.02, -0.03])
    k.box(shade, [0.1, 0.05, 0.2], [0, -N.y + 0.02, -0.04])
  }
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
  /** A spine: dark bone fading to a pale point (the points catch the light). */
  const spine = (width: number, length: number, at: Vec, rot: Vec) => {
    const dir = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(rot[0], rot[1], rot[2]))
    k.spike(bony, width, length * 0.7, at, rot)
    const mid: Vec = [
      at[0] + dir.x * length * 0.55,
      at[1] + dir.y * length * 0.55,
      at[2] + dir.z * length * 0.55,
    ]
    k.spike(tip, width * 0.45, length * 0.45, mid, rot)
  }

  // A long skull swept back into a crest; slit eyes; a thin grin of needle teeth.
  k.on('head').box(skin, [0.26, 0.28, 0.28], [0, -0.01, 0])
  k.box(skin, [0.2, 0.16, 0.2], [0, 0.08, 0.17], [-0.35, 0, 0])
  k.box(ridge, [0.04, 0.05, 0.3], [0, H.y - 0.01, 0.08], [-0.2, 0, 0])
  for (let i = 0; i < 3; i++)
    spine(0.045, 0.14 + i * 0.04, [0, 0.13 - i * 0.03, 0.1 + i * 0.07], [1.2, 0, 0])
  for (const s of SIDES) {
    k.box(
      'eyes',
      [0.085, 0.014, 0.02],
      [s * EYES.stalker.x, EYES.stalker.y, -0.146],
      [0, 0, s * 0.3],
    )
  }
  k.box(0x030304, [0.18, 0.03, 0.012], [0, -0.085, -0.142])
  teeth(k, grin, 0.17, 9, -0.085, -0.15, 0.022)

  // Wiry: sinews over the chest, spines all down the back, hooks on the shoulders.
  k.on('chest').box(skin, [0.4, C.y * 2, 0.22])
  for (const s of SIDES) {
    k.box(ridge, [0.025, 0.24, 0.012], [s * 0.07, -0.01, -0.114], [0, 0, s * 0.25])
    spine(0.06, 0.22 * big, [s * 0.18, C.y - 0.02, 0.04], [0.7, 0, -s * 0.7])
  }
  for (let i = 0; i < 4; i++) {
    spine(0.06, (0.2 + rnd() * 0.1) * big, [0, C.y - 0.03 - i * 0.08, 0.105], [0.9, 0, 0])
  }
  for (const s of SIDES) {
    for (let i = 0; i < 3; i++) {
      spine(0.04, 0.12 * big, [s * 0.09, C.y - 0.06 - i * 0.09, 0.105], [1.0, 0, -s * 0.5])
    }
  }

  k.on('stomach').box(skin, [0.32, S.y * 2, 0.2])
  for (let i = 0; i < 3; i++) {
    spine(0.05, (0.15 + rnd() * 0.06) * big, [0, S.y - 0.05 - i * 0.09, 0.095], [1.0, 0, 0])
  }
  for (const s of SIDES) k.box(ridge, [0.012, 0.22, 0.012], [s * 0.06, 0, -0.103])

  for (const arm of ['armL', 'armR'] as const) {
    k.on(arm).box(skin, [0.075, L, 0.085])
    spine(0.04, 0.12, [0, -0.02, 0.04], [Math.PI / 2 + 0.6, 0, 0]) // elbow spur
    k.box(ridge, [0.085, 0.07, 0.095], [0, L / 2 - 0.03, 0])
    // Three long bone claws, splayed.
    for (let i = 0; i < 3; i++) {
      const spread = (i - 1) * 0.22
      k.spike(claw, 0.025, 0.3, [(i - 1) * 0.03, L / 2, 0], [0.25, 0, -spread])
    }
  }

  for (const thigh of ['thighL', 'thighR'] as const) {
    k.on(thigh).box(skin, [0.11, T.y * 2, 0.12])
  }
  for (const shin of ['shinL', 'shinR'] as const) {
    k.on(shin).box(skin, [0.1, N.y * 2, 0.11])
    spine(0.04, 0.14, [0, -N.y + 0.08, 0.05], [1.9, 0, 0]) // heel spur
    for (let i = 0; i < 3; i++) {
      k.spike(claw, 0.02, 0.1, [(i - 1) * 0.035, -N.y + 0.01, -0.06], [-Math.PI / 2 + 0.1, 0, 0])
    }
  }
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
