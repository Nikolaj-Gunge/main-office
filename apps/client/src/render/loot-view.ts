import { ITEMS, type ItemKind, type LootItem } from '@office-fps/shared'
import * as THREE from 'three'
import { buildGunModel } from './gun-models.ts'

/** What each kind of thing looks like lying about: size (w, h, d in metres) and colour. */
const LOOK: Record<ItemKind, { size: [number, number, number]; color: number }> = {
  weapon: { size: [0.3, 0.08, 0.1], color: 0x8a8f98 },
  ammo: { size: [0.16, 0.09, 0.11], color: 0xc9a23a },
  food: { size: [0.11, 0.14, 0.11], color: 0xc45a3a },
  drink: { size: [0.09, 0.24, 0.09], color: 0x4f9fd8 },
  med: { size: [0.22, 0.1, 0.16], color: 0xe8e8e8 },
  pack: { size: [0.38, 0.46, 0.24], color: 0x5f7a3a },
  tool: { size: [0.12, 0.07, 0.08], color: 0xd8c24a },
  junk: { size: [0.18, 0.1, 0.14], color: 0x8a8378 },
  quest: { size: [0.2, 0.12, 0.16], color: 0xf0c040 },
  money: { size: [0.16, 0.04, 0.08], color: 0x5fae5a },
}

const geometry = new Map<ItemKind, THREE.BoxGeometry>()
const material = new Map<ItemKind, THREE.MeshBasicMaterial>()

interface Shown {
  loot: LootItem
  root: THREE.Object3D
}

/**
 * Things lying about in the survival world, as the server reports them near you. They are
 * faintly self-lit — just enough to be found in the dark when you look for them.
 */
export class LootView {
  private readonly items = new Map<number, Shown>()
  private readonly scene: THREE.Scene

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  apply(add: readonly LootItem[], remove: readonly number[]): void {
    for (const id of remove) this.remove(id)
    for (const loot of add) {
      this.remove(loot.id)
      const def = ITEMS[loot.item]
      const kind = def?.kind ?? 'junk'
      let root: THREE.Object3D
      if (def?.weapon !== undefined) {
        root = buildGunModel(def.weapon)
        root.rotation.z = Math.PI / 2
        root.position.set(loot.x, loot.y + 0.03, loot.z)
      } else {
        const look = LOOK[kind]
        let g = geometry.get(kind)
        if (!g) {
          g = new THREE.BoxGeometry(...look.size)
          geometry.set(kind, g)
        }
        let m = material.get(kind)
        if (!m) {
          // Dim on purpose: it reads as an object catching a little light, not as a lamp.
          m = new THREE.MeshBasicMaterial({
            color: new THREE.Color(look.color).multiplyScalar(0.55),
          })
          material.set(kind, m)
        }
        root = new THREE.Mesh(g, m)
        root.position.set(loot.x, loot.y + look.size[1] / 2, loot.z)
      }
      root.rotation.y = (loot.id * 2.399) % (Math.PI * 2)
      this.scene.add(root)
      this.items.set(loot.id, { loot, root })
    }
  }

  private remove(id: number): void {
    const shown = this.items.get(id)
    if (!shown) return
    this.scene.remove(shown.root)
    this.items.delete(id)
  }

  clear(): void {
    for (const id of [...this.items.keys()]) this.remove(id)
  }

  /** Drops what's far behind you (the server stops telling you about it without saying so). */
  prune(x: number, z: number, beyond = 320): void {
    for (const [id, shown] of this.items) {
      if (Math.hypot(shown.loot.x - x, shown.loot.z - z) > beyond) this.remove(id)
    }
  }

  all(): Iterable<Shown> {
    return this.items.values()
  }
}
