import { type Flock, heightAt, type Terrain } from '@office-fps/shared'
import * as THREE from 'three'

/** Flocks are drawn within this of you (m). */
const SHOWN = 110
/** Birds drawn at once (the nearest flocks first fill it). */
const MAX_BIRDS = 160
/** Seconds a scattered flock takes to fly off out of sight. */
const FLIGHT = 6

/**
 * The crows (roadmap 6.2): small black boxes about the woods and fields, pecking at the ground.
 * Come close or fire a shot and they burst up and away (the server says when, and everyone near
 * hears it); a flock that's gone stays gone until the server has it back.
 */
export class BirdsView {
  readonly root = new THREE.Group()
  private readonly bodies: THREE.InstancedMesh
  private readonly heads: THREE.InstancedMesh
  /** Flocks the server says are away. */
  private away = new Set<number>()
  /** Flocks taking off right now: index → seconds since. */
  private readonly flying = new Map<number, number>()
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly e = new THREE.Euler()
  private readonly p = new THREE.Vector3()
  private readonly s = new THREE.Vector3(1, 1, 1)
  private time = 0

  constructor(
    private readonly flocks: readonly Flock[],
    private readonly terrain: Terrain,
  ) {
    const material = new THREE.MeshLambertMaterial({ color: 0x24242a })
    this.bodies = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.16, 0.14, 0.3),
      material,
      MAX_BIRDS,
    )
    this.heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.1, 0.12), material, MAX_BIRDS)
    for (const mesh of [this.bodies, this.heads]) {
      mesh.frustumCulled = false
      mesh.count = 0
      this.root.add(mesh)
    }
  }

  /** The server's list of flocks that are away (SurvivalShared.rot.birds). */
  setAway(away: readonly number[]): void {
    this.away = new Set(away)
  }

  /** A flock took off (a 'birds' sound notice). */
  scatter(i: number): void {
    if (!this.flying.has(i) && !this.away.has(i)) this.flying.set(i, 0)
    this.away.add(i)
  }

  update(dt: number, eye: { x: number; z: number }): void {
    this.time += dt
    let n = 0
    for (const [i, t] of this.flying) {
      if (t > FLIGHT) this.flying.delete(i)
      else this.flying.set(i, t + dt)
    }
    this.flocks.forEach((f, i) => {
      if (n >= MAX_BIRDS) return
      if (Math.abs(f.x - eye.x) > SHOWN || Math.abs(f.z - eye.z) > SHOWN) return
      const flight = this.flying.get(i)
      if (this.away.has(i) && flight === undefined) return
      for (let b = 0; b < f.n && n < MAX_BIRDS; b++, n++) {
        // Each bird has its own spot, heading and peck, from its index.
        const h = Math.sin(i * 12.9898 + b * 78.233) * 43758.5453
        const r = h - Math.floor(h)
        const a = r * Math.PI * 2
        const d = 0.6 + ((r * 7) % 1) * 2.4
        let x = f.x + Math.cos(a) * d
        let z = f.z + Math.sin(a) * d
        // On the ground right there (a flock sits across a slope).
        let y = heightAt(this.terrain, x, z) + 0.07
        let yaw = a * 3
        let pitch = 0
        let wing = 1
        if (flight !== undefined) {
          // Up and away, all roughly the same way, wings beating.
          const away = i * 1.7 + (r - 0.5) * 0.9
          const t = flight
          x += Math.cos(away) * (5 * t + 1.2 * t * t)
          z += Math.sin(away) * (5 * t + 1.2 * t * t)
          y += 2.4 * t + 0.6 * t * t
          yaw = Math.atan2(-Math.cos(away), -Math.sin(away))
          pitch = 0.4
          wing = 1 + 1.6 * Math.abs(Math.sin(this.time * 22 + b))
        } else {
          // Pecking now and then.
          pitch = Math.max(0, Math.sin(this.time * (2 + r * 3) + b * 4)) ** 8 * 0.8
        }
        this.e.set(pitch, yaw, 0, 'YXZ')
        this.q.setFromEuler(this.e)
        this.s.set(wing, 1, 1)
        this.p.set(x, y + 0.07, z)
        this.m.compose(this.p, this.q, this.s)
        this.bodies.setMatrixAt(n, this.m)
        // The head, forward and up a little (and down when it pecks).
        const fx = -Math.sin(yaw)
        const fz = -Math.cos(yaw)
        this.p.set(x + fx * 0.17, y + 0.16 - pitch * 0.12, z + fz * 0.17)
        this.s.set(1, 1, 1)
        this.m.compose(this.p, this.q, this.s)
        this.heads.setMatrixAt(n, this.m)
      }
    })
    this.bodies.count = n
    this.heads.count = n
    this.bodies.instanceMatrix.needsUpdate = true
    this.heads.instanceMatrix.needsUpdate = true
  }
}
