import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { filterTexture } from './textures.ts'

/**
 * The modelling kit every weapon is built from: low-poly but smooth. Boxes have bevelled edges
 * (the bevel shades from one face's light to the next, so edges read as rounded), barrels,
 * scopes and handles are turned on a lathe, stocks, frames and blades are cut out as profiles
 * and extruded with a bevel, and fingers are swept along curves. Everything is authored in the
 * gun's own space (metres, barrel towards -Z, +Y up) and baked afterwards into one mesh per
 * material per moving part (bake), so a weapon costs only a handful of draw calls.
 */

export type V3 = readonly [number, number, number]
/** A profile point (z, y) or (z, r) with an optional fillet radius (m) rounding that corner. */
export type P2 = readonly [number, number] | readonly [number, number, number]

// ── Detail ──

let worldDetail = false

/**
 * Builds with world detail: no bevels, fewer segments, no fine parts — for weapons lying about
 * and in other players' hands, where the whole thing is a few pixels long.
 */
export function atWorldDetail<T>(build: () => T): T {
  const was = worldDetail
  worldDetail = true
  try {
    return build()
  } finally {
    worldDetail = was
  }
}

/** Whether small parts (screws, rail teeth, grip texture) are worth adding at this detail. */
export function fine(): boolean {
  return !worldDetail
}

/** Segments of a round thing at this detail. */
function round(n: number): number {
  return worldDetail ? Math.max(5, Math.round(n * 0.5)) : n
}

// ── Finishes ──

export type Finish =
  | 'metal'
  | 'brass'
  | 'polymer'
  | 'wood'
  | 'leather'
  | 'skin'
  | 'cloth'
  | 'glow'
  | 'lens'

export interface Paint {
  color: number
  finish: Finish
}

export const paint = (color: number, finish: Finish): Paint => ({ color, finish })

// The palette. Gun colours are a little lighter than real ones: the post pass deepens shadows,
// and the bevels' highlights need something to show against.
export const BLUED = paint(0x464a53, 'metal')
export const PARKERIZED = paint(0x5c616b, 'metal')
export const STAINLESS = paint(0xa2a8b1, 'metal')
export const ALLOY = paint(0x3b3e45, 'metal')
export const BARREL = paint(0x33363c, 'metal')
export const BRASS = paint(0xb88f3e, 'brass')
export const COPPER = paint(0xb0683a, 'brass')
export const POLYMER = paint(0x393b41, 'polymer')
export const RUBBER = paint(0x25262a, 'polymer')
export const OLIVE = paint(0x4d5340, 'polymer')
export const WALNUT = paint(0x6a4127, 'wood')
/** The reddish plywood of Soviet rifles. */
export const LAMINATE = paint(0x8c4a22, 'wood')
export const BIRCH = paint(0xa77d4b, 'wood')
/** Pale wood of bats and tool handles. */
export const ASH = paint(0xc0925a, 'wood')
export const BLADE = paint(0xc5cad2, 'metal')
export const EDGE = paint(0xeef1f5, 'metal')
export const WHITE = paint(0xe6e6e2, 'polymer')
export const RED = paint(0xb3261e, 'polymer')
export const RED_METAL = paint(0xa52a1e, 'metal')
export const LENS = paint(0x13202c, 'lens')
export const DOT = paint(0xff2a2a, 'glow')
export const TRITIUM = paint(0xa8ff70, 'glow')
export const GLOVE = paint(0x6f5f47, 'leather')
export const GLOVE_DARK = paint(0x3a342c, 'leather')
export const SKIN = paint(0xc68e6a, 'skin')
export const SLEEVE = paint(0x2e4057, 'cloth')
export const CUFF = paint(0x24344a, 'cloth')

let wearTexture: THREE.Texture | null | undefined
let grainTexture: THREE.Texture | null | undefined
let stippleTexture: THREE.Texture | null | undefined

