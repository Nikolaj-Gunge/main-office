import * as THREE from 'three'

/** An axis-aligned box (m). */
export interface Aabb {
  min: readonly [number, number, number]
  max: readonly [number, number, number]
}

/** Grid cell (m) for finding the boxes near a point. */
const CELL = 4
/** How far out (m) a vertex looks for things crowding it. */
const REACH = 0.55
/** The darkest a vertex gets (a corner boxed in on every side). */
const FLOOR = 0.62

/** Boxes bucketed by x/z cell, so a lookup only checks what's close. */
export class AabbGrid {
  private readonly cells = new Map<number, Aabb[]>()

  constructor(boxes: readonly Aabb[]) {
    for (const b of boxes) {
      const x0 = Math.floor((b.min[0] - REACH) / CELL)
      const x1 = Math.floor((b.max[0] + REACH) / CELL)
      const z0 = Math.floor((b.min[2] - REACH) / CELL)
      const z1 = Math.floor((b.max[2] + REACH) / CELL)
      // Huge boxes (the ground slabs of a whole town) would fill hundreds of cells: skip them.
      if ((x1 - x0 + 1) * (z1 - z0 + 1) > 400) continue
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const key = x * 100003 + z
          const list = this.cells.get(key)
          if (list) list.push(b)
          else this.cells.set(key, [b])
        }
      }
    }
  }

  /** Whether the point is inside any box. */
  solid(x: number, y: number, z: number): boolean {
    const list = this.cells.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL))
    if (!list) return false
    for (const b of list) {
      if (
        x > b.min[0] &&
        x < b.max[0] &&
        y > b.min[1] &&
        y < b.max[1] &&
        z > b.min[2] &&
        z < b.max[2]
      )
        return true
    }
    return false
  }
}

/**
 * Baked ambient occlusion: how open (0–1) the space is just off a surface at `p` facing `n`.
 * Looks a little way out along the normal and tilted towards the four directions across it;
 * every look that ends inside another box darkens the vertex. A wall's foot on a floor, a box in
 * a corner, the underside of a shelf go darker — interpolated across the face by the GPU.
 */
export function vertexOpenness(
  grid: AabbGrid,
  p: readonly [number, number, number],
  n: readonly [number, number, number],
): number {
  const [px, py, pz] = p
  const [nx, ny, nz] = n
  // Two directions across the face: t = n × a, b = n × t.
  const [ax, ay, az] = Math.abs(ny) > 0.9 ? [1, 0, 0] : [0, 1, 0]
  let tx = ny * az - nz * ay
  let ty = nz * ax - nx * az
  let tz = nx * ay - ny * ax
  const tl = Math.hypot(tx, ty, tz) || 1
  tx /= tl
  ty /= tl
  tz /= tl
  const bx = ny * tz - nz * ty
  const by = nz * tx - nx * tz
  const bz = nx * ty - ny * tx
  const looks: [number, number, number][] = [[nx, ny, nz]]
  for (const s of [1, -1]) {
    looks.push([nx + s * tx, ny + s * ty, nz + s * tz])
    looks.push([nx + s * bx, ny + s * by, nz + s * bz])
  }
  let blocked = 0
  for (const [dx, dy, dz] of looks) {
    const l = Math.hypot(dx, dy, dz)
    const k = REACH / l
    // Just off the surface (so a box never blocks itself), then out.
    const ox = px + nx * 0.02
    const oy = py + ny * 0.02
    const oz = pz + nz * 0.02
    if (grid.solid(ox + dx * k, oy + dy * k, oz + dz * k)) blocked++
    else if (grid.solid(ox + dx * k * 0.4, oy + dy * k * 0.4, oz + dz * k * 0.4)) blocked++
  }
  return 1 - (1 - FLOOR) * (blocked / looks.length)
}

/** Darkens `geometry`'s vertex colours (made white if it has none) by vertexOpenness. */
export function bakeVertexAo(geometry: THREE.BufferGeometry, grid: AabbGrid): void {
  const pos = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  let color = geometry.getAttribute('color')
  if (!color) {
    const white = new Float32Array(pos.count * 3).fill(1)
    geometry.setAttribute('color', new THREE.BufferAttribute(white, 3))
    color = geometry.getAttribute('color')
  }
  for (let i = 0; i < pos.count; i++) {
    const open = vertexOpenness(
      grid,
      [pos.getX(i), pos.getY(i), pos.getZ(i)],
      [normal.getX(i), normal.getY(i), normal.getZ(i)],
    )
    if (open >= 1) continue
    color.setXYZ(i, color.getX(i) * open, color.getY(i) * open, color.getZ(i) * open)
  }
  color.needsUpdate = true
}
