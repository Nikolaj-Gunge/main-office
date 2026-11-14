import {
  AUTO_PICKUP_RADIUS,
  aimProgress,
  Button,
  carried,
  createPlayerState,
  createWeaponState,
  DEFAULT_RULES,
  DebugFlag,
  damageAtDistance,
  encodeServerMessage,
  findSpawnPoints,
  type GameRules,
  type HitPose,
  HitZone,
  hasButton,
  INPUT_BATCH_TICKS,
  type InputCommand,
  isPrimary,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  type MapDef,
  type MapSpawn,
  type MovementConfig,
  moveDirection,
  movementFor,
  type PhysicsWorld,
  PLAYER_COLORS,
  PLAYER_QUERY_GROUPS,
  PlayerBody,
  type PlayerState,
  packAppearance,
  RAPIER,
  type RemotePlayerState,
  randomAppearance,
  raycastPose,
  type ServerMessage,
  ServerMsg,
  type ShotEvent,
  ShotResult,
  SNAPSHOT_RATE,
  type SpawnWeapon,
  type SurvivalAction,
  seeded,
  setGates,
  stepPlayer,
  strideLength,
  type TeamId,
  TICK_DT,
  TICK_RATE,
  USE_PICKUP_RADIUS,
  unpackAppearance,
  WEAPON_TIER,
  WEAPONS,
  WeaponId,
  type WeaponRules,
  type WeaponState,
  weaponRulesFor,
  ZONE_MULTIPLIER,
  zombieScale,
} from '@office-fps/shared'
import { BOT_NAMES, BotBrain } from './bots.ts'
import { type Point, type WorldItem, WorldItems } from './items.ts'
import { type HistoryPose, PoseHistory } from './lagcomp.ts'
import { MatchRunner } from './match.ts'
import { SpawnPicker } from './spawning.ts'

/** What runs a zombie (zombies mode's brain, or one of survival's dead). */
export interface ZombieMind {
  kind: number
  face(yaw: number): void
}

/** Anything that can deliver bytes to one client (a WebSocket, or a fake in tests). */
export interface GameClient {
  send(bytes: Uint8Array<ArrayBuffer>): void
}

interface ServerPlayer {
  id: number
  name: string
  color: number
  /** What they look like (packAppearance, sanitised); undefined for zombies. */
  appearance?: number
  client: GameClient
  body: PlayerBody
  state: PlayerState
  /** Received but not yet simulated input commands, oldest first. */
  queue: InputCommand[]
  /** Highest seq ever queued (rejects duplicates and replays). */
  lastQueuedSeq: number
  /** Highest seq simulated — echoed in snapshots for reconciliation. */
  ackSeq: number
  health: number
  /** Tick at which a dead player respawns. */
  respawnAt: number
  /** Can't be damaged until this tick (spawn protection). Ends early when they shoot. */
  protectedUntil: number
  kills: number
  deaths: number
  debugFlags: number
  /** Round trip (ms) the client last reported. */
  ping: number
  /** Set for server-side bots: decides their input every tick. */
  bot?: BotBrain
  /** Game mode standing (see match.ts): team, gun game level, last-man-standing "out". */
  team: TeamId
  headshots: number
  level: number
  levelKills: number
  out: boolean
  /** Walk cycle 0–1 (advances with distance walked): drives the running animation and hitboxes. */
  stride: number
  /**
   * Aim-down-sights blend 0–1 for the body others see: follows the weapon's aim progress up and
   * eases back down over ADS_OUT_SECONDS (the weapon itself drops its aim instantly). Kept here,
   * not smoothed on clients, so the replicated pose — and its hitboxes — stays the server's.
   */
  ads: number
  /** Landing impact 0–1: set on touchdown by how hard they came down, fades over LAND_SECONDS. */
  land: number
  /** Tick of their last shot or swing (recoil, melee and claw animations). */
  shotTick: number
  /** Shooting-range dummy: stands exactly here, never moves, turns or shoots. */
  dummy?: MapSpawn
  /** Zombies mode: one of the horde (server-run, see zombies.ts). */
  zombie?: ZombieMind
  /** Health on (re)spawn. */
  maxHealth: number
}

/** Range dummies come back this fast after being dropped. */
const DUMMY_RESPAWN_SECONDS = 1

/** How long the gun takes to come down from the sights, as others see it. */
const ADS_OUT_SECONDS = 0.15
/** How long a landing's dip lasts, and the fall speed (m/s) that makes the deepest one. */
const LAND_SECONDS = 0.3
const HARD_LANDING = 9

export type { ServerPlayer }

/** Bots have nobody to send messages to. */
const NO_CLIENT: GameClient = { send: () => {} }

/**
 * Inputs simulated per player per tick. Clients send them in batches (INPUT_BATCH_TICKS), so we
 * take 1 per tick to keep everyone's movement even, and 2 only once a backlog builds up (after
 * a network hiccup) — still capping how fast a (cheating) client can move.
 */
const MAX_COMMANDS_PER_TICK = 2
/** Queue length above which we catch up at MAX_COMMANDS_PER_TICK. */
const CATCH_UP_QUEUE = INPUT_BATCH_TICKS + 1
/** Max buffered commands per player (~0.33 s). Beyond this the oldest are dropped. */
const MAX_QUEUE = 20
const MAX_COMMANDS_PER_MESSAGE = 16
const TICKS_PER_SNAPSHOT = Math.max(1, Math.round(TICK_RATE / SNAPSHOT_RATE))

export const MAX_HEALTH = 100
/** Where a headshot doesn't kill outright (survival's dead), it does this many times the damage. */
const HEAD_MULTIPLIER = 4
export const SPAWN_PROTECTION_SECONDS = 2
/**
 * How far back a shot may be checked (s). Covers ~300 ms RTT + 100 ms interpolation; beyond
 * that, players on terrible connections must lead their targets instead of the victim being
 * shot "around corners" too long after the fact.
 */
export const MAX_REWIND_SECONDS = 0.4