/** A small grey canvas texture (multiplied over the colour), or null where there is no DOM. */
function canvasTexture(draw: (ctx: CanvasRenderingContext2D, size: number) => void) {
  if (typeof document === 'undefined') return null
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  draw(ctx, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  filterTexture(tex)
  return tex
}

/** Seeded so every load looks the same. */
function random(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
}

/** Worn metal: mottled, with bright scratches where hands and holsters rub. */
function wear() {
  if (wearTexture !== undefined) return wearTexture
  wearTexture = canvasTexture((ctx, size) => {
    const rnd = random(7)
    ctx.fillStyle = 'rgb(214,214,214)'
    ctx.fillRect(0, 0, size, size)
    for (let i = 0; i < 260; i++) {
      const v = 190 + Math.floor(rnd() * 50)
      ctx.fillStyle = `rgb(${v},${v},${v})`
      ctx.fillRect(Math.floor(rnd() * size), Math.floor(rnd() * size), 2, 1)
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'
    ctx.lineWidth = 1
    for (let i = 0; i < 9; i++) {
      const x = rnd() * size
      const y = rnd() * size
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + 4 + rnd() * 10, y + (rnd() - 0.5) * 3)
      ctx.stroke()
    }
  })
  return wearTexture
}

/** Wood grain: wavy stripes along u (the length of the part). */
function grain() {
  if (grainTexture !== undefined) return grainTexture
  grainTexture = canvasTexture((ctx, size) => {
    const rnd = random(11)
    const img = ctx.createImageData(size, size)
    const phase = Array.from({ length: 4 }, () => rnd() * 6.28)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const a = (x / size) * Math.PI * 2
        const w = y + 2.2 * Math.sin(a + (phase[0] ?? 0)) + 1.2 * Math.sin(2 * a + (phase[1] ?? 0))
        const ring = 0.5 + 0.5 * Math.sin((w / size) * Math.PI * 2 * 7 + Math.sin(a * 3) * 0.6)
        const v = Math.round(255 * (0.74 + 0.2 * ring ** 3 + 0.06 * rnd()))
        const i = (y * size + x) * 4
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v
        img.data[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
  })
  return grainTexture
}

/** Polymer and leather: a fine stipple. */
function stipple() {
  if (stippleTexture !== undefined) return stippleTexture
  stippleTexture = canvasTexture((ctx, size) => {
    const rnd = random(5)
    ctx.fillStyle = 'rgb(232,232,232)'
    ctx.fillRect(0, 0, size, size)
    for (let i = 0; i < 500; i++) {
      const v = 205 + Math.floor(rnd() * 50)
      ctx.fillStyle = `rgb(${v},${v},${v})`
      ctx.fillRect(Math.floor(rnd() * size), Math.floor(rnd() * size), 1, 1)
    }
  })
  return stippleTexture
}

const materials = new Map<string, THREE.Material>()

/** One shared material per colour and finish. */
export function material(p: Paint): THREE.Material {
  const key = `${p.finish}:${p.color}`
  let m = materials.get(key)
  if (m) return m
  const color = p.color
  switch (p.finish) {
    case 'metal':
      m = new THREE.MeshPhongMaterial({ color, specular: 0x5c5c5c, shininess: 42, map: wear() })
      break
    case 'brass':
      m = new THREE.MeshPhongMaterial({ color, specular: 0x8a7440, shininess: 60, map: wear() })
      break
    case 'polymer':
      m = new THREE.MeshPhongMaterial({ color, specular: 0x2c2c2c, shininess: 22, map: stipple() })
      break
    case 'wood':
      m = new THREE.MeshPhongMaterial({ color, specular: 0x2a221a, shininess: 16, map: grain() })
      break
    case 'leather':
      m = new THREE.MeshPhongMaterial({ color, specular: 0x1e1c1a, shininess: 10, map: stipple() })
      break
    case 'lens':
      m = new THREE.MeshPhongMaterial({ color, specular: 0xb0c0d0, shininess: 90 })
      break
    case 'glow':
      m = new THREE.MeshBasicMaterial({ color })
      break
    default:
      m = new THREE.MeshLambertMaterial({ color })
  }
  materials.set(key, m)
  return m
}

// ── Geometry ──

/** Collects vertices and triangles; triangles are wound to face the way their normals point. */
class Mesher {
  private readonly p: number[] = []
  private readonly n: number[] = []
  private readonly i: number[] = []

  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
    const l = Math.hypot(nx, ny, nz) || 1
    this.p.push(x, y, z)
    this.n.push(nx / l, ny / l, nz / l)
    return this.p.length / 3 - 1
  }

  tri(a: number, b: number, c: number): void {
    const p = this.p
    const n = this.n
    const ax = p[a * 3] as number
    const ay = p[a * 3 + 1] as number
    const az = p[a * 3 + 2] as number
    const ux = (p[b * 3] as number) - ax
    const uy = (p[b * 3 + 1] as number) - ay
    const uz = (p[b * 3 + 2] as number) - az
    const vx = (p[c * 3] as number) - ax
    const vy = (p[c * 3 + 1] as number) - ay
    const vz = (p[c * 3 + 2] as number) - az
    const cx = uy * vz - uz * vy
    const cy = uz * vx - ux * vz
    const cz = ux * vy - uy * vx
    if (Math.hypot(cx, cy, cz) < 1e-12) return
    const sum = (k: number) =>
      (n[a * 3 + k] as number) + (n[b * 3 + k] as number) + (n[c * 3 + k] as number)
    if (cx * sum(0) + cy * sum(1) + cz * sum(2) < 0) this.i.push(a, c, b)
    else this.i.push(a, b, c)
  }

  /** Four corners in order round the loop. */
  quad(a: number, b: number, c: number, d: number): void {
    this.tri(a, b, c)
    this.tri(a, c, d)
  }

  geometry(uvScale = 6): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3))
    g.setIndex(this.i)
    projectUVs(g, uvScale)
    return g
  }
}

/** Box-projected UVs in the part's own space; u runs along z (the grain) wherever it can. */
function projectUVs(g: THREE.BufferGeometry, scale: number): void {
  const pos = g.getAttribute('position')
  const nor = g.getAttribute('normal')
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i))
    const ny = Math.abs(nor.getY(i))
    const nz = Math.abs(nor.getZ(i))
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const [u, v] = nx >= ny && nx >= nz ? [z, y] : ny >= nz ? [z, x] : [x, y]
    uv[i * 2] = u * scale
    uv[i * 2 + 1] = v * scale
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
}

/** Normals closer than this (cos 46°) are shared: the surface reads as one smooth curve. */
const SMOOTH = Math.cos((46 * Math.PI) / 180)

/** A box with its edges and corners bevelled by `b` (44 triangles; 12 with no bevel). */
export function bevelBoxGeometry(w: number, h: number, d: number, b: number): THREE.BufferGeometry {
  const half = [w / 2, h / 2, d / 2]
  const bev = Math.max(0, Math.min(b, ...half.map((v) => v * 0.9)))
  const m = new Mesher()
  const face = new Map<string, number>()
  const id = (axis: number, signs: number[]) => `${axis}|${signs.join()}`
  for (let axis = 0; axis < 3; axis++) {
    const o1 = (axis + 1) % 3
    const o2 = (axis + 2) % 3
    for (const s of [-1, 1]) {
      const loop: number[] = []
      for (const [sa, sb] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const) {
        const pos = [0, 0, 0]
        const signs = [0, 0, 0]
        pos[axis] = s * (half[axis] as number)
        pos[o1] = sa * ((half[o1] as number) - bev)
        pos[o2] = sb * ((half[o2] as number) - bev)
        signs[axis] = s
        signs[o1] = sa
        signs[o2] = sb
        const nrm = [0, 0, 0]
        nrm[axis] = s
        const v = m.vert(
          pos[0] as number,
          pos[1] as number,
          pos[2] as number,
          nrm[0] as number,
          nrm[1] as number,
          nrm[2] as number,
        )
        face.set(id(axis, signs), v)
        loop.push(v)
      }
      m.quad(loop[0] as number, loop[1] as number, loop[2] as number, loop[3] as number)
    }
  }
  if (bev > 0) {
    const at = (axis: number, signs: number[]) => face.get(id(axis, signs)) as number
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        const k = 3 - i - j
        for (const si of [-1, 1]) {
          for (const sj of [-1, 1]) {
            const c = (sk: number) => {
              const s = [0, 0, 0]
              s[i] = si
              s[j] = sj
              s[k] = sk
              return s
            }
            m.quad(at(i, c(-1)), at(i, c(1)), at(j, c(1)), at(j, c(-1)))
          }
        }
      }
    }
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const s = [sx, sy, sz]
          m.tri(at(0, s), at(1, s), at(2, s))
        }
      }
    }
  }
  return m.geometry()
}

