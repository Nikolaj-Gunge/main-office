import { PART_SIZES, type PartName } from '@office-fps/shared'
import * as THREE from 'three'
import { BONE_INDEX, boneWeights, type Place, REST, type RigBone } from './body-rig.ts'

/**
 * A little modelling kit for bodies: smooth blobs, tubes and surfaces (plus boxes and spikes for
 * hard bits) placed on a bone of the body rig, or in model space for pieces that run across
 * joints (a torso, a whole leg). Everything is baked into ONE skinned, vertex-coloured geometry
 * per character (one group per special material), so a detailed body is one or two draw calls
 * and bends smoothly at the joints instead of being a stack of boxes.
 */

export type BodyPartKey = Exclude<PartName, 'gun'>
/**
 * What a piece is drawn with: a colour (merged into the vertex-coloured group), the look's
 * glowing eyes, or any other shared material (its own group).
 */
export type Slot = 'vc' | 'eyes' | THREE.Material
export type Vec = readonly [number, number, number]
/** A colour; with the OWN flag set it is the wearer's own colour times the low 24 bits. */
export type Look = number | Exclude<Slot, 'vc'>
export const OWN = 0x1000000
/** Colour of a vertex from its position in the piece's own space and its (u, v) on a surface. */
export type ColorFn = (p: THREE.Vector3, u: number, v: number) => number

/** Arm meshes are built for this length; the arm bone stretches to the real shoulder–hand span. */
export const ARM_LENGTH = PART_SIZES.armR.y * 2

/** A baked body: skinned geometry in rest model space, its material slots (one group each). */
export interface BodyMesh {
  geometry: THREE.BufferGeometry
  slots: readonly Slot[]
  /** Vertices drawn in the wearer's own colour (recoloured for team tints): index, multiplier. */
  own: { index: Uint32Array; mult: Float32Array } | null
}

interface Piece {
  place: Place
  rigid: boolean
  slot: Slot
  geometry: THREE.BufferGeometry // non-indexed, local space, with a colour attribute
}

const ZERO: Vec = [0, 0, 0]
const ONE: Vec = [1, 1, 1]
const matrix = new THREE.Matrix4()
const position = new THREE.Vector3()
const rotation = new THREE.Quaternion()
const euler = new THREE.Euler()
const scaling = new THREE.Vector3()
const tint = new THREE.Color()
const p = new THREE.Vector3()

export interface SurfaceOptions {
  colorFn?: ColorFn
  /** Close the first / last ring to a single point (poles). */
  poles?: readonly [boolean, boolean]
  /** An open sheet: u runs 0 → 1 inclusive and doesn't wrap round. */
  open?: boolean
  at?: Vec
  rot?: Vec
  stretch?: Vec
}

/** One ring of a tube: height, half-width (x), half-depth (z), centre offset (x, z). */
export type Ring = readonly [y: number, rx: number, rz: number, x?: number, z?: number]

export class Kit {
  private readonly pieces: Piece[] = []
  private place: Place = 'head'
  private isRigid = false

  /** Following pieces go on this bone (its own space), or in model space for 'torso'/'legL'/… */
  on(place: Place): this {
    this.place = place
    return this
  }

  /** Following pieces move with their bone only (no blending into the next one at a joint). */
  rigid(on = true): this {
    this.isRigid = on
    return this
  }

  box(look: Look, size: Vec, at: Vec = ZERO, rot: Vec = ZERO): this {
    return this.add(look, new THREE.BoxGeometry(size[0], size[1], size[2]), at, rot)
  }

  /** A sharp cone `length` long with base `width`, pointing along +Y before `rot`. */
  spike(look: Look, width: number, length: number, at: Vec, rot: Vec = ZERO, sides = 5): this {
    const cone = new THREE.ConeGeometry(width / 2, length, sides, 1)
    cone.translate(0, length / 2, 0) // base at the origin
    return this.add(look, cone, at, rot, ONE, undefined, true)
  }

  /** A smooth lump (tumours, sacks, muscle). */
  lump(look: Look, radius: number, at: Vec, stretch: Vec = ONE, rot: Vec = ZERO): this {
    return this.blob(look, [radius * stretch[0], radius * stretch[1], radius * stretch[2]], at, rot)
  }

