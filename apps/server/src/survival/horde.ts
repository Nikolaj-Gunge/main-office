import {
  Button,
  heightAt,
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
import { CLAW_TIMING, ClawAttack } from '../claw-attack.ts'
import type { ServerPlayer } from '../game.ts'
import type { Point } from '../items.ts'
import type { Nav } from './pathing.ts'

/** How many of the dead the server runs at once (they share MAX_PLAYERS with the living). */
export const POOL = 30

interface KindStats {
  health: number
  claws: number
  /** Share of your walking speed: shuffling about, and coming for you. */
  wander: number
  chase: number
  /** How far it sees in the dark (m); further by daylight and far further at a torch. */
  sight: number
  /** Battering a barricade: damage per blow (see PLANK_HP). */
  bash: number
}

export const KINDS: Record<number, KindStats> = {
  [ZombieKind.Walker]: { health: 220, claws: 14, wander: 0.28, chase: 0.68, sight: 15, bash: 24 },
  [ZombieKind.Runner]: { health: 130, claws: 10, wander: 0.36, chase: 1.4, sight: 19, bash: 14 },
  [ZombieKind.Brute]: { health: 1100, claws: 34, wander: 0.26, chase: 0.8, sight: 15, bash: 95 },
  [ZombieKind.Screamer]: { health: 110, claws: 8, wander: 0.3, chase: 0.62, sight: 22, bash: 10 },
  [ZombieKind.Stalker]: { health: 260, claws: 28, wander: 0, chase: 1.5, sight: 60, bash: 35 },
  [ZombieKind.Mimic]: { health: 170, claws: 16, wander: 0.2, chase: 0.95, sight: 16, bash: 12 },
}

const EYE = 1.6
const CHEST = 1.2
/** Seconds of not seeing you before a chase turns into a search. */
const LOSE_SIGHT = 5
/** Seconds of looking into a noise before it gives up and wanders again. */
const SEARCH = 9
/** Lost you: seconds to get to where it last knew you were, and of sniffing about there. */
const LOST = 10
const SNIFF = 4
/** Playing dead: up when somebody comes this close (m), after a twitch this long (s). */
const RISE_RANGE = 4
const TWITCH = 0.9
/** Share of a place's walkers that lie among the bodies, and of those that only crawl. */
const PLAY_DEAD = 0.08
const CRAWLER = 0.35
/** Seconds between new paths (spread over the ticks by a random bit). */
const REPLAN = { chase: 0.6, search: 1, wander: 1.6 }
/** The dead stay this far outside a safe place's clearing (m). */
const SAFE_MARGIN = 14
/** Screamers wait this long between screams (s). */
const SCREAM_EVERY = 16
/** A stalker stands still while someone within this (m) looks its way. */
const WATCH_RANGE = 55
const WATCH_COS = Math.cos((40 * Math.PI) / 180)

/**
 * What one of the dead is doing, readable from how it moves: idle (stands about, swaying),
 * wander, investigate (a slow walk to a noise and a look round), chase (fast and straight at
 * you), lost (lost sight of you: goes to where you were, stops and sniffs about, gives up) and
 * dead (lying among the bodies until somebody steps too close).
 */
export type Mood = 'idle' | 'wander' | 'investigate' | 'chase' | 'lost' | 'dead'

/** A person as the dead perceive them. */
export interface Prey {
  id: number
  pos: Point
  yaw: number
  pitch: number
  crouched: boolean
  /** Lying flat: hardly there at all. */
  prone: boolean
  /** How far their noise carries right now (m). */
  noise: number
  light: boolean
  /** Worn camouflage: seen this much less far (0–1). */
  hidden?: number
}

/** One of the dead: where it belongs, what it's doing and what it's after. */
export class Zed {
  kind: ZombieKind = ZombieKind.Walker
  /** Index of the place it belongs to, or -1 for one that roams the woods. */
  home = -1
  /** Part of a story horde: knows where everyone is and never gives up. */
  hunter = false
  /** Part of a siege (story.ts): goes where it's sent, safe places or not. */
  siege = false
  mood: Mood = 'idle'
  /** Who it's chasing, and where it last knew them to be. */
  targetId = 0
  lastKnown: Point | null = null
  /** Playing dead: getting up from this time (it twitches first); a crawler never stands. */
  risingAt = 0
  crawler = false
  /** Lying under a car (lurkers.ts): nothing stirs it but somebody stepping right by. */
  lurking = false
  /** Running from a torch (mimics): ignores everyone until `fleeUntil`. */
  fleeing = false
  private fleeUntil = 0
  /** Lost you: when it got to where you were (and started sniffing about), or 0. */
  private sniffFrom = 0
  /** The way it's following (pathing.ts), the next point on it, and when to look again. */
  private path: Point[] = []
  private step = 0
  private planAt = 0
  private planned: Point | null = null
  /** The path ends at the goal itself (not just as near as it could get). */
  private toGoal = false
  private plannedAt = 0
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
  /** The barricade it is battering (spot index), or -1; and when it may strike next. */
  bashing = -1
  nextBash = 0
  private speed = 0
  /** Winding up, clawing and (after a miss) recovering. */
  private readonly attack = new ClawAttack()

  constructor(private readonly random: () => number) {}

  face(yaw: number): void {
    this.yaw = yaw
    this.pitch = 0
    this.stuckFor = 0
    this.attack.reset()
  }

  /** How far through winding up a blow (0–1), or 0. */
  get windup(): number {
    return this.attack.windup
  }

  /** Its blow landed, or clawed at air. */
  struck(landed: boolean): void {
    this.attack.struck(landed)
  }

  /** Fresh out of the pool. */
  reset(kind: ZombieKind, home: number, hunter: boolean): void {
    this.kind = kind
    this.home = home
    this.hunter = hunter
    this.siege = false
    this.mood = 'idle'
    this.targetId = 0
    this.lastKnown = null
    this.goal = null
    this.since = 0
    this.sniffFrom = 0
    this.risingAt = 0
    this.crawler = false
    this.lurking = false
    this.fleeing = false
    this.fleeUntil = 0
    this.path = []
    this.planAt = 0
    this.planned = null
    // Now and then one of a place's walkers lies among the bodies (some of those only crawl).
    if (!hunter && home >= 0 && kind === ZombieKind.Walker && this.random() < PLAY_DEAD) {
      this.mood = 'dead'
      this.crawler = this.random() < CRAWLER
    }
    this.idleUntil = 0
    this.frozen = false
    this.speed = 0
    this.bashing = -1
    this.attack.reset()
  }

  /** Share of walking speed it moves at right now (the game sets its body up with this). */
  get speedFactor(): number {
    const k = KINDS[this.kind] as KindStats
    if (this.mood === 'chase' || this.mood === 'lost' || this.fleeing) return k.chase
    // Looking into a noise: a careful walk, quicker than a shuffle, nowhere near a run.
    if (this.mood === 'investigate') return Math.max(0.3, Math.min(k.chase, k.wander * 1.4))
    return Math.max(0.2, k.wander)
  }

  /** Something made a noise there (or a screamer pointed that way): go and look. */
  alert(at: Point, now: number): void {
    // Playing dead, it doesn't stir for noise: only for somebody right there.
    if (this.mood === 'chase' || this.mood === 'dead' || this.fleeing) return
    this.mood = 'investigate'
    this.lastKnown = { ...at }
    this.since = now
    this.sniffFrom = 0
    this.planAt = 0
  }

  /**
   * Under a car, somebody stepped right by: it has their ankle for `hold` seconds (lurkers.ts
   * roots them meanwhile), then crawls out after them.
   */
  grab(id: number, at: Point, now: number, hold: number): void {
    this.lurking = false
    this.mood = 'dead'
    this.crawler = true
    this.risingAt = now + hold
    this.targetId = id
    this.lastKnown = { ...at }
  }

  /** Caught in a torch beam (mimics): off into the dark, away from `from`, for `seconds`. */
  flee(from: Point, me: Point, now: number, seconds: number): void {
    this.fleeing = true
    this.fleeUntil = now + seconds
    this.mood = 'wander'
    this.targetId = 0
    this.lastKnown = null
    this.idleUntil = 0
    this.planAt = 0
    const away = Math.atan2(me.z - from.z, me.x - from.x)
    this.goal = { x: me.x + Math.cos(away) * 35, y: me.y, z: me.z + Math.sin(away) * 35 }
  }

  /** Playing dead: somebody came close. It twitches, then gets up after them. */
  private rise(p: Prey, now: number): void {
    if (this.risingAt === 0) this.risingAt = now + TWITCH
    this.targetId = p.id
    this.lastKnown = { ...p.pos }
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
    /** The weather's say in how far it sees (see sightScale). */
    seeing = 1,
  ): 'scream' | null {
    const k = KINDS[this.kind] as KindStats
    const me = self.state.pos
    const eye = { x: me.x, y: me.y + EYE * zombieScale(this.kind), z: me.z }
    let seen: Prey | null = null
    let seenD = Number.POSITIVE_INFINITY
    let heard: Prey | null = null
    if (this.lurking) return null
    if (this.fleeing) {
      if (now < this.fleeUntil) return null
      this.fleeing = false
    }
    if (this.mood === 'dead') {
      if (this.risingAt > 0) return null
      for (const p of prey) {
        if (Math.hypot(p.pos.x - me.x, p.pos.z - me.z) < RISE_RANGE) this.rise(p, now)
      }
      return null
    }
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
      let sight =
        k.sight *
        seeing *
        (1 + grey * 0.7) *
        (p.light ? 2.1 : 1) *
        (p.prone ? 0.35 : p.crouched ? 0.6 : 1) *
        (1 - Math.min(0.6, p.hidden ?? 0))
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
    // Battering a barricade with somebody behind it: it knows they're in there.
    if (this.bashing >= 0 && prey.some((p) => Math.hypot(p.pos.x - me.x, p.pos.z - me.z) < 12)) {
      this.since = now
    }
    if (this.mood === 'chase' && now - this.since > LOSE_SIGHT) {
      // Lost you: off to where it last saw you, then a sniff about.
      this.mood = 'lost'
      this.since = now
      this.sniffFrom = 0
      this.targetId = 0
    } else if (
      (this.mood === 'investigate' && now - this.since > SEARCH) ||
      (this.mood === 'lost' && now - this.since > LOST && !this.sniffing(now))
    ) {
      this.giveUp()
    }
    return null
  }

  private sniffing(now: number): boolean {
    return this.sniffFrom > 0 && now - this.sniffFrom < SNIFF
  }

  /** Nothing to go on any more: back to wandering. */
  private giveUp(): void {
    this.mood = 'wander'
    this.lastKnown = null
    this.goal = null
    this.sniffFrom = 0
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
      /** A boarded-up gap right by `me` with `goal` on its far side, if any. */
      boardedAt?: (me: Point, goal: Point) => { index: number; x: number; z: number } | null
      /** The way round walls and fences (pathing.ts); without it, straight at the goal. */
      nav?: Nav
    },
  ): InputCommand {
    const s = self.state
    if (!s.alive) return this.command(0, world.tick)
    const me = s.pos
    let buttons = 0
    const { def, now } = world
    // A crawler stays down; anything else lying down gets up (or lies down to play dead).
    const down = this.mood === 'dead' || this.crawler
    if (s.prone !== down && s.grounded && !(s.prevButtons & Button.Prone)) {
      if (this.mood !== 'dead' || this.risingAt === 0 || now >= this.risingAt)
        buttons |= Button.Prone
    }
    if (this.mood === 'dead') {
      if (this.risingAt === 0) return this.command(buttons, world.tick)
      if (now < this.risingAt) {
        // The twitch before it gets up: a jerk of the head and shoulders, then another.
        if (world.tick % 9 === 0) this.yaw += (this.random() - 0.5) * 0.9
        return this.command(0, world.tick)
      }
      this.mood = 'chase'
      this.since = now
      if (this.crawler) buttons = 0
    }
    const chasing = this.mood === 'chase' && world.target !== null
    const looking = this.mood === 'investigate' || this.mood === 'lost'
    let goal: Point | null = chasing ? world.target : looking ? this.lastKnown : null

    if (!goal) {
      // Nothing to hunt: stand about, then shuffle somewhere nearby (or, for roamers, far).
      if (this.goal && Math.hypot(this.goal.x - me.x, this.goal.z - me.z) < 1.5) {
        this.goal = null
        this.mood = 'idle'
        this.idleUntil = now + 2 + this.random() * 9
      }
      if (!this.goal && now < this.idleUntil) {
        // Standing about: swaying on its feet, head lolling.
        this.yaw += Math.sin(now * 0.8 + self.id * 1.7) * 0.25 * TICK_DT
      }
      if (!this.goal && now >= this.idleUntil && KINDS[this.kind]?.wander) {
        const home: Poi | undefined = def.pois[this.home]
        // Mimics keep to where they are calling from (unless something sends them running).
        const stay = this.kind === ZombieKind.Mimic && !this.fleeing
        const reach = home ? Math.min(home.r, 26) : stay ? 8 : 40 + this.random() * 60
        const a = this.random() * Math.PI * 2
        const from = home ? { x: home.x, z: home.z } : me
        const r = Math.sqrt(this.random()) * reach
        this.goal = { x: from.x + Math.cos(a) * r, y: me.y, z: from.z + Math.sin(a) * r }
        this.mood = 'wander'
      }
      goal = this.goal
    } else if (looking && Math.hypot(goal.x - me.x, goal.z - me.z) < 1.5) {
      if (this.mood === 'lost') {
        // Where it last had you: stop, turn this way and that, sniffing; then wander off.
        if (this.sniffFrom === 0) this.sniffFrom = now
        const t = now - this.sniffFrom
        this.yaw += Math.sign(Math.sin(t * 1.3)) * 1.8 * TICK_DT
        this.pitch = -0.25
        if (t > SNIFF) this.giveUp()
      } else {
        // Got to where the noise was: look around.
        this.yaw += 1.2 * TICK_DT
      }
      goal = null
    }

    // Never into a safe place: turn round at its edge and forget.
    if (goal && !this.siege) {
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
    if (stalker && this.frozen && !this.attack.busy) return this.command(0, world.tick)

    let flat = Number.POSITIVE_INFINITY
    let facing = Math.PI
    this.bashing = -1
    if (goal) {
      // The way round whatever's in between (through doors), or else straight on (through the
      // door, if one of us is indoors and the other isn't).
      const via = world.nav
        ? this.route(me, goal, world.nav, world, chasing)
        : doorBetween(world.rooms, me, goal)
      // A boarded-up door or window between it and what it's after: batter it down.
      const boarded = chasing || looking ? (world.boardedAt?.(me, goal) ?? null) : null
      if (boarded) {
        this.turnTowards(Math.atan2(-(boarded.x - me.x), -(boarded.z - me.z)), 0, 6 * TICK_DT)
        this.bashing = boarded.index
        this.swing = !this.swing
        return this.command(this.swing ? Button.Fire : 0, world.tick)
      }
      const to = via ?? goal
      const dx = to.x - me.x
      const dz = to.z - me.z
      flat = via ? Number.POSITIVE_INFINITY : Math.hypot(dx, dz)
      let want = Math.atan2(-dx, -dz)
      // Trunks in the way: round them.
      if (world.nav && Math.hypot(dx, dz) > 1.2)
        want = world.nav.aroundTrees(me, want, Math.hypot(dx, dz))
      const dy = chasing && !via ? goal.y + CHEST - (me.y + EYE * zombieScale(this.kind)) : 0
      const pitch = chasing && !via ? Math.atan2(dy, Math.max(flat, 0.1)) : 0
      const fast = this.kind === ZombieKind.Runner || stalker
      // Winding up a blow it can only turn so fast after you; off balance after a miss, not at all.
      this.turnTowards(want, pitch, Math.min((fast ? 10 : 5) * TICK_DT, this.attack.turnLimit ?? 9))
      facing = angleTo(want, this.yaw)
      if (!this.attack.busy && (!chasing || flat > 1)) buttons |= Button.Forward
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
    if (this.attack.busy) push = 0 // planted for the blow
    if (push > 0.15) buttons |= Button.Right
    else if (push < -0.15) buttons |= Button.Left

    // In reach: wind up, then claw (see ClawAttack): a blow you can see coming. It plants its
    // feet for the blow, so only from well inside the claws' reach.
    const reach = (WEAPONS[WeaponId.Claws].range - 0.2) * zombieScale(this.kind)
    const claws = s.weapon
    if (
      this.attack.tick(
        this.kind,
        chasing && flat < reach,
        facing,
        claws.cooldown + claws.draw <= (CLAW_TIMING[this.kind]?.windup ?? 0.6),
      )
    ) {
      buttons |= Button.Fire
    }

    // Stuck on a tree or a wall: hop and sidestep for a moment.
    const moved = Math.hypot(me.x - this.lastPos.x, me.z - this.lastPos.z)
    this.lastPos = { x: me.x, z: me.z }
    const trying = (buttons & Button.Forward) !== 0
    if (this.attack.busy) this.unstickFor = 0
    this.stuckFor = trying && moved < 0.25 * TICK_DT ? this.stuckFor + TICK_DT : 0
    if (this.stuckFor > 0.7) {
      this.stuckFor = 0
      this.unstickFor = 0.6
      this.unstickSide = this.random() < 0.5 ? -1 : 1
      buttons |= Button.Jump
      // Wandering into a wall: pick somewhere else next time. Anything else: a fresh path.
      if (!chasing && this.mood === 'wander') this.goal = null
      this.planAt = 0
    }
    if (this.unstickFor > 0) {
      this.unstickFor -= TICK_DT
      buttons |= this.unstickSide > 0 ? Button.Right : Button.Left
    }
    return this.command(buttons, world.tick)
  }

  /**
   * The point to head for on the way to `goal`: the next corner of its path (pathing.ts), or
   * null to go straight at the goal. A new path now and then (sooner when the goal has moved),
   * never more than the nav's few per tick.
   */
  private route(
    me: Point,
    goal: Point,
    nav: Nav,
    world: { def: SurvivalDef; now: number; tick: number },
    chasing: boolean,
  ): Point | null {
    const { now } = world
    const d = Math.hypot(goal.x - me.x, goal.z - me.z)
    // Upstairs (off the ground the grid is made for), or right there: straight on.
    if (d < 1.2 || me.y > heightAt(world.def.terrain, me.x, me.z) + 1.6) {
      this.path = []
      return null
    }
    const moved = this.planned
      ? Math.hypot(goal.x - this.planned.x, goal.z - this.planned.z)
      : Number.POSITIVE_INFINITY
    const every = chasing ? REPLAN.chase : this.mood === 'wander' ? REPLAN.wander : REPLAN.search
    // A path still being walked to a goal that's hardly moved: keep it (for a few seconds).
    const keep =
      this.step < this.path.length && moved < 1.5 && now < this.plannedAt + 4 && this.planAt > 0
    if (now >= this.planAt && keep) this.planAt = now + every
    else if (now >= this.planAt || (moved > 3 && now >= this.planAt - 0.4)) {
      if (nav.clear(me, goal)) {
        this.path = []
        this.planAt = now + every * (0.8 + this.random() * 0.4)
        this.planned = { ...goal }
      } else if (nav.mayPlan(world.tick)) {
        this.path = nav.plan(me, goal) ?? []
        this.step = 0
        const end = this.path.at(-1)
        this.toGoal = end?.x === goal.x && end.z === goal.z
        this.plannedAt = now
        this.planAt = now + every * (0.8 + this.random() * 0.4)
        this.planned = { ...goal }
      }
    }
    // Along the path: on to the next corner once at this one (or once the next is in sight).
    while (this.step < this.path.length) {
      const p = this.path[this.step] as Point
      if (Math.hypot(p.x - me.x, p.z - me.z) > 0.6) break
      this.step++
    }
    const next = this.path[this.step + 1]
    if (next && (world.tick + this.seq) % 10 === 0 && nav.clear(me, next)) this.step++
    const at = this.path[this.step]
    if (!at) return null
    // The path's last point is the goal itself: aim at it as a goal (pitch, claws).
    if (this.step === this.path.length - 1 && this.toGoal) return null
    return at
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

/** Signed angle (radians, −π…π) from yaw `from` round to `to`. */
const angleTo = (to: number, from: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from))

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
