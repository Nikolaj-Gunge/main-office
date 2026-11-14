import {
  type Appearance,
  BEARDS,
  EYE_COLORS,
  HAIR_COLORS,
  HAIR_STYLES,
  SKIN_TONES,
  type SkinId,
} from '@office-fps/shared'
import type * as THREE from 'three'
import { type BodyMesh, Kit, mix, noise3, OWN, pickOf, shade, step } from './body-kit.ts'
import {
  arms,
  BARE_LEGS,
  FIGURE,
  type Figure,
  face,
  faceZ,
  feet,
  fists,
  HEAD,
  type HeadShape,
  hairCap,
  jawShell,
  type Legwear,
  legs,
  type Paint,
  skull,
  skullPoint,
  TORSO_SEG,
  torso,
  torsoPoint as torsoPointCached,
} from './figure.ts'
import { type Dress, dressFor, wearHead } from './gear-looks.ts'

/**
 * People: the player's own face, hair, skin and build (appearance.ts), dressed either for the
 * office (shirt in their colour, tie, trousers, shoes) or for survival (a white tank top, grey
 * joggers and bare feet until they find clothes; gear-looks.ts draws what they find). Robots
 * and slimes are people too, in metal or jelly. One skinned mesh each, built per person.
 */

const TIE_COLORS = [0x1f2a44, 0x7a1f2b, 0x2d4a3a, 0x3b2d4f, 0x8a6a1f, 0x1c1c1c]
const HAT_COLORS = [0x2b2b2e, 0x4a3426, 0x2f3b4a, 0x5a5048]

export interface PersonSpec {
  skin: SkinId
  appearance: Appearance
  colorIndex: number
  /** Survival clothes (gear value) instead of office clothes; null = office. */
  gear: number | null
}

/** Office clothes: a shirt in the player's colour, tie, belt, dark trousers, black shoes. */
function officeDress(colorIndex: number): Dress {
  const tie = pickOf(TIE_COLORS, colorIndex)
  const shirt = OWN | 0xffffff
  return {
    top: (q) => (q.y > 1.505 ? null : fold(shirt, q, 0.05)),
    sleeve: { cuff: 0.245, baggy: 0.008, color: shirt },
    legs: { hem: 0.055, baggy: 0.01, straight: 0.064, cuff: false },
    legColor: 0x2f3440,
    feet: shoe(0x18181a, 0x101010),
    extras: (k, fig) => {
      collar(k, fig, 0xf2f0ea)
      tieOn(k, fig, tie)
      belt(k, fig, 0x1c1a18, 0x9a8a5a)
    },
    hidesUnder: false,
  }
}

/** Darker in the creases: horizontal folds that wander a little. */
export function fold(color: number, q: THREE.Vector3, amount: number): number {
  const n = noise3(q.x * 9, q.y * 3, q.z * 9)
  const crease = Math.max(0, Math.sin(q.y * 70 + n * 6 + q.x * 8)) ** 3
  return shade(color, 1 - amount * crease - 0.06 * (n - 0.5))
}

/** A shirt collar round the neck. */
export function collar(k: Kit, fig: Figure, color: number): void {
  const top = torsoRing(fig, 15, 0.012)
  const low = torsoRing(fig, 14, 0.014)
  k.on('torso').surface(
    color,
    TORSO_SEG,
    3,
    (u, v) => {
      const i = Math.round(u * TORSO_SEG) % TORSO_SEG
      const a = low[i] as THREE.Vector3
      const b = top[i] as THREE.Vector3
      const t = v
      // Folded over: out at the bottom, in at the top; open at the front.
      return [a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t + 0.015 * t, a.z + (b.z - a.z) * t]
    },
    { open: false },
  )
}

function torsoRing(fig: Figure, ring: number, inflate: number): THREE.Vector3[] {
  return Array.from({ length: TORSO_SEG }, (_, i) =>
    torsoPointCached(fig, (i / TORSO_SEG) * Math.PI * 2, ring, inflate),
  )
}

