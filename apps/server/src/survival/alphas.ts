import {
  ALPHA_GONE,
  ALPHA_NEAR,
  ALPHA_RESPAWN_MS,
  ALPHAS,
  type AlphaDef,
  type Notice,
  type SurvivalDef,
  ZombieKind,
} from '@office-fps/shared'
import type { ServerPlayer } from '../game.ts'
import type { Point } from '../items.ts'
import type { Zed } from './horde.ts'
import type { RadioEvent } from './radio.ts'

/**
 * The named alphas in the world (shared alphas.ts has who they are): each turns up at its place
 * when somebody comes near, goes when nobody is, and uses its special move on whoever it's
 * after. Killed, it drops its trophy and things, the radio says so, the world gains something
 * for good, and it stays dead for a few days (kept in the world's save).
 */

/** The Sawmill Brute's charge: from this far (m), this much faster, this long (s), this often. */
export const CHARGE_FROM: [number, number] = [6, 24]
export const CHARGE_BOOST = 2.4
export const CHARGE_SECONDS = 1.6
export const CHARGE_EVERY = 9
/** The Choir's call: this often (s); this many more of the dead; the dead this near come (m). */
export const SUMMON_EVERY = 16
export const SUMMON_COUNT = 3
export const SUMMON_DRAW = 120
const SUMMON_HEARD = 170
/** Old Teeth's leap: from this far (m), this fast along and up (m/s), this often (s). */
export const LEAP_FROM: [number, number] = [4, 13]
export const LEAP_SPEED = 12
export const LEAP_UP = 6.2
export const LEAP_EVERY = 6
/** People hear a roar from this far (m). */
const ROAR_HEARD = 90

export interface AlphaHost {
  def(): SurvivalDef
  /** Seconds since the server started. */
  now(): number
  /** Wall clock (ms since 1970): alphas stay dead for days, across restarts. */
  clock(): number
  random(): number
  /** The living. */
  people(): ServerPlayer[]
  /** Brings one of the dead out at `at` as this alpha (named), belonging to place `home`. */
  spawn(at: Point, kind: ZombieKind, home: number, name: string): ServerPlayer | null
  zed(zombie: ServerPlayer): Zed | undefined
  /** One more of the dead at `at`, going to `goal`. False if none are free. */
  spawnZombie(at: Point, kind: ZombieKind, goal: Point): boolean
  /** The dead within `radius` of `at` come to `goal`. */
  alertNear(at: Point, radius: number, goal: Point): void
  send(player: ServerPlayer, notice: Notice): void
  /** Puts something on the ground. */
  drop(item: string, n: number, at: Point): void
  /** The world gains `key` for good; false if it already had it. */
  unlock(key: string): boolean
  radio(e: RadioEvent): void
  /** What the people of Deadwood call `player` (their character's name). */
  nameOf(player: ServerPlayer): string
}

interface Live {
  zombie: ServerPlayer
  /** When it may use its move again, and when a charge ends (0: not charging). */
  next: number
  until: number
}

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z)

export class Alphas {
  private readonly live = new Map<string, Live>()
  /** Alpha key → when it was killed (ms). */
  private killed = new Map<string, number>()
  /** Killed ones whose comeback hasn't been on the radio yet. */
  private readonly missed = new Set<string>()

  constructor(private readonly host: AlphaHost) {}

  /** A new world: nobody has killed anything. */
  reset(): void {
    this.live.clear()
    this.killed.clear()
    this.missed.clear()
  }

  /** From the world's save. */
  restore(saved: Record<string, number> | undefined): void {
    this.killed = new Map(
      Object.entries(saved ?? {}).filter(([k]) => ALPHAS.some((a) => a.key === k)),
    )
    for (const k of this.killed.keys()) this.missed.add(k)
  }

  /** For the world's save. */
  saved(): Record<string, number> {
    return Object.fromEntries(this.killed)
  }

