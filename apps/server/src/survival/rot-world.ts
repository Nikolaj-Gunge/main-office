import {
  BIRDS_DRAW,
  BIRDS_HEARD,
  BIRDS_NEAR,
  BIRDS_SETTLE,
  BIRDS_SHOT,
  type Flock,
  flocksOf,
  heightAt,
  infectionStage,
  MOODS,
  type Notice,
  type RotMood,
  ServerMsg,
  type SurvivalDef,
  type SurvivalSelf,
  WEAPONS,
  ZombieKind,
} from '@office-fps/shared'
import type { Game, ServerPlayer } from '../game.ts'
import type { Point } from '../items.ts'
import type { Zed } from './horde.ts'
import { ambushSpot, CHASE_NEAR, Rot, type RotEventKind, unseen, type Watcher } from './rot.ts'

/** A car alarm goes on this long (s), and pulls the dead from this far (m). */
export const ALARM_SECONDS = 25
export const ALARM_DRAW = 80
/** People hear a car alarm or a scream from this far (m). */
const ALARM_HEARD = 300
const SCREAM_HEARD = 160
/** The dead after somebody who is relaxing give up once they're this far off, out of sight (m). */
const GIVE_UP = 16

/** What the Rot gets to do in the world (the survival director provides it). */
export interface RotHost {
  def(): SurvivalDef
  readonly random: () => number
  /** Seconds since the server started. */
  now(): number
  /** 0 at night … 1 in daylight. */
  light(): number
  /** The living, what they carry, and whether they're in a safe place. */
  people(): { player: ServerPlayer; self: SurvivalSelf; safe: boolean }[]
  /** The dead walking about. */
  zombies(): { player: ServerPlayer; zed: Zed }[]
  clear(a: Point, b: Point): boolean
  /** Brings one more of the dead out at `at` (going to look at `goal`, if any). */
  spawn(at: Point, kind: ZombieKind, goal: Point | null): boolean
  /** Parked cars nobody sits in. */
  parked(): Point[]
  send(player: ServerPlayer, msg: Parameters<Game['sendTo']>[1]): void
  notice(player: ServerPlayer, kind: Notice['kind'], text: string): void
  broadcast(): void
}

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z)

const watcher = (p: ServerPlayer): Watcher => ({
  pos: p.state.pos,
  yaw: p.state.yaw,
  vel: { x: p.state.vel.x, z: p.state.vel.z },
})

/**
 * The Rot in the world: runs the tension director (rot.ts) once a second and carries out its
 * events, makes the dead give up on people who are getting their breath back, and keeps the
 * birds and car alarms that tell everyone where somebody is.
 */
export class RotWorld {
  readonly director: Rot
  private flocks: Flock[] = []
  /** Flocks in the air or gone: index → when they're back (s). */
  private readonly away = new Map<number, number>()
  private alarms: { at: Point; until: number; next: number }[] = []
  private night = 0

  constructor(private readonly host: RotHost) {
    this.director = new Rot(host.random)
  }

  reset(): void {
    this.flocks = flocksOf(this.host.def())
    this.away.clear()
    this.alarms = []
    this.night = 0
    this.director.endNight()
  }

  get mood(): RotMood | null {
    return this.director.mood
  }

  get flockList(): readonly Flock[] {
    return this.flocks
  }

  /** Dusk: a new night and its mood. Returns what the Haven radio says about it. */
  dusk(seed: number): string {
    const mood = this.director.startNight(seed, this.night++)
    return MOODS[mood].news
  }

  dawn(): void {
    this.director.endNight()
  }

  /** Woken up in the middle of the night (a new world): it has a mood, unannounced. */
  midnight(seed: number): void {
    this.director.startNight(seed, this.night++)
  }

  /** What every client is told (SurvivalShared.rot). */
  shared(): { mood?: RotMood; birds: number[] } {
    return { ...(this.mood ? { mood: this.mood } : {}), birds: [...this.away.keys()] }
  }

  hurt(victim: ServerPlayer, amount: number): void {
    this.director.hurt(victim.id, amount)
  }

  spotted(player: ServerPlayer): void {
    this.director.spotted(player.id)
  }

  forget(player: ServerPlayer): void {
    this.director.forget(player.id)
  }

