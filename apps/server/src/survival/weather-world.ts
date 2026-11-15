import {
  compassWord,
  currentAt,
  floodAt,
  heightAt,
  jettyPassable,
  lakeOutlet,
  type Notice,
  PRINTS_FROM,
  type SurvivalDef,
  snowCoverAt,
  TICK_DT,
  type Weather,
  type WeatherPast,
  waterAt,
} from '@office-fps/shared'
import type { ServerPlayer } from '../game.ts'
import type { Point } from '../items.ts'
import { Footprints } from './footprints.ts'
import type { Zed } from './horde.ts'
import {
  alongRoute,
  MIGRATION_SIZE,
  MIGRATION_SPEED,
  planMigration,
  routeLength,
  rumourOf,
  type Spot,
} from './migration.ts'

/**
 * Weather that changes the map (ROADMAP 6.9), on the server:
 * - a long storm floods Miller's Lake: the water comes up over the jetty and its banks, a current
 *   takes anybody standing deep in it, and cars driven into it drown;
 * - a heavy fog lets a horde migrate across the county (migration.ts), heard of on the radio and
 *   marked on the compass as a rumour, real walkers wherever somebody is near it;
 * - snow takes footprints, and the dead follow the trails (footprints.ts).
 * The flood and the snow follow from the weather alone (weather-effects.ts), as the clients see.
 */

/** Somebody alive in the world, as this needs them. */
export interface WeatherPerson {
  player: ServerPlayer
  /** Under a roof or sitting in a car: no prints, no current. */
  indoors: boolean
  seated: boolean
}

export interface WeatherHost {
  def(): SurvivalDef
  now(): number
  random(): number
  /** The weather now and what it has been (seed, clock, holds). */
  weather(): Weather
  past(): WeatherPast
  people(): WeatherPerson[]
  notice(player: ServerPlayer, kind: Notice['kind'], text: string): void
  /** One of the dead, out at `at` (a walker), or null with none to spare. */
  spawnWalker(at: Point): ServerPlayer | null
  zedOf(zombie: ServerPlayer): Zed | undefined
  zombies(): readonly ServerPlayer[]
  /** Cars standing in water this deep (m) over the ground drown (vehicles.ts). */
  drownCars(depthAt: (x: number, z: number, y: number) => number): void
  broadcast(): void
}

/** What the radio and the compass say about a horde on the move. */
export interface HordeRumour {
  x: number
  z: number
  /** Where it's heading (a place's name). */
  to: string
}

/** Fog this thick sets a horde walking. */
const MIGRATION_FOG = 0.6
/** At least this long between one horde setting off and the next (s). */
const MIGRATION_EVERY = 20 * 60
/** Real walkers come out when somebody is this close to the crowd (m). */
const MATERIALISE = 175
/** Somebody this close hears them coming (m). */
const HEARD = 260

interface Migration {
  route: Spot[]
  length: number
  start: number
  to: string
  /** How many are left of it (some get killed). */
  left: number
  /** The walkers out right now, and where each keeps in the crowd. */
  walkers: Map<number, { zombie: ServerPlayer; dx: number; dz: number; last: Point }>
  /** Who has heard it go by. */
  heard: Set<number>
}

export class WeatherWorld {
  readonly footprints = new Footprints()
  /** How swollen the lakes are and how much snow lies, 0–1 (updated once a second). */
  flood = 0
  snow = 0
  migration: Migration | null = null
  private nextMigration = 0
  private outlets: number[] = []
  private jettyUnder = false
  private rising = false
  /** The dead following a trail right now (their ids). */
  private readonly tracking = new Set<number>()

  constructor(private readonly host: WeatherHost) {}

  /** A new game: dry ground, the lake where it belongs, nobody on the move. */
  reset(): void {
    const def = this.host.def()
    this.outlets = def.lakes.map((l) => lakeOutlet(def.terrain, l))
    this.footprints.clear()
    this.tracking.clear()
    this.migration = null
    this.nextMigration = 0
    this.flood = 0
    this.snow = 0
    this.jettyUnder = false
    this.rising = false
  }

