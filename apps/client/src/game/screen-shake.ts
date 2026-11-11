/**
 * Camera shake from "trauma" (0–1): shake grows with trauma², so small hits barely move the view
 * while big ones really rattle it. Smooth (layered sines), purely visual — never touches aim.
 */
export class ScreenShake {
  /** Max rotation at full trauma (radians). */
  maxAngle = 0.03
  private trauma = 0
  private time = 0
  private readonly seeds = [Math.random() * 100, Math.random() * 100, Math.random() * 100]

  add(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount)
  }

  update(dt: number): { pitch: number; yaw: number; roll: number } {
    this.time += dt
    this.trauma = Math.max(0, this.trauma - dt * 1.6)
    const s = this.trauma * this.trauma * this.maxAngle
    const wave = (seed: number) =>
      Math.sin(this.time * 31 + seed) * 0.6 + Math.sin(this.time * 57 + seed * 1.7) * 0.4
    return {
      pitch: s * wave(this.seeds[0] ?? 0),
      yaw: s * wave(this.seeds[1] ?? 0),
      roll: s * 0.6 * wave(this.seeds[2] ?? 0),
    }
  }
}