  /** Somebody is having a breather: no new roaming dead around them. */
  relaxing(player: ServerPlayer): boolean {
    return this.director.relaxing(player.id)
  }

  /** A gun went off: the birds within earshot take off (any gun, even a quiet one up close). */
  shot(shooter: ServerPlayer): void {
    const noise = WEAPONS[shooter.state.weapon.id].noise
    const reach = noise < 20 ? BIRDS_NEAR * 1.5 : BIRDS_SHOT
    this.flocks.forEach((f, i) => {
      if (dist(f, shooter.state.pos) < reach) this.scatter(i)
    })
  }

  /** A few times a second: birds near anybody take off; car alarms keep pulling the dead in. */
  step(): void {
    const now = this.host.now()
    let back = false
    for (const [i, until] of this.away) {
      if (now < until) continue
      this.away.delete(i)
      back = true
    }
    if (back) this.host.broadcast()
    for (const p of this.host.people()) {
      if (p.safe) continue
      this.flocks.forEach((f, i) => {
        if (dist(f, p.player.state.pos) < BIRDS_NEAR) this.scatter(i)
      })
    }
    this.alarms = this.alarms.filter((a) => now < a.until)
    for (const a of this.alarms) {
      if (now < a.next) continue
      a.next = now + 3
      this.draw(a.at, ALARM_DRAW)
    }
  }

  /** A flock takes off: everybody near hears it, and the dead close by come to look. */
  scatter(i: number): boolean {
    const f = this.flocks[i]
    if (!f || this.away.has(i)) return false
    const now = this.host.now()
    this.away.set(i, now + BIRDS_SETTLE)
    const at = { x: f.x, y: heightAt(this.host.def().terrain, f.x, f.z) + 1, z: f.z }
    for (const p of this.host.people()) {
      if (dist(p.player.state.pos, at) > BIRDS_HEARD) continue
      this.host.send(p.player, {
        type: ServerMsg.Notice,
        notice: { kind: 'sound', text: '', sound: 'birds', flock: i, at },
      })
    }
    this.draw(at, BIRDS_DRAW)
    this.host.broadcast()
    return true
  }

  /** Whether flock `i` is in the air (tests). */
  isAway(i: number): boolean {
    return this.away.has(i)
  }

  /** The dead within `radius` of `at` heard something there. */
  private draw(at: Point, radius: number): void {
    const now = this.host.now()
    for (const { player, zed } of this.host.zombies()) {
      if (dist(player.state.pos, at) > radius) continue
      const r = () => (this.host.random() - 0.5) * 6
      zed.alert({ x: at.x + r(), y: at.y, z: at.z + r() }, now)
    }
  }

  /** Once a second: tensions move on, events happen, the dead let go of those relaxing. */
  tick(): void {
    const now = this.host.now()
    const people = this.host.people()
    const zombies = this.host.zombies()
    const dark = 1 - this.host.light()
    const events = this.director.update(
      now,
      people.map(({ player, self, safe }) => {
        const w = player.state.weapon
        const def = WEAPONS[w.id]
        const ammo = def.ammoType ? Math.min(1, (w.ammo + w.reserve) / Math.max(1, def.magSize)) : 1
        return {
          id: player.id,
          health: player.health / Math.max(1, player.maxHealth),
          ammo,
          dark,
          infection: infectionStage(self.infected),
          chasers: zombies.filter(
            ({ player: z, zed }) =>
              zed.mood === 'chase' &&
              zed.targetId === player.id &&
              dist(z.state.pos, player.state.pos) < CHASE_NEAR,
          ).length,
          safe,
        }
      }),
    )
    for (const e of events) {
      const who = people.find((p) => p.player.id === e.id)
      if (who)
        this.happen(
          who.player,
          e.kind,
          people.map((p) => p.player),
        )
    }
    // Relaxing: whatever is after them and can't see them gives up and goes to look instead.
    for (const { player, zed } of zombies) {
      if (zed.mood !== 'chase' || zed.hunter || zed.siege) continue
      if (!this.director.relaxing(zed.targetId)) continue
      const target = people.find((p) => p.player.id === zed.targetId)?.player
      if (!target || dist(target.state.pos, player.state.pos) < GIVE_UP) continue
      const eye = { ...player.state.pos, y: player.state.pos.y + 1.6 }
      const chest = { ...target.state.pos, y: target.state.pos.y + 1.2 }
      if (this.host.clear(eye, chest)) continue
      // Lost them: off to where it last saw them, a sniff about, then away (horde.ts).
      zed.mood = 'lost'
      zed.targetId = 0
    }
    for (const p of people) {
      const m = this.director.message(p.player.id)
      if (m) this.host.send(p.player, { type: ServerMsg.Tension, ...m })
    }
  }

