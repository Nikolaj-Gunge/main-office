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
}

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
    this.players.set(id, { name, color, avatar, buffer: new InterpolationBuffer(), shown: null })
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

  update(nowMs: number): void {
    if (!this.clock.isSynced) return
    this.renderTick = this.clock.tick(nowMs) - (this.interpDelayMs * TICK_RATE) / 1000
    for (const p of this.players.values()) {
      p.shown = p.buffer.sample(this.renderTick)
      p.avatar.root.visible = p.shown?.alive ?? false
      if (p.shown) p.avatar.update(p.shown, nowMs)
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
}