/**
 * The authoritative game: players, their simulation, combat and what everyone gets told. Knows
 * nothing about sockets — `connections.ts` adapts WebSockets to it, tests drive it directly.
 */
export class Game {
  tick = 0
  readonly players = new Map<number, ServerPlayer>()
  /** Smoothed cost of simulation and of building + sending snapshots (ms), for /healthz. */
  readonly timing = { simMs: 0, snapshotMs: 0 }
  private nextId = 1
  private map: MapDef
  private physics: PhysicsWorld
  private readonly history = new PoseHistory(
    Math.ceil((1 * TICK_RATE) / TICKS_PER_SNAPSHOT),
    TICKS_PER_SNAPSHOT,
  )
  private spawns: SpawnPicker
  items: WorldItems
  private readonly random: () => number
  private rulesValue: GameRules = DEFAULT_RULES
  private movement: MovementConfig = movementFor(DEFAULT_RULES)
  private weaponRules: WeaponRules = weaponRulesFor(DEFAULT_RULES)
  /** Rounds, teams and scoring for the current game mode. */
  readonly match: MatchRunner
  /** The zombie kind each zombie was last announced as (PlayerJoined). */
  private readonly zombieLooks = new Map<number, number>()

  constructor(map: MapDef, physics: PhysicsWorld, random: () => number = Math.random) {
    this.map = map
    this.physics = physics
    this.random = random
    this.rulesValue = { ...DEFAULT_RULES, map: map.id }
    this.spawns = new SpawnPicker(findSpawnPoints(map, physics), physics, random)
    this.items = this.createItems(map)
    this.match = new MatchRunner(this)
    this.match.onMapChanged()
    this.syncDummies()
  }

  /** One dummy per map target (shooting range); removes dummies from the previous map. */
  private syncDummies(): void {
    for (const p of [...this.players.values()]) if (p.dummy) this.leave(p.id)
    for (const target of this.map.targets ?? []) {
      const distance = Math.round(-target.pos[2])
      const id = this.join(`Dummy ${distance} m`, NO_CLIENT, target)
      const dummy = id === null ? undefined : this.players.get(id)
      if (dummy) dummy.protectedUntil = 0
    }
  }

  get mapId(): string {
    return this.map.id
  }

  get rules(): GameRules {
    return this.rulesValue
  }

  /**
   * Applies new game rules to everyone, live. The map is not switched here (the caller builds
   * the new world and calls `changeMap`), so `rules.map` is kept as the map actually running.
   */
  setRules(rules: GameRules): void {
    const before = this.rulesValue
    this.rulesValue = { ...rules, map: this.map.id }
    this.movement = movementFor(this.rulesValue)
    this.weaponRules = weaponRulesFor(this.rulesValue)
    for (const p of this.players.values()) this.applyRules(p)
    this.broadcast({ type: ServerMsg.Rules, rules: this.rulesValue })
    this.syncBots()
    this.match.onRulesChanged(before)
  }

  /** Adds or removes bots until there are as many as the rules ask for (room permitting). */
  private syncBots(): void {
    const bots = [...this.players.values()].filter((p) => p.bot)
    for (const bot of bots) if (bot.bot) bot.bot.skill = this.rulesValue.botSkill
    for (let i = bots.length; i < this.rulesValue.bots; i++) {
      if (this.players.size >= MAX_PLAYERS) break
      const used = new Set(bots.map((b) => b.name))
      const name = `Bot ${BOT_NAMES.find((n) => !used.has(`Bot ${n}`)) ?? i + 1}`
      const id = this.join(name, NO_CLIENT)
      const player = id === null ? undefined : this.players.get(id)
      if (!player) break
      player.bot = new BotBrain(
        this.rulesValue.botSkill,
        () => this.physics,
        () => this.spawns.points,
        this.random,
      )
      bots.push(player)
    }
    for (const bot of bots.slice(this.rulesValue.bots)) this.leave(bot.id)
  }

  /** True for a server-side bot. */
  isBot(id: number): boolean {
    return this.players.get(id)?.bot !== undefined
  }

  /**
   * Swaps in another map: everyone respawns in it with a handgun and gets a fresh Welcome
   * (clients reload into the new map). Scores are kept. Frees the old physics world.
   */
  changeMap(map: MapDef, physics: PhysicsWorld): void {
    const old = this.physics
    for (const p of this.players.values()) p.body.free()
    this.map = map
    this.physics = physics
    this.spawns = new SpawnPicker(findSpawnPoints(map, physics), physics, this.random)
    this.items = this.createItems(map)
    this.history.clear()
    this.rulesValue = { ...this.rulesValue, map: map.id }
    for (const p of this.players.values()) {
      p.body = new PlayerBody(physics, this.movement, p.client === NO_CLIENT)
      p.body.climbs = !p.zombie
      this.applyRules(p)
      p.queue = []
      if (!p.out) this.respawn(p)
    }
    old.world.free()
    this.match.onMapChanged()
    for (const p of this.players.values()) this.sendWorld(p)
    this.syncDummies()
  }

  /** Zeroes everyone's kills and deaths. */
  resetScores(): void {
    for (const p of this.players.values()) {
      p.kills = 0
      p.deaths = 0
      p.headshots = 0
    }
    this.sendScoreboard()
  }

  /** Movement and weapon rules for one player (the infected run faster). */
  applyRules(player: ServerPlayer): void {
    const speedUp = this.match.speedFactor(player)
    const size = zombieScale(player.zombie?.kind ?? 0)
    player.body.configure(
      speedUp === 1 && size === 1
        ? this.movement
        : movementFor({
            ...this.rulesValue,
            speed: this.rulesValue.speed * speedUp,
            playerScale: this.rulesValue.playerScale * size,
          }),
    )
    player.body.weaponRules = this.weaponRules
  }

  /** The map's spawn spots and physics, for the match runner (map rotation) and bots. */
  get world(): { map: MapDef; physics: PhysicsWorld } {
    return { map: this.map, physics: this.physics }
  }

