import type { MapBox, MapDef, MapLight, MaterialId } from '@office-fps/shared'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { buildCorn } from './corn.ts'
import { createLabel } from './labels.ts'
import { castsShadow, getSurfaceMaterial, isTransparent } from './textures.ts'
import { lampSwing } from './wind.ts'

/**
 * World-space planar UVs: each face is projected on its dominant axis, so the 1 m texture grid
 * lines up across every box in the map (and reads as a ruler).
 */
function applyWorldUVs(geometry: THREE.BufferGeometry): void {
  const pos = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const uv = geometry.getAttribute('uv')
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(normal.getX(i))
    const ny = Math.abs(normal.getY(i))
    const nz = Math.abs(normal.getZ(i))
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    if (ny >= nx && ny >= nz) uv.setXY(i, x, z)
    else if (nx >= nz) uv.setXY(i, z, y)
    else uv.setXY(i, x, y)
  }
  uv.needsUpdate = true
}

/** How far a later box's face is pushed out per earlier box it would be coplanar with (m). */
const LAYER_STEP = 0.008

type Bounds = { min: [number, number, number]; max: [number, number, number] }

/**
 * Render bounds for every box, with z-fighting resolved: where a box's face lies in the same
 * plane as an overlapping, earlier box's face pointing the same way (a carpet over a wood
 * floor, a stripe on a container), the later box — the detail — is pushed out a few mm so it
 * always wins instead of flickering. Visual only: collision uses the map boxes as they are.
 */
export function renderBounds(map: MapDef): (Bounds | null)[] {
  const raw = map.boxes.map((box): Bounds | null => {
    if (box.render === false || box.rotation) return null
    const [cx, cy, cz] = box.center
    const [sx, sy, sz] = box.size
    return {
      min: [cx - sx / 2, cy - sy / 2, cz - sz / 2],
      max: [cx + sx / 2, cy + sy / 2, cz + sz / 2],
    }
  })
  const out: (Bounds | null)[] = []
  const overlaps = (a: Bounds, b: Bounds, axis: number) =>
    [0, 1, 2].every(
      (k) =>
        k === axis ||
        Math.min(a.max[k] ?? 0, b.max[k] ?? 0) - Math.max(a.min[k] ?? 0, b.min[k] ?? 0) > 1e-3,
    )
  // Only boxes that are close can share a plane: look them up in a coarse x/z grid instead of
  // comparing every box with every other (the survival world has thousands).
  const GRID = 24
  const grid = new Map<number, number[]>()
  const everywhere: number[] = []
  const cells = (b: Bounds): number[] | null => {
    const x0 = Math.floor((b.min[0] - 0.1) / GRID)
    const x1 = Math.floor((b.max[0] + 0.1) / GRID)
    const z0 = Math.floor((b.min[2] - 0.1) / GRID)
    const z1 = Math.floor((b.max[2] + 0.1) / GRID)
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > 64) return null
    const keys: number[] = []
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) keys.push(x * 100003 + z)
    return keys
  }
  /** Indices of placed boxes that may touch `b`. */
  const near = (b: Bounds): number[] => {
    const keys = cells(b)
    if (!keys) return out.flatMap((o, j) => (o ? [j] : []))
    const found = new Set<number>(everywhere)
    for (const key of keys) for (const j of grid.get(key) ?? []) found.add(j)
    return [...found]
  }
  const place = (i: number, b: Bounds) => {
    const keys = cells(b)
    if (!keys) everywhere.push(i)
    else for (const key of keys) grid.set(key, [...(grid.get(key) ?? []), i])
  }
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i]
    if (!a) {
      out.push(null)
      continue
    }
    const o: Bounds = { min: [...a.min], max: [...a.max] }
    const material = map.boxes[i]?.material
    const candidates = near(o).filter((j) => map.boxes[j]?.material !== material)
    // Two passes: pushing one axis out can create an overlap across another.
    for (let pass = 0; pass < 6 && candidates.length > 0; pass++) {
      const axis = pass % 3
      // Earlier, already-placed boxes this one overlaps across this axis's faces.
      const others: Bounds[] = []
      for (const j of candidates) {
        const b = out[j]
        if (b && overlaps(o, b, axis)) others.push(b)
      }
      // Step each face outwards until no earlier face shares its plane.
      for (const side of ['max', 'min'] as const) {
        const dir = side === 'max' ? 1 : -1
        let value = o[side][axis] ?? 0
        while (others.some((b) => Math.abs((b[side][axis] ?? 0) - value) < 1e-3)) {
          value += dir * LAYER_STEP
        }
        o[side][axis] = value
      }
    }
    out.push(o)
    place(i, o)
  }

  // Glass is drawn from both sides, so a pane resting on a frame (its bottom touching the
  // frame's top) fights too: pull such glass faces back from whatever they touch.
  for (let i = 0; i < out.length; i++) {
    const o = out[i]
    const material = map.boxes[i]?.material
    if (!o || !material || !isTransparent(material)) continue
    const candidates = near(o)
    for (let axis = 0; axis < 3; axis++) {
      for (const j of candidates) {
        const b = out[j]
        if (j === i || !b || !overlaps(o, b, axis)) continue
        if (Math.abs((o.min[axis] ?? 0) - (b.max[axis] ?? 0)) < 1e-3) {
          o.min[axis] = (o.min[axis] ?? 0) + LAYER_STEP
        }
        if (Math.abs((o.max[axis] ?? 0) - (b.min[axis] ?? 0)) < 1e-3) {
          o.max[axis] = (o.max[axis] ?? 0) - LAYER_STEP
        }
      }
    }
  }
  return out
}