  /** Every tick: the current takes whoever stands deep in the flood; prints in the snow. */
  step(tick: number): void {
    if (this.flood > 0.4) {
      const def = this.host.def()
      for (const p of this.host.people()) {
        if (p.seated) continue
        const pos = p.player.state.pos
        const water = waterAt(def, pos.x, pos.z, this.flood, pos.y)
        if (!water) continue
        const i = def.lakes.indexOf(water.lake)
        const push = currentAt(
          water.lake,
          this.outlets[i] ?? 0,
          pos.x,
          pos.z,
          water.depth,
          this.flood,
        )
        if (!push) continue
        pos.x += push.x * TICK_DT
        pos.z += push.z * TICK_DT
      }
    }
    if (tick % 10 !== 0) return
    const now = this.host.now()
    for (const p of this.host.people()) {
      const pos = p.player.state.pos
      if (this.snow < PRINTS_FROM || p.indoors || p.seated || !p.player.state.grounded) {
        this.footprints.lift(p.player.id)
        continue
      }
      this.footprints.step(p.player.id, pos.x, pos.z, now)
    }
  }

  /** Once a second: the water and the snow, the horde on the move, the dead on a trail. */
  second(): void {
    const past = this.host.past()
    const flood = floodAt(past)
    this.snow = snowCoverAt(past)
    this.flood = flood
    this.floodNews(flood)
    if (flood > 0.2) {
      const def = this.host.def()
      this.host.drownCars((x, z, y) => waterAt(def, x, z, flood, y)?.depth ?? 0)
    }
    this.footprints.prune(this.host.now())
    this.track()
    this.migrate()
  }

  /** Tells the people near the lake as it comes up, as the jetty goes under, and as it falls. */
  private floodNews(flood: number): void {
    const def = this.host.def()
    const lake = def.lakes[0]
    if (!lake) return
    const near = (text: string, kind: Notice['kind'] = 'warn') => {
      for (const p of this.host.people()) {
        const pos = p.player.state.pos
        if (Math.hypot(pos.x - lake.x, pos.z - lake.z) < lake.r + 260)
          this.host.notice(p.player, kind, text)
      }
    }
    if (!this.rising && flood > 0.3) {
      this.rising = true
      near("Miller's Lake is coming up over its banks. The water is brown and fast.")
    } else if (this.rising && flood < 0.15) {
      this.rising = false
      near('The lake has gone back down. The bank is mud and drowned reeds.', 'info')
    }
    const under = !jettyPassable(flood)
    if (under !== this.jettyUnder) {
      this.jettyUnder = under
      near(
        under
          ? 'The jetty is under water. The current would take you off it.'
          : 'The jetty is out of the water again.',
        under ? 'warn' : 'info',
      )
    }
  }

  // --- Tracks in the snow --------------------------------------------------------------------

  /** The dead with nothing better to do follow any trail they come across. */
  private track(): void {
    if (this.footprints.prints.length === 0) {
      this.tracking.clear()
      return
    }
    const now = this.host.now()
    for (const z of this.host.zombies()) {
      const zed = this.host.zedOf(z)
      if (!zed || !z.state.alive) continue
      const mine = this.tracking.has(z.id)
      const free =
        zed.mood === 'idle' || zed.mood === 'wander' || (mine && zed.mood === 'investigate')
      if (!free || zed.hunter || zed.siege || this.isMigrant(z.id)) {
        this.tracking.delete(z.id)
        continue
      }
      const pos = z.state.pos
      const lead = this.footprints.lead(pos.x, pos.z, now)
      if (!lead) {
        this.tracking.delete(z.id)
        continue
      }
      this.tracking.add(z.id)
      zed.alert({ x: lead.x, y: pos.y, z: lead.z }, now)
    }
  }

  /** Is this one of the dead following a trail? (tests) */
  isTracking(id: number): boolean {
    return this.tracking.has(id)
  }

  // --- The horde on the move -----------------------------------------------------------------

  private isMigrant(id: number): boolean {
    return this.migration?.walkers.has(id) ?? false
  }

  /** Where the crowd is now (the middle of it), and which way it walks. */
  head(): (Spot & { heading: number }) | null {
    const m = this.migration
    if (!m) return null
    return alongRoute(m.route, (this.host.now() - m.start) * MIGRATION_SPEED)
  }

  /** What the radio says about it, for the compass (null with nothing on the move). */
  rumour(): HordeRumour | null {
    const m = this.migration
    const head = this.head()
    if (!m || !head) return null
    const at = rumourOf(head, Math.floor(this.host.now() / 60), m.start)
    return { ...at, to: m.to }
  }

