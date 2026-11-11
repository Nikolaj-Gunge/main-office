import {
  InterpolationBuffer,
  type RemotePlayerState,
  ServerClock,
  TICK_RATE,
} from '@office-fps/shared'
import type * as THREE from 'three'
import { Avatar } from '../render/avatar.ts'

interface Remote {
  name: string
  color: number
  avatar: Avatar
  buffer: InterpolationBuffer
}

/** Everyone else: roster, snapshot buffers and avatars drawn slightly in the past. */
export class RemotePlayers {
  readonly clock = new ServerClock(TICK_RATE)
  /** How far behind the server we draw others (ms). Must exceed the snapshot interval + jitter. */
  interpDelayMs = 100
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
    this.players.set(id, { name, color, avatar, buffer: new InterpolationBuffer() })
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
    const renderTick = this.clock.tick(nowMs) - (this.interpDelayMs * TICK_RATE) / 1000
    for (const p of this.players.values()) {
      const s = p.buffer.sample(renderTick)
      p.avatar.root.visible = s !== null
      if (s) p.avatar.update(s)
    }
  }
}
