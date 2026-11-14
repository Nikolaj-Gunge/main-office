import { BODY_LOOKS, FEET_LOOKS, HEAD_LOOKS, LEGS_LOOKS } from '@office-fps/shared'
import * as THREE from 'three'
import { type Kit, mix, noise3, seeded, shade, step } from './body-kit.ts'
import {
  type Figure,
  faceZ,
  type HeadShape,
  hairCap,
  jawShell,
  type Legwear,
  type Paint,
  skullPoint,
  TORSO_SEG,
  torsoPoint,
} from './figure.ts'

/**
 * What people wear in survival, as everyone else sees it. The worn gear value packs one look per
 * slot: head | body << 4 | legs << 8 | feet << 12. Everyone starts in a white tank top, grey
 * joggers and bare feet; clothes they find are mostly paint on the smooth body (a flannel's
 * plaid, a camo pattern) plus the shape they add (a hood, a vest's plates, boots, a hat).
 */

/** How a person is dressed (people.ts paints the body with it). */
export interface Dress {
  /** Torso colour above the trousers (model space); null = bare skin. */
  top: (q: THREE.Vector3) => number | null
  /** Sleeves down to `cuff` (arm space), `baggy` m over the arm; null = bare arms. */
  sleeve: { cuff: number; baggy: number; color: number; paint?: Paint } | null
  legs: Legwear | null
  legColor: number
  legPaint?: Paint
  /** Shoes (shin space); null = barefoot. */
  feet: { size?: { length: number; width: number; height: number }; paint: Paint } | null
  /** Shapes on top (collars, plates, pockets, a hood). */
  extras?: (k: Kit, fig: Figure) => void
  /** A closed coat hides the tie and collar under it (office). */
  hidesUnder: boolean
}

const head = (g: number) => g & 15
const body = (g: number) => (g >> 4) & 15
const legsOf = (g: number) => (g >> 8) & 15
const feetOf = (g: number) => (g >> 12) & 15

/** The white tank top everyone starts in: scooped neck, armholes, a little grubby. */
const TANK = 0xe9e6dc
function tankTop(q: THREE.Vector3): number | null {
  if (q.y > 1.49) return null
  const ax = Math.abs(q.x)
  const strap = ax > 0.06 && ax < 0.12
  if (q.y > 1.3 && ax > 0.138) return null // armholes
  if (q.z < 0 && q.y > 1.36 && !strap) return null // scoop neck
  if (q.z >= 0 && q.y > 1.425 && !strap) return null
  const grime = noise3(q.x * 14, q.y * 9, q.z * 14)
  const ribs = 0.97 + 0.03 * Math.sin(q.x * 160 + q.z * 160)
  return shade(mix(TANK, 0xb8ae98, 0.25 * grime ** 2), ribs)
}

const camo = (q: THREE.Vector3, base: number) => {
  const n = noise3(q.x * 8, q.y * 7, q.z * 8) + 0.5 * noise3(q.x * 19 + 3, q.y * 17, q.z * 19)
  if (n > 1.05) return 0x26281c
  if (n > 0.85) return 0x3a4228
  if (n < 0.5) return 0x7a7448
  return base
}

const plaid = (q: THREE.Vector3, red: number) => {
  const u = q.x + q.z * 0.6
  const bandY = Math.abs(Math.sin(q.y * 48)) > 0.82
  const bandX = Math.abs(Math.sin(u * 48)) > 0.82
  if (bandY && bandX) return 0x1a0a08
  if (bandY || bandX) return shade(red, 0.45)
  if (Math.abs(Math.sin(q.y * 48 + 1.5)) > 0.97) return 0xc8584a
  return red
}

/** A shape along the torso at an inflation: rings from..to, u from u0..u1 (open sheet). */
function torsoSheet(
  k: Kit,
  fig: Figure,
  color: number | Paint,
  rings: readonly number[],
  inflate: number,
  u0 = 0,
  u1 = 1,
): void {
  const open = u1 - u0 < 1
  k.on('torso').surface(
    typeof color === 'number' ? color : 0xffffff,
    open ? Math.max(3, Math.round(TORSO_SEG * (u1 - u0)) + 1) : TORSO_SEG,
    rings.length,
    (u, v) => {
      const ring = rings[Math.round(v * (rings.length - 1))] as number
      const q = torsoPoint(fig, (u0 + (u1 - u0) * u) * Math.PI * 2, ring, inflate)
      return [q.x, q.y, q.z]
    },
    { open, colorFn: typeof color === 'number' ? undefined : (q) => color(q) },
  )
}

