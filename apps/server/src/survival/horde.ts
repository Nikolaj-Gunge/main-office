import {
  Button,
  type InputCommand,
  type Poi,
  type Room,
  type SurvivalDef,
  TICK_DT,
  WEAPONS,
  WeaponId,
  ZombieKind,
  zombieScale,
} from '@office-fps/shared'
import type { ServerPlayer } from '../game.ts'
import type { Point } from '../items.ts'

/** How many of the dead the server runs at once (they share MAX_PLAYERS with the living). */
export const POOL = 22

interface KindStats {
  health: number
  claws: number
  /** Share of your walking speed: shuffling about, and coming for you. */
  wander: number
  chase: number
  /** How far it sees in the dark (m); further in the grey hour and far further at a torch. */
  sight: number
}

export const KINDS: Record<number, KindStats> = {
  [ZombieKind.Walker]: { health: 220, claws: 14, wander: 0.28, chase: 0.68, sight: 15 },
  [ZombieKind.Runner]: { health: 130, claws: 10, wander: 0.36, chase: 1.4, sight: 19 },
  [ZombieKind.Brute]: { health: 1100, claws: 34, wander: 0.26, chase: 0.8, sight: 15 },
  [ZombieKind.Screamer]: { health: 110, claws: 8, wander: 0.3, chase: 0.62, sight: 22 },
  [ZombieKind.Stalker]: { health: 260, claws: 28, wander: 0, chase: 1.5, sight: 60 },
}

const EYE = 1.6
const CHEST = 1.2
/** Seconds of not seeing you before a chase turns into a search. */
const LOSE_SIGHT = 5
/** Seconds of searching before it gives up and wanders again. */
const SEARCH = 9
/** The dead stay this far outside a safe place's clearing (m). */
const SAFE_MARGIN = 14
/** Screamers wait this long between screams (s). */
const SCREAM_EVERY = 16
/** A stalker stands still while someone within this (m) looks its way. */
const WATCH_RANGE = 55
const WATCH_COS = Math.cos((40 * Math.PI) / 180)

type Mood = 'idle' | 'wander' | 'search' | 'chase'

/** A person as the dead perceive them. */
export interface Prey {
  id: number
  pos: Point
  yaw: number
  pitch: number
  crouched: boolean
  /** How far their noise carries right now (m). */
  noise: number
  light: boolean
}

/** One of the dead: where it belongs, what it's doing and what it's after. */
export class Zed {
  kind: ZombieKind = ZombieKind.Walker
  /** Index of the place it belongs to, or -1 for one that roams the woods. */
  home = -1
  /** Part of a story horde: knows where everyone is and never gives up. */
  hunter = false
  mood: Mood = 'idle'
  /** Who it's chasing, and where it last knew them to be. */
  targetId = 0
  lastKnown: Point | null = null
  private since = 0
  private goal: Point | null = null
  private yaw = 0
  private pitch = 0
  private seq = 1
  private swing = false
  private stuckFor = 0
  private unstickFor = 0
  private unstickSide = 1
  private lastPos = { x: 0, z: 0 }
  private nextScream = 0
  private idleUntil = 0
  /** Stalkers: somebody is looking. */
  frozen = false
  private speed = 0

  constructor(private readonly random: () => number) {}

  face(yaw: number): void {
    this.yaw = yaw
    this.pitch = 0
    this.stuckFor = 0
  }

  /** Fresh out of the pool. */
  reset(kind: ZombieKind, home: number, hunter: boolean): void {
    this.kind = kind
    this.home = home
    this.hunter = hunter
    this.mood = 'idle'
    this.targetId = 0
    this.lastKnown = null
    this.goal = null
    this.since = 0
    this.idleUntil = 0
    this.frozen = false
    this.speed = 0
  }

  /** Share of walking speed it moves at right now (the game sets its body up with this). */
  get speedFactor(): number {
    const k = KINDS[this.kind] as KindStats
    return this.mood === 'chase' || this.mood === 'search' ? k.chase : Math.max(0.2, k.wander)
  }

  /** Something made a noise there (or a screamer pointed that way): go and look. */
  alert(at: Point, now: number): void {
    if (this.mood === 'chase') return
    this.mood = 'search'
    this.lastKnown = { ...at }
    this.since = now
  }

