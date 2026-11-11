/** Max ticks simulated in one wake-up before we drop time (avoids spiral of death). */
const MAX_CATCH_UP_TICKS = 5

/**
 * Fixed-timestep loop driven by a high-resolution clock. `setInterval` alone drifts and
 * jitters, so we wake often and run as many whole ticks as real time has accumulated.
 */
export class GameLoop {
  tick = 0
  private readonly stepMs: number
  private accumulator = 0
  private last = 0
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    tickRate: number,
    private readonly onTick: (tick: number) => void,
  ) {
    this.stepMs = 1000 / tickRate
  }

  start(): void {
    this.last = performance.now()
    this.schedule()
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule(): void {
    this.timer = setTimeout(() => this.wake(), Math.max(1, this.stepMs - this.accumulator - 1))
  }

  private wake(): void {
    const now = performance.now()
    this.accumulator += now - this.last
    this.last = now

    let steps = 0
    while (this.accumulator >= this.stepMs && steps < MAX_CATCH_UP_TICKS) {
      this.tick++
      this.onTick(this.tick)
      this.accumulator -= this.stepMs
      steps++
    }
    if (steps === MAX_CATCH_UP_TICKS && this.accumulator >= this.stepMs) {
      console.warn(`[loop] fell behind, dropping ${this.accumulator.toFixed(1)} ms`)
      this.accumulator = 0
    }
    this.schedule()
  }
}