/** Torso front depth at height y (centre line). */
function frontZ(fig: Figure, y: number, inflate = 0): number {
  let z = 0
  for (let ring = 0; ring < 18; ring++) {
    const q = torsoPoint(fig, Math.PI * 1.5, ring, inflate)
    if (q.y <= y + 1e-6) z = q.z
  }
  return z
}
function backZ(fig: Figure, y: number, inflate = 0): number {
  let z = 0
  for (let ring = 0; ring < 18; ring++) {
    const q = torsoPoint(fig, Math.PI * 0.5, ring, inflate)
    if (q.y <= y + 1e-6) z = q.z
  }
  return z
}

function makePoliceTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 16
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#e8ecf0'
  ctx.fillRect(0, 0, 64, 16)
  ctx.fillStyle = '#141c30'
  ctx.font = 'bold 13px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('POLICE', 32, 9)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
/** The reflective POLICE strip (catches a little light even at night). */
const policeStrip = new THREE.MeshLambertMaterial({
  map: makePoliceTexture(),
  emissive: 0x30343a,
})

/** A flat label on the back or front of the torso (a plane bent round it a little). */
function label(
  k: Kit,
  fig: Figure,
  material: THREE.Material,
  y: number,
  w: number,
  h: number,
  back: boolean,
): void {
  const z = back ? backZ(fig, y, 0.03) + 0.004 : frontZ(fig, y, 0.03) - 0.004
  const plane = new THREE.PlaneGeometry(w, h, 4, 1)
  const pos = plane.getAttribute('position')
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    pos.setZ(i, (back ? -1 : 1) * 2.2 * x * x)
  }
  if (back) plane.rotateY(Math.PI)
  k.on('torso').add(material, plane, [0, y, z])
}

type Wear = (d: Dress, fig: Figure) => void

