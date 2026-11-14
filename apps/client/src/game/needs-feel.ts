import { type EffectId, shiverOf } from '@office-fps/shared'

/**
 * Cold hands: the aim shivers. A small wobble made of a few quick waves; each frame returns only
 * how much it moved since the last, so it shakes the aim without dragging it anywhere.
 */
export class Shiver {
  private time = 0
  private yaw = 0
  private pitch = 0
  /** How strong it is now (eases in and out, radians). */
  private amount = 0

  /** The aim's nudge this frame for these effects (0 when warm). */
  update(dt: number, effects: readonly EffectId[]): { yaw: number; pitch: number } {
    this.time += dt
    const target = shiverOf(effects)
    this.amount += (target - this.amount) * Math.min(1, dt * 1.5)
    const t = this.time
    const a = this.amount
    const yaw = a * (Math.sin(t * 23) * 0.5 + Math.sin(t * 37 + 1.3) * 0.3 + Math.sin(t * 7) * 0.2)
    const pitch = a * (Math.sin(t * 29 + 0.7) * 0.6 + Math.sin(t * 11 + 2) * 0.4)
    const out = { yaw: yaw - this.yaw, pitch: pitch - this.pitch }
    this.yaw = yaw
    this.pitch = pitch
    return out
  }
}
