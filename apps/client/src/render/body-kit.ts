import { PART_SIZES, type PartName } from '@office-fps/shared'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * A little modelling kit for bodies: boxes, cones and lumps placed in a part's own space and
 * baked into ONE merged, vertex-coloured mesh per part (plus one per special material), so a
 * detailed zombie or a full set of gear costs a handful of draw calls, not dozens.
 */

export type BodyPartKey = Exclude<PartName, 'gun'>
/**
 * What a piece is drawn with: a colour (merged into the part's vertex-coloured mesh), the look's
 * glowing eyes, the player's own shirt material, or any other shared material.
 */
export type Slot = 'vc' | 'eyes' | 'own' | THREE.Material
export type Vec = readonly [number, number, number]
/** Baked meshes per part: [what to draw it with, merged geometry]. */
export type Baked = Partial<Record<BodyPartKey, readonly (readonly [Slot, THREE.BufferGeometry])[]>>

/** Arm meshes are built for this length; the arm group stretches to the real shoulder–hand span. */
export const ARM_LENGTH = PART_SIZES.armR.y * 2

const ZERO: Vec = [0, 0, 0]
const ONE: Vec = [1, 1, 1]
const matrix = new THREE.Matrix4()
const position = new THREE.Vector3()
const rotation = new THREE.Quaternion()
const euler = new THREE.Euler()
const scaling = new THREE.Vector3()
const tint = new THREE.Color()

export class Kit {
  private readonly bins = new Map<BodyPartKey, Map<Slot, THREE.BufferGeometry[]>>()
  private current: BodyPartKey = 'head'

  /** Following pieces go on this part. */
  on(part: BodyPartKey): this {
    this.current = part
    return this
  }

  box(look: number | Slot, size: Vec, at: Vec = ZERO, rot: Vec = ZERO): this {
    return this.add(look, new THREE.BoxGeometry(size[0], size[1], size[2]), at, rot)
  }

  /** A 4-sided spike `length` long with base `width`, pointing along +Y before `rot`. */
  spike(look: number | Slot, width: number, length: number, at: Vec, rot: Vec = ZERO): this {
    const cone = new THREE.ConeGeometry(width / 2, length, 4)
    cone.rotateY(Math.PI / 4)
    cone.translate(0, length / 2, 0) // base at the origin
    return this.add(look, cone, at, rot)
  }

  /** A low-poly lump (tumours, sacks, muscle). */
  lump(look: number | Slot, radius: number, at: Vec, stretch: Vec = ONE, rot: Vec = ZERO): this {
    return this.add(look, new THREE.IcosahedronGeometry(radius, 0), at, rot, stretch)
  }

  add(
    look: number | Slot,
    geometry: THREE.BufferGeometry,
    at: Vec = ZERO,
    rot: Vec = ZERO,
    stretch: Vec = ONE,
  ): this {
    const g = geometry.index ? geometry.toNonIndexed() : geometry
    if (g !== geometry) geometry.dispose()
    matrix.compose(
      position.set(at[0], at[1], at[2]),
      rotation.setFromEuler(euler.set(rot[0], rot[1], rot[2])),
      scaling.set(stretch[0], stretch[1], stretch[2]),
    )
    g.applyMatrix4(matrix)
    let slot: Slot
    if (typeof look === 'number') {
      slot = 'vc'
      tint.setHex(look)
      const count = g.getAttribute('position').count
      const colors = new Float32Array(count * 3)
      for (let i = 0; i < count; i++) colors.set([tint.r, tint.g, tint.b], i * 3)
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    } else slot = look
    let bin = this.bins.get(this.current)
    if (!bin) {
      bin = new Map()
      this.bins.set(this.current, bin)
    }
    const list = bin.get(slot)
    if (list) list.push(g)
    else bin.set(slot, [g])
    return this
  }

  /** Merges everything into one geometry per part and material. */
  bake(): Baked {
    const out: Baked = {}
    for (const [part, bin] of this.bins) {
      const meshes: (readonly [Slot, THREE.BufferGeometry])[] = []
      for (const [slot, list] of bin) {
        const merged = list.length === 1 ? list[0] : mergeGeometries(list)
        if (!merged) throw new Error(`body kit: could not merge ${part}`)
        if (merged !== list[0]) for (const g of list) g.dispose()
        merged.computeBoundingSphere()
        meshes.push([slot, merged] as const)
      }
      out[part] = meshes
    }
    this.bins.clear()
    return out
  }
}

/** Builds meshes for a baked look onto part groups; returns them (to remove later). */
export function attachBaked(
  baked: Baked,
  groups: Record<BodyPartKey, THREE.Object3D>,
  resolve: (slot: Slot) => THREE.Material,
): THREE.Mesh[] {
  const made: THREE.Mesh[] = []
  for (const [part, meshes] of Object.entries(baked) as [BodyPartKey, Baked[BodyPartKey]][]) {
    for (const [slot, geometry] of meshes ?? []) {
      const mesh = new THREE.Mesh(geometry, resolve(slot))
      mesh.castShadow = false
      groups[part].add(mesh)
      made.push(mesh)
    }
  }
  return made
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

/** The vertex-coloured materials everything baked is drawn with. */
export const vertexColored = new THREE.MeshLambertMaterial({ vertexColors: true })
/** Wet, glossy skin (stalkers): catches torchlight as a sheen along the edges. */
export const glossyVertexColored = new THREE.MeshPhongMaterial({
  vertexColors: true,
  shininess: 40,
  specular: 0x3a4050,
})

/** Whether `eye` is inside the body of someone standing at `s` (`size`: their scale). */
export function insideBody(
  eye: { x: number; y: number; z: number },
  s: { x: number; y: number; z: number },
  size: number,
): boolean {
  const reach = 0.4 * size
  return (
    Math.abs(eye.x - s.x) < reach &&
    Math.abs(eye.z - s.z) < reach &&
    eye.y > s.y - 0.1 &&
    eye.y < s.y + 2 * size
  )
}
