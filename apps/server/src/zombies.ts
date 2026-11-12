import {
  type CoopDef,
  type CoopInfo,
  type CoopStage,
  type InputCommand,
  inZone,
  MAX_PLAYERS,
  type MapSpawn,
  TICK_DT,
  TICK_RATE,
  type Vec3,
  ZombieKind,
} from '@office-fps/shared'
import type { BotLead } from './bots.ts'
import type { Game, ServerPlayer } from './game.ts'
import type { Point } from './items.ts'
import { NavGrid } from './nav.ts'
import { ZombieBrain } from './zombie-brain.ts'

/** Most zombies the server runs at once (each one is a full player on the server). */
export const MAX_ZOMBIES = 20
/** Places kept free for people joining while the horde is out. */
const FREE_SLOTS = 4
/** Quiet seconds at the start of a run (or stage retry) before the first zombie shows up. */
const GRACE_SECONDS = 6
/** Seconds between two zombies climbing out. */
const SPAWN_EVERY = 0.45
/** A zombie never appears closer than this to a survivor (m). */
const MIN_SPAWN_DISTANCE = 9
/** Zombies this far (nav steps) from every survivor for a while are recycled closer. */
const LOST_STEPS = 70
const LOST_SECONDS = 4
/** Ticks between rebuilds of the "where are the survivors" distance field. */
const FIELD_EVERY = 12
/** Survivor bots keep within this many steps of the people they follow. */
const FOLLOW_STEPS = 6

/** How the difficulty (the admin's bot skill) plays out. */
const DIFFICULTY = {
  easy: { count: 0.7, health: 0.75, claws: 12 },
  normal: { count: 1, health: 1, claws: 20 },
  hard: { count: 1.35, health: 1.3, claws: 30 },
} as const

const KIND_HEALTH: Record<ZombieKind, number> = {
  [ZombieKind.Walker]: 100,
  [ZombieKind.Runner]: 60,
}
/** Walkers shamble, runners sprint (a little slower than you do). */
const KIND_SPEED: Record<ZombieKind, number> = {
  [ZombieKind.Walker]: 0.62,
  [ZombieKind.Runner]: 0.92,
}

/**
 * Zombies mode on a co-op map: the team fights through the map's stages in order. Each stage
 * has a goal (kill a number of zombies, reach a spot, or hold a spot for a while); finishing it
 * opens the stage's gate, brings fallen survivors back at the next checkpoint and tops everyone
 * up. Meanwhile the horde keeps coming: a pool of server-run zombies is (re)spawned out of
 * sight around the team, more of them the more survivors there are.
 *
 * The MatchRunner owns this and asks it for spawns, loadouts and speeds; the round ends when
 * everyone is down (retry from this stage) or the last stage is done (escaped).
 */
export class ZombieDirector {
  private readonly game: Game
  private readonly random: () => number
  stage = 0
  /** Kills (kill goals) or seconds held (hold goals) this stage. */
  private done = 0
  gates = 0
  escaped = false
  private runStart = 0
  private nav: NavGrid | null = null
  private navMap = ''
  /** Distance to the nearest living survivor, per nav node. */
  private toSurvivors: Float64Array | null = null
  /** Distance to the people (not bots) on the team, for survivor bots to keep up. */
  private toPeople: Float64Array | null = null
  /** Distance to this stage's goal zone. */
  private toGoal: Float64Array | null = null
  private nextSpawn = 0
  private readonly lost = new Map<number, number>()

  constructor(game: Game, random: () => number = Math.random) {
    this.game = game
    this.random = random
  }

  private get coop(): CoopDef | undefined {
    return this.game.world.map.coop
  }

  get current(): CoopStage | undefined {
    return this.coop?.stages[this.stage]
  }

  private get difficulty() {
    return DIFFICULTY[this.game.rules.botSkill]
  }

  /** People and bots on the team (alive or not). */
  survivors(): ServerPlayer[] {
    return [...this.game.players.values()].filter((p) => !p.zombie && !p.dummy)
  }

  private zombies(): ServerPlayer[] {
    return [...this.game.players.values()].filter((p) => p.zombie)
  }

  private alive(players: ServerPlayer[]): ServerPlayer[] {
    return players.filter((p) => p.state.alive)
  }

