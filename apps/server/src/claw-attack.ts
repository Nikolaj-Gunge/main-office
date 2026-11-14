import { TICK_DT, ZombieKind } from '@office-fps/shared'

/** How one kind of zombie attacks: the tell before the blow, and how long a miss leaves it open. */
export interface ClawTiming {
  /** Seconds of wind-up (arms up, leaning back) before the claws come down. */
  windup: number
  /** Seconds it stands there, off balance, after clawing at nothing. */
  recover: number
  /** How fast it can still turn after you while winding up (radians a second). */
  track: number
}

/**
 * Most of the dead telegraph their blows: step back or sidestep during the wind-up and they
 * claw at air, then stand there long enough to be knifed. Runners and stalkers barely wind up
 * at all (and keep turning after you), so they stay dangerous; a brute's blow is slow to come
 * but there's no mistaking it. You see a wind-up late (your ping plus the ~0.1 s remote players
 * are drawn behind) and your step reaches the server late too, so a walker's 0.65 s leaves
 * someone on a fair ping roughly 0.3 s to react.
 */
export const CLAW_TIMING: Record<number, ClawTiming> = {
  [ZombieKind.Walker]: { windup: 0.65, recover: 1.0, track: 0.8 },
  [ZombieKind.Runner]: { windup: 0.3, recover: 0.45, track: 4 },
  [ZombieKind.Brute]: { windup: 0.85, recover: 1.3, track: 0.7 },
  [ZombieKind.Screamer]: { windup: 0.65, recover: 1.0, track: 0.8 },
  [ZombieKind.Stalker]: { windup: 0.25, recover: 0.4, track: 5 },
}

/** Starts a wind-up only when facing its prey within this (radians). */
const START_ANGLE = 0.6

/**
 * One zombie's claw attack, ticked by its brain: idle → winding up → strike (one Fire press) →
 * either the blow landed (back to idle, the claws' cooldown paces the next one) or it missed
 * (recovering: no moving, turning or clawing for a moment). The server resolves the strike at
 * the tick it lands, with the claws' ordinary reach and fan from where the zombie stands and
 * faces right then — so whoever got out of the way during the wind-up isn't there to be hit.
 */
export class ClawAttack {
  private windupLeft = 0
  private recoverLeft = 0
  private timing: ClawTiming = CLAW_TIMING[ZombieKind.Walker] as ClawTiming
  /** The Fire press this tick is a strike (not battering a barricade): its result counts. */
  private striking = false

  /** Back to idle (fresh out of the pool). */
  reset(): void {
    this.windupLeft = 0
    this.recoverLeft = 0
    this.striking = false
  }

  /** How far through a wind-up (0–1), or 0: the client draws the arms going up from this. */
  get windup(): number {
    if (this.windupLeft <= 0) return 0
    return Math.max(0.01, 1 - this.windupLeft / this.timing.windup)
  }

  get busy(): boolean {
    return this.windupLeft > 0 || this.recoverLeft > 0
  }

  get recovering(): boolean {
    return this.recoverLeft > 0
  }

  /** Turn rate allowed this tick (radians), or null when the attack isn't steering. */
  get turnLimit(): number | null {
    if (this.recoverLeft > 0) return 0
    if (this.windupLeft > 0) return this.timing.track * TICK_DT
    return null
  }

  /**
   * One tick. `inReach`: prey in reach; `facing`: how far off it is from straight ahead
   * (radians); `ready`: the claws' cooldown will be done by the time the wind-up is. Returns
   * true on the tick to press Fire.
   */
  tick(kind: ZombieKind, inReach: boolean, facing: number, ready: boolean): boolean {
    this.striking = false
    if (this.recoverLeft > 0) {
      this.recoverLeft -= TICK_DT
      return false
    }
    if (this.windupLeft > 0) {
      this.windupLeft -= TICK_DT
      if (this.windupLeft > 1e-6) return false
      this.windupLeft = 0
      this.striking = true
      return true
    }
    if (inReach && ready && Math.abs(facing) < START_ANGLE) {
      this.timing = CLAW_TIMING[kind] ?? (CLAW_TIMING[ZombieKind.Walker] as ClawTiming)
      this.windupLeft = this.timing.windup
    }
    return false
  }

  /** The server resolved a swing: a strike that hit nobody leaves it open for a moment. */
  struck(landed: boolean): void {
    if (!this.striking) return
    this.striking = false
    if (!landed) this.recoverLeft = this.timing.recover
  }
}