/**
 * Rounds the corners of a polyline that carry a radius (third number): each becomes a short
 * curve. Open lines keep their ends.
 */
export function fillet(points: readonly P2[], closed: boolean): [number, number][] {
  const segs = worldDetail ? 1 : 2
  const out: [number, number][] = []
  const n = points.length
  for (let i = 0; i < n; i++) {
    const p = points[i] as P2
    const r = p[2] ?? 0
    const ends = !closed && (i === 0 || i === n - 1)
    if (r <= 0 || ends) {
      out.push([p[0], p[1]])
      continue
    }
    const prev = points[(i - 1 + n) % n] as P2
    const next = points[(i + 1) % n] as P2
    const la = Math.hypot(prev[0] - p[0], prev[1] - p[1])
    const lb = Math.hypot(next[0] - p[0], next[1] - p[1])
    const c = Math.min(r, la * 0.48, lb * 0.48)
    const a: [number, number] = [
      p[0] + ((prev[0] - p[0]) / la) * c,
      p[1] + ((prev[1] - p[1]) / la) * c,
    ]
    const b: [number, number] = [
      p[0] + ((next[0] - p[0]) / lb) * c,
      p[1] + ((next[1] - p[1]) / lb) * c,
    ]
    for (let s = 0; s <= segs; s++) {
      const t = s / segs
      const u = 1 - t
      out.push([
        u * u * a[0] + 2 * u * t * p[0] + t * t * b[0],
        u * u * a[1] + 2 * u * t * p[1] + t * t * b[1],
      ])
    }
  }
  return out
}

/**
 * A flat part cut out along a side profile (z, y points, gun space) and `t` thick across X,
 * centred on x = 0, its outline edges bevelled by `b`. Frames, slides, stocks, blades.
 */
export function slabGeometry(profile: readonly P2[], t: number, b: number): THREE.BufferGeometry {
  let pts = fillet(profile, true)
  // Counter-clockwise in (z, y), so each edge's outward normal is (dy, -dz).
  let area = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as [number, number]
    const q = pts[(i + 1) % pts.length] as [number, number]
    area += p[0] * q[1] - q[0] * p[1]
  }
  if (area < 0) pts = pts.reverse()
  const n = pts.length
  const bev = worldDetail ? 0 : Math.max(0, Math.min(b, t * 0.45))
  const edge: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const p = pts[i] as [number, number]
    const q = pts[(i + 1) % n] as [number, number]
    const dz = q[0] - p[0]
    const dy = q[1] - p[1]
    const l = Math.hypot(dz, dy) || 1
    edge.push([dy / l, -dz / l])
  }
  const m = new Mesher()
  const xf = t / 2
  const xo = t / 2 - bev
  // Inset outline for the faces: each corner pulled in along its mitre.
  const inset: [number, number][] = pts.map((p, i) => {
    const a = edge[(i - 1 + n) % n] as [number, number]
    const c = edge[i] as [number, number]
    let mz = a[0] + c[0]
    let my = a[1] + c[1]
    const ml = Math.hypot(mz, my) || 1
    mz /= ml
    my /= ml
    const k = bev / Math.max(0.35, mz * c[0] + my * c[1])
    return [p[0] - mz * k, p[1] - my * k]
  })
  // Each outline corner: one vertex per side of it, or one shared where the outline is smooth.
  const ring = (x: number) =>
    pts.map((p, i) => {
      const a = edge[(i - 1 + n) % n] as [number, number]
      const c = edge[i] as [number, number]
      if (a[0] * c[0] + a[1] * c[1] > SMOOTH) {
        const v = m.vert(x, p[1], p[0], 0, a[1] + c[1], a[0] + c[0])
        return { into: v, out: v, sharp: false }
      }
      return {
        into: m.vert(x, p[1], p[0], 0, a[1], a[0]),
        out: m.vert(x, p[1], p[0], 0, c[1], c[0]),
        sharp: true,
      }
    })
  const front = ring(xo)
  const back = ring(-xo)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    m.quad(
      (front[i] as { out: number }).out,
      (front[j] as { into: number }).into,
      (back[j] as { into: number }).into,
      (back[i] as { out: number }).out,
    )
  }
  const cap = (x: number, sign: number, side: typeof front) => {
    const outline = bev > 0 ? inset : pts
    const verts = outline.map((p) => m.vert(x, p[1], p[0], sign, 0, 0))
    const tris = THREE.ShapeUtils.triangulateShape(
      outline.map((p) => new THREE.Vector2(p[0], p[1])),
      [],
    )
    for (const t of tris)
      m.tri(verts[t[0] ?? 0] as number, verts[t[1] ?? 0] as number, verts[t[2] ?? 0] as number)
    if (bev <= 0) return
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const si = side[i] as { out: number; into: number; sharp: boolean }
      const sj = side[j] as { into: number }
      m.quad(verts[i] as number, verts[j] as number, sj.into, si.out)
      if (si.sharp) m.tri(verts[i] as number, si.into, si.out)
    }
  }
  cap(xf, 1, front)
  cap(-xf, -1, back)
  return m.geometry()
}

/**
 * A solid turned about the Z axis: profile points (z, radius) listed from the back (largest z)
 * to the front. Start and end on the axis (r = 0) for a closed solid, or loop back to the
 * first point for a hollow one (a tube with an inner wall). `sx`/`sy` squash it into an oval.
 */
