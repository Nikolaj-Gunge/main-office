import type { WeaponDef } from '@office-fps/shared'

/** Seconds for a kick to reach (~95% of) full height: fast but not a teleport. */
const RISE_TIME = 0.035
const DEG = Math.PI / 180

/**
 * View recoil that moves your *real* aim (it is applied to the mouse-look angles, so the next
 * shot really goes higher) and then springs back. Because it changes the look angles that are
 * sent as input, the server automatically agrees with it — no extra netcode.
 */
export class Recoil {
  /** Kick still to be applied (radians). */
  private pendingPitch = 0
  private pendingYaw = 0
  /** Kick currently applied and not yet recovered. */
  private offsetPitch = 0
  private offsetYaw = 0
  private recoverTime = 0.2
  /** No recovery until this long after the last kick (automatic weapons: until you stop). */
  private recoverDelay = RISE_TIME
  private sinceKick = 1
  /** Shot number within the current spray (resets after a pause). */
  private sprayIndex = 0
  private readonly random: () => number

  constructor(random: () => number = Math.random) {
    this.random = random
  }

  /** Server rules: 0 = no recoil, 2 = double. */
  amount = 1

  kick(def: WeaponDef, aiming: boolean): void {
    const scale = (aiming ? 0.75 : 1) * this.amount
    const automatic = def.fireMode === 'auto'
    if (this.sinceKick > def.fireInterval * 1.6) this.sprayIndex = 0
    const pattern = def.recoilPattern
    const step = pattern?.[Math.min(this.sprayIndex, pattern.length - 1)]
    if (step) {
      // Fixed spray pattern: the same every time, so it can be learned and pulled against.
      this.pendingPitch += step[0] * DEG * scale
      this.pendingYaw -= step[1] * DEG * scale // pattern "right" = turning right = -yaw
    } else {
      this.pendingPitch += def.kickPitch * DEG * scale
      this.pendingYaw += (this.random() * 2 - 1) * def.kickYaw * DEG * scale
    }
    this.sprayIndex++
    this.recoverTime = def.recoverTime
    this.recoverDelay = automatic ? def.fireInterval * 1.5 : RISE_TIME
    this.sinceKick = 0
  }

  /** Advances the spring. Returns the change to add to the look angles this frame. */
  update(dt: number): { pitch: number; yaw: number } {
    this.sinceKick += dt
    // Exponential approach (time constant RISE_TIME / 3): frame-rate independent.
    const riseK = 1 - Math.exp((-3 * dt) / RISE_TIME)
    const risePitch = this.pendingPitch * riseK
    const riseYaw = this.pendingYaw * riseK
    this.pendingPitch -= risePitch
    this.pendingYaw -= riseYaw
    this.offsetPitch += risePitch
    this.offsetYaw += riseYaw

    // Recover only after the kick has landed, exponentially back to where you aimed.
    let recoverPitch = 0
    let recoverYaw = 0
    if (this.sinceKick > this.recoverDelay) {
      const k = 1 - Math.exp(-dt / this.recoverTime)
      recoverPitch = this.offsetPitch * k
      recoverYaw = this.offsetYaw * k
      this.offsetPitch -= recoverPitch
      this.offsetYaw -= recoverYaw
    }
    return { pitch: risePitch - recoverPitch, yaw: riseYaw - recoverYaw }
  }

  reset(): void {
    this.pendingPitch = this.pendingYaw = this.offsetPitch = this.offsetYaw = 0
    this.sprayIndex = 0
  }
}