  /** The alpha this zombie is right now, if any. */
  alphaOf(zombie: ServerPlayer): AlphaDef | null {
    for (const [key, l] of this.live) {
      if (l.zombie !== zombie) continue
      const a = ALPHAS.find((x) => x.key === key)
      // Still the alpha (the pool may have taken it back and named it something else since).
      return a && zombie.name === a.name ? a : null
    }
    return null
  }

  /** Whether `key` is out there right now (tests). */
  out(key: string): ServerPlayer | null {
    const l = this.live.get(key)
    return l && this.alive(key, l) ? l.zombie : null
  }

  /** Whether it's dead and not yet due back. */
  resting(key: string): boolean {
    const at = this.killed.get(key)
    return at !== undefined && this.host.clock() - at < ALPHA_RESPAWN_MS
  }

  /** The pooled zombie is still this alpha (the pool may have taken it back for somebody else). */
  private alive(key: string, l: Live): boolean {
    const def = ALPHAS.find((a) => a.key === key)
    return !!def && l.zombie.state.alive && l.zombie.name === def.name
  }

  /** Once a second: alphas turn up where somebody is near their place. */
  tick(): void {
    const def = this.host.def()
    const people = this.host.people()
    for (const a of ALPHAS) {
      const l = this.live.get(a.key)
      if (l && this.alive(a.key, l)) continue
      this.live.delete(a.key)
      if (this.resting(a.key)) continue
      const home = def.pois.findIndex((p) => p.key === a.poi)
      const poi = def.pois[home]
      if (!poi) continue
      const near = people.some((p) => dist(p.state.pos, poi) < ALPHA_NEAR)
      if (!near) continue
      const at = this.spot(def, home)
      // Never where somebody can watch it appear.
      if (people.some((p) => dist(p.state.pos, at) < 30)) continue
      const zombie = this.host.spawn(at, a.kind, home, a.name)
      if (!zombie) continue
      this.live.set(a.key, { zombie, next: this.host.now(), until: 0 })
      if (this.killed.delete(a.key) || this.missed.delete(a.key))
        this.host.radio({ kind: 'alphaBack', alpha: a.name, place: poi.name })
    }
    // Nobody about any more: the pool takes it back (populate retires the far ones); it'll
    // turn up again when somebody comes.
    for (const [key, l] of this.live) {
      if (!this.alive(key, l)) continue
      if (!people.some((p) => dist(p.state.pos, l.zombie.state.pos) < ALPHA_GONE))
        this.live.delete(key)
    }
  }

  /** Where it stands about: the spot of its place's dead nearest the middle. */
  private spot(def: SurvivalDef, home: number): Point {
    const poi = def.pois[home] as SurvivalDef['pois'][number]
    let best: Point = { x: poi.x, y: poi.y, z: poi.z }
    let bestD = Number.POSITIVE_INFINITY
    for (const s of def.zombieSpots) {
      if (s.poi !== home) continue
      const d = Math.hypot(s.pos[0] - poi.x, s.pos[2] - poi.z)
      if (d < bestD) {
        bestD = d
        best = { x: s.pos[0], y: s.pos[1], z: s.pos[2] }
      }
    }
    return best
  }

  /** Every tick: special moves. */
  step(): void {
    const now = this.host.now()
    for (const [key, l] of this.live) {
      if (!this.alive(key, l)) continue
      const a = ALPHAS.find((x) => x.key === key) as AlphaDef
      const zed = this.host.zed(l.zombie)
      if (!zed) continue
      if (l.until > 0 && now >= l.until) {
        l.until = 0
        zed.boost = 1
      }
      if (now < l.next || zed.mood !== 'chase') continue
      const target = this.host.people().find((p) => p.id === zed.targetId)
      if (!target) continue
      this.move(a, l, zed, target, now)
    }
  }