  /** Carries out one of the director's events for `player` (falling back to an ambush). */
  happen(player: ServerPlayer, kind: RotEventKind, everyone: readonly ServerPlayer[]): string {
    const random = this.host.random
    const me = player.state.pos
    if (kind === 'alarm') {
      const car = this.host
        .parked()
        .filter((c) => dist(c, me) > 30 && dist(c, me) < 130)
        .sort((a, b) => dist(a, me) - dist(b, me))[0]
      if (car) {
        this.alarm(car, everyone)
        return 'alarm'
      }
      kind = 'ambush'
    }
    if (kind === 'scream') {
      // Somewhere off in the trees, out of sight: the dead around there come towards you.
      const a = random() * Math.PI * 2
      const r = 70 + random() * 30
      const at = {
        x: me.x + Math.sin(a) * r,
        y: 0,
        z: me.z + Math.cos(a) * r,
      }
      at.y = heightAt(this.host.def().terrain, at.x, at.z) + 1.5
      for (const p of everyone) {
        if (dist(p.state.pos, at) > SCREAM_HEARD) continue
        this.host.send(p, { type: ServerMsg.Notice, notice: { kind: 'scream', text: '', at } })
      }
      let drawn = 0
      for (const { player: z, zed } of this.host
        .zombies()
        .sort((x, y) => dist(x.player.state.pos, at) - dist(y.player.state.pos, at))) {
        if (drawn >= 4 || dist(z.state.pos, at) > 110) break
        zed.alert(me, this.host.now())
        drawn++
      }
      // Nothing out there to answer it: one comes anyway.
      if (drawn === 0) this.host.spawn(at, ZombieKind.Walker, me)
      return 'scream'
    }
    const spot = ambushSpot(
      this.host.def(),
      watcher(player),
      everyone.map(watcher),
      (a, b) => this.host.clear(a, b),
      random,
    )
    if (!spot) return 'none'
    const dark = this.host.light() < 0.3
    const n = (dark ? 3 : 2) + Math.floor(random() * 2)
    const mood = this.director.moodDef
    for (let k = 0; k < n; k++) {
      const a = random() * Math.PI * 2
      const at = { x: spot.x + Math.cos(a) * 2.5, y: spot.y, z: spot.z + Math.sin(a) * 2.5 }
      at.y = heightAt(this.host.def().terrain, at.x, at.z)
      const roll = random()
      const kind =
        roll < mood.runners + (dark ? 0.15 : 0.05) ? ZombieKind.Runner : ZombieKind.Walker
      // They're coming this way, but don't know it yet: towards where you're headed.
      if (!this.host.spawn(at, kind, k === 0 ? null : spot)) break
    }
    return 'ambush'
  }

  /** A parked car's alarm goes off: heard far off, and the dead come to it while it wails. */
  alarm(at: Point, everyone: readonly ServerPlayer[]): void {
    const now = this.host.now()
    const where = { x: at.x, y: at.y + 0.8, z: at.z }
    this.alarms.push({ at: where, until: now + ALARM_SECONDS, next: now })
    for (const p of everyone) {
      if (dist(p.state.pos, where) > ALARM_HEARD) continue
      this.host.send(p, {
        type: ServerMsg.Notice,
        notice: { kind: 'sound', text: '', sound: 'alarm', at: where, seconds: ALARM_SECONDS },
      })
    }
  }

  /** Whether somewhere is out of everybody's sight (tests and the director). */
  unseenByAll(at: Point, everyone: readonly ServerPlayer[]): boolean {
    return everyone.every((p) => unseen(watcher(p), at, (a, b) => this.host.clear(a, b)))
  }
}