  /**
   * Looks and listens (a few times a second): picks up prey it can see or hear, loses prey it
   * can't. Returns 'scream' when a screamer has just spotted someone.
   */
  sense(
    self: ServerPlayer,
    prey: readonly Prey[],
    now: number,
    grey: number,
    clear: (a: Point, b: Point) => boolean,
  ): 'scream' | null {
    const k = KINDS[this.kind] as KindStats
    const me = self.state.pos
    const eye = { x: me.x, y: me.y + EYE * zombieScale(this.kind), z: me.z }
    let seen: Prey | null = null
    let seenD = Number.POSITIVE_INFINITY
    let heard: Prey | null = null
    for (const p of prey) {
      const dx = p.pos.x - me.x
      const dz = p.pos.z - me.z
      const d = Math.hypot(dx, dz)
      if (this.hunter && d < seenD) {
        seen = p
        seenD = d
        continue
      }
      if (d < p.noise && (!heard || d < Math.hypot(heard.pos.x - me.x, heard.pos.z - me.z)))
        heard = p
      let sight = k.sight * (1 + grey * 0.7) * (p.light ? 2.1 : 1) * (p.crouched ? 0.6 : 1)
      // What it's already chasing is harder to lose than to find.
      if (p.id === this.targetId && this.mood === 'chase') sight *= 1.5
      if (d > sight || d >= seenD) continue
      // It sees what's in front of it; right next to it, it just knows.
      const facing = (-Math.sin(this.yaw) * dx - Math.cos(this.yaw) * dz) / Math.max(d, 1e-3)
      if (d > 3.5 && facing < 0.2 && this.mood !== 'chase') continue
      if (!clear(eye, { x: p.pos.x, y: p.pos.y + CHEST, z: p.pos.z })) continue
      seen = p
      seenD = d
    }
    if (seen) {
      const fresh = this.mood !== 'chase'
      this.mood = 'chase'
      this.targetId = seen.id
      this.lastKnown = { ...seen.pos }
      this.since = now
      if (this.kind === ZombieKind.Screamer && fresh && now >= this.nextScream) {
        this.nextScream = now + SCREAM_EVERY
        return 'scream'
      }
      return null
    }
    if (heard) this.alert(heard.pos, now)
    if (this.mood === 'chase' && now - this.since > LOSE_SIGHT) {
      this.mood = 'search'
      this.since = now
      this.targetId = 0
    } else if (this.mood === 'search' && now - this.since > SEARCH) {
      this.mood = 'wander'
      this.lastKnown = null
      this.goal = null
    }
    return null
  }

  /** Stalkers: stand dead still while anyone is looking at you. */
  watch(self: ServerPlayer, prey: readonly Prey[], clear: (a: Point, b: Point) => boolean): void {
    const me = self.state.pos
    this.frozen = false
    for (const p of prey) {
      const dx = me.x - p.pos.x
      const dy = me.y + 1 - (p.pos.y + EYE)
      const dz = me.z - p.pos.z
      const d = Math.hypot(dx, dy, dz)
      if (d > WATCH_RANGE || d < 0.5) continue
      const cp = Math.cos(p.pitch)
      const look =
        (-Math.sin(p.yaw) * cp * dx + Math.sin(p.pitch) * dy - Math.cos(p.yaw) * cp * dz) / d
      if (look < WATCH_COS) continue
      if (!clear({ x: p.pos.x, y: p.pos.y + EYE, z: p.pos.z }, { x: me.x, y: me.y + 1.3, z: me.z }))
        continue
      this.frozen = true
      return
    }
  }