const BODY: Record<number, Wear> = {
  [BODY_LOOKS.hoodie]: (d) => {
    const grey = 0x5c616b
    d.top = (q) =>
      q.y > 1.5 ? null : shade(grey, 0.95 + 0.1 * noise3(q.x * 20, q.y * 20, q.z * 20))
    d.sleeve = { cuff: 0.25, baggy: 0.016, color: grey }
    d.hidesUnder = true
    d.extras = (k, fig) => {
      // The hood, down on the shoulders; the pouch pocket and drawstrings.
      torsoSheet(k, fig, shade(grey, 0.85), [13, 14, 15], 0.035, 0.05, 0.45)
      k.on('torso').blob(
        shade(grey, 0.85),
        [0.12, 0.07, 0.05],
        [0, 1.47, backZ(fig, 1.45) + 0.03],
        [0.3, 0, 0],
        8,
        5,
      )
      const fz = frontZ(fig, 1.02, 0.02)
      k.blob(shade(grey, 0.88), [0.11, 0.055, 0.015], [0, 1.0, fz - 0.002], [0, 0, 0], 8, 4)
      for (const s of [-1, 1])
        k.blob(
          0xe2e2dc,
          [0.005, 0.05, 0.005],
          [s * 0.04, 1.4, frontZ(fig, 1.4, 0.01) - 0.006],
          [0, 0, 0],
          4,
          4,
        )
      // Ribbed hem.
      torsoSheet(k, fig, shade(grey, 0.8), [3, 4], 0.016)
    }
  },
  [BODY_LOOKS.jacket]: (d) => {
    const leather = 0x3a281c
    const under = d.top
    // Open down the front: the top shows between the panels.
    d.top = (q) => {
      if (q.y > 1.5) return null
      if (q.z < 0 && Math.abs(q.x) < 0.05 + (q.y > 1.35 ? (q.y - 1.35) * 0.6 : 0)) return under(q)
      return shade(leather, 0.92 + 0.12 * noise3(q.x * 25, q.y * 25, q.z * 25))
    }
    d.sleeve = { cuff: 0.255, baggy: 0.014, color: leather }
    d.hidesUnder = false
    d.extras = (k, fig) => {
      torsoSheet(k, fig, 0x241810, [14, 15, 16], 0.03, 0.05, 0.45) // collar
      for (const s of [-1, 1]) {
        const y = 1.4
        k.on('torso').blob(
          0x241810,
          [0.035, 0.07, 0.008],
          [s * 0.075, y, frontZ(fig, y, 0.012) + 0.004],
          [0, s * 0.3, s * 0.35],
          6,
          4,
        ) // lapel
        k.blob(
          0x241810,
          [0.04, 0.006, 0.01],
          [s * 0.1, 1.02, frontZ(fig, 1.02, 0.012)],
          [0, 0, 0],
          6,
          3,
        )
      }
    }
  },
  [BODY_LOOKS.camo]: (d) => {
    d.top = (q) => (q.y > 1.5 ? null : camo(q, 0x5a6440))
    d.sleeve = { cuff: 0.255, baggy: 0.014, color: 0x5a6440, paint: (q) => camo(q, 0x5a6440) }
    d.hidesUnder = true
    d.extras = (k, fig) => {
      torsoSheet(k, fig, 0x3a4228, [14, 15], 0.025, 0.05, 0.45)
      for (const s of [-1, 1]) {
        const y = 1.3
        k.on('torso').blob(
          0x4a5236,
          [0.05, 0.035, 0.012],
          [s * 0.09, y, frontZ(fig, y, 0.012) + 0.002],
          [0, 0, 0],
          6,
          4,
        )
      }
    }
  },
  [BODY_LOOKS.police]: (d) => {
    const navy = 0x1a2236
    const shirt = 0x86a2c4
    d.top = (q) => (q.y > 1.5 ? null : q.y > 1.47 ? shirt : navy)
    d.sleeve = { cuff: 0.0, baggy: 0.008, color: shirt }
    d.hidesUnder = true
    d.extras = (k, fig) => {
      label(k, fig, policeStrip, 1.33, 0.3, 0.075, true)
      label(k, fig, policeStrip, 1.22, 0.24, 0.055, false)
      const fz = frontZ(fig, 1.36, 0.02)
      k.on('torso').box(0xd2a838, [0.04, 0.05, 0.01], [-0.1, 1.38, fz])
      k.box(0x111111, [0.05, 0.08, 0.035], [0.12, 1.37, fz - 0.01])
      k.box(0x111111, [0.015, 0.04, 0.015], [0.135, 1.43, fz - 0.01])
      torsoSheet(k, fig, 0x101010, [2, 3], 0.03) // duty belt
      k.box(0x101010, [0.05, 0.1, 0.05], [0.19, 0.88, -0.03])
    }
  },
  [BODY_LOOKS.military]: (d) => {
    const coyote = 0x6e6246
    const strap = 0x4e4630
    const olive = 0x4c5236
    d.top = (q) => (q.y > 1.5 ? null : fold(olive, q))
    d.sleeve = { cuff: 0.255, baggy: 0.014, color: olive }
    d.hidesUnder = true
    d.extras = (k, fig) => {
      // Plate carrier: front and back plates, cummerbund, shoulder straps, pouches.
      for (const back of [false, true]) {
        const y = 1.25
        const z = back ? backZ(fig, y, 0.04) : frontZ(fig, y, 0.04)
        k.on('torso').tube(
          coyote,
          [
            [1.07, 0.15, 0.022, 0, z],
            [1.42, 0.15, 0.022, 0, z],
          ],
          8,
          { square: 5 },
        )
      }
      torsoSheet(k, fig, coyote, [4, 5, 6, 7], 0.03)
      for (const s of [-1, 1]) {
        k.on('torso').tube(
          coyote,
          [
            [1.42, 0.035, 0.11, s * 0.12, 0],
            [1.47, 0.035, 0.1, s * 0.12, 0],
          ],
          6,
          { square: 4 },
        )
      }
      const fz = frontZ(fig, 1.15, 0.065)
      for (let i = 0; i < 3; i++) {
        k.on('torso').tube(
          strap,
          [
            [1.08, 0.035, 0.022, -0.09 + i * 0.09, fz - 0.01],
            [1.2, 0.035, 0.022, -0.09 + i * 0.09, fz - 0.01],
          ],
          6,
          { square: 5 },
        )
      }
      k.box(strap, [0.14, 0.09, 0.04], [0, 1.32, frontZ(fig, 1.32, 0.06) - 0.02])
      k.box(0x2a2a22, [0.08, 0.12, 0.05], [0.07, 1.25, backZ(fig, 1.25, 0.06) + 0.03])
      k.box(0x1a1a1a, [0.01, 0.22, 0.01], [0.1, 1.45, backZ(fig, 1.4, 0.06) + 0.04], [0.2, 0, 0])
    }
  },
  [BODY_LOOKS.raincoat]: (d) => {
    const yellow = 0xe6c21e
    const fold2 = 0xc8a614
    d.top = (q) => (q.y > 1.5 ? null : q.z < 0 && Math.abs(q.x - 0.02) < 0.006 ? fold2 : yellow)
    d.sleeve = { cuff: 0.265, baggy: 0.02, color: yellow }
    d.hidesUnder = true
    d.extras = (k, fig) => {
      torsoSheet(k, fig, fold2, [13, 14, 15], 0.035, 0.05, 0.45) // hood, down
      // The long skirt to mid-thigh, flaring a little (hangs from the hips, doesn't bend).
      k.on('torso').rigid()
      k.tube(
        yellow,
        [
          [0.95, 0.178, 0.118, 0, 0.008],
          [0.8, 0.2, 0.135, 0, 0.008],
          [0.62, 0.225, 0.15, 0, 0.01],
        ],
        14,
        {
          caps: [false, false],
          colorFn: (q) => (q.z < 0 && Math.abs(q.x - 0.02) < 0.01 ? fold2 : yellow),
        },
      )
      k.rigid(false)
      for (let i = 0; i < 3; i++) {
        const y = 1.36 - i * 0.14
        k.on('torso').blob(
          0x222222,
          [0.012, 0.012, 0.006],
          [0.04, y, frontZ(fig, y, 0.012) - 0.002],
          [0, 0, 0],
          6,
          3,
        )
      }
    }
  },
  [BODY_LOOKS.flannel]: (d) => {
    const red = 0x9a2c26
    d.top = (q) => (q.y > 1.5 ? null : plaid(q, red))
    d.sleeve = { cuff: 0.25, baggy: 0.012, color: red, paint: (q) => plaid(q, red) }
    d.hidesUnder = true
    d.extras = (k, fig) => {
      torsoSheet(k, fig, 0x2a1210, [14, 15], 0.022, 0.55, 0.95) // collar
      for (let i = 0; i < 4; i++) {
        const y = 1.4 - i * 0.1
        k.on('torso').blob(
          0xe8e0d0,
          [0.007, 0.007, 0.004],
          [0, y, frontZ(fig, y, 0.008) - 0.001],
          [0, 0, 0],
          5,
          3,
        )
      }
    }
  },
}

