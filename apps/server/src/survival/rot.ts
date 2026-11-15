import {
  heightAt,
  MOODS,
  moodFor,
  type RotMood,
  RotPhase,
  type SurvivalDef,
} from '@office-fps/shared'
import type { Point } from '../items.ts'

/**
 * "The Rot": a tension director per player, after Left 4 Dead's AI Director. Each person's
 * night builds up (damage taken, the dead chasing them, low ammo and health, the dark, the
 * bite), peaks for a few seconds, then relaxes: no new threats near them for a while, and the
 * dead that lost sight of them give up sooner. While it builds, now and then something happens:
 * a few of the dead turn up ahead of them where they can't see, a scream somewhere off in the
 * trees, a car alarm going off. Each night also has a mood (see MOODS in shared rot.ts).
 */

/** Tension at which a night peaks, and how long a peak is held (s) before it relaxes. */
export const PEAK_AT = 0.78
export const PEAK_HOLD = 5
/** Relaxing lasts at least this long (s), and until tension falls under RELAX_UNTIL (or MAX). */
export const RELAX_MIN = 30
export const RELAX_MAX = 80
export const RELAX_UNTIL = 0.35
/** Seconds between events while it builds: at night, and by day (× the mood's). */
export const EVENT_GAP_NIGHT: [number, number] = [70, 130]
export const EVENT_GAP_DAY: [number, number] = [160, 280]
/** The dead chasing you within this (m) wind you up. */
export const CHASE_NEAR = 20
/** An ambush appears this far ahead of you (m), out of sight. */
export const AMBUSH_MIN = 40
export const AMBUSH_MAX = 65
/** "Out of sight": this far round from where you look (degrees), or behind something. */
export const UNSEEN_ANGLE = 70

export type RotEventKind = 'ambush' | 'scream' | 'alarm'

/** What the director needs to know about one living person, once a second. */
export interface RotSense {
  id: number
  /** Health 0–1. */
  health: number
  /** Rounds left for the gun in hand, 0 (none) – 1 (a full magazine or more); 1 with no gun. */
  ammo: number
  /** 0 by day … 1 in the dark. */
  dark: number
  /** Infection stage 0–4. */
  infection: number
  /** The dead chasing them within CHASE_NEAR. */
  chasers: number
  /** Inside a safe place: nothing happens to them there. */
  safe: boolean
}

interface Mind {
  heat: number
  tension: number
  phase: RotPhase
  since: number
  /** When something last happened to them (hurt, chased). */
  stirred: number
  nextEvent: number
  spotted: boolean
  /** What was last sent (to send again only on change). */
  sent: string
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

export class Rot {
  private readonly minds = new Map<number, Mind>()
  /** Tonight's mood, or null by day. */
  mood: RotMood | null = null
  private now = 0

  constructor(private readonly random: () => number) {}

  /** Night number `night` begins: its mood (seeded by the world). */
  startNight(seed: number, night: number): RotMood {
    this.mood = moodFor(seed, night)
    return this.mood
  }

  endNight(): void {
    this.mood = null
  }

  /** What tonight's mood does (an ordinary night by day). */
  get moodDef() {
    return this.mood
      ? MOODS[this.mood]
      : { wanderers: 1, sight: 1, runners: 0, screamers: 0, events: 1, fog: 0 }
  }

  private mind(id: number): Mind {
    let m = this.minds.get(id)
    if (!m) {
      m = {
        heat: 0,
        tension: 0,
        phase: RotPhase.Build,
        since: this.now,
        stirred: -99,
        nextEvent: this.now + 45,
        spotted: false,
        sent: '',
      }
      this.minds.set(id, m)
    }
    return m
  }

  forget(id: number): void {
    this.minds.delete(id)
  }

  /** They were hurt. */
  hurt(id: number, amount: number): void {
    const m = this.mind(id)
    m.heat = Math.min(1.5, m.heat + amount / 45)
    m.stirred = this.now
  }

  /** One of the dead just saw them (a stinger on their side). */
  spotted(id: number): void {
    const m = this.mind(id)
    m.spotted = true
    m.heat = Math.min(1.5, m.heat + 0.08)
    m.stirred = this.now
  }

  tension(id: number): number {
    return this.minds.get(id)?.tension ?? 0
  }

  phase(id: number): RotPhase {
    return this.minds.get(id)?.phase ?? RotPhase.Build
  }

  relaxing(id: number): boolean {
    return this.phase(id) === RotPhase.Relax
  }

