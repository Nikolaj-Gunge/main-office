import { Button, type InputCommand, type PlayerState, WEAPONS } from '@office-fps/shared'
import type { Point } from '../items.ts'

/**
 * What goes on in a bandit's head (ROADMAP 6.10): stand about the camp, walk the watch, go and
 * look when a shot rings out, and when somebody shows themselves, get behind something and shoot
 * from it. It only decides input (like a player's); the game fires the gun, so every shot is a
 * real one through the same hitscan as anybody's.
 */

/** Eye height (m above the feet). */
export const EYE = 1.6
/** Where it aims on a person (and on one of the dead, a bit lower: they stoop). */
const CHEST = 1.25
const ZOMBIE_CHEST = 1.1
/** Fastest it turns (rad/s). */
const TURN_RATE = Math.PI * 2.2
/** Looks for who it can see this often (ticks): line-of-sight rays aren't free. */
const LOOK_EVERY = 6
/** Seconds without seeing its target before it goes to look where it last was. */
const LOSE_SECONDS = 6
/** Seconds it spends searching where it heard something before going back. */
const SEARCH_SECONDS = 12
/** Never closer than this to one of the dead if it can help it (m). */
const ZOMBIE_SPACE = 6
/** Only bothers with the dead this close (m): further off they're no danger. */
const ZOMBIE_SIGHT = 25
/** A step out from behind cover to shoot (m). */
const PEEK_STEP = 1.1

/** Somebody it might shoot at: a survivor, or one of the dead. */
export interface Threat {
  id: number
  pos: Point
  zombie: boolean
  /** Their torch is on (seen from much further at night, and easier to hit). */
  lit: boolean
  crouched: boolean
  /** Worn camouflage: seen this much less far (0–1). */
  hidden: number
}

/** What a bandit knows this tick. */
export interface BanditView {
  /** Seconds (server clock). */
  now: number
  dt: number
  /** 0 at night … 1 in daylight. */
  light: number
  threats: readonly Threat[]
  /** Nothing solid between two points. */
  clear(a: Point, b: Point): boolean
  /** A spot behind something solid near `near`, on the far side from `from`; or null. */
  cover(near: Point, from: Point): Point | null
  /** Where to be when nothing is going on (its post, the watch's next stop, the raid's road). */
  goal: Point | null
  /** Camps: never chases anybody further than this from home. Raiders: null. */
  leash: { x: number; z: number; r: number } | null
}

export type BanditMood = 'idle' | 'alert' | 'fight'
type Tactic = 'move' | 'hide' | 'peek'

/**
 * How far it sees somebody (m): far by day, close in the dark, and a torch gives you away.
 * Crouching and camouflage help.
 */
export function sightRange(light: number, t: Threat): number {
  let range = 18 + 47 * Math.max(0, Math.min(1, light))
  if (t.lit) range = Math.max(range, 60)
  if (t.crouched) range *= 0.7
  range *= 1 - Math.max(0, Math.min(0.6, t.hidden))
  return t.zombie ? Math.min(range, ZOMBIE_SIGHT) : range
}

/**
 * How far off (rad) a shot may go: steady up close, worse with distance, much worse in the dark
 * (unless you're lit up by your own torch), and worse still just after it starts tracking you.
 */
export function aimError(distance: number, light: number, lit: boolean, tracked = 9): number {
  const dark = 1 - Math.max(0, Math.min(1, light))
  const base = 0.012 + distance * 0.0016 + dark * (lit ? 0.018 : 0.055)
  return base * (1 + Math.max(0, 1.5 - tracked) * 0.4)
}

const dist2 = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z)

export class BanditBrain {
  mood: BanditMood = 'idle'
  /** Who it's after (player id), 0 for nobody. */
  targetId = 0
  /** Set the moment it first sees somebody living (whoever reads it clears it): the shout. */
  spotted: Threat | null = null
  yaw = 0
  pitch = 0
  private seq = 1
  private ticks = 0
  private readonly random: () => number
  private seen = false
  private lastSeen: Point | null = null
  private lastSeenAt = Number.NEGATIVE_INFINITY
  private trackSince = 0
  private reactAt = 0
  private tactic: Tactic = 'move'
  private tacticUntil = 0
  private cycles = 0
  private coverSpot: Point | null = null
  private peekSpot: Point | null = null
  private burst = 0
  private lastAmmo = -1
  private fireToggle = false
  private errYaw = 0
  private errPitch = 0
  private heard: Point | null = null
  private heardUntil = 0
  private stuckFor = 0
  private last = { x: 0, z: 0 }
  private sweepAt = 0
  private sweepYaw = 0

