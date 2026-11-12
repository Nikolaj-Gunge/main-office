import type { CoopZone } from '@office-fps/shared'
import * as THREE from 'three'

/**
 * The current co-op goal area, marked in the world: a glowing patch on the floor with a frame
 * of light round it, gently pulsing. Hidden for goals without an area (kill goals).
 */
export class CoopZoneMarker {
  readonly root = new THREE.Group()
  private readonly floor: THREE.Mesh
  private readonly frame: THREE.LineSegments
  private readonly floorMaterial = new THREE.MeshBasicMaterial({
    color: 0x8fd14f,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    fog: false,
  })
  private readonly frameMaterial = new THREE.LineBasicMaterial({
    color: 0xa8f060,
    transparent: true,
    opacity: 0.9,
    fog: false,
  })
  private time = 0

  constructor() {
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.floorMaterial)
    this.floor.rotation.x = -Math.PI / 2
    this.frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      this.frameMaterial,
    )
    this.root.add(this.floor, this.frame)
    this.root.visible = false
  }

  set(zone: CoopZone | null): void {
    this.root.visible = zone !== null
    if (!zone) return
    const [x0, y0, z0] = zone.min
    const [x1, , z1] = zone.max
    const w = x1 - x0
    const d = z1 - z0
    this.floor.scale.set(w, d, 1)
    this.floor.position.set((x0 + x1) / 2, y0 + 0.03, (z0 + z1) / 2)
    this.frame.scale.set(w, 2.2, d)
    this.frame.position.set((x0 + x1) / 2, y0 + 1.1, (z0 + z1) / 2)
  }

  /** The goal's centre (for the waypoint), or null. */
  centre(target: THREE.Vector3): THREE.Vector3 | null {
    if (!this.root.visible) return null
    return target.copy(this.floor.position).setY(this.floor.position.y + 1.2)
  }

  update(dt: number): void {
    this.time += dt
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 3)
    this.floorMaterial.opacity = 0.1 + 0.15 * pulse
    this.frameMaterial.opacity = 0.5 + 0.4 * pulse
  }
}