/** Fold shading for clothes (local copy: people.ts owns the office one). */
function fold(color: number, q: THREE.Vector3): number {
  const n = noise3(q.x * 9, q.y * 3, q.z * 9)
  const crease = Math.max(0, Math.sin(q.y * 70 + n * 6 + q.x * 8)) ** 3
  return shade(color, 1 - 0.06 * crease - 0.06 * (n - 0.5))
}

const LEGS: Record<number, Wear> = {
  [LEGS_LOOKS.joggers]: (d) => {
    d.legs = { hem: 0.1, baggy: 0.02, straight: 0, cuff: true }
    d.legColor = 0x8a8c90
    d.legPaint = (q) => (q.y < 0.17 ? 0x7a7c80 : 0x8a8c90)
    d.extras = chain(d.extras, (k, fig) => {
      const fz = frontZ(fig, 0.92, 0.01)
      for (const s of [-1, 1])
        k.on('torso').blob(
          0xe8e8e0,
          [0.004, 0.03, 0.004],
          [s * 0.02, 0.9, fz - 0.006],
          [0, 0, 0],
          4,
          4,
        )
    })
  },
  [LEGS_LOOKS.jeans]: (d) => {
    d.legs = { hem: 0.05, baggy: 0.01, straight: 0.062, cuff: false }
    d.legColor = 0x34507a
    d.legPaint = (q) => {
      const side = Math.abs(Math.abs(q.x) - 0.105 - 0.06) < 0.006
      return side
        ? 0x4c6a96
        : mix(
            0x34507a,
            0x5a7aa4,
            0.4 * step(0.55, 0.75, q.y) * noise3(q.x * 30, q.y * 10, q.z * 30),
          )
    }
    d.extras = chain(d.extras, (k, fig) => {
      const bz = backZ(fig, 0.86, 0.008)
      for (const s of [-1, 1])
        k.on('torso').blob(
          0x2c4468,
          [0.05, 0.05, 0.008],
          [s * 0.08, 0.86, bz + 0.002],
          [0, 0, 0],
          6,
          3,
        )
    })
  },
  [LEGS_LOOKS.cargo]: (d) => {
    d.legs = { hem: 0.05, baggy: 0.016, straight: 0.064, cuff: false }
    d.legColor = 0x6b6448
    d.extras = chain(d.extras, (k) => {
      for (const s of [-1, 1]) {
        k.on(s < 0 ? 'thighL' : 'thighR').blob(
          0x5e573c,
          [0.022, 0.06, 0.045],
          [s * 0.088, -0.02, 0],
          [0, 0, 0],
          6,
          4,
        )
        k.box(0x4e4830, [0.012, 0.02, 0.07], [s * 0.1, 0.035, 0])
      }
    })
  },
  [LEGS_LOOKS.camo]: (d) => {
    d.legs = { hem: 0.05, baggy: 0.014, straight: 0.062, cuff: false }
    d.legColor = 0x5a6440
    d.legPaint = (q) => camo(q, 0x5a6440)
  },
  [LEGS_LOOKS.work]: (d) => {
    d.legs = { hem: 0.05, baggy: 0.016, straight: 0.064, cuff: false }
    d.legColor = 0x5a4430
    d.extras = chain(d.extras, (k) => {
      for (const shin of ['shinL', 'shinR'] as const)
        k.on(shin).blob(0x2a2420, [0.05, 0.05, 0.02], [0, 0.17, -0.07], [0, 0, 0], 8, 5) // knee pads
    })
  },
  [LEGS_LOOKS.police]: (d) => {
    d.legs = { hem: 0.05, baggy: 0.01, straight: 0.062, cuff: false }
    d.legColor = 0x1a2236
    d.legPaint = (q) =>
      Math.abs(Math.abs(q.x) - 0.105 - 0.065) < 0.008 && q.y > 0.1 ? 0xc8a838 : 0x1a2236
  },
}