  constructor(random: () => number = Math.random) {
    this.random = random
  }

  /** Back to calm (a fresh spawn), facing `yaw`. */
  reset(yaw: number): void {
    this.mood = 'idle'
    this.targetId = 0
    this.spotted = null
    this.yaw = yaw
    this.sweepYaw = yaw
    this.pitch = 0
    this.seen = false
    this.lastSeen = null
    this.coverSpot = null
    this.peekSpot = null
    this.heard = null
    this.burst = 0
    this.lastAmmo = -1
  }

  /** A shot, a shout or a scream from over there: unless already fighting, it goes to look. */
  hear(at: Point, now: number): void {
    if (this.mood === 'fight') return
    this.mood = 'alert'
    this.heard = { ...at }
    this.heardUntil = now + SEARCH_SECONDS
  }

  /** Hit by somebody it hadn't seen: it knows roughly where from, and goes for cover. */
  hurt(from: Point, now: number): void {
    if (this.mood === 'fight') return
    this.hear(from, now)
    this.coverSpot = null
  }

  think(self: PlayerState, view: BanditView): InputCommand {
    this.ticks++
    if (!self.alive) return this.command(0)
    const me = self.pos
    const { now } = view

    // --- Who can it see (a few times a second) ---------------------------------------------
    if (this.ticks % LOOK_EVERY === 0 || this.targetId === 0) {
      const target = this.look(self, view)
      this.seen = target !== null
      if (target) {
        if (this.mood !== 'fight' || target.id !== this.targetId) {
          // First sight of somebody: a moment to react (and to shout).
          this.reactAt = now + 0.45 + this.random() * 0.6
          this.trackSince = now
          if (!target.zombie && this.mood !== 'fight') this.spotted = target
          this.coverSpot = null
          this.tactic = 'move'
          this.tacticUntil = now + 5
        }
        this.mood = 'fight'
        this.targetId = target.id
        this.lastSeen = { ...target.pos }
        this.lastSeenAt = now
      }
    }

    if (this.mood === 'fight') {
      const target = view.threats.find((t) => t.id === this.targetId)
      if (!target || now - this.lastSeenAt > LOSE_SECONDS) {
        // Gone: go and look where it was last seen.
        this.mood = 'alert'
        this.heard = this.lastSeen
        this.heardUntil = now + SEARCH_SECONDS
        this.targetId = 0
        this.coverSpot = null
      } else return this.fight(self, view, target)
    }

    if (this.mood === 'alert') {
      if (!this.heard || now > this.heardUntil) {
        this.mood = 'idle'
        this.heard = null
      } else {
        const to = this.leashed(this.heard, view)
        if (dist2(me, to) < 2) return this.stand(view, false, true)
        return this.walk(self, to, view, false)
      }
    }

    // --- Nothing going on: its post, or the watch ----------------------------------------
    const goal = view.goal
    if (goal && dist2(me, goal) > 1.2) return this.walk(self, goal, view, true)
    return this.stand(view, false, false)
  }

  /** The nearest threat it can see right now (people over the dead when both are close). */
  private look(self: PlayerState, view: BanditView): Threat | null {
    const eye = { x: self.pos.x, y: self.pos.y + EYE, z: self.pos.z }
    let best: Threat | null = null
    let bestScore = Number.POSITIVE_INFINITY
    for (const t of view.threats) {
      const d = dist2(self.pos, t.pos)
      if (d > sightRange(view.light, t)) continue
      if (view.leash && !t.zombie && dist2(t.pos, view.leash) > view.leash.r + 25) continue
      // The one it is already fighting stays first; the dead only matter close up.
      const score = (t.id === this.targetId ? -10 : 0) + d + (t.zombie ? 8 : 0)
      if (score >= bestScore) continue
      const chest = { x: t.pos.x, y: t.pos.y + (t.zombie ? ZOMBIE_CHEST : CHEST), z: t.pos.z }
      if (!view.clear(eye, chest)) continue
      best = t
      bestScore = score
    }
    return best
  }