  /** A smooth ellipsoid with half-axes `r`. */
  blob(
    look: Look,
    r: Vec,
    at: Vec = ZERO,
    rot: Vec = ZERO,
    seg = 8,
    rings = 6,
    colorFn?: ColorFn,
  ): this {
    return this.surface(
      look,
      seg,
      rings,
      (u, v) => {
        const theta = v * Math.PI
        const phi = u * Math.PI * 2
        const s = Math.sin(theta)
        return [r[0] * s * Math.cos(phi), r[1] * Math.cos(theta), r[2] * s * Math.sin(phi)]
      },
      { colorFn, poles: [true, true], at, rot },
    )
  }

  /**
   * A tube along Y through `rings` (bottom to top or top to bottom), with superelliptic
   * cross-sections (`square` > 2 flattens the sides), optionally capped at either end.
   */
  tube(
    look: Look,
    rings: readonly Ring[],
    seg: number,
    opts: SurfaceOptions & { caps?: readonly [boolean, boolean]; square?: number } = {},
  ): this {
    const caps = opts.caps ?? [true, true]
    const all: Ring[] = [...rings]
    const first = rings[0] as Ring
    const last = rings[rings.length - 1] as Ring
    // A cap is a point just beyond the end ring (a rounded end, not a flat lid).
    const dir = Math.sign(last[0] - first[0]) || 1
    if (caps[0]) all.unshift([first[0] - dir * Math.min(first[1], first[2]) * 0.5, 0, 0, first[3], first[4]])
    if (caps[1]) all.push([last[0] + dir * Math.min(last[1], last[2]) * 0.5, 0, 0, last[3], last[4]])
    const e = 2 / (opts.square ?? 2)
    return this.surface(
      look,
      seg,
      all.length,
      (u, v) => {
        const i = Math.round(v * (all.length - 1))
        const ring = all[i] as Ring
        const a = u * Math.PI * 2
        const c = Math.cos(a)
        const s = Math.sin(a)
        return [
          (ring[3] ?? 0) + ring[1] * Math.sign(c) * Math.abs(c) ** e,
          ring[0],
          (ring[4] ?? 0) + ring[2] * Math.sign(s) * Math.abs(s) ** e,
        ]
      },
      { ...opts, poles: [caps[0], caps[1]] },
    )
  }

