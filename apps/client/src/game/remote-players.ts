import {
  type HitPose,
  InterpolationBuffer,
  type RemotePlayerState,
  ServerClock,
  TICK_RATE,
} from '@office-fps/shared'
import * as THREE from 'three'
import { Avatar } from '../render/avatar.ts'

interface Remote {
  name: string
  color: number
  avatar: Avatar
  buffer: InterpolationBuffer
  /** Last interpolated state drawn on screen. */
  shown: RemotePlayerState | null
  /** Distance walked since the last footstep (m). */
  stride: number
  wasGrounded: boolean
}

/** Same stride as your own footsteps (CameraFeel) so everyone sounds alike. */
const STRIDE = 1.9
/** Below this speed (crouch-walking is 2.4 m/s) you move silently — sneaking is a tactic. */
const SILENT_SPEED = 2.8

/** Everyone else: roster, snapshot buffers and avatars drawn slightly in the past. */
export class RemotePlayers {
  readonly clock = new ServerClock(TICK_RATE)
  /** How far behind the server we draw others (ms). Must exceed the snapshot interval + jitter. */
  interpDelayMs = 100
  /**
   * Server tick the remote players on screen correspond to. Sent with every input so the server
   * can rewind to exactly what you were looking at when you fired.
   */
  renderTick = 0
  private readonly players = new Map<number, Remote>()
  private readonly scene: THREE.Scene
  private lastUpdateMs = 0
  /** Someone else's footstep (derived from their movement, no network traffic needed). */
  onFootstep?: (at: THREE.Vector3, sprinting: boolean) => void
  onLand?: (at: THREE.Vector3) => void

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  get count(): number {
    return this.players.size
  }

  add(id: number, name: string, color: number): void {
    this.remove(id)
    const avatar = new Avatar(name, color)
    avatar.root.visible = false // until the first snapshot places it
    this.scene.add(avatar.root)
    this.players.set(id, {
      name,
      color,
      avatar,
      buffer: new InterpolationBuffer(),
      shown: null,
      stride: 0,
      wasGrounded: true,
    })
  }

  remove(id: number): void {
    const p = this.players.get(id)
    if (!p) return
    this.scene.remove(p.avatar.root)
    p.avatar.dispose()
    this.players.delete(id)
  }

  clear(): void {
    for (const id of [...this.players.keys()]) this.remove(id)
  }

  onSnapshot(tick: number, states: RemotePlayerState[], nowMs: number): void {
    this.clock.onSnapshot(tick, nowMs)
    for (const s of states) this.players.get(s.id)?.buffer.push(tick, s)
  }

  /** @param viewer your eye position (for directional effects like the scope glint) */
  update(nowMs: number, viewer?: THREE.Vector3): void {
    if (!this.clock.isSynced) return
    this.renderTick = this.clock.tick(nowMs) - (this.interpDelayMs * TICK_RATE) / 1000
    const dt = Math.min(0.1, (nowMs - this.lastUpdateMs) / 1000)
    this.lastUpdateMs = nowMs
    for (const p of this.players.values()) {
      const before = p.shown
      p.shown = p.buffer.sample(this.renderTick)
      p.avatar.root.visible = p.shown?.alive ?? false
      if (p.shown) p.avatar.update(p.shown, nowMs, viewer)
      if (before && p.shown && dt > 0) this.detectSteps(p, before, p.shown, dt)
    }
  }

  private detectSteps(p: Remote, a: RemotePlayerState, b: RemotePlayerState, dt: number): void {
    const moved = Math.hypot(b.x - a.x, b.z - a.z)
    const at = () => new THREE.Vector3(b.x, b.y + 0.05, b.z)
    if (!b.alive || moved > 3) {
      // Dead, or a respawn teleport: not a step.
      p.stride = 0
      p.wasGrounded = b.grounded
      return
    }
    if (b.grounded && !p.wasGrounded) this.onLand?.(at())
    p.wasGrounded = b.grounded
    const speed = moved / dt
    if (!b.grounded || speed < SILENT_SPEED) return
    p.stride += moved
    if (p.stride >= STRIDE) {
      p.stride -= STRIDE
      this.onFootstep?.(at(), speed > 6)
    }
  }

  /** Hit poses of every living player as currently drawn (for local tracer ends and F4 debug). */
  visiblePoses(): Map<number, HitPose> {
    const poses = new Map<number, HitPose>()
    for (const [id, p] of this.players) {
      const s = p.shown
      if (s?.alive) poses.set(id, { x: s.x, y: s.y, z: s.z, yaw: s.yaw, crouch: s.crouch })
    }
    return poses
  }

  /** Where player `id`'s gun is on screen, or null if unknown. */
  muzzleOf(id: number): THREE.Vector3 | null {
    const p = this.players.get(id)
    return p?.shown ? p.avatar.muzzleWorld(new THREE.Vector3()) : null
  }

  nameOf(id: number): string | undefined {
    return this.players.get(id)?.name
  }

  colorOf(id: number): number | undefined {
    return this.players.get(id)?.color
  }
}
