import { WeaponId } from '@office-fps/shared'
import * as THREE from 'three'
import { BASE_GUNS } from './base-guns.ts'
import { survivalWorldModel, worldModel } from './survival-guns.ts'

const BASE: Partial<Record<WeaponId, () => THREE.Object3D>> = {
  [WeaponId.Handgun]: () => BASE_GUNS.handgun().group,
  [WeaponId.Rifle]: () => BASE_GUNS.rifle().group,
  [WeaponId.Sniper]: () => BASE_GUNS.sniper().group,
  [WeaponId.Shotgun]: () => BASE_GUNS.shotgun().group,
  [WeaponId.Smg]: () => BASE_GUNS.mp5().group,
  [WeaponId.Lmg]: () => BASE_GUNS.lmg().group,
}

/** One prototype per weapon; every model handed out is a clone sharing its geometry. */
const prototypes = new Map<WeaponId, THREE.Group>()

function prototype(id: WeaponId): THREE.Group | null {
  if (id === WeaponId.Knife || id === WeaponId.Claws) return null // never lie around
  const base = BASE[id]
  return base ? worldModel(base, false) : survivalWorldModel(id)
}

/**
 * Real-size weapon models (no hands) for weapons lying on the floor and in players' hands: the
 * first-person models at world detail. Origin at the grip, barrel towards -Z, resting on y = 0.
 * The returned group is the caller's; its geometry and materials are shared (don't dispose them).
 */
export function buildGunModel(id: WeaponId): THREE.Group {
  let proto = prototypes.get(id)
  if (!proto) {
    proto = prototype(id) ?? new THREE.Group()
    prototypes.set(id, proto)
  }
  return proto.clone()
}
