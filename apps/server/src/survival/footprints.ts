import { PRINT_SECONDS } from '@office-fps/shared'

/**
 * Footprints in the snow (ROADMAP 6.9), as the dead know them: where each of the living has
 * walked in the last couple of minutes. One of the dead that comes across a trail follows it the
 * way it leads — towards whoever made it. (What you see in the snow is drawn by the client,
 * footprints-view.ts; this is only where the trails go.)
 */

export interface Print {
  x: number
  z: number
  /** When it was made (s). */
  at: number
  /** Whose trail (player id). */
  trail: number
}

/** A print every this far along a trail (m). */
export const PRINT_STRIDE = 1.4
/** The most prints kept at once (oldest go first). */
export const PRINT_CAP = 900
/** One of the dead notices a trail within this (m). */
export const NOTICE = 7
/** It heads this far on along the trail at a time (m). */
const LEAD_AHEAD = 10

export class Footprints {
  /** Oldest first. */
  readonly prints: Print[] = []
  private readonly last = new Map<number, { x: number; z: number }>()

  /** Somebody is at (x, z): leaves a print if they've come a stride since the last one. */
  step(trail: number, x: number, z: number, now: number): boolean {
    const was = this.last.get(trail)
    if (was && Math.hypot(x - was.x, z - was.z) < PRINT_STRIDE) return false
    this.last.set(trail, { x, z })
    this.prints.push({ x, z, at: now, trail })
    if (this.prints.length > PRINT_CAP) this.prints.splice(0, this.prints.length - PRINT_CAP)
    return true
  }

  /** Somebody stopped leaving prints (indoors, in a car, the snow gone): their next starts afresh. */
  lift(trail: number): void {
    this.last.delete(trail)
  }

  /** Prints older than PRINT_SECONDS melt away. */
  prune(now: number): void {
    let n = 0
    while (n < this.prints.length && now - (this.prints[n] as Print).at > PRINT_SECONDS) n++
    if (n > 0) this.prints.splice(0, n)
  }

  clear(): void {
    this.prints.length = 0
    this.last.clear()
  }

  /**
   * Where a trail near (x, z) leads: the nearest print within NOTICE, then on along its trail
   * (newer prints) about LEAD_AHEAD further — or the trail's newest print, if it ends sooner.
   * Null with no trail in reach. `ignore` skips a trail (somebody's own, say).
   */
  lead(x: number, z: number, now: number, ignore = 0): Print | null {
    let near: Print | null = null
    let nearIndex = -1
    let best = NOTICE
    for (let i = 0; i < this.prints.length; i++) {
      const p = this.prints[i] as Print
      if (p.trail === ignore || now - p.at > PRINT_SECONDS) continue
      const d = Math.hypot(p.x - x, p.z - z)
      // The fresher of two equally near: it follows where they went last.
      if (d < best || (near && d < best + 0.5 && p.at > near.at)) {
        best = Math.min(best, d)
        near = p
        nearIndex = i
      }
    }
    if (!near) return null
    let ahead = near
    for (let i = nearIndex + 1; i < this.prints.length; i++) {
      const p = this.prints[i] as Print
      if (p.trail !== near.trail) continue
      ahead = p
      if (Math.hypot(p.x - near.x, p.z - near.z) >= LEAD_AHEAD) break
    }
    return ahead
  }
}