  /**
   * A smooth surface: `fn(u, v)` for u in [0, 1) around (it wraps) and v in [0, 1] along,
   * `seg` × `rings` vertices, normals smoothed across the whole surface.
   */
  surface(
    look: Look,
    seg: number,
    rings: number,
    fn: (u: number, v: number) => readonly [number, number, number],
    opts: SurfaceOptions = {},
  ): this {
    const [poleA, poleB] = opts.poles ?? [false, false]
    const pos: number[] = []
    const uv: number[] = []
    const index: number[] = []
    const rowStart: number[] = []
    for (let j = 0; j < rings; j++) {
      const v = j / (rings - 1)
      rowStart.push(pos.length / 3)
      const pole = (j === 0 && poleA) || (j === rings - 1 && poleB)
      const count = pole ? 1 : seg
      for (let i = 0; i < count; i++) {
        const u = pole ? 0 : opts.open ? i / (seg - 1) : i / seg
        const q = fn(u, v)
        pos.push(q[0], q[1], q[2])
        uv.push(u, v)
      }
    }
    for (let j = 0; j < rings - 1; j++) {
      const a = rowStart[j] as number
      const b = rowStart[j + 1] as number
      const aPole = j === 0 && poleA
      const bPole = j + 1 === rings - 1 && poleB
      for (let i = 0; i < (opts.open ? seg - 1 : seg); i++) {
        const i1 = (i + 1) % seg
        const a0 = aPole ? a : a + i
        const a1 = aPole ? a : a + i1
        const b0 = bPole ? b : b + i
        const b1 = bPole ? b : b + i1
        if (!aPole) index.push(a0, a1, b1)
        if (!bPole) index.push(a0, b1, b0)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(index)
    // Winding: make the faces point outwards (fn may run either way round).
    g.computeVertexNormals()
    if (inwards(g)) {
      for (let t = 0; t < index.length; t += 3) {
        const x = index[t + 1] as number
        index[t + 1] = index[t + 2] as number
        index[t + 2] = x
      }
      g.setIndex(index)
      g.computeVertexNormals()
    }
    return this.add(look, g, opts.at, opts.rot, opts.stretch, opts.colorFn, true)
  }

  /** Any geometry (indexed ones get smooth normals when `smooth`). */
  add(
    look: Look,
    geometry: THREE.BufferGeometry,
    at: Vec = ZERO,
    rot: Vec = ZERO,
    stretch: Vec = ONE,
    colorFn?: ColorFn,
    smooth = false,
  ): this {
    if (smooth && geometry.index) geometry.computeVertexNormals()
    const g = geometry.index ? geometry.toNonIndexed() : geometry
    if (g !== geometry) geometry.dispose()
    const count = g.getAttribute('position').count
    let slot: Slot = 'vc'
    const colors = new Float32Array(count * 4)
    if (typeof look === 'number' || colorFn) {
      const pos = g.getAttribute('position')
      const uv = g.getAttribute('uv')
      for (let i = 0; i < count; i++) {
        let c = typeof look === 'number' ? look : 0xffffff
        if (colorFn) c = colorFn(p.fromBufferAttribute(pos, i), uv?.getX(i) ?? 0, uv?.getY(i) ?? 0)
        tint.setHex(c & 0xffffff)
        colors.set([tint.r, tint.g, tint.b, c & OWN ? 1 : 0], i * 4)
      }
    }
    if (typeof look !== 'number') slot = look
    // The 4th channel flags the wearer's own colour (resolved at build).
    g.setAttribute('color', new THREE.BufferAttribute(colors, 4))
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2))
    matrix.compose(
      position.set(at[0], at[1], at[2]),
      rotation.setFromEuler(euler.set(rot[0], rot[1], rot[2])),
      scaling.set(stretch[0], stretch[1], stretch[2]),
    )
    g.applyMatrix4(matrix)
    this.pieces.push({ place: this.place, rigid: this.isRigid, slot, geometry: g })
    return this
  }

  /**
   * Bakes every piece into one skinned geometry in rest model space (groups: colours first,
   * then each special material), `own` = the wearer's colour for OWN-flagged colours.
   */
  build(own = 0xffffff): BodyMesh {
    const slots: Slot[] = ['vc']
    for (const piece of this.pieces) if (!slots.includes(piece.slot)) slots.push(piece.slot)
    let total = 0
    for (const piece of this.pieces) total += piece.geometry.getAttribute('position').count
    const positions = new Float32Array(total * 3)
    const normals = new Float32Array(total * 3)
    const colors = new Float32Array(total * 3)
    const uvs = new Float32Array(total * 2)
    const skinIndex = new Uint16Array(total * 4)
    const skinWeight = new Float32Array(total * 4)
    const ownIndex: number[] = []
    const ownMult: number[] = []
    const ownColor = new THREE.Color(own)
    const geometry = new THREE.BufferGeometry()
    const normal = new THREE.Matrix3()
    const n = new THREE.Vector3()
    let at = 0
    for (const slot of slots) {
      const start = at
      for (const piece of this.pieces) {
        if (piece.slot !== slot) continue
        const g = piece.geometry
        const rest = typeof piece.place === 'string' && piece.place in REST ? REST[piece.place as RigBone] : null
        if (rest) normal.getNormalMatrix(rest)
        const pos = g.getAttribute('position')
        const nor = g.getAttribute('normal')
        const col = g.getAttribute('color')
        const uv = g.getAttribute('uv')
        for (let i = 0; i < pos.count; i++, at++) {
          uvs.set([uv.getX(i), uv.getY(i)], at * 2)
          p.fromBufferAttribute(pos, i)
          n.fromBufferAttribute(nor, i)
          if (rest) {
            p.applyMatrix4(rest)
            n.applyMatrix3(normal).normalize()
          }
          positions.set([p.x, p.y, p.z], at * 3)
          normals.set([n.x, n.y, n.z], at * 3)
          const r = col.getX(i)
          const gg = col.getY(i)
          const b = col.getZ(i)
          if (col.getW(i) > 0.5) {
            ownIndex.push(at)
            ownMult.push(r, gg, b)
            colors.set([r * ownColor.r, gg * ownColor.g, b * ownColor.b], at * 3)
          } else colors.set([r, gg, b], at * 3)
          const [b0, b1, w] = boneWeights(piece.place, p, piece.rigid)
          skinIndex.set([BONE_INDEX[b0], BONE_INDEX[b1], 0, 0], at * 4)
          skinWeight.set([1 - w, w, 0, 0], at * 4)
        }
        g.dispose()
      }
      geometry.addGroup(start, at - start, slots.indexOf(slot))
    }
    this.pieces.length = 0
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4))
    geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4))
    geometry.computeBoundingSphere()
    return {
      geometry,
      slots,
      own:
        ownIndex.length > 0
          ? { index: Uint32Array.from(ownIndex), mult: Float32Array.from(ownMult) }
          : null,
    }
  }
}