  /** This tick's input. `home` is where it belongs (to wander around), `safe` where it may not go. */
  think(
    self: ServerPlayer,
    world: {
      def: SurvivalDef
      now: number
      tick: number
      target: Point | null
      crowd: readonly Point[]
      rooms: readonly Room[]
    },
  ): InputCommand {
    const s = self.state
    if (!s.alive) return this.command(0, world.tick)
    const me = s.pos
    let buttons = 0
    const { def, now } = world
    const chasing = this.mood === 'chase' && world.target !== null
    let goal: Point | null = chasing ? world.target : this.mood === 'search' ? this.lastKnown : null

    if (!goal) {
      // Nothing to hunt: stand about, then shuffle somewhere nearby (or, for roamers, far).
      if (this.goal && Math.hypot(this.goal.x - me.x, this.goal.z - me.z) < 1.5) {
        this.goal = null
        this.mood = 'idle'
        this.idleUntil = now + 2 + this.random() * 9
      }
      if (!this.goal && now >= this.idleUntil && KINDS[this.kind]?.wander) {
        const home: Poi | undefined = def.pois[this.home]
        const reach = home ? Math.min(home.r, 26) : 40 + this.random() * 60
        const a = this.random() * Math.PI * 2
        const from = home ? { x: home.x, z: home.z } : me
        const r = Math.sqrt(this.random()) * reach
        this.goal = { x: from.x + Math.cos(a) * r, y: me.y, z: from.z + Math.sin(a) * r }
        this.mood = 'wander'
      }
      goal = this.goal
    } else if (this.mood === 'search' && Math.hypot(goal.x - me.x, goal.z - me.z) < 1.5) {
      // Got to where the noise was: look around.
      this.yaw += 1.2 * TICK_DT
      goal = null
    }

    // Never into a safe place: turn round at its edge and forget.
    if (goal) {
      for (const p of def.pois) {
        if (!p.safe) continue
        const edge = p.r + SAFE_MARGIN
        if (
          Math.hypot(goal.x - p.x, goal.z - p.z) < edge &&
          Math.hypot(me.x - p.x, me.z - p.z) < edge + 4
        ) {
          this.mood = 'wander'
          this.targetId = 0
          this.lastKnown = null
          const away = Math.atan2(me.z - p.z, me.x - p.x)
          this.goal = {
            x: p.x + Math.cos(away) * (edge + 30),
            y: me.y,
            z: p.z + Math.sin(away) * (edge + 30),
          }
          goal = this.goal
        }
      }
    }

    const stalker = this.kind === ZombieKind.Stalker
    if (stalker && this.frozen) return this.command(0, world.tick)

    let flat = Number.POSITIVE_INFINITY
    if (goal) {
      // Through the door, if one of us is indoors and the other isn't.
      const via = doorBetween(world.rooms, me, goal)
      const to = via ?? goal
      const dx = to.x - me.x
      const dz = to.z - me.z
      flat = via ? Number.POSITIVE_INFINITY : Math.hypot(dx, dz)
      const want = Math.atan2(-dx, -dz)
      const dy = chasing && !via ? goal.y + CHEST - (me.y + EYE * zombieScale(this.kind)) : 0
      const pitch = chasing && !via ? Math.atan2(dy, Math.max(flat, 0.1)) : 0
      const fast = this.kind === ZombieKind.Runner || stalker
      this.turnTowards(want, pitch, (fast ? 10 : 5) * TICK_DT)
      if (!chasing || flat > 1) buttons |= Button.Forward
    }

    // Keep a little apart from the others (nobody collides with anybody).
    let push = 0
    const fx = -Math.sin(this.yaw)
    const fz = -Math.cos(this.yaw)
    for (const o of world.crowd) {
      const ox = me.x - o.x
      const oz = me.z - o.z
      const d = Math.hypot(ox, oz)
      if (d > 0.9 || d < 1e-3) continue
      push += ((ox * -fz + oz * fx) / d) * ((0.9 - d) / 0.9)
    }
    if (push > 0.15) buttons |= Button.Right
    else if (push < -0.15) buttons |= Button.Left

    // In reach: claw (a fresh click every other tick; the claws' own cooldown paces it).
    const reach = (WEAPONS[WeaponId.Claws].range - 0.2) * zombieScale(this.kind)
    if (chasing && flat < reach) {
      this.swing = !this.swing
      if (this.swing) buttons |= Button.Fire
    }

    // Stuck on a tree or a wall: hop and sidestep for a moment.
    const moved = Math.hypot(me.x - this.lastPos.x, me.z - this.lastPos.z)
    this.lastPos = { x: me.x, z: me.z }
    const trying = (buttons & Button.Forward) !== 0
    this.stuckFor = trying && moved < 0.25 * TICK_DT ? this.stuckFor + TICK_DT : 0
    if (this.stuckFor > 0.7) {
      this.stuckFor = 0
      this.unstickFor = 0.6
      this.unstickSide = this.random() < 0.5 ? -1 : 1
      buttons |= Button.Jump
      // Wandering into a wall: pick somewhere else next time.
      if (!chasing && this.mood === 'wander') this.goal = null
    }
    if (this.unstickFor > 0) {
      this.unstickFor -= TICK_DT
      buttons |= this.unstickSide > 0 ? Button.Right : Button.Left
    }
    return this.command(buttons, world.tick)
  }

