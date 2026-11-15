import type { PlayerBody } from '@office-fps/shared'
import {
  dayPhase,
  EFFECTS,
  type EffectId,
  effectsOf,
  freshNeeds,
  type ItemDef,
  type Lake,
  type MovementConfig,
  movementKey,
  type Needs,
  type Notice,
  type PlayerState,
  RESTED_SECONDS,
  type Room,
  SICK_SECONDS,
  SPRAIN_FALL,
  SPRAIN_SECONDS,
  type Surroundings,
  type SurvivalSelf,
  skillEffects,
  stepNeeds,
  tuneMovement,
  VOMIT_CHANCE,
  VOMIT_HUNGER,
  VOMIT_THIRST,
  type WarmSpot,
  wornWarmth,
} from '@office-fps/shared'

/** The bits of a survivor this needs: who they are and what they've got. */
export interface NeedsSurvivor {
  player: { state: PlayerState; body: PlayerBody }
  self: SurvivalSelf
  dirty: boolean
}

/** What the needs keeper asks of the director. */
export interface NeedsHost {
  /** The world's fires, buildings and lakes (null before there is one). */
  world(): { fires?: readonly WarmSpot[]; rooms: readonly Room[]; lakes: readonly Lake[] } | null
  /** The day's clock (0–1) and how hard it rains (0–1). */
  time(): number
  rain(): number
  random(): number
  notice(sv: NeedsSurvivor, kind: Notice['kind'], text: string): void
  /** Sitting in a car (falls don't count). */
  seated(sv: NeedsSurvivor): boolean
  /** Warmed through by a fire (Field Notes count it). */
  rested?(sv: NeedsSurvivor): void
  /** How hard it snows, 0–1 (weather.ts). */
  snow?(): number
  /** In a lake, flooded or not (weather-effects.ts); without it, the lakes as they were made. */
  inWater?(pos: { x: number; y: number; z: number }): boolean
}

/** What we keep on each survivor between ticks. */
interface Track {
  /** Highest point since leaving the ground (feet), or null on the ground. */
  top: number | null
  /** The movement config before tuning, the tuned one we gave the body, and for which effects. */
  base?: MovementConfig
  tuned?: MovementConfig
  moveKey: string
  /** Effects last told to the client. */
  told: string
  /** Rested minutes last told. */
  restedMin: number
}

/** Chance that a drink from the lake turns your stomach. */
const LAKE_POISON = 0.35

const NIGHT: Record<string, number> = { night: 1, dusk: 0.5, dawn: 0.5, day: 0 }

/**
 * Runs the needs (see shared needs.ts) for the survival director: once a second wet, cold,
 * rested and the timers, buffs and statuses told as they come and go; every tick a watch for long
 * falls; and how each survivor moves with what they've got.
 */
export class NeedsKeeper {
  private readonly host: NeedsHost
  private readonly tracks = new WeakMap<object, Track>()
  /** More fires to warm up at (lit ones people make), besides the map's own. */
  readonly extraFires: WarmSpot[] = []

  constructor(host: NeedsHost) {
    this.host = host
  }

  private track(sv: NeedsSurvivor): Track {
    let t = this.tracks.get(sv.player)
    if (!t) {
      t = { top: null, moveKey: '', told: '', restedMin: 0 }
      this.tracks.set(sv.player, t)
    }
    return t
  }

  /** The survivor's needs (made if an old save had none). */
  needs(sv: NeedsSurvivor): Needs {
    sv.self.needs ??= freshNeeds()
    return sv.self.needs
  }

  /** Every tick: a fall further than SPRAIN_FALL sprains an ankle. */
  watch(sv: NeedsSurvivor): void {
    const t = this.track(sv)
    const s = sv.player.state
    if (!s.alive || this.host.seated(sv) || s.mantle) {
      t.top = null
      return
    }
    if (!s.grounded) {
      t.top = Math.max(t.top ?? s.pos.y, s.pos.y)
      return
    }
    if (t.top !== null && t.top - s.pos.y > SPRAIN_FALL) this.sprain(sv)
    t.top = null
  }

  sprain(sv: NeedsSurvivor): void {
    const n = this.needs(sv)
    if (n.sprain === 0) this.host.notice(sv, 'warn', 'You land badly. Your ankle is sprained.')
    n.sprain = SPRAIN_SECONDS
    this.changed(sv)
  }