export function latheGeometry(
  profile: readonly P2[],
  radial: number,
  sx = 1,
  sy = 1,
  phase = 0,
): THREE.BufferGeometry {
  const pts = fillet(profile, false)
  const segs = round(radial)
  const m = new Mesher()
  const segNormal: [number, number][] = []
  for (let k = 0; k < pts.length - 1; k++) {
    const p = pts[k] as [number, number]
    const q = pts[k + 1] as [number, number]
    const dz = q[0] - p[0]
    const dr = q[1] - p[1]
    const l = Math.hypot(dz, dr) || 1
    segNormal.push([dr / l, -dz / l]) // (nz, nr)
  }
  const ringAt = (z: number, r: number, nz: number, nr: number) => {
    const out: number[] = []
    for (let j = 0; j < segs; j++) {
      const a = phase + (j / segs) * Math.PI * 2
      const c = Math.cos(a)
      const s = Math.sin(a)
      out.push(m.vert(r * c * sx, r * s * sy, z, (nr * c) / sx, (nr * s) / sy, nz))
    }
    return out
  }
  // For each point: the ring the segment before it ends on, and the ring the next starts from.
  const into: number[][] = []
  const from: number[][] = []
  for (let k = 0; k < pts.length; k++) {
    const [z, r] = pts[k] as [number, number]
    const a = segNormal[k - 1]
    const b = segNormal[k]
    if (a && b && a[0] * b[0] + a[1] * b[1] > SMOOTH) {
      const ring = ringAt(z, r, a[0] + b[0], a[1] + b[1])
      into.push(ring)
      from.push(ring)
    } else {
      into.push(a ? ringAt(z, r, a[0], a[1]) : [])
      from.push(b ? ringAt(z, r, b[0], b[1]) : [])
    }
  }
  for (let k = 0; k < pts.length - 1; k++) {
    const r0 = from[k] as number[]
    const r1 = into[k + 1] as number[]
    for (let j = 0; j < segs; j++) {
      const jn = (j + 1) % segs
      m.quad(r0[j] as number, r0[jn] as number, r1[jn] as number, r1[j] as number)
    }
  }
  return m.geometry()
}

/** A round rod swept along a smooth path, tapering from r0 to r1, its ends domed. Fingers. */
export function sweepGeometry(
  path: readonly V3[],
  r0: number,
  r1: number,
  steps: number,
  radial: number,
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(
    path.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
    false,
    'centripetal',
  )
  const n = worldDetail ? Math.max(2, steps - 1) : steps
  const segs = round(radial)
  const frames = curve.computeFrenetFrames(n, false)
  const m = new Mesher()
  const rings: number[][] = []
  const dir = new THREE.Vector3()
  for (let i = 0; i <= n; i++) {
    const p = curve.getPointAt(i / n)
    const N = frames.normals[i] as THREE.Vector3
    const B = frames.binormals[i] as THREE.Vector3
    const r = r0 + (r1 - r0) * (i / n)
    const ring: number[] = []
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2
      dir.copy(N).multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a))
      ring.push(m.vert(p.x + dir.x * r, p.y + dir.y * r, p.z + dir.z * r, dir.x, dir.y, dir.z))
    }
    rings.push(ring)
  }
  for (let i = 0; i < n; i++) {
    const a = rings[i] as number[]
    const b = rings[i + 1] as number[]
    for (let j = 0; j < segs; j++) {
      const jn = (j + 1) % segs
      m.quad(a[j] as number, a[jn] as number, b[jn] as number, b[j] as number)
    }
  }
  for (const [i, r, sign] of [
    [0, r0, -1],
    [n, r1, 1],
  ] as const) {
    const t = frames.tangents[i] as THREE.Vector3
    const p = curve.getPointAt(i / n)
    const apex = m.vert(
      p.x + t.x * r * 0.7 * sign,
      p.y + t.y * r * 0.7 * sign,
      p.z + t.z * r * 0.7 * sign,
      t.x * sign,
      t.y * sign,
      t.z * sign,
    )
    const ring = rings[i] as number[]
    for (let j = 0; j < segs; j++) m.tri(apex, ring[j] as number, ring[(j + 1) % segs] as number)
  }
  return m.geometry()
}

// ── Parts (meshes, placed in the parent's space) ──

function mesh(geometry: THREE.BufferGeometry, p: Paint, at?: V3, rot?: V3): THREE.Mesh {
  const out = new THREE.Mesh(geometry, material(p))
  if (at) out.position.set(at[0], at[1], at[2])
  if (rot) out.rotation.set(rot[0], rot[1], rot[2])
  return out
}

/** A bevelled box: `size` (w, h, d), centred `at`, turned by `rot` (x, y, z radians). */
export function box(p: Paint, size: V3, at?: V3, rot?: V3, bevel?: number): THREE.Mesh {
  const small = Math.min(...size) < 0.005
  const b = worldDetail ? 0 : (bevel ?? (small ? 0 : Math.min(0.006, 0.22 * Math.min(...size))))
  return mesh(bevelBoxGeometry(size[0], size[1], size[2], b), p, at, rot)
}

/** A profile (z, y) cut out `t` thick, centred on x (see slabGeometry). */
export function slab(
  p: Paint,
  profile: readonly P2[],
  t: number,
  x = 0,
  bevel?: number,
): THREE.Mesh {
  const b = bevel ?? Math.min(0.005, t * 0.3)
  return mesh(slabGeometry(profile, t, b), p, [x, 0, 0])
}

export interface LatheOptions {
  radial?: number
  /** Squash into an oval: x and y scale of the cross-section. */
  sx?: number
  sy?: number
  /** Turn the cross-section (for few-sided shapes: flat on top). */
  phase?: number
  rot?: V3
}

/** A turned part along Z (see latheGeometry), its axis through `at`. */
export function lathe(p: Paint, profile: readonly P2[], at?: V3, o: LatheOptions = {}): THREE.Mesh {
  return mesh(latheGeometry(profile, o.radial ?? 10, o.sx, o.sy, o.phase), p, at, o.rot)
}

/** A plain rod along Z from z0 (back) to z1 (front), its end edges softened. */
export function rod(p: Paint, r: number, z0: number, z1: number, at: V3, radial = 10, edge = 0.25) {
  const e = Math.min(r * edge, Math.abs(z0 - z1) * 0.3)
  return lathe(
    p,
    [
      [z0, 0],
      [z0, r - e],
      [z0 - e, r],
      [z1 + e, r],
      [z1, r - e],
      [z1, 0],
    ],
    at,
    { radial },
  )
}

