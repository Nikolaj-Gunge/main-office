import * as THREE from 'three'
import { type ColorFn, type Kit, mix, type Ring, step } from './body-kit.ts'
import { JOINTS } from './body-rig.ts'

/**
 * Smooth body building blocks shared by people and zombies: a torso that runs from the crotch
 * up into the neck, whole legs from hip to ankle, arms, fists, feet and a head with a face. Every
 * block takes a figure (build and proportions) and paint functions, so clothes are mostly
 * colour on the body itself (a shirt, trousers, a tank top) and only add shape where they have
 * it (collars, cuffs, boots). Model space: feet at the origin, facing -Z, metres.
 */

export interface Figure {
  /** 0 = masculine … 1 = feminine (shoulders, hips, waist, chest, jaw). */
  fem: number
  /** Torso width × (brutes are wide, runners narrow). */
  girth: number
  /** Torso depth ×. */
  depth: number
  /** Limb thickness ×. */
  limb: number
  /** Extra belly out front (m). */
  belly: number
  /** Waist pulled in × (starved < 1). */
  waist: number
  /** Shoulder width ×. */
  shoulders: number
}

export const FIGURE: Figure = {
  fem: 0,
  girth: 1,
  depth: 1,
  limb: 1,
  belly: 0,
  waist: 1,
  shoulders: 1,
}

/** Paint for a point (model space for torso and legs, the bone's own space for the rest). */
export type Paint = (p: THREE.Vector3) => number

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

// Torso profile: height → half-width, half-depth, depth centre (masculine | feminine).
const TORSO_Y = [
  0.79, 0.83, 0.88, 0.94, 1.0, 1.06, 1.12, 1.18, 1.24, 1.3, 1.35, 1.39, 1.425, 1.455, 1.48, 1.5,
  1.53, 1.6,
]
const TORSO_M: readonly (readonly [number, number, number])[] = [
  [0.05, 0.05, 0.0],
  [0.13, 0.09, 0.004],
  [0.163, 0.104, 0.008],
  [0.168, 0.108, 0.01],
  [0.161, 0.104, 0.004],
  [0.156, 0.102, 0.0],
  [0.158, 0.104, -0.002],
  [0.165, 0.108, -0.005],
  [0.175, 0.114, -0.008],
  [0.183, 0.118, -0.009],
  [0.188, 0.117, -0.008],
  [0.192, 0.111, -0.004],
  [0.19, 0.1, 0.002],
  [0.172, 0.088, 0.008],
  [0.13, 0.074, 0.01],
  [0.075, 0.06, 0.006],
  [0.056, 0.054, 0.0],
  [0.052, 0.05, -0.004],
]
const TORSO_F: readonly (readonly [number, number, number])[] = [
  [0.055, 0.05, 0.0],
  [0.145, 0.095, 0.006],
  [0.178, 0.108, 0.012],
  [0.18, 0.11, 0.014],
  [0.162, 0.1, 0.006],
  [0.142, 0.092, 0.0],
  [0.132, 0.088, -0.002],
  [0.138, 0.092, -0.004],
  [0.148, 0.098, -0.006],
  [0.155, 0.1, -0.006],
  [0.16, 0.1, -0.005],
  [0.165, 0.098, -0.002],
  [0.165, 0.09, 0.002],
  [0.152, 0.08, 0.006],
  [0.115, 0.068, 0.008],
  [0.068, 0.054, 0.005],
  [0.05, 0.048, 0.0],
  [0.046, 0.045, -0.004],
]
export const TORSO_SEG = 18

/**
 * A point on the torso surface: `a` round the body (0 = right side, π/2 = back, 3π/2 = front)
 * at ring `i`, pushed out by `inflate` (clothes over it).
 */
