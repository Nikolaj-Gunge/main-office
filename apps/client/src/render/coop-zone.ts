import type { CoopZone } from '@office-fps/shared'
import * as THREE from 'three'

/**
 * The current co-op goal areas, marked in the world: a glowing patch on the floor with a frame
 * of light round it, gently pulsing. One for most goals, several for activate goals (spots
 * already done disappear), none for kill and survive goals.
 */
export class CoopZoneMarker {
  readonly root = new THREE.Group()
  private readonly marks: THREE.Group[] = []
  private readonly floorGeometry = new THREE.PlaneGeometry(1, 1)
  private readonly frameGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1))
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

  set(zones: readonly CoopZone[]): void {
    while (this.marks.length < zones.length) {
      const floor = new THREE.Mesh(this.floorGeometry, this.floorMaterial)
      floor.rotation.x = -Math.PI / 2
      floor.name = 'floor'
      const frame = new THREE.LineSegments(this.frameGeometry, this.frameMaterial)
      frame.name = 'frame'
      const mark = new THREE.Group()
      mark.add(floor, frame)
      this.marks.push(mark)
      this.root.add(mark)
    }
    this.marks.forEach((mark, i) => {
      const zone = zones[i]
      mark.visible = zone !== undefined
      if (!zone) return
      const [x0, y0, z0] = zone.min
      const [x1, , z1] = zone.max
      const w = x1 - x0
      const d = z1 - z0
      mark.position.set((x0 + x1) / 2, y0, (z0 + z1) / 2)
      const floor = mark.getObjectByName('floor')
      const frame = mark.getObjectByName('frame')
      floor?.scale.set(w, d, 1)
      floor?.position.set(0, 0.03, 0)
      frame?.scale.set(w, 2.2, d)
      frame?.position.set(0, 1.1, 0)
    })
  }

  /** The centre of the marked area nearest `from` (for the waypoint), or null. */
  centre(target: THREE.Vector3, from: THREE.Vector3): THREE.Vector3 | null {
    let best = Number.POSITIVE_INFINITY
    let found = false
    for (const mark of this.marks) {
      if (!mark.visible) continue
      const d = mark.position.distanceToSquared(from)
      if (d >= best) continue
      best = d
      found = true
      target.copy(mark.position).setY(mark.position.y + 1.2)
    }
    return found ? target : null
  }

  update(dt: number): void {
    this.time += dt
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 3)
    this.floorMaterial.opacity = 0.1 + 0.15 * pulse
    this.frameMaterial.opacity = 0.5 + 0.4 * pulse
  }
}