/** A rod between two points (a cylinder turned to lie from a to b), radius r0 at a, r1 at b. */
export function limb(p: Paint, a: V3, b: V3, r0: number, r1 = r0, radial = 8): THREE.Mesh {
  const va = new THREE.Vector3(...a)
  const vb = new THREE.Vector3(...b)
  const len = va.distanceTo(vb)
  const e0 = r0 * 0.45
  const e1 = r1 * 0.45
  const out = lathe(
    p,
    [
      [0, 0],
      [0, r0 - e0],
      [-e0, r0],
      [-len + e1, r1],
      [-len, r1 - e1],
      [-len, 0],
    ],
    undefined,
    { radial },
  )
  out.position.copy(va)
  out.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), vb.sub(va).normalize())
  return out
}

/** A rod swept along a path through the given points (see sweepGeometry). */
export function sweep(p: Paint, path: readonly V3[], r0: number, r1 = r0, steps = 4, radial = 6) {
  return mesh(sweepGeometry(path, r0, r1, steps, radial), p)
}

/** An empty marker (muzzle, ejection port…) at a point. */
export function marker(x: number, y: number, z: number): THREE.Object3D {
  const o = new THREE.Object3D()
  o.position.set(x, y, z)
  return o
}

/** A group holding parts, at a point (for moving parts: a slide, a magazine, a pump). */
export function part(at: V3 = [0, 0, 0], ...children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group()
  g.position.set(at[0], at[1], at[2])
  if (children.length) g.add(...children)
  return g
}

// ── Shared gun details ──

/** Picatinny rail along z on top of something at height y: a flat bar with cross slots. */
export function rail(z0: number, z1: number, y: number, w = 0.022, x = 0): THREE.Mesh[] {
  const len = z0 - z1
  const out = [box(ALLOY, [w, 0.006, len], [x, y + 0.003, (z0 + z1) / 2], undefined, 0.0015)]
  if (fine()) {
    for (let z = z0 - 0.008; z > z1 + 0.004; z -= 0.016)
      out.push(box(ALLOY, [w * 0.92, 0.004, 0.006], [x, y + 0.008, z], undefined, 0))
  }
  return out
}

/**
 * A trigger guard: a loop of bar from the frame at `front` (z) round under the trigger and back
 * up into the frame at `back`, the frame's underside at height y; plus the trigger blade.
 */
export function triggerGuard(
  p: Paint,
  y: number,
  front: number,
  back: number,
  depth = 0.026,
  r = 0.0032,
  trigger: Paint = BLUED,
): THREE.Mesh[] {
  const mid = (front + back) / 2
  const len = back - front
  const out = [
    sweep(
      p,
      [
        [0, y + 0.002, front],
        [0, y - depth * 0.75, front + len * 0.08],
        [0, y - depth, mid],
        [0, y - depth * 0.92, back - len * 0.12],
        [0, y - depth * 0.35, back + 0.002],
        [0, y + 0.002, back],
      ],
      r,
      r,
      worldDetail ? 3 : 8,
      6,
    ),
  ]
  if (fine()) {
    out.push(
      sweep(
        trigger,
        [
          [0, y + 0.002, mid - 0.002],
          [0, y - depth * 0.45, mid - 0.003],
          [0, y - depth * 0.72, mid + 0.003],
        ],
        0.0028,
        0.0022,
        3,
        5,
      ),
    )
  }
  return out
}

/** A muzzle crown: the barrel's end, slightly chamfered, with its dark bore. */
export function barrel(
  p: Paint,
  r: number,
  z0: number,
  z1: number,
  y: number,
  x = 0,
): THREE.Mesh[] {
  const out = [rod(p, r, z0, z1, [x, y, 0], 10, 0.35)]
  if (fine()) out.push(rod(RUBBER, r * 0.55, z1 + 0.003, z1 - 0.0005, [x, y, 0], 8, 0))
  return out
}

/**
 * Open sights (front post in protective ears, rear aperture): `tip` is the height you aim
 * along; the front post stands at frontZ, the rear sight at rearZ, both rising from `base`.
 */
export function apertureSights(
  p: Paint,
  tip: number,
  frontZ: number,
  rearZ: number,
  base: number,
  glow = true,
): THREE.Mesh[] {
  const hf = tip - base
  const out = [
    // Front: a base block, a thin post, a hood ring round it.
    slab(
      p,
      [
        [frontZ + 0.012, base - 0.004],
        [frontZ + 0.008, base + hf * 0.55, 0.004],
        [frontZ - 0.008, base + hf * 0.55, 0.004],
        [frontZ - 0.012, base - 0.004],
      ],
      0.012,
    ),
    box(p, [0.003, hf * 0.5, 0.004], [0, tip - hf * 0.25, frontZ], undefined, 0.0008),
    // Rear: an aperture drum on a block.
    slab(
      p,
      [
        [rearZ + 0.014, base - 0.004],
        [rearZ + 0.012, tip - 0.01, 0.003],
        [rearZ - 0.01, tip - 0.01, 0.003],
        [rearZ - 0.014, base - 0.004],
      ],
      0.02,
    ),
    lathe(
      p,
      [
        [rearZ + 0.004, 0.0035],
        [rearZ + 0.004, 0.009],
        [rearZ - 0.004, 0.009],
        [rearZ - 0.004, 0.0035],
        [rearZ + 0.004, 0.0035],
      ],
      [0, tip, 0],
      { radial: 10 },
    ),
  ]
  if (fine()) {
    out.push(
      lathe(
        p,
        [
          [frontZ + 0.003, 0.0085],
          [frontZ + 0.003, 0.011],
          [frontZ - 0.003, 0.011],
          [frontZ - 0.003, 0.0085],
          [frontZ + 0.003, 0.0085],
        ],
        [0, tip - 0.002, 0],
        { radial: 10, sy: 1.1 },
      ),
    )
    if (glow)
      out.push(box(TRITIUM, [0.0026, 0.0026, 0.002], [0, tip, frontZ - 0.0012], undefined, 0))
  }
  return out
}

/**
 * Tall post sights (the MP5's style): the front post in a hood and two rear ears, `tip` the
 * height you aim along. They stand on posts so aiming you look over the gun, not into it.
 */