  /**
   * Once a second (`now` in seconds): everybody's tension and phase moves on. Returns the events
   * due (whom for and what); the director decides where, and whether it can.
   */
  update(now: number, senses: readonly RotSense[]): { id: number; kind: RotEventKind }[] {
    const dt = Math.max(0, Math.min(5, now - this.now))
    this.now = now
    const events: { id: number; kind: RotEventKind }[] = []
    const here = new Set<number>()
    for (const s of senses) {
      here.add(s.id)
      const m = this.mind(s.id)
      if (s.chasers > 0) {
        m.heat = Math.min(1.5, m.heat + Math.min(3, s.chasers) * 0.06 * dt)
        m.stirred = now
      }
      // Quiet for a few seconds: it ebbs away (faster while relaxing, and fast in Haven).
      if (now - m.stirred > 3 || s.safe) {
        const ebb = s.safe ? 0.2 : m.phase === RotPhase.Relax ? 0.09 : 0.05
        m.heat = Math.max(0, m.heat - ebb * dt)
      }
      const ambient = Math.min(
        0.45,
        0.3 * clamp01((0.6 - s.health) / 0.5) +
          0.12 * clamp01(1 - s.ammo) +
          0.12 * s.dark +
          0.12 * (s.infection / 4),
      )
      m.tension = clamp01(m.heat + ambient * (s.safe ? 0.4 : 1))

      const held = now - m.since
      if (m.phase === RotPhase.Build && m.tension >= PEAK_AT) this.enter(m, RotPhase.Peak)
      else if (m.phase === RotPhase.Peak && held >= PEAK_HOLD) this.enter(m, RotPhase.Relax)
      else if (
        m.phase === RotPhase.Relax &&
        ((held >= RELAX_MIN && m.tension < RELAX_UNTIL) || held >= RELAX_MAX)
      ) {
        this.enter(m, RotPhase.Build)
        // A breather before anything new.
        m.nextEvent = Math.max(m.nextEvent, now + 20)
      }

      if (m.phase === RotPhase.Relax || s.safe || now < m.nextEvent) continue
      const [lo, hi] = s.dark > 0.5 ? EVENT_GAP_NIGHT : EVENT_GAP_DAY
      m.nextEvent = now + (lo + this.random() * (hi - lo)) * this.moodDef.events
      // Already in trouble: let it play out.
      if (m.tension > 0.6) continue
      events.push({ id: s.id, kind: this.pick() })
    }
    for (const id of this.minds.keys()) if (!here.has(id)) this.minds.delete(id)
    return events
  }

  private enter(m: Mind, phase: RotPhase): void {
    m.phase = phase
    m.since = this.now
  }

  private pick(): RotEventKind {
    const w: Record<RotEventKind, number> = {
      ambush: this.mood === 'hunting' ? 4 : 3,
      scream: this.mood === 'choir' ? 3 : 1,
      alarm: 1,
    }
    let r = this.random() * (w.ambush + w.scream + w.alarm)
    for (const kind of ['ambush', 'scream', 'alarm'] as const) {
      r -= w[kind]
      if (r < 0) return kind
    }
    return 'ambush'
  }

  /** What to tell `id` now, or null when nothing changed (level as a byte, phase, spotted). */
  message(id: number): { level: number; phase: RotPhase; spotted: boolean } | null {
    const m = this.minds.get(id)
    if (!m) return null
    const level = Math.round(m.tension * 255) / 255
    const key = `${Math.round(m.tension * 32)}/${m.phase}`
    if (key === m.sent && !m.spotted) return null
    m.sent = key
    const spotted = m.spotted
    m.spotted = false
    return { level, phase: m.phase, spotted }
  }
}

/** Where a person is, which way they look, which way they go. */
export interface Watcher {
  pos: Point
  /** Where they look (the game's yaw: 0 = −z, + = to the left). */
  yaw: number
  vel: { x: number; z: number }
}

/** True when `at` is out of `who`'s sight: well round from where they look, or behind something. */
export function unseen(who: Watcher, at: Point, clear: (a: Point, b: Point) => boolean): boolean {
  const dx = at.x - who.pos.x
  const dz = at.z - who.pos.z
  const d = Math.hypot(dx, dz)
  if (d < 1e-3) return false
  const facing = (-Math.sin(who.yaw) * dx - Math.cos(who.yaw) * dz) / d
  if (facing < Math.cos((UNSEEN_ANGLE * Math.PI) / 180)) return true
  const eye = { x: who.pos.x, y: who.pos.y + 1.6, z: who.pos.z }
  return !clear(eye, { x: at.x, y: at.y + 1.4, z: at.z })
}

/**
 * Where a small group could turn up ahead of `who` (along where they're going, or where they
 * look when standing still): AMBUSH_MIN–MAX away, on open ground, out of everybody's sight.
 * Null if nowhere will do.
 */
export function ambushSpot(
  def: SurvivalDef,
  who: Watcher,
  people: readonly Watcher[],
  clear: (a: Point, b: Point) => boolean,
  random: () => number,
): Point | null {
  const moving = Math.hypot(who.vel.x, who.vel.z) > 0.5
  const heading = moving
    ? Math.atan2(who.vel.x, who.vel.z)
    : Math.atan2(-Math.sin(who.yaw), -Math.cos(who.yaw))
  for (let n = 0; n < 12; n++) {
    const a = heading + (random() - 0.5) * ((100 * Math.PI) / 180)
    const r = AMBUSH_MIN + random() * (AMBUSH_MAX - AMBUSH_MIN)
    const x = who.pos.x + Math.sin(a) * r
    const z = who.pos.z + Math.cos(a) * r
    if (Math.abs(x) > 1480 || Math.abs(z) > 1480) continue
    if (def.pois.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + (p.safe ? 40 : 2))) continue
    if (def.lakes.some((l) => Math.hypot(l.x - x, l.z - z) < l.r + 4)) continue
    const at = { x, y: heightAt(def.terrain, x, z), z }
    if (people.some((p) => Math.hypot(p.pos.x - x, p.pos.z - z) < AMBUSH_MIN - 5)) continue
    if (!people.every((p) => unseen(p, at, clear))) continue
    return at
  }
  return null
}