export function torsoPoint(fig: Figure, a: number, i: number, inflate = 0): THREE.Vector3 {
  const y = TORSO_Y[i] as number
  const m = TORSO_M[i] as readonly [number, number, number]
  const f = TORSO_F[i] as readonly [number, number, number]
  let hw = lerp(m[0], f[0], fig.fem)
  let hd = lerp(m[1], f[1], fig.fem)
  const zc = lerp(m[2], f[2], fig.fem)
  // Shoulders, girth and waist only below the neck.
  const body = 1 - step(1.47, 1.52, y)
  const shoulder = step(1.3, 1.42, y) * (1 - step(1.46, 1.5, y))
  hw *= 1 + body * (fig.girth - 1 + shoulder * (fig.shoulders - 1))
  hd *= 1 + body * (fig.depth - 1)
  const waistBand = Math.exp(-(((y - 1.08) / 0.1) ** 2))
  hw *= 1 - (1 - fig.waist) * waistBand
  hd *= 1 - (1 - fig.waist) * waistBand * 0.6
  const c = Math.cos(a)
  const s = Math.sin(a)
  const e = 2 / 2.6
  let x = hw * Math.sign(c) * Math.abs(c) ** e
  let z = zc + hd * Math.sign(s) * Math.abs(s) ** e
  if (s < 0) {
    // Front: belly, and a chest (pecs or a bust).
    const front = -s
    z -= fig.belly * Math.exp(-(((y - 1.02) / 0.11) ** 2)) * front ** 1.5
    const bust = fig.fem * 0.04 * Math.exp(-(((y - 1.29) / 0.06) ** 2))
    const pecs = (1 - fig.fem) * 0.012 * Math.exp(-(((y - 1.3) / 0.06) ** 2))
    const across = Math.exp(-(((Math.abs(x) - 0.075) / 0.06) ** 2))
    z -= (bust + pecs) * across * front
  }
  // Inflate along the (approximate) outward direction.
  if (inflate !== 0) {
    const len = Math.hypot(x / Math.max(hw, 1e-3), (z - zc) / Math.max(hd, 1e-3)) || 1
    x += (inflate * x) / Math.max(hw, 1e-3) / len
    z += (inflate * (z - zc)) / Math.max(hd, 1e-3) / len
  }
  return new THREE.Vector3(x, y, z)
}

/** The torso skin (or a garment shell from ring `from` to `to` pushed out by `inflate`). */
export function torso(
  k: Kit,
  fig: Figure,
  paint: Paint,
  opts: { from?: number; to?: number; inflate?: number; look?: number } = {},
): void {
  const from = opts.from ?? 0
  const to = opts.to ?? TORSO_Y.length - 1
  const rings = to - from + 1
  const closed = from === 0
  const top = to === TORSO_Y.length - 1
  const pts: THREE.Vector3[][] = []
  for (let j = 0; j < rings; j++) {
    const row: THREE.Vector3[] = []
    for (let i = 0; i < TORSO_SEG; i++) {
      row.push(torsoPoint(fig, (i / TORSO_SEG) * Math.PI * 2, from + j, opts.inflate ?? 0))
    }
    pts.push(row)
  }
  // Closed ends get a pole a little beyond the end ring.
  const all = [...pts]
  const centre = (row: THREE.Vector3[], dy: number) => {
    const c = new THREE.Vector3()
    for (const q of row) c.add(q)
    c.multiplyScalar(1 / row.length)
    c.y += dy
    return Array.from({ length: TORSO_SEG }, () => c.clone())
  }
  if (closed) all.unshift(centre(pts[0] as THREE.Vector3[], -0.02))
  if (top) all.push(centre(pts[pts.length - 1] as THREE.Vector3[], 0.01))
  const surfacePaint: ColorFn = (q) => paint(q)
  k.on('torso').surface(
    opts.look ?? 0xffffff,
    TORSO_SEG,
    all.length,
    (u, v) => {
      const j = Math.round(v * (all.length - 1))
      const i = Math.round(u * TORSO_SEG) % TORSO_SEG
      const q = (all[j] as THREE.Vector3[])[i] as THREE.Vector3
      return [q.x, q.y, q.z]
    },
    { colorFn: surfacePaint, poles: [closed, top] },
  )
}

/** Leg shape: radius × at height (model), offsets for trousers, cuffs and boots. */
export interface Legwear {
  /** Hem height: legwear above, skin below (0 = to the floor). */
  hem: number
  /** Extra radius of the legwear (baggy). */
  baggy: number
  /** Straight legs: the radius never falls below this above the hem (trousers). */
  straight: number
  /** Gathered tight at the hem (joggers, cargo tucked into boots). */
  cuff: boolean
}
export const BARE_LEGS: Legwear = { hem: 2, baggy: 0, straight: 0, cuff: false }