  // --- Runs and stages ----------------------------------------------------------------------

  /**
   * Starts (or restarts) the run at `stage`: gates of earlier stages open, the horde back in
   * the pool. A fresh run (stage 0) also restarts the clock.
   */
  startRun(stage: number): void {
    const stages = this.coop?.stages ?? []
    if (stages.length === 0) return // not a co-op map (the mode is about to change)
    this.stage = Math.max(0, Math.min(stage, stages.length - 1))
    if (this.stage === 0) this.runStart = this.game.tick
    this.done = 0
    this.escaped = false
    this.gates = 0
    for (const s of stages.slice(0, this.stage))
      if (s.opens !== undefined) this.gates |= 1 << s.opens
    this.game.setGates(this.gates)
    this.ensureNav()
    this.fillPool()
    for (const z of this.zombies()) this.game.retireZombie(z)
    this.lost.clear()
    this.nextSpawn = this.game.tick + GRACE_SECONDS * TICK_RATE
    this.toSurvivors = null
    this.toGoal = this.goalField()
  }

  /** Mode over: the horde leaves and every gate opens (other modes play the whole map). */
  dispose(): void {
    for (const z of this.zombies()) this.game.leave(z.id)
    this.game.setGates(0xffff)
  }

  /** The map changed under us (admin): start over on it. */
  private ensureNav(): void {
    const { map, physics } = this.game.world
    if (this.nav && this.navMap === map.id) return
    this.nav = map.coop ? new NavGrid(map, physics, (id) => (this.gates & (1 << id)) !== 0) : null
    this.navMap = map.id
  }

  /** As many pooled zombies as there's room for. */
  private fillPool(): void {
    const people = [...this.game.players.values()].filter((p) => !p.zombie).length
    const size = Math.max(0, Math.min(MAX_ZOMBIES, MAX_PLAYERS - FREE_SLOTS - people))
    const pool = this.zombies()
    for (let i = pool.length; i < size; i++) {
      if (!this.game.addZombie(new ZombieBrain(ZombieKind.Walker, this.random))) break
    }
    for (const z of pool.slice(size)) this.game.leave(z.id)
  }

  private completeStage(): void {
    const stage = this.current
    if (!stage) return
    if (stage.opens === undefined) {
      this.escaped = true
      return
    }
    this.gates |= 1 << stage.opens
    this.game.setGates(this.gates)
    this.stage++
    this.done = 0
    this.toGoal = this.goalField()
    // Checkpoint: the fallen come back here, everyone is patched up and restocked.
    for (const p of this.survivors()) {
      if (!p.state.alive) {
        p.out = false
        this.game.respawnNow(p)
      }
      this.game.refill(p)
    }
    this.game.match.broadcast()
  }

  /** Kills the current stage needs (more with more survivors). */
  private killsNeeded(stage: CoopStage): number {
    if (stage.goal.kind !== 'kill') return 0
    const team = Math.max(1, this.survivors().length)
    return Math.round(stage.goal.count * (0.6 + 0.4 * team))
  }

  // --- Every tick -----------------------------------------------------------------------------

  step(): void {
    const stage = this.current
    if (!stage || this.escaped || !this.nav) return
    const tick = this.game.tick
    const team = this.alive(this.survivors())
    if (team.length === 0) {
      // Nobody to chase: whoever (re)joins gets a few seconds before the first ones show up.
      this.nextSpawn = tick + GRACE_SECONDS * TICK_RATE
      // Nobody's started yet: the run clock waits for the first survivor.
      if (this.stage === 0 && this.done === 0) this.runStart = tick
      return
    }

    if (!this.toSurvivors || tick % FIELD_EVERY === 0) {
      const open = (id: number) => (this.gates & (1 << id)) !== 0
      this.toSurvivors = this.nav.field(
        team.map((p) => p.state.pos),
        open,
      )
      const people = team.filter((p) => !p.bot)
      this.toPeople =
        people.length > 0
          ? this.nav.field(
              people.map((p) => p.state.pos),
              open,
            )
          : null
    }

    // The goal.
    const goal = stage.goal
    if (goal.kind === 'kill' && this.done >= this.killsNeeded(stage)) this.completeStage()
    else if (goal.kind === 'reach' && team.some((p) => inZone(goal.zone, p.state.pos))) {
      this.completeStage()
    } else if (goal.kind === 'hold' && team.some((p) => inZone(goal.zone, p.state.pos))) {
      this.done += TICK_DT
      if (this.done >= goal.seconds) this.completeStage()
    }

    // The horde.
    const zombies = this.zombies()
    const awake = zombies.filter((z) => z.state.alive).length
    const want = Math.min(
      zombies.length,
      Math.round((4 + 3 * team.length) * stage.intensity * this.difficulty.count),
    )
    if (awake < want && tick >= this.nextSpawn) {
      const sleeper = zombies.find((z) => !z.state.alive)
      if (sleeper && this.spawn(sleeper, stage, team)) {
        this.nextSpawn = tick + Math.round(SPAWN_EVERY * TICK_RATE)
      }
    }
    if (tick % TICK_RATE === 0) this.recycleLost(zombies)
  }

