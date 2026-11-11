import type { MapDef, MaterialId } from '@office-fps/shared'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { createLabel } from './labels.ts'
import { getSurfaceMaterial } from './textures.ts'

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

/** Builds the static map: one merged mesh per material (few draw calls) plus labels. */
export function buildMapObject(map: MapDef): THREE.Group {
  const group = new THREE.Group()
  group.name = `map:${map.id}`

  const byMaterial = new Map<MaterialId, THREE.BufferGeometry[]>()
  const matrix = new THREE.Matrix4()
  const quaternion = new THREE.Quaternion()
  const euler = new THREE.Euler()

  for (const box of map.boxes) {
    const geometry = new THREE.BoxGeometry(...box.size)
    euler.set(...(box.rotation ?? [0, 0, 0]))
    quaternion.setFromEuler(euler)
    matrix.compose(new THREE.Vector3(...box.center), quaternion, new THREE.Vector3(1, 1, 1))
    geometry.applyMatrix4(matrix)
    applyWorldUVs(geometry)
    const list = byMaterial.get(box.material) ?? []
    list.push(geometry)
    byMaterial.set(box.material, list)
  }

  for (const [material, geometries] of byMaterial) {
    const merged = mergeGeometries(geometries)
    for (const g of geometries) g.dispose()
    const mesh = new THREE.Mesh(merged, getSurfaceMaterial(material))
    mesh.name = `surface:${material}`
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }

  for (const label of map.labels) {
    const sprite = createLabel(label.text)
    sprite.position.set(...label.pos)
    group.add(sprite)
  }

  return group
}
