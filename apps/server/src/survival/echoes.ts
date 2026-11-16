import {
  ECHO_DAYS,
  ECHO_FRAMES,
  ECHO_MAX,
  ECHO_REACH,
  ECHO_STRIDE,
  ECHO_WORDS_SECONDS,
  type EchoReplay,
  type EchoSave,
  readEchoes,
  type StainShared,
} from '@office-fps/shared'
import type { Point } from '../items.ts'

/** One sample of somebody alive: where they were, which way they faced, crouched or not. */
interface Sample {
  x: number
  y: number
  z: number
  yaw: number
  crouched: boolean
}

/**
 * Bloodstain echoes (shared/survival/echoes.ts): the last few seconds of everybody's movement in a
 * small ring (sampled ECHO_RATE times a second by the director), and the last thing each said
 * out loud. On a death those seconds are kept where they fell; E on the stain, or at the grave of
 * somebody of the same name, plays them back. Kept in the world save.
 */
export class Echoes {
  private readonly trail = new Map<number, Sample[]>()
  private readonly words = new Map<number, { text: string; at: number }>()
  private list: EchoSave[] = []
  private nextId = 1

  /** As the world was saved (older saves have none). */
  restore(raw: unknown): void {
    this.list = readEchoes(raw)
    this.nextId = Math.max(1, ...this.list.map((e) => e.id + 1))
    this.trail.clear()
    this.words.clear()
  }

  save(): EchoSave[] {
    return this.list.map((e) => ({ ...e, frames: [...e.frames] }))
  }

  get all(): readonly EchoSave[] {
    return this.list
  }

  /** Where somebody alive is now (a few times a second). */
  sample(id: number, pos: Point, yaw: number, crouched: boolean): void {
    let t = this.trail.get(id)
    if (!t) {
      t = []
      this.trail.set(id, t)
    }
    t.push({ x: pos.x, y: pos.y, z: pos.z, yaw, crouched })
    if (t.length > ECHO_FRAMES) t.shift()
  }

  /** They said something out loud, at `now` (s). */
  said(id: number, text: string, now: number): void {
    this.words.set(id, { text: text.slice(0, 120), at: now })
  }

  /** Gone from the server: their trail and words are let go. */
  forget(id: number): void {
    this.trail.delete(id)
    this.words.delete(id)
  }

  /** Somebody died at `at` on world day `day`: their last seconds stay there. */
  died(id: number, name: string, at: Point, day: number, now: number): EchoSave {
    const trail = this.trail.get(id) ?? []
    const frames: number[] = []
    for (const s of trail)
      frames.push(
        Math.round((s.x - at.x) * 10),
        Math.round((s.y - at.y) * 10),
        Math.round((s.z - at.z) * 10),
        Math.round(s.yaw * 100),
        s.crouched ? 1 : 0,
      )
    const w = this.words.get(id)
    const echo: EchoSave = {
      id: this.nextId++,
      name: name.slice(0, 32),
      x: Math.round(at.x * 100) / 100,
      y: Math.round(at.y * 100) / 100,
      z: Math.round(at.z * 100) / 100,
      frames: frames.slice(-ECHO_FRAMES * ECHO_STRIDE),
      day,
      ...(w && now - w.at <= ECHO_WORDS_SECONDS ? { words: w.text } : {}),
    }
    this.forget(id)
    this.list.push(echo)
    while (this.list.length > ECHO_MAX) this.list.shift()
    return echo
  }

  /** The stains still to be seen on world day `day`. */
  stains(day: number): StainShared[] {
    return this.list
      .filter((e) => day - e.day < ECHO_DAYS)
      .map((e) => ({ id: e.id, x: e.x, y: e.y, z: e.z }))
  }

  /**
   * The echo to play for somebody standing at `at`: a fresh stain within reach first, else the
   * newest echo of whoever lies in a grave within reach. Null if there is none.
   */
  near(
    at: Point,
    day: number,
    graves: readonly { name: string; x: number; z: number }[],
  ): EchoReplay | null {
    const d = (o: { x: number; z: number }) => Math.hypot(o.x - at.x, o.z - at.z)
    const stain = this.list
      .filter((e) => day - e.day < ECHO_DAYS && d(e) < ECHO_REACH && Math.abs(e.y - at.y) < 2.5)
      .sort((a, b) => d(a) - d(b))[0]
    const grave = stain ? null : graves.find((g) => d(g) < ECHO_REACH)
    const echo =
      stain ?? (grave ? [...this.list].reverse().find((e) => e.name === grave.name) : undefined)
    if (!echo) return null
    const { day: _, ...replay } = echo
    return replay
  }
}

/** What the echo's caption says. */
export function echoCaption(e: Pick<EchoReplay, 'name' | 'words'>): string {
  return e.words
    ? `A cold breath. ${e.name}, the last time: "${e.words}"`
    : `A cold breath. ${e.name}'s last moments, here.`
}