  /** Where someone stands, as far as warmth goes. */
  surroundings(sv: NeedsSurvivor): Surroundings {
    const { pos, vel } = sv.player.state
    const world = this.host.world()
    const near = (f: WarmSpot) =>
      Math.hypot(f.pos[0] - pos.x, f.pos[2] - pos.z) < f.r && Math.abs(f.pos[1] - pos.y) < 3
    return {
      night: NIGHT[dayPhase(this.host.time())] ?? 0,
      rain: this.host.rain(),
      indoors: (world?.rooms ?? []).some(
        (r) => pos.x > r.min[0] && pos.x < r.max[0] && pos.z > r.min[1] && pos.z < r.max[1],
      ),
      byFire: (world?.fires ?? []).some(near) || this.extraFires.some(near),
      inWater: this.host.inWater
        ? this.host.inWater(pos)
        : (world?.lakes ?? []).some(
            (l) => Math.hypot(pos.x - l.x, pos.z - l.z) < l.r && pos.y < l.y + 0.1,
          ),
      still: Math.hypot(vel.x, vel.z) < 0.6,
      snow: this.host.snow?.() ?? 0,
    }
  }

  /** Once a second (alive): wet, cold, rested and the timers; throwing up; movement. */
  second(sv: NeedsSurvivor): void {
    const n = this.needs(sv)
    const at = this.surroundings(sv)
    if (stepNeeds(n, at, wornWarmth(sv.self.wear), 1)) {
      this.host.notice(sv, 'info', 'The fire warms you through. You feel rested.')
      this.host.rested?.(sv)
    }
    if (n.sick > 0 && this.host.random() < VOMIT_CHANCE) {
      sv.self.hunger = Math.max(0, sv.self.hunger - VOMIT_HUNGER)
      sv.self.thirst = Math.max(0, sv.self.thirst - VOMIT_THIRST)
      sv.dirty = true
      this.host.notice(sv, 'warn', 'You double over and throw up.')
    }
    this.changed(sv)
  }

  /**
   * After anything that may change the effects: tells the client when they do (with a line on
   * each new bad one saying how to fix it) and tunes how they move.
   */
  changed(sv: NeedsSurvivor): void {
    const t = this.track(sv)
    const effects = effectsOf(sv.self)
    const key = effects.join(',')
    if (key !== t.told) {
      const was = new Set(t.told.split(','))
      for (const id of effects) {
        const fx = EFFECTS[id]
        // Starving and parched have their own warnings (the director's).
        if (!was.has(id) && !fx.good && id !== 'starving' && id !== 'parched')
          this.host.notice(sv, 'warn', `${fx.name}. ${fx.tip}`)
      }
      t.told = key
      sv.dirty = true
    }
    const minutes = Math.ceil(this.needs(sv).rested / 60)
    if (minutes !== t.restedMin) {
      t.restedMin = minutes
      sv.dirty = true
    }
    this.tune(sv, effects)
  }

  /**
   * Gives the body the movement for these effects. The game swaps in a fresh config now and then
   * (rules change, respawn): that becomes the new base.
   */
  private tune(sv: NeedsSurvivor, effects: readonly EffectId[]): void {
    const t = this.track(sv)
    const body = sv.player.body
    const fitness = skillEffects(sv.self.skills).sprint
    const key = movementKey(effects, fitness)
    const replaced = body.config !== t.tuned
    if (!replaced && key === t.moveKey) return
    if (replaced && key === '' && !t.tuned) return
    const base = replaced ? body.config : (t.base ?? body.config)
    t.base = base
    t.moveKey = key
    t.tuned = tuneMovement(base, effects, fitness)
    body.configure(t.tuned)
  }

  /** Something eaten, drunk or used: bad food may poison; bandages bind; antibiotics settle. */
  used(sv: NeedsSurvivor, def: ItemDef): void {
    const n = this.needs(sv)
    if (def.splints && n.sprain > 0) {
      n.sprain = 0
      this.host.notice(sv, 'info', 'You bind the ankle tight. It holds.')
    }
    if (def.settles && n.sick > 0) {
      n.sick = 0
      this.host.notice(sv, 'info', 'Your stomach settles.')
    }
    if (def.poison && this.host.random() < def.poison) this.poison(sv)
    this.changed(sv)
  }

  /** A drink from the lake: it might not agree with you. */
  drankLake(sv: NeedsSurvivor): void {
    if (this.host.random() < LAKE_POISON) this.poison(sv)
    this.changed(sv)
  }

  poison(sv: NeedsSurvivor): void {
    this.needs(sv).sick = SICK_SECONDS
  }

  /** A night in a bunk: warm, dry and rested. */
  slept(sv: NeedsSurvivor): void {
    const n = this.needs(sv)
    n.rested = RESTED_SECONDS
    n.wet = 0
    n.chill = 0
    this.changed(sv)
  }
}