/** Calls both shape adders. */
function chain(a: Dress['extras'], b: NonNullable<Dress['extras']>): NonNullable<Dress['extras']> {
  return (k, fig) => {
    a?.(k, fig)
    b(k, fig)
  }
}

/** Shoes (shin space: sole at y = -0.23). */
function footwear(look: number): Dress['feet'] {
  const size = { length: 0.135, width: 0.05, height: 0.05 }
  switch (look) {
    case FEET_LOOKS.sneakers:
      return {
        size,
        paint: (q) => {
          if (q.y < -0.212) return 0xf2f2ee
          if (Math.abs(q.x) > 0.035 && q.y < -0.19 && q.y > -0.205) return 0x2a5aa8
          if (q.z < -0.02 && q.z > -0.09 && Math.abs(q.x) < 0.016 && q.y > -0.19) return 0xffffff
          return 0xd8d8d4
        },
      }
    case FEET_LOOKS.boots:
      return { size, paint: (q) => (q.y < -0.215 ? 0x1a1410 : 0x5a3a22) }
    case FEET_LOOKS.military:
      return {
        size,
        paint: (q) => {
          if (q.y < -0.212) return 0x2a2620
          if (q.z < -0.01 && Math.abs(q.x) < 0.014 && q.y > -0.2) return 0x0c0c0c
          return 0x1e1e1c
        },
      }
    default:
      return null
  }
}

/** Boot shafts up the shins. */
function bootShafts(k: Kit, look: number): void {
  const top = look === FEET_LOOKS.military ? -0.02 : look === FEET_LOOKS.boots ? -0.07 : null
  if (top === null) return
  const color = look === FEET_LOOKS.military ? 0x1e1e1c : 0x5a3a22
  for (const shin of ['shinL', 'shinR'] as const) {
    k.on(shin)
      .rigid()
      .tube(
        color,
        [
          [-0.2, 0.048, 0.06, 0, 0.0],
          [-0.12, 0.045, 0.05, 0, 0.0],
          [top, 0.05, 0.056, 0, 0.004],
        ],
        10,
        { caps: [false, false] },
      )
    k.tube(
      shade(color, 0.7),
      [
        [top - 0.012, 0.052, 0.058, 0, 0.004],
        [top + 0.006, 0.052, 0.058, 0, 0.004],
      ],
      10,
      {
        caps: [false, false],
      },
    )
    k.rigid(false)
  }
}