  /** Sets a horde walking (the fog, or a test). Returns false with none to start. */
  startMigration(): boolean {
    const def = this.host.def()
    const plan = planMigration(def.pois, def.lakes, () => this.host.random())
    if (!plan) return false
    const size =
      MIGRATION_SIZE.min +
      Math.floor(this.host.random() * (MIGRATION_SIZE.max - MIGRATION_SIZE.min + 1))
    this.migration = {
      route: plan.route,
      length: routeLength(plan.route),
      start: this.host.now(),
      to: plan.to.name,
      left: size,
      walkers: new Map(),
      heard: new Set(),
    }
    this.nextMigration = this.host.now() + MIGRATION_EVERY
    for (const p of this.host.people()) {
      const pos = p.player.state.pos
      this.host.notice(
        p.player,
        'info',
        `The radio, through the static: "...a lot of them, moving in the fog. Out past ${plan.from.name}, heading ${compassWord(plan.from, plan.to)} for ${plan.to.name}. Keep off the road..." (${compassWord(pos, plan.from)} of you)`,
      )
    }
    this.host.broadcast()
    return true
  }

  private migrate(): void {
    const weather = this.host.weather()
    const now = this.host.now()
    const people = this.host.people().filter((p) => p.player.state.alive)
    if (!this.migration) {
      if (weather.fog >= MIGRATION_FOG && now >= this.nextMigration && people.length > 0)
        this.startMigration()
      return
    }
    const m = this.migration
    const walked = (now - m.start) * MIGRATION_SPEED
    const head = alongRoute(m.route, walked)
    const nearest = (at: Spot) =>
      Math.min(
        Number.POSITIVE_INFINITY,
        ...people.map((p) => Math.hypot(p.player.state.pos.x - at.x, p.player.state.pos.z - at.z)),
      )

    // Those that fell: killed near somebody (gone from the crowd), or let go far from anyone.
    for (const [id, w] of m.walkers) {
      if (w.zombie.state.alive && w.zombie.id === id && this.host.zedOf(w.zombie)) {
        w.last = { ...w.zombie.state.pos }
        continue
      }
      if (nearest(w.last) < MATERIALISE) m.left--
      m.walkers.delete(id)
    }
    if (walked >= m.length || m.left <= 0) {
      // There: the crowd breaks up into the woods round about.
      this.migration = null
      this.host.broadcast()
      return
    }

    // Somebody near: real walkers, in a loose crowd round the head.
    const close = nearest(head)
    if (m.walkers.size === 0 && close < MATERIALISE) {
      for (let n = 0; n < m.left; n++) {
        const a = this.host.random() * Math.PI * 2
        const r = 2 + Math.sqrt(this.host.random()) * 11
        const dx = Math.cos(a) * r
        const dz = Math.sin(a) * r
        const at = { x: head.x + dx, z: head.z + dz }
        // Never right under somebody's nose (the fog hides the rest).
        if (nearest(at) < 30) continue
        const y = heightAt(this.host.def().terrain, at.x, at.z)
        const zombie = this.host.spawnWalker({ x: at.x, y, z: at.z })
        if (!zombie) break
        m.walkers.set(zombie.id, { zombie, dx, dz, last: { x: at.x, y, z: at.z } })
      }
    }
    // Keep them walking on along the route, together.
    const ahead = alongRoute(m.route, walked + 22)
    for (const w of m.walkers.values()) {
      const zed = this.host.zedOf(w.zombie)
      if (!zed || zed.mood === 'chase' || zed.mood === 'lost' || zed.mood === 'dead') continue
      zed.alert({ x: ahead.x + w.dx, y: w.zombie.state.pos.y, z: ahead.z + w.dz }, now)
    }
    // The ones close enough hear it go by.
    for (const p of people) {
      if (m.heard.has(p.player.id)) continue
      const pos = p.player.state.pos
      if (Math.hypot(pos.x - head.x, pos.z - head.z) > HEARD) continue
      m.heard.add(p.player.id)
      this.host.notice(
        p.player,
        'warn',
        `Feet in the fog, a lot of them, to the ${compassWord(pos, head)}. Moaning, shuffling. Stay low and let them pass.`,
      )
    }
  }
}