/** A tie down the front of the shirt, from the collar to the belt. */
export function tieOn(k: Kit, fig: Figure, color: number): void {
  const front = (y: number) => {
    // Front surface depth at height y (sampled from the torso rings).
    let z = 0
    for (let ring = 0; ring < 18; ring++) {
      const q = torsoPointCached(fig, Math.PI * 1.5, ring, 0)
      if (q.y <= y) z = q.z
    }
    return z
  }
  const rings: [number, number, number, number, number][] = []
  for (const [y, w] of [
    [1.48, 0.02],
    [1.44, 0.016],
    [1.35, 0.026],
    [1.2, 0.036],
    [1.1, 0.04],
    [1.06, 0.001],
  ] as const) {
    rings.push([y, w, 0.006, 0, front(y) - 0.014])
  }
  k.on('torso').tube(color, rings, 6, { caps: [false, false], square: 3 })
  k.blob(
    shade(color, 0.85),
    [0.022, 0.02, 0.012],
    [0, 1.475, front(1.475) - 0.016],
    [0, 0, 0],
    6,
    4,
  )
}

/** A belt with a buckle at the trouser waist. */
export function belt(k: Kit, fig: Figure, color: number, buckle: number): void {
  const low = torsoRing(fig, 2, 0.01)
  const high = torsoRing(fig, 3, 0.01)
  const y0 = 0.9
  const y1 = 0.935
  k.on('torso').surface(color, TORSO_SEG, 2, (u, v) => {
    const i = Math.round(u * TORSO_SEG) % TORSO_SEG
    const a = low[i] as THREE.Vector3
    const b = high[i] as THREE.Vector3
    const t = (y0 + (y1 - y0) * v - a.y) / (b.y - a.y)
    return [a.x + (b.x - a.x) * t, y0 + (y1 - y0) * v, a.z + (b.z - a.z) * t]
  })
  const fz = (low[Math.round(TORSO_SEG * 0.75)] as THREE.Vector3).z
  k.box(buckle, [0.04, 0.03, 0.008], [0, (y0 + y1) / 2, fz - 0.004])
}

/** Shoes: a rounded shoe with a darker sole. */
export function shoe(upper: number, sole: number, laces?: number): Dress['feet'] {
  return {
    size: { length: 0.135, width: 0.05, height: 0.05 },
    paint: (q) => {
      if (q.y < -0.215) return sole
      if (laces !== undefined && q.z < -0.02 && q.z > -0.09 && Math.abs(q.x) < 0.015 && q.y > -0.19)
        return laces
      return upper
    },
  }
}

/** Hair, each style its own shape; `hatted` drops the parts a hat would crush. */
function hair(k: Kit, h: HeadShape, style: string, color: number, hatted: boolean): void {
  const dark = shade(color, 0.8)
  const streaky = (q: THREE.Vector3) => mix(color, dark, noise3(q.x * 40, q.y * 25, q.z * 40))
  switch (style) {
    case 'bald':
    case 'buzz':
      return // painted on the skull
    case 'short':
      hairCap(k, h, streaky, { front: 0.3, side: 0.42, back: 0.6 }, (t) => 0.012 * Math.cos(t))
      return
    case 'side part':
      hairCap(
        k,
        h,
        (q) => (Math.abs(q.x + 0.035) < 0.006 && q.y > 0.07 ? shade(color, 0.6) : streaky(q)),
        {
          front: 0.27,
          side: 0.42,
          back: 0.6,
        },
        (t, phi) => 0.016 * Math.cos(t) + 0.012 * Math.max(0, Math.cos(phi)) * Math.sin(t * 2),
      )
      return
    case 'messy':
      hairCap(k, h, streaky, { front: 0.3, side: 0.44, back: 0.62 }, (t, phi) =>
        hatted ? 0.01 : 0.012 + 0.03 * Math.abs(Math.sin(phi * 5 + t * 7)) * Math.cos(t * 0.8),
      )
      return
    case 'mohawk':
      if (hatted) return
      for (let i = 0; i < 6; i++) {
        const theta = -0.1 + i * 0.15
        const q = skullPoint(
          h,
          Math.abs(theta) * Math.PI,
          theta < 0 ? Math.PI * 1.5 : Math.PI * 0.5,
        )
        k.on('head').blob(
          color,
          [0.016, 0.05 - i * 0.003, 0.032],
          [0, q.y + 0.02, q.z],
          [theta * 2.2, 0, 0],
          6,
          4,
        )
      }
      return
    case 'bob':
      hairCap(
        k,
        h,
        streaky,
        { front: 0.25, side: 0.72, back: 0.72 },
        (t) => 0.012 + 0.03 * step(0.3, 0.7, t / Math.PI),
      )
      return
    case 'ponytail': {
      hairCap(k, h, streaky, { front: 0.3, side: 0.45, back: 0.62 }, () => 0.006)
      k.on('head').blob(dark, [0.02, 0.02, 0.016], [0, 0.03, 0.118], [0, 0, 0], 6, 4)
      k.tube(
        color,
        [
          [0.04, 0.022, 0.02, 0, 0.13],
          [-0.03, 0.03, 0.026, 0, 0.15],
          [-0.12, 0.026, 0.022, 0, 0.155],
          [-0.2, 0.012, 0.012, 0, 0.15],
        ],
        8,
      )
      return
    }
    case 'long': {
      hairCap(k, h, streaky, { front: 0.27, side: 0.5, back: 0.6 }, () => 0.012)
      // A curtain down the back and sides to the shoulders, open at the face.
      k.on('head').surface(
        0xffffff,
        12,
        5,
        (u, v) => {
          const phi = Math.PI * 1.5 + 0.55 + u * (Math.PI * 2 - 1.1)
          const theta = 0.45 * Math.PI
          const q = skullPoint(h, theta, phi, 0.014)
          const drop = v * 0.3
          const spread = 1 + v * 0.25
          return [q.x * spread, q.y - drop, q.z * spread + v * 0.03]
        },
        { open: true, colorFn: streaky },
      )
      return
    }
    case 'bun':
      hairCap(k, h, streaky, { front: 0.3, side: 0.45, back: 0.6 }, () => 0.006)
      if (!hatted)
        k.on('head').blob(color, [0.045, 0.04, 0.045], [0, 0.135, 0.06], [0, 0, 0], 8, 6, streaky)
      return
  }
}

