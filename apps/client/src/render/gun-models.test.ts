import { describe, expect, test } from 'bun:test'
import { WeaponId } from '@office-fps/shared'
import * as THREE from 'three'
import { BASE_GUNS } from './base-guns.ts'
import { bake, triangles } from './gun-kit.ts'
import { buildGunModel } from './gun-models.ts'
import { survivalGuns } from './survival-guns.ts'
import type { GunModel } from './viewmodel.ts'

const firstPerson = (): [string, GunModel][] => [
  ...Object.entries(BASE_GUNS).map(([name, build]) => [name, build()] as [string, GunModel]),
  ...Object.entries(survivalGuns()),
]

function bakeModel(m: GunModel): void {
  bake(m.group, [m.action?.part, m.bolt, m.lever, m.pump, m.mag, m.support, m.hinge?.part])
}

const meshes = (o: THREE.Object3D) => {
  let n = 0
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) n++
  })
  return n
}

describe('weapon models', () => {
  test('first-person models stay within their triangle and draw-call budgets', () => {
    for (const [name, model] of firstPerson()) {
      bakeModel(model)
      const tris = triangles(model.group)
      if (tris > 3500 || meshes(model.group) > 24) console.log(name, tris, meshes(model.group))
      expect(tris).toBeLessThanOrEqual(3500)
      expect(meshes(model.group)).toBeLessThanOrEqual(24)
    }
  })

  test('moving parts survive baking, still inside the gun', () => {
    for (const [, model] of firstPerson()) {
      bakeModel(model)
      for (const p of [
        model.action?.part,
        model.mag,
        model.support,
        model.pump,
        model.bolt,
        model.lever,
      ]) {
        if (!p) continue
        let inside = false
        p.traverseAncestors((a) => {
          if (a === model.group) inside = true
        })
        expect(inside).toBe(true)
        expect(meshes(p)).toBeGreaterThan(0)
      }
      expect(model.muzzle.parent).not.toBeNull()
    }
  })

  test('world models are cheap, hand-free and rest on the ground', () => {
    for (const id of Object.values(WeaponId)) {
      const g = buildGunModel(id)
      if (id === WeaponId.Knife || id === WeaponId.Claws) {
        expect(triangles(g)).toBe(0)
        continue
      }
      expect(triangles(g)).toBeGreaterThan(50)
      expect(triangles(g)).toBeLessThanOrEqual(800)
      expect(meshes(g)).toBeLessThanOrEqual(12)
      const bounds = new THREE.Box3().setFromObject(g)
      expect(Math.abs(bounds.min.y)).toBeLessThan(1e-3)
    }
  })
})