export function postSights(
  p: Paint,
  tip: number,
  frontZ: number,
  rearZ: number,
  base: number,
): THREE.Mesh[] {
  const h = tip - base
  const out = [
    slab(
      p,
      [
        [frontZ + 0.012, base - 0.004],
        [frontZ + 0.005, tip - 0.004, 0.004],
        [frontZ - 0.005, tip - 0.004, 0.004],
        [frontZ - 0.01, base - 0.004],
      ],
      0.008,
    ),
    box(WHITE, [0.0035, 0.008, 0.006], [0, tip - 0.002, frontZ], undefined, 0.001),
  ]
  for (const side of [-1, 1]) {
    out.push(
      slab(
        p,
        [
          [rearZ + 0.012, base - 0.004],
          [rearZ + 0.004, tip + 0.002, 0.003],
          [rearZ - 0.004, tip + 0.002, 0.003],
          [rearZ - 0.008, base - 0.004],
        ],
        0.007,
        side * 0.012,
      ),
    )
  }
  if (fine()) {
    // The front hood: two thin wings either side of the post.
    for (const side of [-1, 1])
      out.push(
        box(
          p,
          [0.003, h * 0.4, 0.012],
          [side * 0.009, tip - h * 0.18, frontZ],
          [0, 0, side * -0.12],
          0.001,
        ),
      )
  }
  return out
}

/**
 * An open red dot: a hollow tube housing on a mount, the glowing dot at `y` in the middle of
 * it (you look through the tube, over the gun). `z` is where the tube stands.
 */
export function redDot(y: number, z: number, base: number, radius = 0.022): THREE.Mesh[] {
  const r = radius
  const len = 0.05
  const out = [
    lathe(
      ALLOY,
      [
        [z + len / 2, r - 0.003, 0.001],
        [z + len / 2, r + 0.002, 0.002],
        [z - len / 2, r + 0.004, 0.002],
        [z - len / 2, r - 0.002, 0.001],
        [z + len / 2, r - 0.003],
      ],
      [0, y, 0],
      { radial: 14 },
    ),
    // The mount below the tube, down to the rail.
    slab(
      ALLOY,
      [
        [z + 0.03, base],
        [z + 0.026, y - r + 0.004, 0.004],
        [z - 0.026, y - r + 0.004, 0.004],
        [z - 0.03, base],
      ],
      0.024,
    ),
    box(DOT, [0.0055, 0.0055, 0.002], [0, y, z + len / 2 - 0.004], undefined, 0),
  ]
  if (fine()) {
    // Brightness knob on the side.
    out.push(rod(ALLOY, 0.0075, 0.004, -0.004, [0, 0, 0], 8))
    const knob = out[out.length - 1] as THREE.Mesh
    knob.rotation.y = Math.PI / 2
    knob.position.set(r + 0.004, y, z + 0.004)
  }
  return out
}

/**
 * A telescopic sight lying along z: objective bell at the front, eyepiece at the back, two
 * turrets and the rings. `y` is its axis, `front`/`back` its ends, `base` where the rings sit.
 */
export function scope(
  y: number,
  back: number,
  front: number,
  base: number,
  tube = 0.015,
  bell = 0.024,
  body: Paint = ALLOY,
): THREE.Mesh[] {
  const len = back - front
  const out = [
    lathe(
      body,
      [
        [back, 0],
        [back, tube + 0.004],
        [back + 0.002, tube + 0.007, 0.002],
        [back - len * 0.16, tube + 0.007, 0.003],
        [back - len * 0.28, tube, 0.006],
        [front + len * 0.3, tube, 0.006],
        [front + len * 0.14, bell, 0.004],
        [front, bell, 0.002],
        [front, 0],
      ],
      [0, y, 0],
      { radial: 12 },
    ),
    // Turrets: elevation on top, windage on the right.
    lathe(
      body,
      [
        [0.012, 0],
        [0.012, 0.0085, 0.002],
        [0, 0.0085],
        [0, 0],
      ],
      [0, y + tube - 0.002, (back + front) / 2 + len * 0.02],
      { radial: 10, rot: [-Math.PI / 2, 0, 0] },
    ),
  ]
  if (fine()) {
    out.push(
      lathe(
        body,
        [
          [0.011, 0],
          [0.011, 0.0075, 0.002],
          [0, 0.0075],
          [0, 0],
        ],
        [tube - 0.002, y, (back + front) / 2 + len * 0.02],
        { radial: 10, rot: [0, Math.PI / 2, 0] },
      ),
      // Lenses, catching the light.
      lathe(
        LENS,
        [
          [front - 0.0005, 0],
          [front - 0.0005, bell - 0.003],
          [front - 0.001, 0],
        ],
        [0, y, 0],
        {
          radial: 14,
        },
      ),
      lathe(
        LENS,
        [
          [back + 0.0025, 0],
          [back + 0.0025, tube + 0.002],
          [back + 0.002, 0],
        ],
        [0, y, 0],
        {
          radial: 12,
        },
      ),
    )
  }
  // Rings and their bases.
  for (const rz of [back - len * 0.32, front + len * 0.36]) {
    out.push(
      lathe(
        body,
        [
          [rz + 0.007, tube + 0.0005],
          [rz + 0.007, tube + 0.004],
          [rz - 0.007, tube + 0.004],
          [rz - 0.007, tube + 0.0005],
          [rz + 0.007, tube + 0.0005],
        ],
        [0, y, 0],
        { radial: 10 },
      ),
      box(body, [0.016, y - tube - base, 0.012], [0, (y - tube + base) / 2, rz], undefined, 0.002),
    )
  }
  return out
}

// ── Hands and arms ──

/** Marks hand and sleeve parts: the world models leave them out. */
function flagHand<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => {
    c.userData.hand = true
  })
  return o
}

const v3 = (v: THREE.Vector3): V3 => [v.x, v.y, v.z]

/**
 * A sleeved forearm from the wrist back to the elbow (gun space): a glove cuff, the sleeve's
 * cuff, and the sleeve widening up the arm.
 */