// Leg profile: height, half-width, half-depth, depth centre.
const LEG: readonly (readonly [number, number, number, number])[] = [
  [0.95, 0.075, 0.08, 0.0],
  [0.86, 0.086, 0.09, 0.0],
  [0.76, 0.08, 0.085, 0.0],
  [0.64, 0.07, 0.075, -0.004],
  [0.53, 0.06, 0.065, -0.006],
  [0.47, 0.056, 0.06, -0.008],
  [0.42, 0.055, 0.06, -0.004],
  [0.36, 0.057, 0.064, 0.008],
  [0.29, 0.056, 0.064, 0.012],
  [0.21, 0.046, 0.052, 0.008],
  [0.14, 0.036, 0.04, 0.002],
  [0.09, 0.034, 0.038, 0.0],
  [0.06, 0.034, 0.038, 0.0],
]

/** Both legs, hip to ankle (feet are separate: barefoot or shod). */
export function legs(k: Kit, fig: Figure, wear: Legwear, paint: Paint): void {
  for (const s of [-1, 1] as const) {
    const rings: Ring[] = LEG.map(([y, rx, rz, zc]) => {
      const thick = fig.limb * (1 + fig.fem * 0.06 * step(0.6, 0.85, y))
      let a = rx * thick
      let b = rz * thick
      if (y >= wear.hem - 1e-6) {
        const cuff = wear.cuff ? step(wear.hem, wear.hem + 0.08, y) : 1
        const extra = wear.baggy * cuff + 0.006
        a = Math.max(a, wear.straight) + extra
        b = Math.max(b, wear.straight * 1.05) + extra
      }
      const x = s * (0.105 + 0.006 * (1 - y))
      return [y, a, b, x, zc]
    })
    // The legwear's hem: a ring at the hem itself so the colour edge is crisp.
    k.on(s < 0 ? 'legL' : 'legR').tube(0xffffff, rings, 12, {
      colorFn: (q) => paint(q),
      caps: [false, true],
    })
  }
}

/** Arm shape (arm space: shoulder at y = -0.28, wrist at +0.28). */
const ARM_RINGS: readonly Ring[] = [
  [-0.3, 0.034, 0.036],
  [-0.26, 0.052, 0.054],
  [-0.19, 0.052, 0.054],
  [-0.09, 0.047, 0.049],
  [0.0, 0.041, 0.043],
  [0.08, 0.044, 0.046],
  [0.17, 0.038, 0.039],
  [0.25, 0.03, 0.031],
  [0.285, 0.028, 0.029],
]

/** Both arms; `sleeve` from the shoulder down to `cuff` (arm y) adds `baggy` to the radius. */
export function arms(
  k: Kit,
  fig: Figure,
  paint: Paint,
  sleeve: { cuff: number; baggy: number } | null = null,
  seg = 10,
): void {
  const thick = fig.limb * (1 - 0.14 * fig.fem)
  const rings: Ring[] = ARM_RINGS.map(([y, rx, rz]) => {
    const extra = sleeve && y <= sleeve.cuff + 1e-6 ? sleeve.baggy : 0
    return [y, rx * thick + extra, rz * thick + extra]
  })
  for (const arm of ['armL', 'armR'] as const) {
    k.on(arm).tube(0xffffff, rings, seg, { colorFn: (q) => paint(q) })
  }
}

/** Fists on both hands (hand space: wrist at the origin, knuckles towards +Y). */
export function fists(k: Kit, color: number, scale = 1, nails?: number): void {
  for (const hand of ['handL', 'handR'] as const) {
    const s = hand === 'handL' ? -1 : 1
    const z = (v: number) => v * scale
    k.on(hand).blob(color, [z(0.036), z(0.046), z(0.021)], [0, z(0.04), 0], [0, 0, 0], 8, 5)
    k.blob(
      color,
      [z(0.037), z(0.03), z(0.027)],
      [0, z(0.086), z(-0.01)],
      [0.3, 0, 0],
      8,
      5,
      nails === undefined ? undefined : (q) => (q.z < -z(0.012) && q.y > z(0.005) ? nails : color),
    )
    k.blob(
      color,
      [z(0.012), z(0.03), z(0.013)],
      [s * z(0.028), z(0.06), z(-0.022)],
      [-0.5, 0, s * 0.5],
      6,
      4,
    )
  }
}

