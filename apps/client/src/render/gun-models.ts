import { WeaponId } from '@office-fps/shared'
import * as THREE from 'three'

const STEEL = 0x2b2d33
const FRAME = 0x3a3d45
const WOOD = 0x6b4a2f
const SCOPE = 0x15161a

const materials = new Map<number, THREE.MeshLambertMaterial>()
function material(color: number): THREE.MeshLambertMaterial {
  let m = materials.get(color)
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color })
    materials.set(color, m)
  }
  return m
}

function box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color))
  mesh.position.set(x, y, z)
  mesh.castShadow = false
  return mesh
}

/**
 * Real-size weapon models (no hands) for weapons lying on the floor — and later for players'
 * third-person guns. Origin at the grip, barrel towards -Z, resting on y = 0.
 */
export function buildGunModel(id: WeaponId): THREE.Group {
  const g = new THREE.Group()
  switch (id) {
    case WeaponId.Handgun:
      g.add(
        box(0.032, 0.03, 0.19, STEEL, 0, 0.1, -0.02),
        box(0.03, 0.022, 0.16, FRAME, 0, 0.075, -0.005),
        box(0.028, 0.09, 0.042, FRAME, 0, 0.03, 0.05),
      )
      break
    case WeaponId.Rifle:
      g.add(
        box(0.045, 0.06, 0.3, FRAME, 0, 0.09, 0),
        box(0.05, 0.05, 0.2, STEEL, 0, 0.085, -0.24),
        box(0.018, 0.018, 0.16, STEEL, 0, 0.09, -0.42),
        box(0.03, 0.11, 0.055, STEEL, 0, 0.04, -0.06), // magazine
        box(0.028, 0.07, 0.04, FRAME, 0, 0.035, 0.08), // grip
        box(0.04, 0.07, 0.18, FRAME, 0, 0.07, 0.24), // stock
      )
      break
    case WeaponId.Sniper:
      g.add(
        box(0.04, 0.05, 0.32, STEEL, 0, 0.08, 0),
        box(0.05, 0.055, 0.42, WOOD, 0, 0.05, -0.02),
        box(0.02, 0.02, 0.38, STEEL, 0, 0.085, -0.42),
        box(0.034, 0.034, 0.22, SCOPE, 0, 0.135, -0.02),
        box(0.044, 0.044, 0.03, SCOPE, 0, 0.135, -0.13),
        box(0.045, 0.08, 0.2, WOOD, 0, 0.06, 0.27),
      )
      break
    case WeaponId.Shotgun:
      g.add(
        box(0.05, 0.06, 0.26, STEEL, 0, 0.08, 0), // receiver
        box(0.026, 0.026, 0.46, STEEL, 0, 0.095, -0.34), // barrel
        box(0.022, 0.022, 0.4, FRAME, 0, 0.065, -0.3), // tube magazine
        box(0.05, 0.045, 0.14, WOOD, 0, 0.055, -0.26), // pump
        box(0.05, 0.075, 0.24, WOOD, 0, 0.055, 0.24), // stock
      )
      break
  }
  return g
}
