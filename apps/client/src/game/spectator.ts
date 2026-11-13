import type { HitPose } from '@office-fps/shared'
import * as THREE from 'three'

/** Seconds of your own death view before the camera moves over to a teammate. */
const DEATH_VIEW = 1.5
/** Chase camera: this far behind their head (m), a little above it and off to the right. */
const DISTANCE = 2.8
const ABOVE = 0.35
const SHOULDER = 0.5
/** Eye height of someone standing (m, at scale 1). */
const EYE = 1.6
/** How quickly the camera swings round after them (1/s). */
const FOLLOW = 8

/**
 * Dead with teammates still up: after a moment the camera follows one of them over the
 * shoulder (click for the next, right-click for the one before). Hidden while you're alive or
 * when nobody on your team is.
 */
export class Spectator {
  /** Who we're watching, or null. */
  target: number | null = null
  private deadFor = 0
  private step: 1 | -1 | 0 = 0
  private yaw = 0
  private pitch = 0
  private readonly head = new THREE.Vector3()
  private readonly want = new THREE.Vector3()
  private readonly dir = new THREE.Vector3()
  private readonly label: HTMLDivElement

  constructor(parent: HTMLElement) {
    this.label = document.createElement('div')
    this.label.className = 'hud-spectate'
    this.label.hidden = true
    parent.append(this.label)
  }

  get active(): boolean {
    return this.target !== null
  }

  /** Switch to the next (1) or previous (−1) teammate. */
  cycle(step: 1 | -1): void {
    this.step = step
  }

  /**
   * Moves `camera` behind the watched teammate; returns false (camera untouched) when not
   * spectating.
   * @param teammates  ids of your teammates (alive or not)
   * @param poses      everyone alive, as drawn
   * @param reach      how far (m) the camera can go from `from` along `dir` before a wall
   */
  update(
    dt: number,
    alive: boolean,
    teammates: readonly number[],
    poses: ReadonlyMap<number, HitPose>,
    camera: THREE.PerspectiveCamera,
    reach: (from: THREE.Vector3, dir: THREE.Vector3, max: number) => number,
    name: (id: number) => string,
  ): boolean {
    this.deadFor = alive ? 0 : this.deadFor + dt
    const up = teammates.filter((id) => poses.has(id))
    if (alive || this.deadFor < DEATH_VIEW || up.length === 0) return this.stop()

    let i = this.target === null ? -1 : up.indexOf(this.target)
    let snap = i < 0
    if (i < 0) i = 0
    if (this.step !== 0) {
      i = (i + this.step + up.length) % up.length
      this.step = 0
      snap = true
    }
    const id = up[i] as number
    const pose = poses.get(id) as HitPose
    this.target = id

    // Swing round after where they look (the short way), pitch toned down a little.
    const pitch = Math.max(-0.9, Math.min(0.9, (pose.pitch ?? 0) * 0.7))
    if (snap) {
      this.yaw = pose.yaw
      this.pitch = pitch
    } else {
      const k = Math.min(1, dt * FOLLOW)
      let d = (pose.yaw - this.yaw) % (Math.PI * 2)
      if (d > Math.PI) d -= Math.PI * 2
      if (d < -Math.PI) d += Math.PI * 2
      this.yaw += d * k
      this.pitch += (pitch - this.pitch) * k
    }

    const scale = pose.scale ?? 1
    const lying = 1 - 0.75 * (pose.prone ?? 0)
    this.head.set(pose.x, pose.y + EYE * (1 - 0.3 * pose.crouch) * lying * scale + ABOVE, pose.z)
    const cp = Math.cos(this.pitch)
    const fx = -Math.sin(this.yaw) * cp
    const fy = Math.sin(this.pitch)
    const fz = -Math.cos(this.yaw) * cp
    this.want.set(
      this.head.x - fx * DISTANCE + Math.cos(this.yaw) * SHOULDER,
      this.head.y - fy * DISTANCE,
      this.head.z - fz * DISTANCE - Math.sin(this.yaw) * SHOULDER,
    )
    // Pull in when a wall is in the way.
    this.dir.subVectors(this.want, this.head)
    const length = this.dir.length()
    this.dir.divideScalar(length)
    const free = Math.max(0.3, Math.min(length, reach(this.head, this.dir, length) - 0.25))
    camera.position.copy(this.head).addScaledVector(this.dir, free)
    camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ')

    this.label.hidden = false
    const text = `Spectating ${name(id)}${up.length > 1 ? ' · click for the next' : ''}`
    if (this.label.textContent !== text) this.label.textContent = text
    document.body.classList.add('spectating')
    return true
  }

  private stop(): false {
    if (this.target !== null || !this.label.hidden) {
      this.target = null
      this.label.hidden = true
      document.body.classList.remove('spectating')
    }
    return false
  }
}