  /** Its special move on `target`, if it's in range for it. */
  private move(a: AlphaDef, l: Live, zed: Zed, target: ServerPlayer, now: number): string | null {
    const me = l.zombie.state
    const d = dist(me.pos, target.state.pos)
    if (a.move === 'charge') {
      if (d < CHARGE_FROM[0] || d > CHARGE_FROM[1]) return null
      zed.boost = CHARGE_BOOST
      l.until = now + CHARGE_SECONDS
      l.next = now + CHARGE_EVERY
      this.roar(me.pos)
      return 'charge'
    }
    if (a.move === 'leap') {
      if (d < LEAP_FROM[0] || d > LEAP_FROM[1] || !me.grounded) return null
      const dx = (target.state.pos.x - me.pos.x) / d
      const dz = (target.state.pos.z - me.pos.z) / d
      me.vel = { x: dx * LEAP_SPEED, y: LEAP_UP, z: dz * LEAP_SPEED }
      me.grounded = false
      l.next = now + LEAP_EVERY
      this.roar(me.pos)
      return 'leap'
    }
    // The Choir: a long call, and the woods empty towards it.
    l.next = now + SUMMON_EVERY
    const at = { x: me.pos.x, y: me.pos.y + 1.8, z: me.pos.z }
    for (const p of this.host.people()) {
      if (dist(p.state.pos, at) > SUMMON_HEARD) continue
      this.host.send(p, { kind: 'scream', text: '', at })
    }
    this.host.alertNear(me.pos, SUMMON_DRAW, target.state.pos)
    const def = this.host.def()
    for (let n = 0; n < SUMMON_COUNT; n++) {
      const ang = this.host.random() * Math.PI * 2
      const r = 22 + this.host.random() * 14
      const x = me.pos.x + Math.cos(ang) * r
      const z = me.pos.z + Math.sin(ang) * r
      if (def.pois.some((p) => p.safe && Math.hypot(p.x - x, p.z - z) < p.r + 20)) continue
      const kind = n === 0 && this.host.random() < 0.5 ? ZombieKind.Runner : ZombieKind.Walker
      if (!this.host.spawnZombie({ x, y: me.pos.y, z }, kind, target.state.pos)) break
    }
    return 'summon'
  }

  /** A roar as it charges or leaps: heard (not seen) by everyone near. */
  private roar(pos: Point): void {
    const at = { x: pos.x, y: pos.y + 1.8, z: pos.z }
    for (const p of this.host.people()) {
      if (dist(p.state.pos, at) > ROAR_HEARD) continue
      this.host.send(p, { kind: 'sound', text: '', sound: 'roar', at })
    }
  }

  /**
   * One of the dead went down. If it was an alpha: its things drop, it's news, the world gains
   * what it was keeping from everyone, and it's dead for a few days. Returns the alpha, if any.
   */
  onKill(victim: ServerPlayer, killer: ServerPlayer): AlphaDef | null {
    const a = this.alphaOf(victim)
    if (!a) return null
    this.live.delete(a.key)
    this.killed.set(a.key, this.host.clock())
    this.missed.delete(a.key)
    const zed = this.host.zed(victim)
    if (zed) zed.boost = 1
    const at = victim.state.pos
    for (const [item, n] of a.drop) this.host.drop(item, n, at)
    const fresh = this.host.unlock(a.unlock)
    const poi = this.host.def().pois.find((p) => p.key === a.poi)
    const by = killer.zombie || killer === victim ? 'Somebody' : this.host.nameOf(killer)
    this.host.radio({ kind: 'alpha', alpha: a.name, by, place: poi?.name ?? a.poi })
    for (const p of this.host.people()) {
      if (dist(p.state.pos, at) > 120) continue
      const name = a.name.charAt(0).toUpperCase() + a.name.slice(1)
      this.host.send(p, {
        kind: 'quest',
        text: fresh
          ? `${name} is dead. Word will get round: Gus will have new stock.`
          : `${name} is dead. For now.`,
      })
    }
    return a
  }
}
