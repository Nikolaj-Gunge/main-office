import { canReach, USE_PICKUP_RADIUS, type WeaponId } from '@office-fps/shared'
import * as THREE from 'three'
import { buildGunModel } from './gun-models.ts'

interface ShownItem {
  weapon: WeaponId
  pos: THREE.Vector3
  root: THREE.Group
  gun: THREE.Group
  phase: number
}

function makeGlowTexture(): THREE.CanvasTexture {
  const size = 32
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  const g = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,214,120,0.9)')
  g.addColorStop(0.5, 'rgba(255,190,80,0.35)')
  g.addColorStop(1, 'rgba(255,170,60,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  return tex
}

/**
 * Weapons lying on the floor, as the server reports them. They hover a little, turn slowly and
 * sit on a warm glow so you can spot them across a room.
 */
export class WorldItemsView {
  private readonly items = new Map<number, ShownItem>()
  private readonly scene: THREE.Scene
  private readonly glowMaterial = new THREE.MeshBasicMaterial({
    map: makeGlowTexture(),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  })
  private readonly glowGeometry = new THREE.PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2)

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  add(id: number, weapon: WeaponId, pos: { x: number; y: number; z: number }, yaw: number): void {
    this.remove(id)
    const root = new THREE.Group()
    root.position.set(pos.x, pos.y, pos.z)
    const glow = new THREE.Mesh(this.glowGeometry, this.glowMaterial)
    glow.position.y = 0.02
    // Spinner turns around the vertical axis; the gun inside lies on its side.
    const spinner = new THREE.Group()
    spinner.rotation.y = yaw
    const gun = buildGunModel(weapon)
    gun.rotation.z = Math.PI / 2
    gun.position.x = 0.06
    spinner.add(gun)
    root.add(glow, spinner)
    this.scene.add(root)
    this.items.set(id, {
      weapon,
      pos: new THREE.Vector3(pos.x, pos.y, pos.z),
      root,
      gun: spinner,
      phase: id,
    })
  }

  remove(id: number): void {
    const item = this.items.get(id)
    if (!item) return
    this.scene.remove(item.root)
    this.items.delete(id)
  }

  clear(): void {
    for (const id of [...this.items.keys()]) this.remove(id)
  }

  /** Positions for the minimap. */
  positions(): { x: number; z: number }[] {
    return [...this.items.values()].map((i) => ({ x: i.pos.x, z: i.pos.z }))
  }

  /** The closest weapon within E range of `feet`, if any. */
  nearestInReach(feet: { x: number; y: number; z: number }): { weapon: WeaponId } | null {
    let best: ShownItem | null = null
    let bestD = Number.POSITIVE_INFINITY
    for (const item of this.items.values()) {
      if (!canReach(feet, item.pos, USE_PICKUP_RADIUS)) continue
      const d = Math.hypot(item.pos.x - feet.x, item.pos.z - feet.z)
      if (d < bestD) {
        bestD = d
        best = item
      }
    }
    return best ? { weapon: best.weapon } : null
  }

  update(dt: number): void {
    for (const item of this.items.values()) {
      item.phase += dt
      item.gun.position.y = 0.12 + Math.sin(item.phase * 2) * 0.04
      item.gun.rotation.y += dt * 0.8
    }
  }
}
