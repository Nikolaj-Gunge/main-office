import type { RemotePlayerState } from '../protocol/messages.ts'
import { blendShotAge } from '../sim/skeleton.ts'

interface Sample {
  tick: number
  state: RemotePlayerState
}

/** Shortest-path angle lerp (yaw wraps at 2π). */
function lerpAngle(a: number, b: number, t: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a))
  return a + d * t
}

/** Max ticks to extrapolate past the newest snapshot before freezing (covers a late packet). */
const MAX_EXTRAPOLATE_TICKS = 6

/**
 * Buffer of snapshots for one remote player. Rendering happens slightly in the past (the
 * interpolation delay) so there are almost always two known states to blend between — remote
 * players then move smoothly even though snapshots only arrive 30 times a second.
 */
export class InterpolationBuffer {
  private samples: Sample[] = []

  push(tick: number, state: RemotePlayerState): void {
    const last = this.samples[this.samples.length - 1]
    if (last && tick <= last.tick) return // duplicate or out of order
    this.samples.push({ tick, state })
    if (this.samples.length > 64) this.samples.shift()
  }

  get newestTick(): number {
    return this.samples[this.samples.length - 1]?.tick ?? -1
  }

  /** State at fractional server tick `renderTick`, or null if nothing received yet. */
  sample(renderTick: number): RemotePlayerState | null {
    const samples = this.samples
    const first = samples[0]
    if (!first) return null
    if (renderTick <= first.tick) return first.state

    for (let i = samples.length - 1; i > 0; i--) {
      const a = samples[i - 1]
      const b = samples[i]
      if (a && b && renderTick >= a.tick) {
        const span = b.tick - a.tick
        // Past the newest sample: keep moving a little (velocity of the last segment), then hold.
        const t = Math.min((renderTick - a.tick) / span, 1 + MAX_EXTRAPOLATE_TICKS / span)
        // Drop samples we'll never need again.
        if (i > 2) this.samples = samples.slice(i - 2)
        return blend(a.state, b.state, t)
      }
    }
    return samples[samples.length - 1]?.state ?? null
  }
}

function blend(a: RemotePlayerState, b: RemotePlayerState, t: number): RemotePlayerState {
  const lerp = (x: number, y: number) => x + (y - x) * t
  return {
    id: b.id,
    x: lerp(a.x, b.x),
    y: lerp(a.y, b.y),
    z: lerp(a.z, b.z),
    yaw: lerpAngle(a.yaw, b.yaw, t),
    pitch: lerp(a.pitch, b.pitch),
    crouch: Math.max(0, Math.min(1, lerp(a.crouch, b.crouch))),
    grounded: t < 0.5 ? a.grounded : b.grounded,
    alive: b.alive,
    protected: b.protected,
    weapon: b.weapon,
    aiming: b.aiming,
    // Walk cycle wraps at 1: go the short way round.
    stride: (((a.stride + (((b.stride - a.stride + 1.5) % 1) - 0.5) * t) % 1) + 1) % 1,
    speed: lerp(a.speed, b.speed),
    moveDir: lerpAngle(a.moveDir, b.moveDir, t),
    vy: lerp(a.vy, b.vy),
    land: lerp(a.land, b.land),
    ads: lerp(a.ads, b.ads),
    shotAge: blendShotAge(a.shotAge, b.shotAge, t),
    ...(b.light ? { light: true } : {}),
  }
}

/**
 * Estimates the server's current tick from snapshot arrivals. Smoothed so one late packet
 * doesn't jerk every remote player; re-syncs instantly after a big jump (reconnect, stall).
 */
export class ServerClock {
  private readonly tickRate: number
  private offset = 0
  private synced = false

  constructor(tickRate: number) {
    this.tickRate = tickRate
  }

  onSnapshot(tick: number, nowMs: number): void {
    const sample = tick - (nowMs * this.tickRate) / 1000
    if (!this.synced || Math.abs(sample - this.offset) > this.tickRate / 2) {
      this.offset = sample
      this.synced = true
      return
    }
    // Lean towards the earliest arrivals (least delayed) but follow slowly.
    this.offset += (sample - this.offset) * (sample > this.offset ? 0.2 : 0.02)
  }

  get isSynced(): boolean {
    return this.synced
  }

  /** Fractional server tick right now. */
  tick(nowMs: number): number {
    return (nowMs * this.tickRate) / 1000 + this.offset
  }
}