  /** In a fight: to cover, crouch, step out, a few shots, back again. */
  private fight(self: PlayerState, view: BanditView, t: Threat): InputCommand {
    const me = self.pos
    const { now } = view
    const d = dist2(me, t.pos)
    const aimY = t.pos.y + (t.zombie ? ZOMBIE_CHEST : CHEST)
    const dx = t.pos.x - me.x
    const dz = t.pos.z - me.z
    const wantYaw = Math.atan2(-dx, -dz)
    const wantPitch = Math.atan2(aimY - (me.y + EYE), Math.hypot(dx, dz))
    const weapon = WEAPONS[self.weapon.id]

    // Did the last press fire? (the burst counts down by what left the magazine)
    if (this.lastAmmo >= 0 && self.weapon.ammo < this.lastAmmo) {
      this.burst--
      this.rollError(d, view, t)
    }
    this.lastAmmo = self.weapon.ammo

    let buttons = 0
    let crouch = false
    let shoot = false

    if (t.zombie && d < ZOMBIE_SPACE) {
      // One of the dead too close: back off and keep shooting.
      buttons |= this.steer(me, { x: me.x - dx, z: me.z - dz }, wantYaw)
      shoot = this.seen
    } else {
      if (!this.coverSpot) this.pickCover(me, t, view)
      const cover = this.coverSpot ?? me
      if (this.tactic === 'move') {
        if (dist2(me, cover) < 0.6 || now > this.tacticUntil || this.stuck(me, view.dt, true)) {
          this.tactic = 'hide'
          this.tacticUntil = now + 0.5 + this.random() * 1.0
        } else buttons |= this.steer(me, cover, this.yaw) | (d > 12 ? Button.Sprint : 0)
      } else if (this.tactic === 'hide') {
        crouch = true
        if (dist2(me, cover) > 0.5) buttons |= this.steer(me, cover, this.yaw)
        if (now > this.tacticUntil && self.weapon.reload === 0 && self.weapon.ammo > 0) {
          this.tactic = 'peek'
          this.tacticUntil = now + 2.6
          this.burst = 2 + Math.floor(this.random() * 3)
          this.rollError(d, view, t)
        }
      } else {
        const peek = this.peekSpot ?? cover
        if (dist2(me, peek) > 0.4) buttons |= this.steer(me, peek, this.yaw)
        shoot = this.seen
        if (this.burst <= 0 || now > this.tacticUntil || self.weapon.ammo === 0) {
          this.tactic = 'hide'
          this.tacticUntil = now + 0.8 + this.random() * 1.4
          this.cycles++
          // Every few rounds, find somewhere new (closer in if it's a long shot).
          if (this.cycles % 3 === 0) this.coverSpot = null
        }
      }
    }

    // Aim, with the error of the moment.
    this.turnTowards(wantYaw + this.errYaw, wantPitch + this.errPitch, TURN_RATE * view.dt)
    if (self.weapon.ammo === 0 && self.weapon.reload === 0) buttons |= Button.Reload
    else if (shoot && now >= this.reactAt && self.weapon.reload === 0) {
      const off = Math.abs(angleDiff(wantYaw + this.errYaw, this.yaw))
      if (off < 0.08) {
        if (weapon.fireMode === 'auto') buttons |= Button.Fire
        else {
          this.fireToggle = !this.fireToggle
          if (this.fireToggle) buttons |= Button.Fire
        }
      }
      if (weapon.scoped || d > 12) buttons |= Button.Aim
    }
    if (crouch) buttons |= Button.Crouch
    return this.command(buttons)
  }

  /** New aim error for the next shot (they're each their own). */
  private rollError(d: number, view: BanditView, t: Threat): void {
    const e = aimError(d, view.light, t.lit, view.now - this.trackSince)
    this.errYaw = (this.random() * 2 - 1) * e
    this.errPitch = (this.random() * 2 - 1) * e * 0.6
  }