  private createItems(map: MapDef): WorldItems {
    const items = new WorldItems(
      map.pickups ?? [],
      (item) => this.broadcast(itemSpawnMessage(item)),
      (id) => this.broadcast({ type: ServerMsg.ItemRemove, id }),
    )
    items.step(this.tick)
    return items
  }

  /** Number of possible random spawn spots (for the startup log). */
  get spawnPointCount(): number {
    return this.spawns.count
  }

  /**
   * Adds a player and sends them the world. Returns the id, or null if the server is full.
   * `appearance` is what they chose in the character creator (packed; sanitised here). Without
   * one, people, bots and dummies get a random look of their own; zombies have none.
   */
  join(
    rawName: string,
    client: GameClient,
    dummy?: MapSpawn,
    zombie?: ZombieMind,
    appearance?: number,
  ): number | null {
    if (this.players.size >= MAX_PLAYERS) {
      // A person always gets in: a zombie or a bot gives up its place.
      const bot =
        client === NO_CLIENT
          ? undefined
          : ([...this.players.values()].find((p) => p.zombie) ??
            [...this.players.values()].find((p) => p.bot))
      if (!bot) return null
      this.leave(bot.id)
    }
    const id = this.nextId
    this.nextId = (this.nextId % 0xffff) + 1
    const name = sanitizeName(rawName) || `Player ${id}`
    // Zombies and bots (no client) go through corn; people walk round it.
    const body = new PlayerBody(this.physics, this.movement, client === NO_CLIENT)
    body.climbs = !zombie // the dead don't climb
    const player: ServerPlayer = {
      id,
      name,
      color: this.pickColor(),
      ...(zombie ? {} : { appearance: sanitizeAppearance(appearance, id) }),
      client,
      body,
      state: createPlayerState(),
      queue: [],
      lastQueuedSeq: 0,
      ackSeq: 0,
      health: MAX_HEALTH,
      respawnAt: 0,
      protectedUntil: this.tick + SPAWN_PROTECTION_SECONDS * TICK_RATE,
      kills: 0,
      deaths: 0,
      debugFlags: 0,
      ping: 0,
      team: 0,
      headshots: 0,
      level: 0,
      levelKills: 0,
      out: false,
      stride: 0,
      ads: 0,
      land: 0,
      shotTick: -TICK_RATE,
      maxHealth: MAX_HEALTH,
      ...(dummy ? { dummy } : {}),
      ...(zombie ? { zombie } : {}),
    }
    this.match.onJoin(player)
    this.applyRules(player)
    player.state = this.freshState(player)
    if (player.out) player.state.alive = false

    this.sendWorld(player)
    for (const other of this.players.values()) send(client, joinedMessage(other))
    this.players.set(id, player)
    this.broadcast(joinedMessage(player))
    this.match.broadcast()
    return id
  }

  /** Welcome (which map, your id), the rules and the weapons lying around. */
  private sendWorld(player: ServerPlayer): void {
    send(player.client, {
      type: ServerMsg.Welcome,
      playerId: player.id,
      serverTick: this.tick,
      tickRate: TICK_RATE,
      snapshotRate: SNAPSHOT_RATE,
      mapId: this.map.id,
    })
    send(player.client, { type: ServerMsg.Rules, rules: this.rulesValue })
    send(player.client, { type: ServerMsg.Match, match: this.match.info() })
    for (const item of this.items.items.values()) send(player.client, itemSpawnMessage(item))
  }

  leave(id: number): void {
    const player = this.players.get(id)
    if (!player) return
    this.match.onLeave(player)
    player.body.free()
    this.players.delete(id)
    this.zombieLooks.delete(id)
    this.broadcast({ type: ServerMsg.PlayerLeft, id })
    // A person left: bots may fill up again (after one gave up its place).
    if (!player.bot && !player.dummy && !player.zombie) this.syncBots()
    this.match.check()
  }

  handleInput(id: number, commands: InputCommand[]): void {
    const player = this.players.get(id)
    if (!player) return
    for (const command of commands.slice(0, MAX_COMMANDS_PER_MESSAGE)) {
      if (command.seq <= player.lastQueuedSeq) continue
      player.lastQueuedSeq = command.seq
      player.queue.push(command)
    }
    if (player.queue.length > MAX_QUEUE) player.queue.splice(0, player.queue.length - MAX_QUEUE)
  }

  /** Stores the round trip a client measured (for the scoreboard). */
  reportPing(id: number, rtt: number): void {
    const player = this.players.get(id)
    if (player) player.ping = Math.min(9999, Math.max(0, rtt))
  }

  setDebug(id: number, flags: number): void {
    const player = this.players.get(id)
    if (player) player.debugFlags = flags
  }

  /** Advances the replicated animation state after one simulated command. */
  private animate(player: ServerPlayer, walked: number): void {
    const s = player.state
    const speed = Math.hypot(s.vel.x, s.vel.z)
    const length = strideLength(speed, this.sizeOf(player), player.zombie?.kind ?? 0)
    if (walked < 1) player.stride = (player.stride + walked / length) % 1
    player.ads = Math.max(aimProgress(s.weapon), player.ads - TICK_DT / ADS_OUT_SECONDS)
    player.land = Math.max(0, player.land - TICK_DT / LAND_SECONDS)
  }

  /** Survival: something done from the backpack, a shop or a conversation. */
  handleAction(id: number, action: SurvivalAction): void {
    const player = this.players.get(id)
    if (player) this.match.onAction(player, action)
  }

  /** One client. */
  sendTo(player: ServerPlayer, msg: ServerMessage): void {
    send(player.client, msg)
  }

