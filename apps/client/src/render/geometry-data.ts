import * as THREE from 'three'

/** A BufferGeometry's contents, ready to send between threads. */
export interface GeometryData {
  attributes: { name: string; array: Float32Array; itemSize: number }[]
  index: Uint16Array | Uint32Array | null
  /** Bounding sphere (centre x, y, z, radius) as three.js would work it out, if known. */
  sphere: [number, number, number, number] | null
}

/** The buffers to hand over (transfer) when sending `data` to another thread. */
export function transferables(data: GeometryData | null): ArrayBuffer[] {
  if (!data) return []
  const out = data.attributes.map((a) => a.array.buffer as ArrayBuffer)
  if (data.index) out.push(data.index.buffer as ArrayBuffer)
  return out
}

/**
 * The bounding sphere BufferGeometry.computeBoundingSphere would give (centre of the box, radius
 * to the furthest vertex), worked out here so the main thread doesn't have to.
 */
export function boundingSphere(position: Float32Array): [number, number, number, number] {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (let i = 0; i < position.length; i += 3) {
    const x = position[i] as number
    const y = position[i + 1] as number
    const z = position[i + 2] as number
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (z < minZ) minZ = z
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    if (z > maxZ) maxZ = z
  }
  const cx = (minX + maxX) * 0.5
  const cy = (minY + maxY) * 0.5
  const cz = (minZ + maxZ) * 0.5
  let r2 = 0
  for (let i = 0; i < position.length; i += 3) {
    const dx = (position[i] as number) - cx
    const dy = (position[i + 1] as number) - cy
    const dz = (position[i + 2] as number) - cz
    r2 = Math.max(r2, dx * dx + dy * dy + dz * dz)
  }
  return [cx, cy, cz, Math.sqrt(r2)]
}

/** Wraps the arrays in a BufferGeometry (no copies). */
export function toGeometry(data: GeometryData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  for (const a of data.attributes)
    g.setAttribute(a.name, new THREE.BufferAttribute(a.array, a.itemSize))
  if (data.index) g.setIndex(new THREE.BufferAttribute(data.index, 1))
  if (data.sphere) {
    const [x, y, z, r] = data.sphere
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(x, y, z), r)
  }
  return g
}