function forearm(wrist: V3, elbow: V3, glove: Paint): THREE.Mesh[] {
  const a = new THREE.Vector3(...wrist)
  const b = new THREE.Vector3(...elbow)
  const dir = b.clone().sub(a).normalize()
  const at = (d: number) => v3(a.clone().addScaledVector(dir, d))
  return [
    limb(glove, at(-0.012), at(0.03), 0.019, 0.021, 8),
    limb(CUFF, at(0.024), at(0.05), 0.026, 0.027, 9),
    limb(SLEEVE, at(0.045), v3(b), 0.027, 0.035, 9),
  ]
}

export interface Grip {
  /** Where the hand holds the grip (gun space): the middle of the grip at the middle finger. */
  at: V3
  /** How far the grip leans: its top forward of its bottom (radians). */
  rake?: number
  /** Grip width (x) and depth (z) at the hand. */
  gw?: number
  gd?: number
  /** Where the index finger presses (gun space); without one, it wraps the grip too. */
  trigger?: V3 | undefined
  /** Thumb height above the hand's middle (pistols ride it high along the frame). */
  thumb?: number
  /** Where the forearm ends (gun space): it runs from the wrist to here. */
  elbow?: V3 | undefined
  glove?: Paint
}

/**
 * The right hand wrapped round a grip and its sleeved forearm: back of the hand to the right,
 * fingers round the front, thumb up the left side. Built round a grip running up local Y.
 */
export function rightHand(g: Grip): THREE.Group {
  const gw = g.gw ?? 0.03
  const gd = g.gd ?? 0.045
  const glove = g.glove ?? GLOVE
  const hand = new THREE.Group()
  hand.position.set(...g.at)
  hand.rotation.x = -(g.rake ?? 0)
  hand.updateMatrix()
  const toLocal = hand.matrix.clone().invert()
  const fingerR = 0.0098
  const finger = (y: number, r: number, reach = 1) =>
    sweep(
      glove,
      [
        [gw / 2 + 0.013, y, -gd / 2 + 0.014],
        [gw / 2 + 0.006, y, -gd / 2 - 0.006],
        [-gw / 2 + 0.006 * reach, y - 0.002, -gd / 2 - 0.009],
        [-gw / 2 - 0.007, y - 0.003, -gd / 2 + 0.008 * reach],
      ],
      r,
      r * 0.86,
      3,
      6,
    )
  hand.add(
    // Back of the hand, along the right side of the grip.
    box(glove, [0.025, 0.078, gd + 0.032], [gw / 2 + 0.012, -0.004, 0.012], [0, 0.18, 0], 0.009),
    // Knuckle pad.
    box(
      GLOVE_DARK,
      [0.012, 0.064, 0.02],
      [gw / 2 + 0.024, 0.0, -gd / 2 + 0.018],
      [0, 0.25, 0],
      0.004,
    ),
    // Heel of the palm behind the grip.
    box(glove, [gw + 0.012, 0.07, 0.024], [0.003, -0.01, gd / 2 + 0.011], undefined, 0.009),
    finger(0.002, fingerR),
    finger(-0.018, fingerR * 0.97),
    finger(-0.036, fingerR * 0.86, 0.8),
  )
  // Index finger: on the trigger, or round the grip with the others.
  if (g.trigger) {
    const t = new THREE.Vector3(...g.trigger).applyMatrix4(toLocal)
    hand.add(
      sweep(
        glove,
        [
          [gw / 2 + 0.012, 0.022, -gd / 2 + 0.012],
          [gw / 2 + 0.006, (0.022 + t.y) / 2 + 0.004, (-gd / 2 + t.z) / 2 + 0.004],
          [0.006, t.y + 0.002, t.z - 0.004],
          [-0.002, t.y - 0.004, t.z + 0.001],
        ],
        fingerR,
        fingerR * 0.85,
        4,
        6,
      ),
    )
  } else hand.add(finger(0.021, fingerR))
  // Thumb: from the web behind the grip, forward along the left side.
  const ty = g.thumb ?? 0.03
  hand.add(
    sweep(
      glove,
      [
        [-0.002, ty - 0.022, gd / 2 + 0.014],
        [-gw / 2 - 0.008, ty - 0.006, gd / 2 - 0.006],
        [-gw / 2 - 0.009, ty, -gd / 2 + 0.008],
        [-gw / 2 - 0.006, ty + 0.001, -gd / 2 - 0.006],
      ],
      0.0112,
      0.0096,
      4,
      6,
    ),
  )
  const wrist = new THREE.Vector3(gw / 2 + 0.006, -0.026, gd / 2 + 0.03).applyMatrix4(hand.matrix)
  const elbow = g.elbow ?? [g.at[0] + 0.035, g.at[1] - 0.06, g.at[2] + 0.3]
  const out = new THREE.Group()
  out.add(hand, ...forearm(v3(wrist), elbow, glove))
  return flagHand(out)
}

/** The same hand, mirrored: a left hand round a grip (pistols' support hand wraps the right). */
export function leftHand(g: Grip): THREE.Group {
  const mirror = (v?: V3): V3 | undefined => (v ? [-v[0], v[1], v[2]] : undefined)
  const hand = rightHand({
    ...g,
    at: mirror(g.at) as V3,
    trigger: mirror(g.trigger),
    elbow: mirror(g.elbow ?? [g.at[0] - 0.05, g.at[1] - 0.07, g.at[2] + 0.28]),
  })
  hand.scale.x = -1
  return hand
}

export interface Cradle {
  /** The middle of what the hand holds (gun space): a handguard, a pump, a magazine. */
  at: V3
  /** Its width and height. */
  w: number
  h: number
  /** Where the forearm ends (gun space). */
  elbow?: V3 | undefined
  glove?: Paint
}

/**
 * The left hand holding something from below: palm under its left edge, fingers curled up the
 * right side, thumb along the left. The forend grip of every long gun (and the reload hand).
 */
