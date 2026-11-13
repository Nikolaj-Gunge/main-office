import { heightAt, type Terrain } from '@office-fps/shared'
import * as THREE from 'three'
import { wind } from './wind.ts'

/** Leaves in the air around you at once. */
const COUNT = 260
/** They fall in a box this wide around you (m), from this high above the ground. */
const SPREAD = 34
const CEILING = 12

const COLORS = [0x6b3d17, 0x8a5420, 0x4e3a1a, 0x9a7a2a, 0x5c2a14, 0x3f4a1c]

interface Leaf {
  x: number
  y: number
  z: number
  /** Falling speed (m/s), how wide and fast it rocks, its own phase. */
  fall: number
  rock: number
  rate: number
  phase: number
  spin: number
}

/**
 * Dead leaves drifting down out of the dark around you: a few hundred tiny cards that rock
 * side to side as they fall, ride the gusts and settle on the forest floor before starting
 * again somewhere above you. Only your torch and the lamps really show them.
 */
export class Leaves {
  readonly mesh: THREE.InstancedMesh
  private readonly leaves: Leaf[] = []
  private readonly terrain: Terrain
  private readonly matrix = new THREE.Matrix4()
  private readonly quat = new THREE.Quaternion()
  private readonly euler = new THREE.Euler()
  private readonly pos = new THREE.Vector3()
  private readonly scale = new THREE.Vector3(1, 1, 1)
  private started = false

  constructor(terrain: Terrain) {
    this.terrain = terrain
    const geometry = new THREE.PlaneGeometry(0.11, 0.07)
    const material = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide })
    this.mesh = new THREE.InstancedMesh(geometry, material, COUNT)
    this.mesh.name = 'leaves'
    this.mesh.frustumCulled = false
    this.mesh.castShadow = false
    const color = new THREE.Color()
    for (let i = 0; i < COUNT; i++) {
      this.mesh.setColorAt(i, color.setHex(COLORS[i % COLORS.length] as number))
      this.leaves.push({ x: 0, y: 0, z: 0, fall: 0, rock: 0, rate: 0, phase: 0, spin: 0 })
    }
  }

  /** Puts a leaf somewhere around (x, z): anywhere in the air at first, then up at the top. */
  private respawn(leaf: Leaf, x: number, z: number, anywhere: boolean): void {
    leaf.x = x + (Math.random() - 0.5) * SPREAD
    leaf.z = z + (Math.random() - 0.5) * SPREAD
    const ground = heightAt(this.terrain, leaf.x, leaf.z)
    leaf.y = ground + (anywhere ? Math.random() : 0.7 + Math.random() * 0.3) * CEILING
    leaf.fall = 0.35 + Math.random() * 0.45
    leaf.rock = 0.25 + Math.random() * 0.5
    leaf.rate = 1.6 + Math.random() * 1.8
    leaf.phase = Math.random() * Math.PI * 2
    leaf.spin = (Math.random() - 0.5) * 3
  }

  update(dt: number, viewer: THREE.Vector3): void {
    if (!this.started) {
      this.started = true
      for (const leaf of this.leaves) this.respawn(leaf, viewer.x, viewer.z, true)
    }
    const t = wind.time
    const push = 0.3 + wind.gust * 2.2
    const half = SPREAD / 2
    this.leaves.forEach((leaf, i) => {
      // Rock side to side (a falling leaf glides, catches, glides back), drift with the wind.
      const swing = Math.sin(t * leaf.rate + leaf.phase)
      leaf.y -= leaf.fall * (0.6 + 0.6 * Math.abs(swing)) * dt
      leaf.x += (wind.dir.x * push + Math.cos(leaf.phase) * swing * leaf.rock) * dt
      leaf.z += (wind.dir.y * push + Math.sin(leaf.phase) * swing * leaf.rock) * dt
      // Left behind, or landed: start again above you.
      const far = Math.abs(leaf.x - viewer.x) > half || Math.abs(leaf.z - viewer.z) > half
      if (far || leaf.y < heightAt(this.terrain, leaf.x, leaf.z)) {
        this.respawn(leaf, viewer.x, viewer.z, far)
      }
      this.euler.set(
        swing * 0.9,
        t * leaf.spin + leaf.phase,
        Math.cos(t * leaf.rate + leaf.phase) * 0.7,
      )
      this.quat.setFromEuler(this.euler)
      this.matrix.compose(this.pos.set(leaf.x, leaf.y, leaf.z), this.quat, this.scale)
      this.mesh.setMatrixAt(i, this.matrix)
    })
    this.mesh.instanceMatrix.needsUpdate = true
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.mesh.dispose()
  }
}
