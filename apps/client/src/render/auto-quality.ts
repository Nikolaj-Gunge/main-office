/**
 * Automatic quality: watches how long frames take and makes the picture coarser (one step of
 * pixel size at a time) when the machine can't keep up, and finer again when it has room to
 * spare. A step that had to be undone soon after is not tried again for a while, so it settles
 * instead of see-sawing.
 */
export class AutoQuality {
  /** Extra steps of pixel size on top of the player's setting (0 = as set). */
  bias = 0
  private readonly maxBias: number
  private sum = 0
  private count = 0
  private window = 0
  /** Seconds the frame rate has been comfortably high. */
  private easy = 0
  private cooldown = 0
  /** After a finer step failed: don't try going finer again until then (s). */
  private lockedFor = 0
  private sinceRaise = Number.POSITIVE_INFINITY

  constructor(maxBias = 2) {
    this.maxBias = maxBias
  }

  /**
   * One frame took `dt` seconds. Returns true when `bias` changed (resize the renderer).
   * Slow: frames average over 20 ms (under 50 fps). Easy: under 17.5 ms for 20 s running.
   */
  frame(dt: number): boolean {
    // A stall (tab hidden, loading) says nothing about the GPU.
    if (dt >= 0.25) return false
    this.cooldown = Math.max(0, this.cooldown - dt)
    this.lockedFor = Math.max(0, this.lockedFor - dt)
    this.sinceRaise += dt
    this.sum += dt
    this.count++
    this.window += dt
    if (this.window < 1.5) return false
    const avg = this.sum / this.count
    this.sum = 0
    this.count = 0
    this.window = 0
    if (this.cooldown > 0) return false

    if (avg > 0.02 && this.bias < this.maxBias) {
      this.bias++
      this.cooldown = 3
      this.easy = 0
      // Just went finer and it didn't hold: leave it coarser for a minute.
      if (this.sinceRaise < 10) this.lockedFor = 60
      return true
    }
    // 60 Hz screens sit at ~16.7 ms however light the work: count that as easy too, but only
    // after a long calm spell, and only if a finer step hasn't failed lately.
    if (avg < 0.0175) this.easy += 1.5
    else this.easy = 0
    if (this.bias > 0 && this.easy >= 20 && this.lockedFor === 0) {
      this.bias--
      this.cooldown = 3
      this.easy = 0
      this.sinceRaise = 0
      return true
    }
    return false
  }

  /** Back to the player's setting (they changed it, or turned auto quality off). */
  reset(): void {
    this.bias = 0
    this.easy = 0
    this.cooldown = 0
    this.lockedFor = 0
  }
}