  /** Advances the world one fixed tick. */
  step(): void {
    this.tick++
    const t0 = performance.now()
    this.thinkBots()
    for (const player of this.players.values()) {
      const take = player.queue.length > CATCH_UP_QUEUE ? MAX_COMMANDS_PER_TICK : 1
      const commands = player.queue.splice(0, take)
      for (const command of commands) {
        const usePressed =
          hasButton(command.buttons, Button.Use) && !hasButton(player.state.prevButtons, Button.Use)
        const bx = player.state.pos.x
        const bz = player.state.pos.z
        const wasGrounded = player.state.grounded
        const fallSpeed = -player.state.vel.y
        const events = stepPlayer(player.state, command, TICK_DT, player.body)
        this.animate(player, Math.hypot(player.state.pos.x - bx, player.state.pos.z - bz))
        if (player.state.grounded && !wasGrounded) {
          player.land = Math.max(player.land, Math.min(1, (fallSpeed - 1) / (HARD_LANDING - 1)))
        }
        player.ackSeq = command.seq
        if (events.shot) {
          player.shotTick = this.tick
          this.fire(player, events.shot, command.viewTick)
          this.match.onShot(player)
        }
        if (this.match.ownsUse) {
          if (usePressed) this.match.onUse(player)
        } else this.handlePickups(player, usePressed)
      }
    }
    this.items.step(this.tick)
    for (const player of this.players.values()) {
      if (!player.state.alive && !player.out && this.tick >= player.respawnAt) this.respawn(player)
    }
    this.match.step()
    const t1 = performance.now()
    this.timing.simMs += (t1 - t0 - this.timing.simMs) * 0.05

    if (this.tick % TICK_RATE === 0) {
      this.sendScoreboard()
      this.match.broadcast()
    }
    if (this.tick % TICKS_PER_SNAPSHOT === 0) {
      this.history.record(this.tick, this.currentPoses())
      this.sendSnapshots()
      this.timing.snapshotMs += (performance.now() - t1 - this.timing.snapshotMs) * 0.05
    }
  }

  /** Every bot decides this tick's input, from where everyone is right now. */
  private thinkBots(): void {
    let views:
      | { id: number; pos: Point; alive: boolean; isProtected: boolean; team: number }[]
      | null = null
    for (const player of this.players.values()) {
      if (player.dummy) {
        // Dummies stand still facing their way: an idle input keeps their sim (and pose) going.
        const seq = player.lastQueuedSeq + 1
        player.lastQueuedSeq = seq
        player.queue.push({ seq, buttons: 0, yaw: player.dummy.yaw, pitch: 0, viewTick: this.tick })
        continue
      }
      if (player.zombie) {
        const command = this.match.thinkZombie(player)
        if (command) {
          player.lastQueuedSeq = command.seq
          player.queue.push(command)
        }
        continue
      }
      if (!player.bot) continue
      views ??= [...this.players.values()].map((p) => ({
        id: p.id,
        pos: p.state.pos,
        alive: p.state.alive,
        isProtected: this.tick < p.protectedUntil,
        team: p.team,
      }))
      const others = views.filter((v) => v.id !== player.id)
      player.bot.team = player.team
      player.bot.follow = this.match.botFollow(player)
      const command = player.bot.think(player.state, others, this.tick, TICK_DT)
      player.lastQueuedSeq = command.seq
      player.queue.push(command)
    }
  }

  // --- Combat -------------------------------------------------------------------------------

  /**
   * Resolves a hitscan shot — every pellet of it, for the shotgun — with everyone rewound to
   * what the shooter saw. Damage is added up per victim and applied once.
   */
  private fire(shooter: ServerPlayer, shot: ShotEvent, viewTick: number): void {
    shooter.protectedUntil = 0 // shooting ends spawn protection
    const weapon = WEAPONS[shooter.state.weapon.id]
    const { origin } = shot
    const rewindTo = Math.max(
      this.tick - MAX_REWIND_SECONDS * TICK_RATE,
      this.history.oldestTick,
      Math.min(viewTick, this.tick),
    )
    const targets: { player: ServerPlayer; pose: HitPose & { id: number } }[] = []
    for (const target of this.players.values()) {
      if (target === shooter || !target.state.alive) continue
      // A zombie's claws go through the zombie crowding it (they'd always hit each other).
      if (shooter.zombie && target.zombie) continue
      const pose = this.history.poseAt(target.id, rewindTo) ?? toHistoryPose(target, this.tick)
      if (!pose.alive) continue
      // Idle motion runs on the server clock: the time the shooter was looking at.
      const time = rewindTo / TICK_RATE
      targets.push({
        player: target,
        pose: { id: target.id, ...pose, time, scale: this.sizeOf(target) },
      })
    }

    if (weapon.fireMode === 'melee') {
      this.swing(shooter, shot, targets)
      return
    }

    const hits = new Map<ServerPlayer, { amount: number; headshot: boolean; zone: HitZone }>()
    shot.pellets.forEach((dir, i) => {
      const ray = new RAPIER.Ray(origin, dir)
      const wall = this.physics.world.castRayAndGetNormal(
        ray,
        weapon.range,
        true,
        undefined,
        PLAYER_QUERY_GROUPS,
      )
      const wallDistance = wall ? wall.timeOfImpact : weapon.range
      let hit: { victim: ServerPlayer; distance: number; zone: HitZone } | null = null
      for (const { player, pose } of targets) {
        const result = raycastPose(origin, dir, hit?.distance ?? wallDistance, pose)
        if (result) hit = { victim: player, ...result }
      }

      const distance = hit?.distance ?? wallDistance
      const end = {
        x: origin.x + dir.x * distance,
        y: origin.y + dir.y * distance,
        z: origin.z + dir.z * distance,
      }
      const normal = hit
        ? { x: -dir.x, y: -dir.y, z: -dir.z }
        : wall
          ? { x: wall.normal.x, y: wall.normal.y, z: wall.normal.z }
          : { x: 0, y: 1, z: 0 }
      const result = hit ? ShotResult.Player : wall ? ShotResult.World : ShotResult.Nothing
      const shotMsg = encodeServerMessage({
        type: ServerMsg.ShotFired,
        shooterId: shooter.id,
        weapon: shooter.state.weapon.id,
        end,
        normal,
        result,
        ...(i > 0 ? { pellet: true } : {}),
      })
      for (const p of this.players.values()) if (p !== shooter) p.client.send(shotMsg)

      if (!hit) return
      const amount = this.hitDamage(weapon, hit.zone, hit.distance, hit.victim)
      if (amount <= 0) return
      const total = hits.get(hit.victim) ?? { amount: 0, headshot: false, zone: hit.zone }
      total.amount += amount
      if (hit.zone === HitZone.Head) {
        total.headshot = true
        total.zone = HitZone.Head
      }
      hits.set(hit.victim, total)
    })

    if (shooter.debugFlags & DebugFlag.LagComp) {
      send(shooter.client, {
        type: ServerMsg.DebugShot,
        origin,
        dir: shot.dir,
        viewTick: rewindTo,
        poses: targets.map((t) => t.pose),
      })
    }

    for (const [victim, total] of hits) {
      this.damage(victim, shooter, total.zone, total.amount, total.headshot)
    }
  }

