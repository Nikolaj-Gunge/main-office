import { type Flock, heightAt, type Notice, type SurvivalDef, ZombieKind } from '@office-fps/shared'
import type { Point } from '../items.ts'
import type { Zed } from './horde.ts'
import { gentleKind, shielded } from './newcomer.ts'

/**
 * The first gunshot is a lesson (research 4-spectacular 1.2): the first time somebody new fires
 * a gun out in the woods, a flock nearby always takes off, a groan answers from off in the trees
 * a moment later, one or two walkers start drifting towards the shot, and a hint says why.
 * Once per account (guests: once per visit), and only while the newcomer's shield is up — what
 * comes is walkers only, at most two, and never inside a safe place.
 */

/** The account record's key (saves.ts AccountSave): one-time lessons learnt. */
export const LESSONS_KEY = 'lessons'
/** The groan answers this long after the shot (s); the hint follows after this much more. */
export const GROAN_DELAY = 2
export const HINT_DELAY = 1.6
/** Guns quieter than this (a suppressed one) don't teach it: nothing much heard them. */
export const LOUD = 20
/** Walkers that drift over: from this far off (m), at most this many. */
export const DRIFT_NEAR = 30
export const DRIFT_FAR = 150
export const MAX_DRIFTERS = 2
/** Nothing out there to answer: one comes from this far (m). */
export const ANSWER_FROM = 75
/** The nearest flock within this (m) takes off, whatever the gun's reach for birds. */
const FLOCK_REACH = 250
/** The hint (onboarding.ts HINTS.gunfire says the same). */
export const GUNFIRE_HINT = 'Gunfire carries. They heard that.'

export interface FirstShotHost {
  def(): SurvivalDef
  readonly random: () => number
  now(): number
  /** The account's record, or null for a guest. */
  account(account: string): Record<string, unknown>
  putAccount(account: string, key: string, value: unknown): void
  flocks(): readonly Flock[]
  isAway(i: number): boolean
  scatter(i: number): boolean
  zombies(): { player: { state: { pos: Point; alive: boolean } }; zed: Zed }[]
  /** Brings one more of the dead out at `at`, going to look at `goal`. */
  spawn(at: Point, kind: ZombieKind, goal: Point): boolean
  /** Is `at` out of the shooter's sight? */
  hidden(from: Point, at: Point): boolean
  notice(playerId: number, notice: Notice): void
}

export interface Shooter {
  id: number
  account?: string | null | undefined
  pos: Point
  /** Seconds alive (newcomer.ts). */
  age: number | undefined
  /** In a safe place (Haven): the lesson waits for a shot outside. */
  safe: boolean
  /** How loud the gun is (WEAPONS[…].noise). */
  noise: number
}

interface Pending {
  id: number
  shot: Point
  from: Point
  drifters: Zed[]
  spawn: number
  groanAt: number
  hintAt: number
  groaned: boolean
}

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z)

/** Has this account had the lesson? */
export function learnt(record: Record<string, unknown> | null): boolean {
  const lessons = record?.[LESSONS_KEY]
  return (
    !!lessons &&
    typeof lessons === 'object' &&
    (lessons as { firstShot?: unknown }).firstShot === true
  )
}

export class FirstShotLesson {
  /** Taught (or not new) this visit: never looked at again. */
  private readonly done = new Set<number>()
  private pending: Pending[] = []

  constructor(private readonly host: FirstShotHost) {}

  /** A gun went off. True if this was somebody's lesson. */
  onShot(s: Shooter): boolean {
    if (this.done.has(s.id)) return false
    if (!shielded(s.age)) {
      this.done.add(s.id)
      return false
    }
    if (s.safe || s.noise < LOUD) return false
    this.done.add(s.id)
    if (s.account) {
      const record = this.host.account(s.account)
      if (learnt(record)) return false
      const lessons = (record[LESSONS_KEY] as Record<string, unknown> | undefined) ?? {}
      this.host.putAccount(s.account, LESSONS_KEY, { ...lessons, firstShot: true })
    }
    const shot = { ...s.pos }
    this.scatterNearest(shot)
    // Walkers out there, not after anybody yet, nearest first.
    const drifters = this.host
      .zombies()
      .filter(
        ({ player, zed }) =>
          player.state.alive &&
          zed.kind === ZombieKind.Walker &&
          zed.mood !== 'chase' &&
          !zed.hunter &&
          !zed.siege &&
          dist(player.state.pos, shot) > DRIFT_NEAR &&
          dist(player.state.pos, shot) < DRIFT_FAR,
      )
      .sort((a, b) => dist(a.player.state.pos, shot) - dist(b.player.state.pos, shot))
      .slice(0, MAX_DRIFTERS)
    const from = drifters[0]
      ? { ...drifters[0].player.state.pos, y: drifters[0].player.state.pos.y + 1.6 }
      : this.answerSpot(shot)
    const now = this.host.now()
    this.pending.push({
      id: s.id,
      shot,
      from,
      drifters: drifters.map((d) => d.zed),
      spawn: drifters.length ? 0 : 1,
      groanAt: now + GROAN_DELAY,
      hintAt: now + GROAN_DELAY + HINT_DELAY,
      groaned: false,
    })
    return true
  }

  /** A few times a second: the groan and the walkers, then the hint. */
  step(): void {
    const now = this.host.now()
    for (const p of this.pending) {
      if (!p.groaned && now >= p.groanAt) {
        p.groaned = true
        this.host.notice(p.id, { kind: 'sound', text: '', sound: 'groan', at: p.from })
        const r = () => (this.host.random() - 0.5) * 6
        for (const zed of p.drifters)
          zed.alert({ x: p.shot.x + r(), y: p.shot.y, z: p.shot.z + r() }, now)
        for (let k = 0; k < p.spawn; k++) {
          const at = { x: p.from.x + r(), y: 0, z: p.from.z + r() }
          at.y = heightAt(this.host.def().terrain, at.x, at.z)
          this.host.spawn(at, gentleKind(ZombieKind.Walker), p.shot)
        }
      }
      if (now >= p.hintAt)
        this.host.notice(p.id, { kind: 'info', text: GUNFIRE_HINT, hint: 'gunfire' })
    }
    this.pending = this.pending.filter((p) => now < p.hintAt)
  }

  /** Gone (left the game): nothing more for them; a guest back later is new again. */
  forget(id: number): void {
    this.done.delete(id)
    this.pending = this.pending.filter((p) => p.id !== id)
  }

  /** Waiting to happen (tests). */
  get waiting(): number {
    return this.pending.length
  }

  private scatterNearest(at: Point): void {
    const flocks = this.host.flocks()
    let best = -1
    for (let i = 0; i < flocks.length; i++) {
      const f = flocks[i] as Flock
      if (this.host.isAway(i) || dist(f, at) > FLOCK_REACH) continue
      if (best < 0 || dist(f, at) < dist(flocks[best] as Flock, at)) best = i
    }
    if (best >= 0) this.host.scatter(best)
  }

  /** Off in the trees, out of sight if there's such a spot: where the answer comes from. */
  private answerSpot(shot: Point): Point {
    const terrain = this.host.def().terrain
    let spot: Point | null = null
    for (let k = 0; k < 8; k++) {
      const a = this.host.random() * Math.PI * 2
      const x = shot.x + Math.sin(a) * ANSWER_FROM
      const z = shot.z + Math.cos(a) * ANSWER_FROM
      spot = { x, y: heightAt(terrain, x, z) + 1.6, z }
      if (this.host.hidden({ ...shot, y: shot.y + 1.6 }, spot)) break
    }
    return spot as Point
  }
}