  /** Somewhere to duck behind, and the spot beside it to shoot from. */
  private pickCover(me: Point, t: Threat, view: BanditView): void {
    let spot = view.cover(me, t.pos)
    if (spot && view.leash && dist2(spot, view.leash) > view.leash.r) spot = null
    const cover = spot ?? { ...me }
    this.coverSpot = cover
    this.tactic = 'move'
    this.tacticUntil = view.now + 5
    // Step out sideways (whichever side sees them), or stand up where it is.
    const ax = cover.x - t.pos.x
    const az = cover.z - t.pos.z
    const len = Math.hypot(ax, az) || 1
    const side = { x: -az / len, z: ax / len }
    const aim = { x: t.pos.x, y: t.pos.y + CHEST, z: t.pos.z }
    this.peekSpot = cover
    if (!spot) return
    for (const s of this.random() < 0.5 ? [1, -1] : [-1, 1]) {
      const p = {
        x: cover.x + side.x * PEEK_STEP * s,
        y: cover.y,
        z: cover.z + side.z * PEEK_STEP * s,
      }
      if (view.clear({ x: p.x, y: p.y + EYE, z: p.z }, aim)) {
        this.peekSpot = p
        return
      }
    }
  }

  /** Walks somewhere, looking where it's going (or about, at its post). */
  private walk(self: PlayerState, to: Point, view: BanditView, calm: boolean): InputCommand {
    const dx = to.x - self.pos.x
    const dz = to.z - self.pos.z
    this.turnTowards(Math.atan2(-dx, -dz), 0, TURN_RATE * view.dt * (calm ? 0.5 : 1))
    let buttons = this.steer(self.pos, to, this.yaw)
    if (!calm && Math.hypot(dx, dz) > 10) buttons |= Button.Sprint
    if (this.stuck(self.pos, view.dt, true)) buttons |= Button.Jump
    return this.command(buttons)
  }

  /** Stands about, looking this way and that (warily, gun up, when something is off). */
  private stand(view: BanditView, crouch: boolean, wary: boolean): InputCommand {
    if (view.now > this.sweepAt) {
      this.sweepAt = view.now + 2 + this.random() * 3
      this.sweepYaw = this.yaw + (this.random() * 2 - 1) * (wary ? 1.6 : 0.9)
    }
    this.turnTowards(this.sweepYaw, 0, TURN_RATE * view.dt * 0.3)
    return this.command((crouch ? Button.Crouch : 0) | (wary ? Button.Aim : 0))
  }

  /** Clamps a spot to the camp's leash. */
  private leashed(p: Point, view: BanditView): Point {
    const l = view.leash
    if (!l) return p
    const d = dist2(p, l)
    if (d <= l.r) return p
    const k = l.r / d
    return { x: l.x + (p.x - l.x) * k, y: p.y, z: l.z + (p.z - l.z) * k }
  }

  /** Not getting anywhere while trying to move. */
  private stuck(me: Point, dt: number, moving: boolean): boolean {
    const moved = Math.hypot(me.x - this.last.x, me.z - this.last.z)
    this.last = { x: me.x, z: me.z }
    this.stuckFor = moving && moved < 0.6 * dt ? this.stuckFor + dt : 0
    if (this.stuckFor > 1.2) {
      this.stuckFor = 0
      return true
    }
    return false
  }

  /** Movement keys that take it towards `to` while facing `yaw`. */
  private steer(me: Point, to: { x: number; z: number }, yaw: number): number {
    const dx = to.x - me.x
    const dz = to.z - me.z
    const d = Math.hypot(dx, dz)
    if (d < 0.3) return 0
    const f = (dx * -Math.sin(yaw) + dz * -Math.cos(yaw)) / d
    const r = (dx * Math.cos(yaw) + dz * -Math.sin(yaw)) / d
    let b = 0
    if (f > 0.38) b |= Button.Forward
    if (f < -0.38) b |= Button.Back
    if (r > 0.38) b |= Button.Right
    if (r < -0.38) b |= Button.Left
    return b
  }

  private turnTowards(yaw: number, pitch: number, maxStep: number): void {
    const dy = angleDiff(yaw, this.yaw)
    const dp = pitch - this.pitch
    const length = Math.hypot(dy, dp)
    const k = length > maxStep ? maxStep / length : 1
    this.yaw += dy * k
    this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + dp * k))
  }

  private command(buttons: number): InputCommand {
    return { seq: this.seq++, buttons, yaw: this.yaw, pitch: this.pitch, viewTick: 0 }
  }
}

/** Shortest signed difference a − b between two angles. */
function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}