export function cradle(c: Cradle): THREE.Group {
  const { w, h } = c
  const glove = c.glove ?? GLOVE
  const hand = new THREE.Group()
  hand.position.set(...c.at)
  const bottom = -h / 2
  const reach = Math.min(h * 0.75, 0.05)
  const finger = (z: number, r: number) =>
    sweep(
      glove,
      [
        [-w * 0.05, bottom - 0.016, z + 0.004],
        [w / 2 + 0.002, bottom - 0.009, z],
        [w / 2 + 0.009, bottom + reach * 0.6, z - 0.002],
        [w / 2 + 0.002, bottom + reach, z - 0.003],
      ],
      r,
      r * 0.86,
      3,
      6,
    )
  hand.add(
    // Palm and back of the hand under the left edge, tipped up to face it.
    box(glove, [0.03, 0.026, 0.08], [-w / 2 + 0.002, bottom - 0.013, 0.008], [0, 0, -0.55], 0.01),
    box(GLOVE_DARK, [0.018, 0.012, 0.064], [-w * 0.05, bottom - 0.026, 0.002], [0, 0, -0.2], 0.004),
    finger(-0.028, 0.0094),
    finger(-0.008, 0.0098),
    finger(0.012, 0.0094),
    finger(0.03, 0.0084),
    sweep(
      glove,
      [
        [-w / 2 - 0.006, bottom - 0.006, 0.04],
        [-w / 2 - 0.011, bottom + 0.012, 0.012],
        [-w / 2 - 0.009, bottom + Math.min(h * 0.5, 0.03), -0.016],
        [-w / 2 - 0.004, bottom + Math.min(h * 0.55, 0.034), -0.032],
      ],
      0.011,
      0.0094,
      4,
      6,
    ),
  )
  const wrist: V3 = [c.at[0] - w / 2 - 0.012, c.at[1] + bottom - 0.03, c.at[2] + 0.045]
  const elbow = c.elbow ?? [wrist[0] - 0.08, wrist[1] - 0.17, wrist[2] + 0.22]
  const out = new THREE.Group()
  out.add(hand, ...forearm(wrist, elbow, glove))
  return flagHand(out)
}

/** A hand round a melee weapon's handle (lying along -Z, the hand at the origin). */
export function fist(diameter: number, elbow: V3): THREE.Group {
  const hand = rightHand({ at: [0, 0, 0], gw: diameter, gd: diameter, thumb: 0.016 })
  // rightHand grips up local Y; turn that to point along the handle (-Z), fingers underneath.
  const inner = hand.children[0] as THREE.Object3D
  inner.rotation.x = -Math.PI / 2
  // Rebuild the forearm from the turned wrist.
  for (const c of [...hand.children]) if (c !== inner) c.removeFromParent()
  inner.updateMatrix()
  const wrist = new THREE.Vector3(diameter / 2 + 0.006, -0.026, diameter / 2 + 0.03).applyMatrix4(
    inner.matrix,
  )
  hand.add(...forearm(v3(wrist), elbow, GLOVE))
  return flagHand(hand)
}

// ── Baking ──

/**
 * Merges the meshes under `root` into one per material, in place. Each of `keep` (moving parts:
 * a slide, a magazine, the support hand) keeps its own merged meshes so it can still move; so
 * does anything flagged `userData.keep`. Markers and empty groups stay where they are.
 */
export function bake(root: THREE.Object3D, keep: Iterable<THREE.Object3D | undefined> = []): void {
  const keepers = new Set<THREE.Object3D>([root])
  for (const k of keep) if (k) keepers.add(k)
  root.traverse((o) => {
    if (o.userData.keep) keepers.add(o)
  })
  root.updateMatrixWorld(true)
  for (const keeper of keepers) {
    if ((keeper as THREE.Mesh).isMesh && keeper !== root) continue
    const meshes: THREE.Mesh[] = []
    const visit = (o: THREE.Object3D) => {
      for (const c of o.children) {
        if (keepers.has(c)) continue
        if ((c as THREE.Mesh).isMesh) meshes.push(c as THREE.Mesh)
        visit(c)
      }
    }
    visit(keeper)
    if (meshes.length === 0) continue
    const inverse = keeper.matrixWorld.clone().invert()
    const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>()
    const local = new THREE.Matrix4()
    for (const m of meshes) {
      local.multiplyMatrices(inverse, m.matrixWorld)
      const g = m.geometry.clone()
      for (const name of Object.keys(g.attributes))
        if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name)
      if (!g.index) g.setIndex([...Array(g.getAttribute('position').count).keys()])
      g.applyMatrix4(local)
      if (local.determinant() < 0) {
        const idx = g.index as THREE.BufferAttribute
        for (let i = 0; i < idx.count; i += 3) {
          const b = idx.getX(i + 1)
          idx.setX(i + 1, idx.getX(i + 2))
          idx.setX(i + 2, b)
        }
      }
      const mat = m.material as THREE.Material
      const list = byMaterial.get(mat) ?? []
      list.push(g)
      byMaterial.set(mat, list)
      // Anything hung on a mesh (a marker) stays put when the mesh goes.
      for (const child of [...m.children]) m.parent?.attach(child)
      m.removeFromParent()
    }
    for (const [mat, geos] of byMaterial) {
      const merged = mergeGeometries(geos)
      if (!merged) continue
      merged.computeBoundingSphere()
      keeper.add(new THREE.Mesh(merged, mat))
    }
  }
}

/** Removes the hands and sleeves (for the world). */
export function stripHands(root: THREE.Object3D): void {
  const hands: THREE.Object3D[] = []
  root.traverse((o) => {
    if (o.userData.hand) hands.push(o)
  })
  for (const h of hands) h.removeFromParent()
}

/** Triangles drawn for an object (visible meshes only). */
export function triangles(root: THREE.Object3D): number {
  let n = 0
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const g = m.geometry
    n += (g.index ? g.index.count : g.getAttribute('position').count) / 3
  })
  return n
}

/**
 * The support hand as a moving part: a group at `at` (what the hand holds: the middle of a
 * handguard or pump, w × h), the hand cradling it and its forearm (elbow in gun space).
 */
export function supportHand(at: V3, w: number, h: number, elbow?: V3): THREE.Group {
  const g = part(at)
  g.add(
    cradle({
      at: [0, 0, 0],
      w,
      h,
      elbow: elbow ? [elbow[0] - at[0], elbow[1] - at[1], elbow[2] - at[2]] : undefined,
    }),
  )
  return g
}