  /**
   * A knife swing: the closest player any ray of the swing's fan touches within reach takes one
   * hit — two from the front kill, one from behind (a backstab). Others hear the swing.
   */
  private swing(
    shooter: ServerPlayer,
    shot: ShotEvent,
    targets: { player: ServerPlayer; pose: HitPose & { id: number } }[],
  ): void {
    const weapon = WEAPONS[shooter.state.weapon.id]
    const { origin } = shot
    let best: { victim: ServerPlayer; pose: HitPose; distance: number; zone: HitZone } | null = null
    let endDir = shot.dir
    for (const dir of shot.pellets) {
      const wall = this.physics.world.castRay(
        new RAPIER.Ray(origin, dir),
        weapon.range,
        true,
        undefined,
        PLAYER_QUERY_GROUPS,
      )
      const reach = wall ? wall.timeOfImpact : weapon.range
      for (const { player, pose } of targets) {
        const hit = raycastPose(origin, dir, best?.distance ?? reach, pose)
        if (hit) {
          best = { victim: player, pose, ...hit }
          endDir = dir
        }
      }
    }
    const distance = best?.distance ?? weapon.range
    const swingMsg = encodeServerMessage({
      type: ServerMsg.ShotFired,
      shooterId: shooter.id,
      weapon: weapon.id,
      end: {
        x: origin.x + endDir.x * distance,
        y: origin.y + endDir.y * distance,
        z: origin.z + endDir.z * distance,
      },
      normal: { x: -endDir.x, y: -endDir.y, z: -endDir.z },
      result: best ? ShotResult.Player : ShotResult.Nothing,
    })
    for (const p of this.players.values()) if (p !== shooter) p.client.send(swingMsg)
    if (!best) return

    // Behind them: the attacker is on the side their back faces.
    const fx = -Math.sin(best.pose.yaw)
    const fz = -Math.cos(best.pose.yaw)
    const ax = shooter.state.pos.x - best.pose.x
    const az = shooter.state.pos.z - best.pose.z
    const backstab =
      (weapon.id === WeaponId.Knife || (weapon.slot === 'melee' && !shooter.zombie)) &&
      (fx * ax + fz * az) / (Math.hypot(ax, az) || 1) < -0.3 &&
      this.match.backstabKills(best.victim)
    const rules = this.rulesValue
    const headshot = best.zone === HitZone.Head
    if (shooter.zombie) {
      // Zombie claws: their damage comes from the mode (difficulty), not the game rules.
      this.damage(best.victim, shooter, best.zone, this.match.clawDamage(shooter), false)
      return
    }
    if (rules.headshotsOnly && !headshot && !backstab) return
    const amount =
      backstab || rules.oneShot
        ? best.victim.health
        : Math.round(
            damageAtDistance(weapon, best.distance) *
              rules.damage *
              (headshot && !this.match.headshotKills(best.victim) ? HEAD_MULTIPLIER : 1),
          )
    this.damage(best.victim, shooter, best.zone, amount, headshot)
  }

  /**
   * Damage one bullet or pellet does under the current rules (0 = none). A headshot kills
   * outright (enough to take all of `health`), except for shotgun pellets, which only hurt more.
   */
  private hitDamage(
    weapon: (typeof WEAPONS)[WeaponId],
    zone: HitZone,
    distance: number,
    victim: ServerPlayer,
  ): number {
    const rules = this.rulesValue
    const headshot = zone === HitZone.Head
    if (rules.headshotsOnly && !headshot) return 0
    const multiPellet = (weapon.pellets ?? 1) > 1
    const lethal = this.match.headshotKills(victim)
    if (rules.oneShot || (headshot && !multiPellet && lethal)) return victim.health
    const zoneMultiplier = headshot
      ? multiPellet
        ? (weapon.pelletHeadMultiplier ?? 1)
        : HEAD_MULTIPLIER
      : ZONE_MULTIPLIER[zone]
    return Math.max(
      1,
      Math.round(damageAtDistance(weapon, distance) * zoneMultiplier * rules.damage),
    )
  }

  private damage(
    victim: ServerPlayer,
    attacker: ServerPlayer,
    zone: HitZone,
    amount: number,
    headshot: boolean,
  ) {
    if (this.tick < victim.protectedUntil) return
    if (!this.match.canHurt(attacker, victim)) return
    const dealt = Math.min(victim.health, this.match.armour(victim, zone === HitZone.Head, amount))
    victim.health -= dealt
    const killed = victim.health === 0

    send(attacker.client, {
      type: ServerMsg.HitConfirm,
      victimId: victim.id,
      zone,
      damage: dealt,
      killed,
    })
    const s = attacker.state.pos
    send(victim.client, {
      type: ServerMsg.Damaged,
      attackerId: attacker.id,
      damage: dealt,
      health: victim.health,
      from: { x: s.x, y: s.y, z: s.z },
    })
    this.match.onDamage(victim, attacker, dealt)
    if (killed) this.kill(victim, attacker, headshot)
  }

  /** How big someone is: the rules' body size, times a zombie kind's own. */
  private sizeOf(player: ServerPlayer): number {
    return this.rulesValue.playerScale * zombieScale(player.zombie?.kind ?? 0)
  }

