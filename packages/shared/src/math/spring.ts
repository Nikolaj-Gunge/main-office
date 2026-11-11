/**
 * Critically damped spring (no overshoot) — the building block for camera and weapon feel.
 * Push it with `impulse()`, read `value`. Stable for any dt (exact solution, not Euler).
 */
export class Spring {
  value = 0
  velocity = 0
  target = 0
  /** Angular frequency (rad/s): higher = snappier return. */
  frequency: number

  constructor(frequency: number) {
    this.frequency = frequency
  }

  impulse(velocity: number): void {
    this.velocity += velocity
  }

  update(dt: number): number {
    const w = this.frequency
    const x = this.value - this.target
    const exp = Math.exp(-w * dt)
    const newX = (x + (this.velocity + w * x) * dt) * exp
    this.velocity = (this.velocity - w * (this.velocity + w * x) * dt) * exp
    this.value = this.target + newX
    return this.value
  }
}