  /** Wakes a pooled zombie at a spawn spot away from (and preferably out of sight of) the team. */
  private spawn(zombie: ServerPlayer, stage: CoopStage, team: ServerPlayer[]): boolean {
    const previous = this.coop?.stages[this.stage - 1]
    const spots = [...stage.zombieSpawns, ...(previous?.zombieSpawns ?? [])]
    const far = spots.filter((s) =>
      team.every(
        (p) => Math.hypot(p.state.pos.x - s[0], p.state.pos.z - s[2]) >= MIN_SPAWN_DISTANCE,
      ),
    )
    if (far.length === 0) return false
    const reachable = far.filter(
      (s) =>
        !this.toSurvivors ||
        Number.isFinite(this.nav?.distance(this.toSurvivors, { x: s[0], y: s[1], z: s[2] }) ?? 0),
    )
    const pool = reachable.length > 0 ? reachable : far
    const hidden = pool.filter((s) => !team.some((p) => this.sees(p, s)))
    const choice = pick(hidden.length > 0 ? hidden : pool, this.random)
    if (!choice) return false
    const kind = this.random() < stage.runners ? ZombieKind.Runner : ZombieKind.Walker
    if (zombie.zombie) zombie.zombie.kind = kind
    const jitter = () => (this.random() - 0.5) * 0.8
    const nearest = team[0]?.state.pos
    const yaw = nearest ? Math.atan2(-(nearest.x - choice[0]), -(nearest.z - choice[2])) : 0
    const spot: MapSpawn = { pos: [choice[0] + jitter(), choice[1], choice[2] + jitter()], yaw }
    this.game.placeZombie(zombie, spot, Math.round(KIND_HEALTH[kind] * this.difficulty.health))
    return true
  }

  private sees(p: ServerPlayer, s: Vec3): boolean {
    const eye = { x: p.state.pos.x, y: p.state.pos.y + 1.6, z: p.state.pos.z }
    return this.game.lineClear(eye, { x: s[0], y: s[1] + 1.2, z: s[2] })
  }

  /** Zombies left far behind (or stuck somewhere unreachable) go back into the pool. */
  private recycleLost(zombies: ServerPlayer[]): void {
    const field = this.toSurvivors
    if (!field || !this.nav) return
    for (const z of zombies) {
      if (!z.state.alive) {
        this.lost.delete(z.id)
        continue
      }
      const d = this.nav.distance(field, z.state.pos)
      if (d < LOST_STEPS) {
        this.lost.delete(z.id)
        continue
      }
      const t = (this.lost.get(z.id) ?? 0) + 1
      this.lost.set(z.id, t)
      if (t >= LOST_SECONDS) {
        this.lost.delete(z.id)
        this.game.retireZombie(z)
      }
    }
  }

  // --- What the game asks -----------------------------------------------------------------------