  private kill(victim: ServerPlayer, killer: ServerPlayer, headshot: boolean): void {
    // Your rifle/sniper drops where you died (full ammo, like every weapon on the floor).
    const primary = this.match.ownsUse ? null : primaryOf(victim.state)
    if (primary)
      this.items.drop(primary.id, this.floorBelow(victim.state.pos), victim.state.yaw, this.tick)
    victim.state.alive = false
    victim.state.vel = { x: 0, y: 0, z: 0 }
    const respawnSeconds = victim.dummy
      ? DUMMY_RESPAWN_SECONDS
      : (this.match.respawnSeconds() ?? this.rulesValue.respawnSeconds)
    victim.respawnAt = this.tick + Math.round(respawnSeconds * TICK_RATE)
    if (!victim.dummy) victim.deaths++
    if (killer !== victim && !victim.dummy) {
      killer.kills++
      if (headshot) killer.headshots++
    }
    const weapon = killer.state.weapon.id
    this.broadcast({
      type: ServerMsg.Kill,
      killerId: killer.id,
      victimId: victim.id,
      weapon,
      headshot,
    })
    this.match.onKill(victim, killer, weapon)
    this.sendScoreboard()
  }

  /** Kills `victimId` as if `killerId` shot them (tests, and a future admin "slay"). */
  killPlayer(victimId: number, killerId: number, headshot = false): void {
    const victim = this.players.get(victimId)
    const killer = this.players.get(killerId)
    if (!victim || !killer || !victim.state.alive) return
    victim.health = 0
    this.kill(victim, killer, headshot)
  }

  /** Puts `player` back in, fresh, at a safe spot (also used by the match runner). */
  respawnNow(player: ServerPlayer): void {
    this.respawn(player)
  }

  /** Swaps the weapon in a player's hand (gun game level-up), keeping the knife. */
  giveWeapon(player: ServerPlayer, id: WeaponId): void {
    const s = player.state
    s.weapon = newWeapon(id)
    s.holstered = id === WeaponId.Knife ? null : newWeapon(WeaponId.Knife)
    s.pocket = null
  }

  // --- Zombies mode (zombies.ts runs the horde through these) ---------------------------------

  /** Adds a zombie to the pool (dead until `placeZombie`). Null if the server is full. */
  addZombie(brain: ZombieMind): ServerPlayer | null {
    const id = this.join('Zombie', NO_CLIENT, undefined, brain)
    const zombie = id === null ? undefined : this.players.get(id)
    if (!zombie) return null
    this.zombieLooks.set(zombie.id, brain.kind)
    zombie.state.alive = false
    zombie.respawnAt = Number.POSITIVE_INFINITY
    return zombie
  }

  /** Brings a pooled zombie (back) to life here. */
  placeZombie(zombie: ServerPlayer, spawn: MapSpawn, health: number): void {
    // Walker or runner this time: clients need to know to draw the right one.
    const kind = zombie.zombie?.kind ?? 0
    if (this.zombieLooks.get(zombie.id) !== kind) {
      this.zombieLooks.set(zombie.id, kind)
      this.broadcast(joinedMessage(zombie))
    }
    zombie.maxHealth = health
    this.applyRules(zombie)
    this.respawn(zombie, spawn)
    zombie.zombie?.face(spawn.yaw)
  }

  /** Renames a pooled zombie (survival: someone who turned), telling every client. */
  nameZombie(zombie: ServerPlayer, name: string): void {
    if (zombie.name === name) return
    zombie.name = name
    this.broadcast(joinedMessage(zombie))
  }

  /** Takes a zombie out quietly (no kill, no score): back into the pool. */
  retireZombie(zombie: ServerPlayer): void {
    zombie.state.alive = false
    zombie.state.vel = { x: 0, y: 0, z: 0 }
    zombie.respawnAt = Number.POSITIVE_INFINITY
  }

  /** Opens and shuts the map's gates (bit i = gate i open). */
  setGates(open: number): void {
    setGates(this.physics, (id) => (open & (1 << id)) !== 0)
  }

  /**
   * Puts `id` in a player's hands as their primary, unless what they carry is at least as big
   * (co-op armory at each checkpoint). Their old primary is simply replaced.
   */
  arm(player: ServerPlayer, id: WeaponId): void {
    const s = player.state
    const current = primaryOf(s)
    if (current && WEAPON_TIER[current.id] >= WEAPON_TIER[id]) return
    const others = carried(s).filter((w) => w !== current)
    const handgun = others.find((w) => w.id === WeaponId.Handgun) ?? newWeapon(WeaponId.Handgun)
    const knife = others.find((w) => w.id === WeaponId.Knife) ?? newWeapon(WeaponId.Knife)
    s.weapon = newWeapon(id)
    s.holstered = handgun
    s.pocket = knife
  }

  /** Full health and a full reserve for every gun carried (co-op checkpoints). */
  refill(player: ServerPlayer): void {
    player.health = player.maxHealth
    for (const w of carried(player.state)) w.reserve = WEAPONS[w.id].reserve
  }

