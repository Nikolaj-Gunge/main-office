/**
 * Camera shake from "trauma" (0–1): shake grows with trauma², so small hits barely move the view
 * while big ones really rattle it. Smooth (layered sines), purely visual — never touches aim.
 */
/** Trauma lost per second: a full-strength jolt is gone in two thirds of a second. */
const DECAY = 1.5

export class ScreenShake {
  /** Max rotation at full trauma (radians). */
  maxAngle = 0.03
  /** The player's "Screen shake" setting (0 = off … 1 = full); trauma still decays as normal. */
  scale = 1
  private trauma = 0
  private time = 0
  private readonly seeds: number[]

  constructor(random: () => number = Math.random) {
    this.seeds = [random() * 100, random() * 100, random() * 100]
  }

  /** Current trauma (0–1). */
  get level(): number {
    return this.trauma
  }

  add(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount)
  }

  update(dt: number): { pitch: number; yaw: number; roll: number } {
    this.time += dt
    this.trauma = Math.max(0, this.trauma - dt * DECAY)
    const s = this.trauma * this.trauma * this.maxAngle * this.scale
    const wave = (seed: number) =>
      Math.sin(this.time * 31 + seed) * 0.6 + Math.sin(this.time * 57 + seed * 1.7) * 0.4
    return {
      pitch: s * wave(this.seeds[0] ?? 0),
      yaw: s * wave(this.seeds[1] ?? 0),
      roll: s * 0.6 * wave(this.seeds[2] ?? 0),
    }
  }
}