/** True when most of a closed surface's normals point at its middle (wound inside out). */
function inwards(g: THREE.BufferGeometry): boolean {
  const pos = g.getAttribute('position')
  const nor = g.getAttribute('normal')
  const centre = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) centre.add(p.fromBufferAttribute(pos, i))
  centre.multiplyScalar(1 / pos.count)
  let score = 0
  const n = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).sub(centre)
    score += p.dot(n.fromBufferAttribute(nor, i))
  }
  return score < 0
}

/** Recolours a body's own-coloured vertices (team tints). */
export function recolor(mesh: BodyMesh, color: number): void {
  if (!mesh.own) return
  const c = new THREE.Color(color)
  const attr = mesh.geometry.getAttribute('color') as THREE.BufferAttribute
  const { index, mult } = mesh.own
  for (let i = 0; i < index.length; i++) {
    const at = index[i] as number
    attr.setXYZ(at, (mult[i * 3] as number) * c.r, (mult[i * 3 + 1] as number) * c.g, (mult[i * 3 + 2] as number) * c.b)
  }
  attr.needsUpdate = true
}

/** Small deterministic random numbers (the same zombie looks the same on every screen). */
export function seeded(seed: number): () => number {
  let a = (seed * 2654435761) >>> 0 || 1
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const pickOf = <T>(list: readonly T[], i: number): T =>
  list[((i % list.length) + list.length) % list.length] as T

/** Mixes two colours (t = 0 → a, 1 → b). */
export function mix(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t))
  const ch = (s: number) => {
    const x = (a >> s) & 255
    const y = (b >> s) & 255
    return Math.round(x + (y - x) * k) << s
  }
  return (a & OWN) | ch(16) | ch(8) | ch(0)
}

/** Darkens (f < 1) or brightens a colour, keeping the OWN flag. */
export function shade(c: number, f: number): number {
  const ch = (s: number) => Math.min(255, Math.round(((c >> s) & 255) * f)) << s
  return (c & OWN) | ch(16) | ch(8) | ch(0)
}

/** Smooth 0 → 1 between e0 and e1. */
export function step(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** Cheap smooth-ish value noise in 3D (camo, grime, mottling). */
export function noise3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453
  const t = Math.sin(x * 4.1 + 1.3) * Math.sin(y * 3.7 + 0.7) * Math.sin(z * 5.3 + 2.1)
  return 0.5 + 0.35 * t + 0.15 * (s - Math.floor(s) - 0.5)
}

/** The vertex-coloured materials everything baked is drawn with. */
export const vertexColored = new THREE.MeshLambertMaterial({ vertexColors: true })
/** Wet, glossy skin (stalkers): catches torchlight as a sheen along the edges. */
export const glossyVertexColored = new THREE.MeshPhongMaterial({
  vertexColors: true,
  shininess: 40,
  specular: 0x3a4050,
})