/** The skull's paint: skin, socket shadows, cheeks, and stubble or a buzz cut. */
function skullPaint(h: HeadShape, skin: number, hairColor: number, style: string, beard: string) {
  const eyeZ = faceZ(h, 0.037, 0.022)
  const buzz = style === 'buzz' || style === 'mohawk'
  const sides = style === 'mohawk'
  return (q: THREE.Vector3) => {
    let c = skin
    // Sockets: a little darker round the eyes, cheeks a little warmer.
    const dEye = Math.min(
      Math.hypot(q.x - 0.037, q.y - 0.024, q.z - eyeZ),
      Math.hypot(q.x + 0.037, q.y - 0.024, q.z - eyeZ),
    )
    c = shade(c, 0.88 + 0.12 * step(0.012, 0.035, dEye))
    if (q.z < 0 && q.y < 0 && q.y > -0.06)
      c = mix(c, 0xd06050, 0.06 * step(0.03, 0.06, Math.abs(q.x)))
    // Hairline for a buzz cut.
    const front = -q.z
    if (buzz && q.y > (front > 0.05 ? 0.07 : -0.03)) c = mix(c, hairColor, sides ? 0.35 : 0.65)
    if (
      (beard === 'stubble' || beard === 'full' || beard === 'goatee') &&
      q.y < -0.025 &&
      q.z < 0.05
    ) {
      const lips = Math.abs(q.x) < 0.03 && q.y > -0.075 && q.y < -0.045 && q.z < -0.07
      if (!lips) c = mix(c, hairColor, beard === 'stubble' ? 0.32 : 0.5)
    }
    return c
  }
}

const HATTED = new Set([1, 2, 3, 4, 6]) // cap, beanie, hardhat, helmet, cowboy hat