/** Feet on both shins (shin space: the sole at y = -0.23, toes towards -Z). */
export function feet(
  k: Kit,
  paint: (q: THREE.Vector3) => number,
  size: { length: number; width: number; height: number } = {
    length: 0.12,
    width: 0.045,
    height: 0.04,
  },
): void {
  const { length, width, height } = size
  const sole = -0.23
  for (const shin of ['shinL', 'shinR'] as const) {
    k.on(shin)
      .rigid()
      .surface(
        0xffffff,
        12,
        8,
        (u, v) => {
          const theta = v * Math.PI
          const phi = u * Math.PI * 2
          const dx = Math.sin(theta) * Math.cos(phi)
          const dy = Math.cos(theta)
          const dz = Math.sin(theta) * Math.sin(phi)
          // Toes wider than the heel, a flat sole, an instep rising to the ankle.
          const toe = Math.max(0, -dz)
          const x = dx * width * (0.85 + 0.25 * toe)
          let y = dy * height
          if (y < -height * 0.55) y = -height * 0.55
          y += height * 0.4 * Math.max(0, dz) * Math.max(0, dy) // heel up into the ankle
          const z = dz * length
          return [x, sole + height * 0.55 + y, z - length * 0.38]
        },
        { colorFn: (q) => paint(q), poles: [true, true] },
      )
    k.rigid(false)
  }
}

// --- Heads ---------------------------------------------------------------------------------

export interface HeadShape {
  rx: number
  ry: number
  rz: number
  /** Centre of the skull in head space. */
  cy: number
  /** Jaw narrowing (0–1). */
  jaw: number
  /** Chin forward/down (m). */
  chin: number
  /** Long skull: extra height on top (screamer). */
  stretch: number
  /** Back of the skull swept up and back (stalker crest). */
  crest: number
}
export const HEAD: HeadShape = {
  rx: 0.096,
  ry: 0.128,
  rz: 0.112,
  cy: 0.015,
  jaw: 0.24,
  chin: 0.008,
  stretch: 0,
  crest: 0,
}

/** A point on the skull for polar angle theta (0 = crown) and azimuth phi; inflated. */
export function skullPoint(h: HeadShape, theta: number, phi: number, inflate = 0): THREE.Vector3 {
  const dx = Math.sin(theta) * Math.cos(phi)
  const dy = Math.cos(theta)
  const dz = Math.sin(theta) * Math.sin(phi)
  const lower = Math.max(0, -dy)
  const upper = Math.max(0, dy)
  let x = dx * (h.rx + inflate)
  let y = dy * (h.ry + inflate) + upper * upper * h.stretch
  let z = dz * (h.rz + inflate)
  x *= 1 - h.jaw * lower ** 1.3
  if (dz > 0) {
    z *= 1 - 0.42 * lower ** 1.1 + 0.06 * (1 - lower)
    z += h.crest * upper * dz * 1.2
    y += h.crest * 0.4 * dz * upper
  } else {
    z *= 1 - 0.06 * lower - 0.05 * upper ** 2
    y -= h.chin * step(0.5, 1, lower) * -dz
    z -= h.chin * 0.6 * step(0.5, 0.9, lower) * -dz
  }
  return new THREE.Vector3(x, y + h.cy, z)
}

/** The skull (seg × rings), painted in head space. */
export function skull(k: Kit, h: HeadShape, paint: Paint, seg = 16, rings = 12): void {
  k.on('head').surface(
    0xffffff,
    seg,
    rings,
    (u, v) => {
      const q = skullPoint(h, v * Math.PI, u * Math.PI * 2)
      return [q.x, q.y, q.z]
    },
    { colorFn: (q) => paint(q), poles: [true, true] },
  )
}