/** How someone in survival is dressed for a gear value. */
export function dressFor(gear: number, _fig: Figure): Dress {
  const d: Dress = {
    top: tankTop,
    sleeve: null,
    legs: null,
    legColor: 0x8a8c90,
    feet: null,
    hidesUnder: false,
  }
  ;(LEGS[legsOf(gear)] ?? LEGS[LEGS_LOOKS.joggers])?.(d, _fig)
  BODY[body(gear)]?.(d, _fig)
  const f = feetOf(gear)
  d.feet = footwear(f)
  if (d.feet) {
    // Trousers go into or over the shoes.
    if (d.legs) d.legs = { ...d.legs, hem: Math.max(d.legs.hem, 0.07) }
    d.extras = chain(d.extras, (k) => bootShafts(k, f))
  }
  return d
}

/** A dome over the skull down to `line` (theta as a fraction of π), `lift` m over it. */
function dome(
  k: Kit,
  h: HeadShape,
  color: number,
  line: { front: number; side: number; back: number },
  lift: number,
): void {
  hairCap(k, h, color, line, () => lift, 16, 6)
}

const HEADS: Record<number, (k: Kit, h: HeadShape) => void> = {
  [HEAD_LOOKS.cap]: (k, h) => {
    const red = 0xa82828
    dome(k, h, red, { front: 0.3, side: 0.36, back: 0.4 }, 0.022)
    const q = skullPoint(h, 0.32 * Math.PI, Math.PI * 1.5, 0.03)
    k.on('head').blob(
      red,
      [0.085, 0.008, 0.06],
      [0, q.y - 0.005, q.z - 0.045],
      [-0.12, 0, 0],
      10,
      4,
    ) // brim
    k.blob(0xeaeaea, [0.012, 0.008, 0.012], [0, h.cy + h.ry + 0.03, 0], [0, 0, 0], 6, 3)
  },
  [HEAD_LOOKS.beanie]: (k, h) => {
    const knit = 0x2f5a78
    dome(k, h, knit, { front: 0.36, side: 0.42, back: 0.45 }, 0.03)
    const q = skullPoint(h, 0.36 * Math.PI, 0, 0.04)
    k.on('head').tube(
      0x264a64,
      [
        [q.y - 0.03, h.rx + 0.03, h.rz + 0.03],
        [q.y + 0.01, h.rx + 0.03, h.rz + 0.03],
      ],
      14,
      { caps: [false, false] },
    )
    k.blob(0xd8d8d0, [0.035, 0.03, 0.035], [0, h.cy + h.ry + 0.055, 0], [0, 0, 0], 8, 5)
  },
  [HEAD_LOOKS.hardhat]: (k, h) => {
    const yellow = 0xf0be14
    dome(k, h, yellow, { front: 0.38, side: 0.4, back: 0.42 }, 0.04)
    const y = skullPoint(h, 0.4 * Math.PI, 0, 0.04).y
    k.on('head').tube(
      yellow,
      [
        [y - 0.012, h.rx + 0.07, h.rz + 0.09, 0, -0.02],
        [y, h.rx + 0.07, h.rz + 0.09, 0, -0.02],
      ],
      16,
    )
    k.blob(0xd8a80c, [0.018, 0.03, h.rz + 0.03], [0, h.cy + h.ry + 0.02, 0], [0, 0, 0], 6, 6)
  },
  [HEAD_LOOKS.helmet]: (k, h) => {
    const olive = 0x4c5634
    dome(k, h, olive, { front: 0.36, side: 0.5, back: 0.5 }, 0.035)
    const y = skullPoint(h, 0.42 * Math.PI, 0, 0.04).y
    k.on('head').tube(
      0x343a24,
      [
        [y - 0.01, h.rx + 0.045, h.rz + 0.045],
        [y + 0.02, h.rx + 0.045, h.rz + 0.045],
      ],
      14,
      { caps: [false, false] },
    )
    const q = skullPoint(h, 0.3 * Math.PI, Math.PI * 1.5, 0.05)
    k.box(0x1e1e1a, [0.07, 0.04, 0.025], [0, q.y, q.z]) // NVG mount
    for (const s of [-1, 1])
      k.box(0x262620, [0.008, 0.16, 0.02], [s * (h.rx + 0.005), -0.04, -0.02], [0, 0, s * 0.05])
  },
  [HEAD_LOOKS.bandana]: (k, h) => {
    const rnd = seeded(5)
    const dots: [number, number][] = Array.from({ length: 14 }, () => [
      rnd() * 0.2 - 0.1,
      -0.13 + rnd() * 0.1,
    ])
    const red = 0x9a1c1c
    k.on('head').surface(
      red,
      12,
      5,
      (u, v) => {
        const phi = Math.PI + 0.2 + u * (Math.PI - 0.4)
        const theta = (0.5 + v * 0.42) * Math.PI
        const q = skullPoint(h, theta, phi, 0.018 + 0.02 * v * (1 - Math.abs(u - 0.5) * 2))
        return [q.x, q.y - 0.02 * v * (1 - Math.abs(u - 0.5) * 2), q.z]
      },
      {
        open: true,
        colorFn: (q) =>
          dots.some(([x, y]) => Math.hypot(q.x - x, q.y - y) < 0.009) ? 0xf0e8d8 : red,
      },
    )
    const q = skullPoint(h, 0.5 * Math.PI, Math.PI * 0.5, 0.02)
    k.blob(red, [0.03, 0.025, 0.02], [0, q.y, q.z + 0.01], [0, 0, 0], 6, 4)
  },
  [HEAD_LOOKS.cowboy]: (k, h) => {
    const hide = 0x7a5230
    const top = h.cy + h.ry
    k.on('head').surface(
      hide,
      18,
      4,
      (u, v) => {
        const a = u * Math.PI * 2
        const r = 0.12 + v * 0.17
        const side = Math.abs(Math.cos(a))
        return [Math.cos(a) * r, top - 0.04 + v * v * 0.06 * side, Math.sin(a) * r * 1.1]
      },
      { poles: [false, false] },
    )
    k.tube(
      hide,
      [
        [top - 0.045, 0.11, 0.125],
        [top + 0.06, 0.1, 0.12],
        [top + 0.09, 0.08, 0.1],
      ],
      14,
    )
    k.tube(
      0x2a1a10,
      [
        [top - 0.03, 0.113, 0.128],
        [top - 0.005, 0.112, 0.127],
      ],
      14,
      { caps: [false, false] },
    )
  },
  [HEAD_LOOKS.gasmask]: (k, h) => {
    const rubber = 0x1c1e20
    jawShell(k, h, rubber, 0.02, 0.4)
    const fz = faceZ(h, 0.037, 0.022)
    for (const s of [-1, 1]) {
      k.on('head').tube(
        0x0a0a0a,
        [
          [0, 0.026, 0.026],
          [0.02, 0.026, 0.026],
        ],
        10,
        { at: [s * 0.04, 0.022, fz - 0.018], rot: [Math.PI / 2, 0, 0] },
      )
      k.blob(0x8fb8c0, [0.022, 0.022, 0.006], [s * 0.04, 0.022, fz - 0.04], [0, 0, 0], 8, 4)
    }
    const mz = faceZ(h, 0, -0.07)
    k.tube(
      0x4a5236,
      [
        [0, 0.03, 0.03],
        [0.06, 0.03, 0.03],
      ],
      10,
      { at: [0, -0.08, mz - 0.03], rot: [Math.PI / 2 + 0.4, 0, 0] },
    )
    k.tube(
      rubber,
      [
        [h.cy + 0.03, h.rx + 0.012, h.rz + 0.012],
        [h.cy + 0.05, h.rx + 0.012, h.rz + 0.012],
      ],
      14,
      { caps: [false, false] },
    )
  },
}

/** The head piece for a head look (head space). */
export function wearHead(k: Kit, look: number, h: HeadShape): void {
  HEADS[look]?.(k, h)
  k.rigid(false)
}

/** Head look of a worn gear value (hair under a hat is trimmed). */
export const headOf = head
