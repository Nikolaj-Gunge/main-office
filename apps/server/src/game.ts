import {
  AUTO_PICKUP_RADIUS,
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
  type MovementConfig,
  movementFor,
  type PhysicsWorld,
  PLAYER_COLORS,
  PLAYER_QUERY_GROUPS,
  PlayerBody,
  type PlayerState,
  RAPIER,
  type RemotePlayerState,
  raycastPose,
  type ServerMessage,
  ServerMsg,
  type ShotEvent,
  ShotResult,
  SNAPSHOT_RATE,
  type SpawnWeapon,
  stepPlayer,
  type TeamId,
  TICK_DT,
  TICK_RATE,
  USE_PICKUP_RADIUS,
  WEAPONS,
  WeaponId,
  type WeaponRules,
  type WeaponState,
  weaponRulesFor,
  ZONE_MULTIPLIER,
} from '@office-fps/shared'
import { BOT_NAMES, BotBrain } from './bots.ts'
import { type Point, type WorldItem, WorldItems } from './items.ts'
import { type HistoryPose, PoseHistory } from './lagcomp.ts'
import { MatchRunner } from './match.ts'
import { SpawnPicker } from './spawning.ts'

/** Anything that can deliver bytes to one client (a WebSocket, or a fake in tests). */
export interface GameClient {
  send(bytes: Uint8Array<ArrayBuffer>): void
}

interface ServerPlayer {
  id: number
  name: string
  color: number
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
}