/** A whole person, baked. */
export function personMesh(spec: PersonSpec, own: number): BodyMesh {
  const a = spec.appearance
  const fem = a.body === 1 ? 1 : 0
  const fig: Figure = { ...FIGURE, fem }
  const h: HeadShape = {
    ...HEAD,
    rx: fem ? 0.091 : 0.097,
    jaw: fem ? 0.33 : 0.22,
    chin: fem ? 0.004 : 0.01,
    ry: fem ? 0.124 : 0.128,
  }
  const k = new Kit()
  const robot = spec.skin === 'robot'
  const slime = spec.skin === 'slime'
  const skin = robot ? 0x9aa2ae : slime ? OWN | 0xffffff : pickOf(SKIN_TONES, a.skin)
  const hairColor = pickOf(HAIR_COLORS, a.hairColor)
  const style = robot || slime ? 'bald' : pickOf(HAIR_STYLES, a.hair)
  const beard = robot || slime ? 'none' : pickOf(BEARDS, a.beard)
  const headLook = spec.gear === null ? 0 : spec.gear & 15
  const dress: Dress = spec.gear === null ? officeDress(spec.colorIndex) : dressFor(spec.gear, fig)

  // Torso: the top (or skin), trousers over the hips.
  const legColor = dress.legColor
  const torsoPaint: Paint = (q) => {
    if (q.y < 0.93) return fold(legColor, q, 0.08)
    return dress.top(q) ?? skin
  }
  torso(k, fig, torsoPaint)
  const sleeve = dress.sleeve
  arms(
    k,
    fig,
    (q) =>
      sleeve && q.y <= sleeve.cuff ? (sleeve.paint?.(q) ?? fold(sleeve.color, q, 0.08)) : skin,
    sleeve,
  )
  fists(k, skin, 1, robot ? 0x5a606a : undefined)
  const wear: Legwear = dress.legs ?? BARE_LEGS
  legs(k, fig, wear, (q) =>
    q.y >= wear.hem ? fold(dress.legPaint?.(q) ?? legColor, q, 0.1) : skin,
  )
  if (dress.feet) feet(k, dress.feet.paint, dress.feet.size)
  else feet(k, (q) => (q.z < -0.13 && q.y > -0.215 ? shade(skin, 0.94) : skin))
  dress.extras?.(k, fig)

  // Head.
  skull(k, h, robot || slime ? () => skin : skullPaint(h, skin, hairColor, style, beard))
  if (robot) {
    k.on('head').blob(
      0x5ff2ff,
      [0.075, 0.022, 0.03],
      [0, 0.02, faceZ(h, 0, 0.02) + 0.018],
      [0, 0, 0],
      10,
      4,
    )
    k.box(0x3c424c, [0.012, 0.12, 0.012], [0.06, 0.17, 0])
    k.blob(OWN | 0xffffff, [0.03, 0.03, 0.03], [0.06, 0.24, 0], [0, 0, 0], 8, 6)
    for (const s of [-1, 1])
      k.blob(0x3c424c, [0.02, 0.04, 0.04], [s * 0.098, 0, 0.01], [0, 0, 0], 6, 4)
  } else if (slime) {
    k.on('head').blob(
      0x1b1d2a,
      [0.08, 0.026, 0.03],
      [0, 0.02, faceZ(h, 0, 0.02) + 0.016],
      [0, 0, 0],
      10,
      4,
    )
    if (headLook === 0) slimeHat(k, h, spec.colorIndex)
  } else {
    const iris = pickOf(EYE_COLORS, a.eyes)
    face(k, h, {
      skin,
      iris,
      brow: shade(hairColor, 0.85),
      lips: mix(skin, fem ? 0xb04050 : 0x9a5048, fem ? 0.45 : 0.25),
      fem,
      noseSize: fem ? 0.85 : 1,
    })
    hair(k, h, style, hairColor, HATTED.has(headLook))
    if (beard === 'moustache' || beard === 'goatee' || beard === 'full') {
      const z = faceZ(h, 0, -0.042)
      k.on('head').blob(hairColor, [0.03, 0.009, 0.012], [0, -0.042, z - 0.003], [0, 0, 0], 6, 4)
    }
    if (beard === 'goatee') {
      const z = faceZ(h, 0, -0.09)
      k.on('head').blob(hairColor, [0.022, 0.024, 0.014], [0, -0.092, z + 0.002], [0, 0, 0], 6, 4)
    }
    if (beard === 'full') jawShell(k, h, hairColor, 0.012, 0.56)
  }
  if (spec.gear !== null) wearHead(k, headLook, h)
  return k.build(own)
}

/** The slime's fedora or bowler. */
function slimeHat(k: Kit, h: HeadShape, colorIndex: number): void {
  const color = pickOf(HAT_COLORS, colorIndex)
  const top = h.cy + h.ry
  k.on('head').rigid()
  k.tube(
    color,
    [
      [top - 0.03, 0.2, 0.2],
      [top - 0.02, 0.2, 0.2],
    ],
    14,
  )
  if (colorIndex % 2 === 0) {
    k.tube(
      color,
      [
        [top - 0.03, 0.115, 0.125],
        [top + 0.05, 0.11, 0.12],
        [top + 0.09, 0.095, 0.1],
      ],
      12,
    )
    k.tube(
      0x111111,
      [
        [top - 0.015, 0.118, 0.128],
        [top + 0.01, 0.116, 0.126],
      ],
      12,
      { caps: [false, false] },
    )
  } else {
    k.blob(color, [0.125, 0.1, 0.13], [0, top - 0.02, 0], [0, 0, 0], 12, 6)
  }
  k.rigid(false)
}