/** Head-space front of the face at height y and offset x (approximate surface z). */
export function faceZ(h: HeadShape, x: number, y: number): number {
  let best = 0
  let bestD = Number.POSITIVE_INFINITY
  for (let i = 0; i <= 24; i++) {
    const theta = (i / 24) * Math.PI
    for (let j = 0; j <= 12; j++) {
      const phi = Math.PI + (j / 12) * Math.PI
      const q = skullPoint(h, theta, phi)
      if (q.z > 0) continue
      const d = (q.x - x) ** 2 + (q.y - y) ** 2
      if (d < bestD) {
        bestD = d
        best = q.z
      }
    }
  }
  return best
}

/** A hair cap over the skull down to a hairline (theta at the front, sides and back). */
export function hairCap(
  k: Kit,
  h: HeadShape,
  color: number | ((q: THREE.Vector3) => number),
  line: { front: number; side: number; back: number },
  puff: (theta: number, phi: number) => number,
  seg = 16,
  rings = 7,
): void {
  k.on('head').surface(
    typeof color === 'number' ? color : 0xffffff,
    seg,
    rings,
    (u, v) => {
      const phi = u * Math.PI * 2
      const front = -Math.sin(phi)
      const max =
        front > 0 ? lerp(line.side, line.front, front) : lerp(line.side, line.back, -front)
      const theta = v * max * Math.PI
      const q = skullPoint(h, theta, phi, 0.008 + puff(theta, phi))
      return [q.x, q.y, q.z]
    },
    { colorFn: typeof color === 'number' ? undefined : (q) => color(q), poles: [true, false] },
  )
}

/** Eyes (white + iris), brows, nose, lips, ears for a person-like face. */
export function face(
  k: Kit,
  h: HeadShape,
  o: {
    skin: number
    iris: number
    brow: number
    lips: number
    eyeY?: number
    eyeX?: number
    noseSize?: number
    fem?: number
  },
): void {
  const eyeY = o.eyeY ?? 0.022
  const eyeX = o.eyeX ?? 0.037
  const fz = faceZ(h, eyeX, eyeY)
  k.on('head')
  for (const s of [-1, 1]) {
    k.blob(0xf2efe8, [0.016, 0.0105, 0.008], [s * eyeX, eyeY, fz + 0.007], [0, 0, 0], 6, 4)
    k.blob(o.iris, [0.0075, 0.0085, 0.004], [s * eyeX, eyeY, fz - 0.0005], [0, 0, 0], 6, 4)
    k.blob(
      o.brow,
      [0.027, 0.0065 * (1 - 0.35 * (o.fem ?? 0)), 0.01],
      [s * 0.039, eyeY + 0.028, faceZ(h, 0.039, eyeY + 0.028) + 0.003],
      [0, 0, s * -0.12],
      6,
      4,
    )
    // Ears.
    const ex = skullPoint(h, Math.PI * 0.52, s > 0 ? 0 : Math.PI).x
    k.blob(o.skin, [0.011, 0.028, 0.019], [ex + s * 0.003, 0.0, 0.012], [0, s * 0.35, 0], 6, 5)
  }
  const n = o.noseSize ?? 1
  const nz = faceZ(h, 0, -0.005)
  k.blob(o.skin, [0.012 * n, 0.03 * n, 0.016 * n], [0, -0.002, nz - 0.004], [-0.3, 0, 0], 6, 5)
  k.blob(
    mix(o.skin, 0xb05040, 0.12),
    [0.017 * n, 0.013 * n, 0.015 * n],
    [0, -0.03, nz - 0.012],
    [0, 0, 0],
    6,
    4,
  )
  const mz = faceZ(h, 0, -0.06)
  k.blob(o.lips, [0.024, 0.0065, 0.008], [0, -0.058, mz + 0.002], [0, 0, 0], 6, 4)
}

/** A neck-to-crown shell around the face, for beards etc. (front half of the lower head). */
export function jawShell(k: Kit, h: HeadShape, color: number, inflate: number, top: number): void {
  k.on('head').surface(
    color,
    10,
    5,
    (u, v) => {
      const phi = Math.PI + 0.1 + u * (Math.PI - 0.2)
      const theta = lerp(top, 0.97, v) * Math.PI
      const q = skullPoint(h, theta, phi, inflate * (1 - 0.6 * v))
      return [q.x, q.y, q.z]
    },
    { open: true },
  )
}

export const JOINT_Y = JOINTS
