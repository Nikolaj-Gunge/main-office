import { blendProgress, blendShotAge, type HitPose } from '@office-fps/shared'

export interface HistoryPose extends HitPose {
  alive: boolean
}

/** Shortest-path angle lerp (yaw wraps at 2π). */
function lerpAngle(a: number, b: number, t: number): number {
  return a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t
}

/**
 * Ring buffer of every player's hitbox pose at recent snapshot ticks. When someone fires, the
 * server asks "where was everyone at the moment the shooter saw them?" and tests against that.
 *
 * Interpolates between *snapshot* ticks, exactly like the client does when drawing remote
 * players, so the rewound pose matches what was on the shooter's screen.
 */
export class PoseHistory {
  private readonly frames: { tick: number; poses: Map<number, HistoryPose> }[] = []
  private readonly capacity: number
  private readonly ticksPerFrame: number

  constructor(capacity: number, ticksPerFrame: number) {
    this.capacity = capacity
    this.ticksPerFrame = ticksPerFrame
  }

  record(tick: number, poses: Map<number, HistoryPose>): void {
    this.frames.push({ tick, poses })
    if (this.frames.length > this.capacity) this.frames.shift()
  }

  /** Forgets everything (after a map change, old positions mean nothing). */
  clear(): void {
    this.frames.length = 0
  }

  get oldestTick(): number {
    return this.frames[0]?.tick ?? 0
  }

  /** Pose of player `id` at fractional `tick`, or null if unknown then. */
  poseAt(id: number, tick: number): HistoryPose | null {
    const frames = this.frames
    const newest = frames[frames.length - 1]
    if (!newest) return null
    // Frames are evenly spaced: index arithmetic instead of searching.
    const rel = (tick - (frames[0]?.tick ?? 0)) / this.ticksPerFrame
    const i0 = Math.max(0, Math.min(frames.length - 1, Math.floor(rel)))
    const i1 = Math.min(frames.length - 1, i0 + 1)
    const a = frames[i0]?.poses.get(id)
    const b = frames[i1]?.poses.get(id)
    if (!a || !b) return a ?? b ?? null
    const t = i0 === i1 ? 0 : Math.max(0, Math.min(1, rel - i0))
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
      yaw: lerpAngle(a.yaw, b.yaw, t),
      crouch: a.crouch + (b.crouch - a.crouch) * t,
      alive: t < 0.5 ? a.alive : b.alive,
      pitch: (a.pitch ?? 0) + ((b.pitch ?? 0) - (a.pitch ?? 0)) * t,
      stride:
        ((((a.stride ?? 0) + ((((b.stride ?? 0) - (a.stride ?? 0) + 1.5) % 1) - 0.5) * t) % 1) +
          1) %
        1,
      speed: (a.speed ?? 0) + ((b.speed ?? 0) - (a.speed ?? 0)) * t,
      grounded: (t < 0.5 ? a.grounded : b.grounded) ?? true,
      // The animation extras, blended exactly as clients blend snapshots (interpolation.ts).
      moveDir: lerpAngle(a.moveDir ?? 0, b.moveDir ?? 0, t),
      vy: (a.vy ?? 0) + ((b.vy ?? 0) - (a.vy ?? 0)) * t,
      land: (a.land ?? 0) + ((b.land ?? 0) - (a.land ?? 0)) * t,
      ads: (a.ads ?? 0) + ((b.ads ?? 0) - (a.ads ?? 0)) * t,
      shotAge: blendShotAge(a.shotAge ?? 1, b.shotAge ?? 1, t),
      prone: (a.prone ?? 0) + ((b.prone ?? 0) - (a.prone ?? 0)) * t,
      slide: blendProgress(a.slide ?? 0, b.slide ?? 0, t, -1),
      mantle: blendProgress(a.mantle ?? 0, b.mantle ?? 0, t, 1),
      ledge: !a.mantle
        ? (b.ledge ?? 0)
        : !b.mantle
          ? (a.ledge ?? 0)
          : (a.ledge ?? 0) + ((b.ledge ?? 0) - (a.ledge ?? 0)) * t,
      windup: blendProgress(a.windup ?? 0, b.windup ?? 0, t, 1),
      ...(b.weapon !== undefined ? { weapon: b.weapon } : {}),
      ...(b.gait !== undefined ? { gait: b.gait } : {}),
      ...(b.seed !== undefined ? { seed: b.seed } : {}),
    }
  }
}