  /** True when its speed changed since the last call (the body needs setting up again). */
  speedChanged(): boolean {
    const next = this.speedFactor
    if (next === this.speed) return false
    this.speed = next
    return true
  }

  private command(buttons: number, viewTick: number): InputCommand {
    return { seq: this.seq++, buttons, yaw: this.yaw, pitch: this.pitch, viewTick }
  }

  private turnTowards(yaw: number, pitch: number, maxStep: number): void {
    let d = (yaw - this.yaw) % (Math.PI * 2)
    if (d > Math.PI) d -= Math.PI * 2
    if (d < -Math.PI) d += Math.PI * 2
    this.yaw += Math.max(-maxStep, Math.min(maxStep, d))
    this.pitch += Math.max(-maxStep, Math.min(maxStep, pitch - this.pitch))
  }
}

const inside = (r: Room, p: Point) =>
  p.x > r.min[0] && p.x < r.max[0] && p.z > r.min[1] && p.z < r.max[1]

/**
 * If exactly one of `a` and `b` is inside a room, the door of that room to go through (the one
 * that makes the shortest trip) — unless `a` is at it already. Otherwise null: go straight.
 */
export function doorBetween(rooms: readonly Room[], a: Point, b: Point): Point | null {
  for (const room of rooms) {
    const aIn = inside(room, a)
    if (aIn === inside(room, b)) continue
    let best: Point | null = null
    let bestD = Number.POSITIVE_INFINITY
    for (const [x, y, z] of room.doors) {
      const d = Math.hypot(x - a.x, z - a.z) + Math.hypot(x - b.x, z - b.z)
      if (d < bestD) {
        bestD = d
        best = { x, y, z }
      }
    }
    if (!best) return null
    // Door points lie just outside: from inside, walk to it; from outside, walk to it and then
    // on through (once close, head straight for the goal).
    return Math.hypot(best.x - a.x, best.z - a.z) < (aIn ? 0.8 : 1.1) ? null : best
  }
  return null
}

/** Which kinds live at a place: mostly walkers, with whatever makes the place special. */
export function kindFor(
  poi: Poi | undefined,
  slot: number,
  roll: number,
  dark: boolean,
): ZombieKind {
  if (poi?.kind === 'quarry' && slot === 0) return ZombieKind.Brute
  if (poi?.key === 'site7')
    return slot === 0 ? ZombieKind.Brute : roll < 0.4 ? ZombieKind.Stalker : ZombieKind.Runner
  if (poi?.kind === 'town') {
    if (slot === 3) return ZombieKind.Screamer
    if (slot === 7 && poi.key === 'ashford') return ZombieKind.Brute
    return roll < 0.22 ? ZombieKind.Runner : ZombieKind.Walker
  }
  if (poi?.kind === 'checkpoint' || poi?.kind === 'bunker' || poi?.kind === 'crash') {
    return roll < 0.35 ? ZombieKind.Runner : ZombieKind.Walker
  }
  if (poi?.kind === 'church') return roll < 0.15 ? ZombieKind.Screamer : ZombieKind.Walker
  if (!poi) {
    // The woods: mostly shamblers; in the dark, now and then something worse.
    if (roll < 0.62) return ZombieKind.Walker
    if (roll < 0.8) return ZombieKind.Runner
    if (roll < 0.9) return ZombieKind.Screamer
    return dark ? ZombieKind.Stalker : ZombieKind.Walker
  }
  return roll < 0.15 ? ZombieKind.Runner : ZombieKind.Walker
}