/** Metres walked per full walk cycle (two steps). */
const STRIDE_LENGTH = 1.7

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

  constructor(map: MapDef, physics: PhysicsWorld, random: () => number = Math.random) {
    this.map = map
    this.physics = physics
    this.random = random
    this.rulesValue = { ...DEFAULT_RULES, map: map.id }
    this.spawns = new SpawnPicker(findSpawnPoints(map, physics), physics, random)
    this.items = this.createItems(map)
    this.match = new MatchRunner(this)
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
      p.body = new PlayerBody(physics, this.movement)
      this.applyRules(p)
      p.queue = []
      if (!p.out) this.respawn(p)
    }
    old.world.free()
    for (const p of this.players.values()) this.sendWorld(p)
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
    player.body.configure(
      speedUp === 1
        ? this.movement
        : movementFor({ ...this.rulesValue, speed: this.rulesValue.speed * speedUp }),
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

  /** Adds a player and sends them the world. Returns the id, or null if the server is full. */
  join(rawName: string, client: GameClient): number | null {
    if (this.players.size >= MAX_PLAYERS) {
      // A person always gets in: a bot gives up its place.
      const bot = client === NO_CLIENT ? undefined : [...this.players.values()].find((p) => p.bot)
      if (!bot) return null
      this.leave(bot.id)
    }
    const id = this.nextId
    this.nextId = (this.nextId % 0xffff) + 1
    const name = sanitizeName(rawName) || `Player ${id}`
    const body = new PlayerBody(this.physics, this.movement)
    const player: ServerPlayer = {
      id,
      name,
      color: this.pickColor(),
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
    }
    this.match.onJoin(player)
    this.applyRules(player)
    player.state = this.freshState(player)
    if (player.out) player.state.alive = false

    this.sendWorld(player)
    for (const other of this.players.values()) {
      send(client, {
        type: ServerMsg.PlayerJoined,
        id: other.id,
        color: other.color,
        name: other.name,
      })
    }
    this.players.set(id, player)
    this.broadcast({ type: ServerMsg.PlayerJoined, id, color: player.color, name })
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
    player.body.free()
    this.players.delete(id)
    this.broadcast({ type: ServerMsg.PlayerLeft, id })
    // A person left: bots may fill up again (after one gave up its place).
    if (!player.bot) this.syncBots()
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
        const events = stepPlayer(player.state, command, TICK_DT, player.body)
        const walked = Math.hypot(player.state.pos.x - bx, player.state.pos.z - bz)
        if (walked < 1) player.stride = (player.stride + walked / STRIDE_LENGTH) % 1
        player.ackSeq = command.seq
        if (events.shot) this.fire(player, events.shot, command.viewTick)
        this.handlePickups(player, usePressed)
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
      const pose = this.history.poseAt(target.id, rewindTo) ?? toHistoryPose(target)
      if (!pose.alive) continue
      targets.push({ player: target, pose: { id: target.id, ...pose } })
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
        const scaled = { ...pose, scale: this.rulesValue.playerScale }
        const result = raycastPose(origin, dir, hit?.distance ?? wallDistance, scaled)
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
      const amount = this.hitDamage(weapon, hit.zone, hit.distance, hit.victim.health)
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
        const scaled = { ...pose, scale: this.rulesValue.playerScale }
        const hit = raycastPose(origin, dir, best?.distance ?? reach, scaled)
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
    const backstab = (fx * ax + fz * az) / (Math.hypot(ax, az) || 1) < -0.3
    const rules = this.rulesValue
    const headshot = best.zone === HitZone.Head
    if (rules.headshotsOnly && !headshot && !backstab) return
    const amount =
      backstab || rules.oneShot
        ? best.victim.health
        : Math.round(damageAtDistance(weapon, best.distance) * rules.damage)
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
    health: number,
  ): number {
    const rules = this.rulesValue
    const headshot = zone === HitZone.Head
    if (rules.headshotsOnly && !headshot) return 0
    const multiPellet = (weapon.pellets ?? 1) > 1
    if (rules.oneShot || (headshot && !multiPellet)) return health
    const zoneMultiplier = headshot ? (weapon.pelletHeadMultiplier ?? 1) : ZONE_MULTIPLIER[zone]
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
    const dealt = Math.min(victim.health, amount)
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
    if (killed) this.kill(victim, attacker, headshot)
  }

  private kill(victim: ServerPlayer, killer: ServerPlayer, headshot: boolean): void {
    // Your rifle/sniper drops where you died (full ammo, like every weapon on the floor).
    const primary = primaryOf(victim.state)
    if (primary)
      this.items.drop(primary.id, this.floorBelow(victim.state.pos), victim.state.yaw, this.tick)
    victim.state.alive = false
    victim.state.vel = { x: 0, y: 0, z: 0 }
    victim.respawnAt = this.tick + Math.round(this.rulesValue.respawnSeconds * TICK_RATE)
    victim.deaths++
    if (killer !== victim) {
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

  /** Every connected client. */
  broadcastMessage(msg: ServerMessage): void {
    this.broadcast(msg)
  }

  /** Switches map from inside the game (map rotation between rounds). */
  rotateMap(next: MapDef, physics: PhysicsWorld): void {
    this.changeMap(next, physics)
  }

  private respawn(player: ServerPlayer): void {
    const previous = player.state
    player.state = this.freshState(player)
    // Keep input edge detection continuous so a held button isn't seen as a new press.
    player.state.prevButtons = previous.prevButtons
    player.health = MAX_HEALTH
    player.protectedUntil = this.tick + SPAWN_PROTECTION_SECONDS * TICK_RATE
  }

  /**
   * Everyone spawns with the handgun, plus the rules' spawn weapon in hand if the admin set one
   * (otherwise rifles, snipers and shotguns are found on the floor).
   */
  private freshState(player: ServerPlayer): PlayerState {
    const spawn = this.pickSpawn(player)
    // Gun game and the infected: the mode decides what you carry.
    const forced = this.match.loadout(player)
    if (forced) {
      return forced === WeaponId.Knife
        ? createPlayerState(spawn, newWeapon(WeaponId.Knife), null, null)
        : createPlayerState(spawn, newWeapon(forced), newWeapon(WeaponId.Knife), null)
    }
    const primary = spawnPrimary(this.rulesValue.spawnWeapon, this.random)
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
    for (const p of this.players.values()) poses.set(p.id, toHistoryPose(p))
    return poses
  }

  private sendSnapshots(): void {
    const everyone: RemotePlayerState[] = [...this.players.values()].map((p) =>
      toRemote(p, this.tick < p.protectedUntil),
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
      entries: [...this.players.values()].map((p) => ({
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
      .filter((p) => p !== player && p.state.alive && (p.team === 0 || p.team !== player.team))
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

function toHistoryPose(p: ServerPlayer): HistoryPose {
  const s = p.state
  return {
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

function toRemote(p: ServerPlayer, isProtected: boolean): RemotePlayerState {
  const s = p.state
  return {
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