/**
 * Builds the static map: one merged mesh per material (few draw calls) plus labels. Gates
 * (co-op maps) get their own group each, named `gate:<id>`, so they can be hidden when open.
 */
export function buildMapObject(map: MapDef): THREE.Group {
  const group = new THREE.Group()
  group.name = `map:${map.id}`

  const byMaterial = new Map<MaterialId, THREE.BufferGeometry[]>()
  const gates = new Map<number, Map<MaterialId, THREE.BufferGeometry[]>>()
  const swings = new Map<number, Map<MaterialId, THREE.BufferGeometry[]>>()
  const matrix = new THREE.Matrix4()
  const quaternion = new THREE.Quaternion()
  const euler = new THREE.Euler()

  const bounds = renderBounds(map)
  const corn: MapBox[] = []
  map.boxes.forEach((box, i) => {
    if (box.render === false) return
    if (box.material === 'corn') {
      corn.push(box)
      return
    }
    const b = bounds[i]
    // Axis-aligned boxes use the z-fight-resolved bounds; rotated ones are drawn as they are.
    const size: [number, number, number] = b
      ? [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]]
      : [...box.size]
    const center: [number, number, number] = b
      ? [(b.max[0] + b.min[0]) / 2, (b.max[1] + b.min[1]) / 2, (b.max[2] + b.min[2]) / 2]
      : [...box.center]
    const geometry = new THREE.BoxGeometry(...size)
    euler.set(...(box.rotation ?? [0, 0, 0]))
    quaternion.setFromEuler(euler)
    matrix.compose(new THREE.Vector3(...center), quaternion, new THREE.Vector3(1, 1, 1))
    geometry.applyMatrix4(matrix)
    applyWorldUVs(geometry)
    let target = byMaterial
    if (box.gate !== undefined) {
      target = gates.get(box.gate) ?? new Map()
      gates.set(box.gate, target)
    } else if (box.swing !== undefined && map.lights?.[box.swing]?.hang) {
      target = swings.get(box.swing) ?? new Map()
      swings.set(box.swing, target)
    }
    const list = target.get(box.material) ?? []
    list.push(geometry)
    target.set(box.material, list)
  })

  const addMerged = (parent: THREE.Group, meshes: Map<MaterialId, THREE.BufferGeometry[]>) => {
    for (const [material, geometries] of meshes) {
      const merged = mergeGeometries(geometries)
      for (const g of geometries) g.dispose()
      const mesh = new THREE.Mesh(merged, getSurfaceMaterial(material))
      mesh.name = `surface:${material}`
      mesh.castShadow = castsShadow(material)
      mesh.receiveShadow = !isTransparent(material)
      // Glass after everything opaque so you see what's behind it.
      if (isTransparent(material)) mesh.renderOrder = 1
      parent.add(mesh)
    }
  }
  addMerged(group, byMaterial)
  for (const [id, meshes] of gates) {
    const gate = new THREE.Group()
    gate.name = `gate:${id}`
    addMerged(gate, meshes)
    group.add(gate)
  }

  // Hanging lamps: their own group each, pivoting where the cord is tied (see swingLamps).
  const lamps: THREE.Group[] = []
  for (const [index, meshes] of swings) {
    const light = map.lights?.[index] as MapLight
    const hang = light.hang ?? 0
    const pivot = new THREE.Vector3(light.pos[0], light.pos[1] + hang, light.pos[2])
    for (const list of meshes.values()) {
      for (const g of list) g.translate(-pivot.x, -pivot.y, -pivot.z)
    }
    const lamp = new THREE.Group()
    lamp.name = `swing:${index}`
    lamp.position.copy(pivot)
    lamp.userData.swing = { index, hang }
    addMerged(lamp, meshes)
    group.add(lamp)
    lamps.push(lamp)
  }
  group.userData.lamps = lamps

  const field = buildCorn(corn)
  if (field) group.add(field)

  for (const label of map.labels) {
    const sprite = createLabel(label.text)
    sprite.position.set(...label.pos)
    group.add(sprite)
  }

  return group
}

/** Swings the map's hanging lamps (built by buildMapObject) to the wind at time t. */
export function swingLamps(mapObject: THREE.Object3D, t: number, outdoors: boolean): void {
  for (const lamp of (mapObject.userData.lamps ?? []) as THREE.Group[]) {
    const { index, hang } = lamp.userData.swing as { index: number; hang: number }
    lampSwing(index, hang, t, outdoors, lamp.rotation)
  }
}