  /** Nothing solid (map, glass, shut gates) between two points. */
  lineClear(a: Point, b: Point): boolean {
    const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }
    const length = Math.hypot(d.x, d.y, d.z)
    if (length < 0.01) return true
    const ray = new RAPIER.Ray(a, { x: d.x / length, y: d.y / length, z: d.z / length })
    return this.physics.world.castRay(ray, length, true, undefined, PLAYER_QUERY_GROUPS) === null
  }

  /** Every connected client. */
  broadcastMessage(msg: ServerMessage): void {
    this.broadcast(msg)
  }

  /** Switches map from inside the game (map rotation between rounds). */
  rotateMap(next: MapDef, physics: PhysicsWorld): void {
    this.changeMap(next, physics)
  }

  private respawn(player: ServerPlayer, at?: MapSpawn): void {
    const previous = player.state
    player.state = this.freshState(player, at)
    // Keep input edge detection continuous so a held button isn't seen as a new press.
    player.state.prevButtons = previous.prevButtons
    player.health = player.maxHealth
    player.protectedUntil =
      player.dummy || player.zombie ? 0 : this.tick + SPAWN_PROTECTION_SECONDS * TICK_RATE
  }

  /**
   * Everyone spawns with the handgun, plus the rules' spawn weapon in hand if the admin set one
   * (otherwise rifles, snipers and shotguns are found on the floor).
   */
  private freshState(player: ServerPlayer, at?: MapSpawn): PlayerState {
    const spawn = at ?? player.dummy ?? this.match.spawnFor(player) ?? this.pickSpawn(player)
    // Survival: you come back with what you carried.
    const own = this.match.freshState(player, spawn)
    if (own) return own
    // Gun game and the infected: the mode decides what you carry.
    const forced = this.match.loadout(player)
    if (forced) {
      return forced === WeaponId.Knife || forced === WeaponId.Claws
        ? createPlayerState(spawn, newWeapon(forced), null, null)
        : createPlayerState(spawn, newWeapon(forced), newWeapon(WeaponId.Knife), null)
    }
    // Co-op hands out the stage's gun (if it beats the admin's spawn weapon).
    const ruled = spawnPrimary(this.rulesValue.spawnWeapon, this.random)
    const armory = this.match.armory()
    const primary =
      armory !== null && (ruled === null || WEAPON_TIER[armory] > WEAPON_TIER[ruled])
        ? armory
        : ruled
    const handgun = newWeapon(WeaponId.Handgun)
    return primary === null
      ? createPlayerState(spawn, handgun, null)
      : createPlayerState(spawn, newWeapon(primary), handgun)
  }

  // --- Weapons on the floor ------------------------------------------------------------------

  /**
   * Empty primary slot: walking over a weapon picks it up and draws it. Slot filled: E swaps —
   * your rifle/sniper is thrown on the floor and the new one goes in your hands.
   */
  private handlePickups(player: ServerPlayer, usePressed: boolean): void {
    if (!player.state.alive || !this.match.canPickUp(player)) return
    const s = player.state
    const primary = primaryOf(s)
    if (!primary) {
      const item = this.items.nearest(s.pos, AUTO_PICKUP_RADIUS)
      if (item) this.equip(player, item)
      return
    }
    if (!usePressed) return
    const item = this.items.nearest(s.pos, USE_PICKUP_RADIUS)
    if (!item) return
    this.throwPrimary(player, primary)
    this.equip(player, item)
  }

  /** Takes `item` off the floor into the primary slot and draws it (full ammo). */
  private equip(player: ServerPlayer, item: WorldItem): void {
    if (!this.items.take(item.id, this.tick)) return
    const s = player.state
    const items = carried(s)
    const handgun = items.find((w) => w.id === WeaponId.Handgun) ?? newWeapon(WeaponId.Handgun)
    const knife = items.find((w) => w.id === WeaponId.Knife) ?? newWeapon(WeaponId.Knife)
    // The new gun goes in your hand; what you were holding becomes "last used" (Q).
    const previous = s.weapon.id === WeaponId.Knife ? knife : handgun
    s.weapon = newWeapon(item.weapon)
    s.holstered = previous
    s.pocket = previous === handgun ? knife : handgun
  }

  /** Throws the primary a little ahead onto the floor. */
  private throwPrimary(player: ServerPlayer, primary: WeaponState): void {
    const s = player.state
    const ahead = {
      x: s.pos.x - Math.sin(s.yaw) * 0.9,
      y: s.pos.y,
      z: s.pos.z - Math.cos(s.yaw) * 0.9,
    }
    // Don't throw it through a wall: keep it at your feet if something is in the way.
    const ray = new RAPIER.Ray(
      { x: s.pos.x, y: s.pos.y + 0.5, z: s.pos.z },
      { x: -Math.sin(s.yaw), y: 0, z: -Math.cos(s.yaw) },
    )
    const blocked = this.physics.world.castRay(ray, 1.2, true, undefined, PLAYER_QUERY_GROUPS)
    this.items.drop(primary.id, this.floorBelow(blocked ? s.pos : ahead), s.yaw, this.tick)
    const rest = carried(s).filter((w) => w !== primary)
    if (s.weapon === primary) {
      s.weapon =
        rest.find((w) => w.id === WeaponId.Handgun) ?? rest[0] ?? newWeapon(WeaponId.Handgun)
    }
    const others = rest.filter((w) => w !== s.weapon)
    s.holstered = others[0] ?? null
    s.pocket = others[1] ?? null
  }

  /** The floor (or desk) surface below a point, so dropped weapons lie on something. */
  private floorBelow(p: Point): Point {
    const ray = new RAPIER.Ray({ x: p.x, y: p.y + 1, z: p.z }, { x: 0, y: -1, z: 0 })
    const hit = this.physics.world.castRay(ray, 6, true, undefined, PLAYER_QUERY_GROUPS)
    return { x: p.x, y: hit ? p.y + 1 - hit.timeOfImpact : p.y, z: p.z }
  }

  // --- Snapshots -----------------------------------------------------------------------------

  private currentPoses(): Map<number, HistoryPose> {
    const poses = new Map<number, HistoryPose>()
    for (const p of this.players.values()) poses.set(p.id, toHistoryPose(p, this.tick))
    return poses
  }

  private sendSnapshots(): void {
    const everyone: RemotePlayerState[] = [...this.players.values()].map((p) =>
      toRemote(
        p,
        this.tick < p.protectedUntil,
        this.match.lightOn(p),
        this.tick,
        this.match.gearOf(p),
      ),
    )
    for (const player of this.players.values()) {
      send(player.client, {
        type: ServerMsg.Snapshot,
        tick: this.tick,
        ackSeq: player.ackSeq,
        self: player.state,
        health: player.health,
        respawnIn: player.state.alive ? 0 : Math.max(0, player.respawnAt - this.tick) / TICK_RATE,
        protected: this.tick < player.protectedUntil,
        players: everyone.filter((p) => p.id !== player.id),
      })
    }
  }

  /** Everyone's score, once a second (and right after each kill). */
  sendScoreboard(): void {
    this.broadcast({
      type: ServerMsg.Scoreboard,
      entries: [...this.players.values()]
        .filter((p) => !p.zombie)
        .map((p) => ({
          id: p.id,
          kills: p.kills,
          deaths: p.deaths,
          ping: p.ping,
        })),
    })
  }

  private broadcast(msg: ServerMessage): void {
    const bytes = encodeServerMessage(msg)
    for (const player of this.players.values()) player.client.send(bytes)
  }

  /** A random spot away from, and out of sight of, every living enemy (not teammates). */
  private pickSpawn(player: ServerPlayer) {
    const enemies = [...this.players.values()]
      .filter(
        (p) =>
          p !== player && p.state.alive && !p.dummy && (p.team === 0 || p.team !== player.team),
      )
      .map((p) => p.state.pos)
    return this.spawns.pick(enemies)
  }

  private pickColor(): number {
    const used = new Set([...this.players.values()].map((p) => p.color))
    for (let i = 0; i < PLAYER_COLORS.length; i++) if (!used.has(i)) return i
    return this.players.size % PLAYER_COLORS.length
  }
}

