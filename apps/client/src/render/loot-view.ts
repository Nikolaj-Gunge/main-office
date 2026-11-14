import type { LootItem } from '@office-fps/shared'
import * as THREE from 'three'
import { ITEM_MATERIAL, itemModel } from './item-models.ts'

/** Loot is drawn merged per square cell this wide (m): one draw call per cell in view. */
const CELL = 16

interface Shown {
  loot: LootItem
  cell: number
}

interface Cell {
  ids: Set<number>
  /** Its corner: the merged mesh's origin (keeps the vertex numbers small). */
  x0: number
  z0: number
  mesh: THREE.Mesh | null
}

function cellOf(x: number, z: number): number {
  return Math.floor((x + 4096) / CELL) * 1024 + Math.floor((z + 4096) / CELL)
}

/** Each thing's own turn, the same every time it's seen. */
function yawOf(id: number): number {
  return (id * 2.399) % (Math.PI * 2)
}

/**
 * Things lying about in the survival world, as the server reports them near you, each as its
 * own little model (item-models.ts). Everything in a cell is welded into one mesh with one
 * material, rebuilt when something there comes or goes: a shop full of tins costs a draw call.
 */
export class LootView {
  private readonly items = new Map<number, Shown>()
  private readonly cells = new Map<number, Cell>()
  private readonly dirty = new Set<number>()
  private readonly scene: THREE.Scene

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  apply(add: readonly LootItem[], remove: readonly number[]): void {
    for (const id of remove) this.remove(id)
    for (const loot of add) {
      this.remove(loot.id)
      const key = cellOf(loot.x, loot.z)
      let cell = this.cells.get(key)
      if (!cell) {
        cell = {
          ids: new Set(),
          x0: Math.floor((loot.x + 4096) / CELL) * CELL - 4096,
          z0: Math.floor((loot.z + 4096) / CELL) * CELL - 4096,
          mesh: null,
        }
        this.cells.set(key, cell)
      }
      cell.ids.add(loot.id)
      this.items.set(loot.id, { loot, cell: key })
      this.dirty.add(key)
    }
    this.flush()
  }

  private remove(id: number): void {
    const shown = this.items.get(id)
    if (!shown) return
    this.items.delete(id)
    this.cells.get(shown.cell)?.ids.delete(id)
    this.dirty.add(shown.cell)
  }

  /** Rebuilds the cells that changed. */
  private flush(): void {
    for (const key of this.dirty) {
      const cell = this.cells.get(key)
      if (!cell) continue
      if (cell.mesh) {
        this.scene.remove(cell.mesh)
        cell.mesh.geometry.dispose()
        cell.mesh = null
      }
      if (cell.ids.size === 0) {
        this.cells.delete(key)
        continue
      }
      cell.mesh = this.build(cell)
      this.scene.add(cell.mesh)
    }
    this.dirty.clear()
  }

  private build(cell: Cell): THREE.Mesh {
    let count = 0
    for (const id of cell.ids) {
      const shown = this.items.get(id)
      if (shown) count += itemModel(shown.loot.item).positions.length / 3
    }
    const positions = new Float32Array(count * 3)
    const normals = new Float32Array(count * 3)
    const uvs = new Float32Array(count * 2)
    let v = 0
    for (const id of cell.ids) {
      const shown = this.items.get(id)
      if (!shown) continue
      const { loot } = shown
      const m = itemModel(loot.item)
      const yaw = yawOf(loot.id)
      const c = Math.cos(yaw)
      const s = Math.sin(yaw)
      // A hair above the surface, so its underside never flickers through the shelf.
      const ox = loot.x - cell.x0
      const oy = loot.y + 0.003
      const oz = loot.z - cell.z0
      const n = m.positions.length / 3
      for (let i = 0; i < n; i++, v++) {
        const x = m.positions[i * 3] ?? 0
        const z = m.positions[i * 3 + 2] ?? 0
        positions[v * 3] = ox + x * c + z * s
        positions[v * 3 + 1] = oy + (m.positions[i * 3 + 1] ?? 0)
        positions[v * 3 + 2] = oz - x * s + z * c
        const nx = m.normals[i * 3] ?? 0
        const nz = m.normals[i * 3 + 2] ?? 0
        normals[v * 3] = nx * c + nz * s
        normals[v * 3 + 1] = m.normals[i * 3 + 1] ?? 0
        normals[v * 3 + 2] = -nx * s + nz * c
      }
      uvs.set(m.uvs, (v - n) * 2)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    const mesh = new THREE.Mesh(geo, ITEM_MATERIAL)
    mesh.position.set(cell.x0, 0, cell.z0)
    mesh.name = 'loot'
    mesh.matrixAutoUpdate = false
    mesh.updateMatrix()
    return mesh
  }

  clear(): void {
    for (const id of [...this.items.keys()]) this.remove(id)
    this.flush()
  }

  /** Drops what's far behind you (the server stops telling you about it without saying so). */
  prune(x: number, z: number, beyond = 320): void {
    for (const [id, shown] of this.items) {
      if (Math.hypot(shown.loot.x - x, shown.loot.z - z) > beyond) this.remove(id)
    }
    this.flush()
  }

  all(): Iterable<{ loot: LootItem }> {
    return this.items.values()
  }
}