  thinkZombie(zombie: ServerPlayer): InputCommand | null {
    const brain = zombie.zombie
    if (!brain) return null
    const pos = zombie.state.pos
    let target: Point | null = null
    let best = Number.POSITIVE_INFINITY
    for (const p of this.survivors()) {
      if (!p.state.alive) continue
      const d = Math.hypot(p.state.pos.x - pos.x, p.state.pos.z - pos.z)
      if (d < best) {
        best = d
        target = p.state.pos
      }
    }
    const waypoint =
      zombie.state.alive && this.nav && this.toSurvivors
        ? this.nav.next(this.toSurvivors, pos)
        : null
    const crowd: Point[] = []
    for (const other of this.game.players.values()) {
      if (other === zombie || !other.zombie || !other.state.alive) continue
      const o = other.state.pos
      if (Math.abs(o.x - pos.x) < 1 && Math.abs(o.z - pos.z) < 1) crowd.push(o)
    }
    return brain.think(
      zombie.state,
      { target, waypoint, clear: (a, b) => this.game.lineClear(a, b), crowd },
      this.game.tick,
      TICK_DT,
    )
  }

  /** Survivor bots: to the goal zone (and stay in it), else after the people on the team. */
  botFollow(bot: ServerPlayer): ((pos: Point) => BotLead) | null {
    const nav = this.nav
    if (!nav || bot.team !== 1) return null
    return (pos) => {
      const goal = this.current?.goal
      if (goal && goal.kind !== 'kill' && this.toGoal) {
        if (inZone(goal.zone, pos)) return 'stay'
        return nav.next(this.toGoal, pos)
      }
      if (!this.toPeople) return null
      if (nav.distance(this.toPeople, pos) <= FOLLOW_STEPS) return 'stay'
      return nav.next(this.toPeople, pos)
    }
  }

  private goalField(): Float64Array | null {
    const goal = this.current?.goal
    if (!this.nav || !goal || goal.kind === 'kill') return null
    const { min, max } = goal.zone
    const centre = { x: (min[0] + max[0]) / 2, y: min[1], z: (min[2] + max[2]) / 2 }
    return this.nav.field([centre], (id) => (this.gates & (1 << id)) !== 0)
  }

  /** A zombie went down: counts for kill goals; it waits in the pool to come back. */
  onZombieKilled(zombie: ServerPlayer): void {
    zombie.respawnAt = Number.POSITIVE_INFINITY
    if (this.current?.goal.kind === 'kill') this.done++
  }

  /** A survivor went down: out until the next checkpoint (or the retry, if nobody's left). */
  onSurvivorKilled(player: ServerPlayer): void {
    player.out = true
    player.respawnAt = Number.POSITIVE_INFINITY
  }

  /** Where a survivor (re)spawns: one of this stage's start spots. */
  spawnFor(player: ServerPlayer): MapSpawn | null {
    if (player.zombie || player.dummy) return null
    const spots = this.current?.start ?? []
    const spot = pick(spots, this.random)
    if (!spot) return null
    const jitter = () => (this.random() - 0.5) * 0.4
    return { pos: [spot.pos[0] + jitter(), spot.pos[1], spot.pos[2] + jitter()], yaw: spot.yaw }
  }

  clawDamage(): number {
    return this.difficulty.claws
  }

  speedFactor(player: ServerPlayer): number {
    return player.zombie ? KIND_SPEED[player.zombie.kind] : 1
  }

  /** Everyone down? (Nobody on the team at all doesn't count.) */
  get wiped(): boolean {
    const team = this.survivors()
    return team.length > 0 && team.every((p) => !p.state.alive)
  }

  get elapsed(): number {
    return Math.floor((this.game.tick - this.runStart) / TICK_RATE)
  }

  info(): CoopInfo {
    const stage = this.current
    const goal = stage?.goal
    let progress = 0
    let kills: [number, number] | undefined
    if (stage && goal?.kind === 'kill') {
      const needed = this.killsNeeded(stage)
      kills = [Math.min(this.done, needed), needed]
      progress = needed > 0 ? Math.min(1, this.done / needed) : 1
    } else if (goal?.kind === 'hold') progress = Math.min(1, this.done / goal.seconds)
    return {
      stage: this.escaped ? (this.coop?.stages.length ?? 0) : this.stage,
      progress: this.escaped ? 1 : progress,
      ...(kills ? { kills } : {}),
      gates: this.gates,
      zombiesAlive: this.zombies().filter((z) => z.state.alive).length,
      elapsed: this.elapsed,
    }
  }
}

function pick<T>(list: readonly T[], random: () => number): T | undefined {
  return list[Math.floor(random() * list.length)]
}