const SPAWN_PRIMARIES: Record<Exclude<SpawnWeapon, 'none' | 'random'>, WeaponId> = {
  rifle: WeaponId.Rifle,
  sniper: WeaponId.Sniper,
  shotgun: WeaponId.Shotgun,
  mp5: WeaponId.Smg,
  lmg: WeaponId.Lmg,
}

/** The main weapon a spawn gets under the rules ('random' picks one per spawn), or null. */
function spawnPrimary(rule: SpawnWeapon, random: () => number): WeaponId | null {
  if (rule === 'none') return null
  if (rule !== 'random') return SPAWN_PRIMARIES[rule]
  const all = Object.values(SPAWN_PRIMARIES)
  return all[Math.floor(random() * all.length)] ?? WeaponId.Rifle
}

/** A weapon fresh off the floor: full magazine and reserve, its own spread seed. */
function newWeapon(id: WeaponId): WeaponState {
  return createWeaponState(id, (Math.random() * 0xffffffff) >>> 0)
}

/** The rifle/sniper a player carries (in hand or holstered), or null. */
function primaryOf(s: PlayerState): WeaponState | null {
  return carried(s).find((w) => isPrimary(w.id)) ?? null
}

function itemSpawnMessage(item: WorldItem): ServerMessage {
  return {
    type: ServerMsg.ItemSpawn,
    id: item.id,
    weapon: item.weapon,
    pos: item.pos,
    yaw: item.yaw,
  }
}

function joinedMessage(p: ServerPlayer): ServerMessage {
  return {
    type: ServerMsg.PlayerJoined,
    id: p.id,
    color: p.color,
    name: p.name,
    ...(p.zombie ? { kind: p.zombie.kind } : {}),
    ...(p.appearance === undefined ? {} : { appearance: p.appearance }),
  }
}

/** A chosen look made valid (out-of-range fields clamp), or a random one seeded by the id. */
function sanitizeAppearance(raw: number | undefined, id: number): number {
  if (raw !== undefined && Number.isFinite(raw)) return packAppearance(unpackAppearance(raw))
  return packAppearance(randomAppearance(seeded(id * 2654435761)))
}

function toHistoryPose(p: ServerPlayer, tick: number): HistoryPose {
  const s = p.state
  return {
    ...animationOf(p, tick),
    weapon: s.weapon.id,
    gait: p.zombie?.kind ?? 0,
    seed: p.id,
    x: s.pos.x,
    y: s.pos.y,
    z: s.pos.z,
    yaw: s.yaw,
    pitch: s.pitch,
    crouch: s.crouchAmount,
    stride: p.stride,
    speed: Math.hypot(s.vel.x, s.vel.z),
    grounded: s.grounded,
    alive: s.alive,
  }
}

/** The animation extras of the replicated pose (the same in snapshots and lag compensation). */
function animationOf(p: ServerPlayer, tick: number) {
  const s = p.state
  return {
    moveDir: moveDirection(s.yaw, s.vel.x, s.vel.z),
    vy: s.vel.y,
    land: p.land,
    ads: p.ads,
    shotAge: Math.min(1, (tick - p.shotTick) / TICK_RATE),
    prone: s.proneAmount,
    slide: s.slide > 0 ? Math.min(1, s.slide / p.body.config.slideTime) : 0,
    // Never 0 while climbing (0 means not climbing), even on the tick it starts.
    mantle: s.mantle ? Math.max(0.005, s.mantle.time / s.mantle.duration) : 0,
    ledge: s.mantle ? s.mantle.to.y - s.pos.y : 0,
  }
}

function toRemote(
  p: ServerPlayer,
  isProtected: boolean,
  light: boolean,
  tick: number,
  gear = 0,
): RemotePlayerState {
  const s = p.state
  return {
    ...animationOf(p, tick),
    id: p.id,
    x: s.pos.x,
    y: s.pos.y,
    z: s.pos.z,
    yaw: s.yaw,
    pitch: s.pitch,
    crouch: s.crouchAmount,
    grounded: s.grounded,
    alive: s.alive,
    protected: isProtected,
    weapon: s.weapon.id,
    aiming: s.alive && hasButton(s.prevButtons, Button.Aim) && s.weapon.aimTime > 0,
    stride: p.stride,
    speed: Math.hypot(s.vel.x, s.vel.z),
    ...(light && s.alive ? { light: true } : {}),
    ...(gear ? { gear } : {}),
  }
}

function send(client: GameClient, msg: ServerMessage): void {
  client.send(encodeServerMessage(msg))
}

/** Printable characters only, collapsed whitespace, length-capped. */
export function sanitizeName(raw: string): string {
  return [
    ...raw
      .replace(/[\p{C}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim(),
  ]
    .slice(0, MAX_NAME_LENGTH)
    .join('')
}
