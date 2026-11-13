import { type BoardSpot, plankBoxes, planksFor } from '@office-fps/shared'
import * as THREE from 'three'
import { getSurfaceMaterial } from './textures.ts'

/** What changed at a gap since the last update, for the sounds. */
export interface BoardChange {
  spot: BoardSpot
  /** 'nailed' a plank went up, 'hit' something struck it, 'broke' a plank came off. */
  what: 'nailed' | 'hit' | 'broke'
}

/**
 * The planks nailed across doorways and windows. Told the server's battering-left numbers, it
 * draws the planks each gap has and reports what changed (a plank nailed up, a blow, a plank
 * torn loose) so the right sound can play there.
 */
export class BarricadeView {
  readonly root = new THREE.Group()
  private readonly spots: readonly BoardSpot[]
  private readonly hp = new Map<number, number>()
  private readonly meshes = new Map<number, THREE.Group>()
  /** Old boards, darker and greyer than new floorboards. */
  private readonly material = (() => {
    const m = (getSurfaceMaterial('wood') as THREE.MeshLambertMaterial).clone()
    m.color.setHex(0x8a6c50)
    return m
  })()

  constructor(spots: readonly BoardSpot[]) {
    this.spots = spots
    this.root.name = 'barricades'
  }

  /** Planks across gap i right now. */
  planks(i: number): number {
    return planksFor(this.hp.get(i) ?? 0)
  }

  /** `boards` is the server's flat list: spot index, battering left, … */
  apply(boards: readonly number[]): BoardChange[] {
    const next = new Map<number, number>()
    for (let k = 0; k + 1 < boards.length; k += 2) {
      next.set(boards[k] as number, boards[k + 1] as number)
    }
    const changes: BoardChange[] = []
    for (const i of new Set([...this.hp.keys(), ...next.keys()])) {
      const spot = this.spots[i]
      if (!spot) continue
      const before = this.hp.get(i) ?? 0
      const after = next.get(i) ?? 0
      if (before === after) continue
      const planksBefore = planksFor(before)
      const planksAfter = planksFor(after)
      if (planksAfter > planksBefore) changes.push({ spot, what: 'nailed' })
      else if (planksAfter < planksBefore) changes.push({ spot, what: 'broke' })
      else if (after < before) changes.push({ spot, what: 'hit' })
      if (planksAfter !== planksBefore) this.draw(i, spot, planksAfter)
    }
    this.hp.clear()
    for (const [i, hp] of next) this.hp.set(i, hp)
    return changes
  }

  private draw(i: number, spot: BoardSpot, planks: number): void {
    const old = this.meshes.get(i)
    if (old) {
      this.root.remove(old)
      for (const child of old.children) (child as THREE.Mesh).geometry.dispose()
      this.meshes.delete(i)
    }
    if (planks === 0) return
    const group = new THREE.Group()
    for (const box of plankBoxes(spot, planks)) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...box.size), this.material)
      mesh.position.set(...box.center)
      if (box.rotation) mesh.rotation.set(...box.rotation)
      mesh.castShadow = true
      mesh.receiveShadow = true
      group.add(mesh)
    }
    this.root.add(group)
    this.meshes.set(i, group)
  }

  clear(): void {
    this.apply([])
  }
}
