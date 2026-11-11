import {
  AUTO_PICKUP_RADIUS,
  Button,
  createPlayerState,
  createWeaponState,
  DEFAULT_MOVEMENT,
  DebugFlag,
  damageAtDistance,
  encodeServerMessage,
  findSpawnPoints,
  type HitPose,
  HitZone,
  hasButton,
  type InputCommand,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  type MapDef,
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
  stepPlayer,
  TICK_DT,
  TICK_RATE,
  USE_PICKUP_RADIUS,
  WEAPONS,
  WeaponId,
  type WeaponState,
  ZONE_MULTIPLIER,
} from '@office-fps/shared'
import { type Point, type WorldItem, WorldItems } from './items.ts'
import { type HistoryPose, PoseHistory } from './lagcomp.ts'
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
}

/**
 * Inputs simulated per player per tick. Normally 1 arrives per tick; allowing 2 drains bursts
 * after network hiccups, while still capping how fast a (cheating) client can move.
 */
const MAX_COMMANDS_PER_TICK = 2
/** Max buffered commands per player (~0.33 s). Beyond this the oldest are dropped. */
const MAX_QUEUE = 20
const MAX_COMMANDS_PER_MESSAGE = 16
const TICKS_PER_SNAPSHOT = Math.max(1, Math.round(TICK_RATE / SNAPSHOT_RATE))

export const MAX_HEALTH = 100
export const RESPAWN_SECONDS = 3
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
  private readonly map: MapDef
  private readonly physics: PhysicsWorld
  private readonly history = new PoseHistory(
    Math.ceil((1 * TICK_RATE) / TICKS_PER_SNAPSHOT),
    TICKS_PER_SNAPSHOT,
  )
  private readonly spawns: SpawnPicker
  readonly items: WorldItems

  constructor(map: MapDef, physics: PhysicsWorld, random: () => number = Math.random) {
    this.map = map
    this.physics = physics
    this.spawns = new SpawnPicker(findSpawnPoints(map, physics), physics, random)
    this.items = new WorldItems(
      map.pickups ?? [],
      (item) => this.broadcast(itemSpawnMessage(item)),
      (id) => this.broadcast({ type: ServerMsg.ItemRemove, id }),
    )
    this.items.step(0)
  }

  /** Number of possible random spawn spots (for the startup log). */
  get spawnPointCount(): number {
    return this.spawns.count
  }

  /** Adds a player and sends them the world. Returns the id, or null if the server is full. */
  join(rawName: string, client: GameClient): number | null {
    if (this.players.size >= MAX_PLAYERS) return null
    const id = this.nextId
    this.nextId = (this.nextId % 0xffff) + 1
    const name = sanitizeName(rawName) || `Player ${id}`
    const player: ServerPlayer = {
      id,
      name,
      color: this.pickColor(),
      client,
      body: new PlayerBody(this.physics, DEFAULT_MOVEMENT),
      state: this.freshState(0),
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
    }

    send(client, {
      type: ServerMsg.Welcome,
      playerId: id,
      serverTick: this.tick,
      tickRate: TICK_RATE,
      snapshotRate: SNAPSHOT_RATE,
      mapId: this.map.id,
    })
    for (const other of this.players.values()) {
      send(client, {
        type: ServerMsg.PlayerJoined,
        id: other.id,
        color: other.color,
        name: other.name,
      })
    }
    for (const item of this.items.items.values()) send(client, itemSpawnMessage(item))
    this.players.set(id, player)
    this.broadcast({ type: ServerMsg.PlayerJoined, id, color: player.color, name })
    return id
  }

  leave(id: number): void {
    const player = this.players.get(id)
    if (!player) return
    player.body.free()
    this.players.delete(id)
    this.broadcast({ type: ServerMsg.PlayerLeft, id })
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
    for (const player of this.players.values()) {
      const commands = player.queue.splice(0, MAX_COMMANDS_PER_TICK)
      for (const command of commands) {
        const usePressed =
          hasButton(command.buttons, Button.Use) && !hasButton(player.state.prevButtons, Button.Use)
        const events = stepPlayer(player.state, command, TICK_DT, player.body)
        player.ackSeq = command.seq
        if (events.shot) this.fire(player, events.shot, command.viewTick)
        this.handlePickups(player, usePressed)
      }
    }
    this.items.step(this.tick)
    for (const player of this.players.values()) {
      if (!player.state.alive && this.tick >= player.respawnAt) this.respawn(player)
    }
    const t1 = performance.now()
    this.timing.simMs += (t1 - t0 - this.timing.simMs) * 0.05

    if (this.tick % TICK_RATE === 0) this.sendScoreboard()
    if (this.tick % TICKS_PER_SNAPSHOT === 0) {
      this.history.record(this.tick, this.currentPoses())
      this.sendSnapshots()
      this.timing.snapshotMs += (performance.now() - t1 - this.timing.snapshotMs) * 0.05
    }
  }

  // --- Combat -------------------------------------------------------------------------------

  /** Resolves one hitscan shot with everyone rewound to what the shooter saw. */
  private fire(shooter: ServerPlayer, shot: ShotEvent, viewTick: number): void {
    shooter.protectedUntil = 0 // shooting ends spawn protection
    const weapon = WEAPONS[shooter.state.weapon.id]
    const { origin, dir } = shot

    const ray = new RAPIER.Ray(origin, dir)
    const wall = this.physics.world.castRayAndGetNormal(
      ray,
      weapon.range,
      true,
      undefined,
      PLAYER_QUERY_GROUPS,
    )
    const wallDistance = wall ? wall.timeOfImpact : weapon.range

    const rewindTo = Math.max(
      this.tick - MAX_REWIND_SECONDS * TICK_RATE,
      this.history.oldestTick,
      Math.min(viewTick, this.tick),
    )
    let hit: { victim: ServerPlayer; distance: number; zone: HitZone } | null = null
    const debugPoses: (HitPose & { id: number })[] = []
    for (const target of this.players.values()) {
      if (target === shooter || !target.state.alive) continue
      const pose = this.history.poseAt(target.id, rewindTo) ?? toHistoryPose(target.state)
      if (!pose.alive) continue
      debugPoses.push({ id: target.id, ...pose })
      const result = raycastPose(origin, dir, hit?.distance ?? wallDistance, pose)
      if (result) hit = { victim: target, ...result }
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
    })
    for (const p of this.players.values()) if (p !== shooter) p.client.send(shotMsg)

    if (shooter.debugFlags & DebugFlag.LagComp) {
      send(shooter.client, {
        type: ServerMsg.DebugShot,
        origin,
        dir,
        viewTick: rewindTo,
        poses: debugPoses,
      })
    }

    if (hit) this.damage(hit.victim, shooter, hit.zone, hit.distance)
  }

  private damage(victim: ServerPlayer, attacker: ServerPlayer, zone: HitZone, distance: number) {
    if (this.tick < victim.protectedUntil) return
    const weapon = WEAPONS[attacker.state.weapon.id]
    const headshot = zone === HitZone.Head
    const amount = headshot
      ? victim.health
      : Math.round(damageAtDistance(weapon, distance) * ZONE_MULTIPLIER[zone])
    victim.health = Math.max(0, victim.health - amount)
    const killed = victim.health === 0

    send(attacker.client, {
      type: ServerMsg.HitConfirm,
      victimId: victim.id,
      zone,
      damage: amount,
      killed,
    })
    const s = attacker.state.pos
    send(victim.client, {
      type: ServerMsg.Damaged,
      attackerId: attacker.id,
      damage: amount,
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
    victim.respawnAt = this.tick + RESPAWN_SECONDS * TICK_RATE
    victim.deaths++
    if (killer !== victim) killer.kills++
    this.broadcast({
      type: ServerMsg.Kill,
      killerId: killer.id,
      victimId: victim.id,
      weapon: killer.state.weapon.id,
      headshot,
    })
    this.sendScoreboard()
  }

  private respawn(player: ServerPlayer): void {
    const previous = player.state
    player.state = this.freshState(player.id)
    // Keep input edge detection continuous so a held button isn't seen as a new press.
    player.state.prevButtons = previous.prevButtons
    player.health = MAX_HEALTH
    player.protectedUntil = this.tick + SPAWN_PROTECTION_SECONDS * TICK_RATE
  }

  /** Everyone spawns with only the handgun; rifles and snipers are found on the floor. */
  private freshState(excludeId: number): PlayerState {
    return createPlayerState(this.pickSpawn(excludeId), newWeapon(WeaponId.Handgun), null)
  }

  // --- Weapons on the floor ------------------------------------------------------------------

  /**
   * Empty primary slot: walking over a weapon picks it up and draws it. Slot filled: E swaps —
   * your rifle/sniper is thrown on the floor and the new one goes in your hands.
   */
  private handlePickups(player: ServerPlayer, usePressed: boolean): void {
    if (!player.state.alive) return
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
    const handgun = s.weapon.id === WeaponId.Handgun ? s.weapon : s.holstered
    s.weapon = newWeapon(item.weapon)
    s.holstered = handgun ?? newWeapon(WeaponId.Handgun)
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
    if (s.weapon === primary) s.weapon = s.holstered ?? newWeapon(WeaponId.Handgun)
    s.holstered = null
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
    for (const p of this.players.values()) poses.set(p.id, toHistoryPose(p.state))
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

  /** A random spot away from, and out of sight of, every living enemy. */
  private pickSpawn(excludeId = 0) {
    const enemies = [...this.players.values()]
      .filter((p) => p.id !== excludeId && p.state.alive)
      .map((p) => p.state.pos)
    return this.spawns.pick(enemies)
  }

  private pickColor(): number {
    const used = new Set([...this.players.values()].map((p) => p.color))
    for (let i = 0; i < PLAYER_COLORS.length; i++) if (!used.has(i)) return i
    return this.players.size % PLAYER_COLORS.length
  }
}

/** A weapon fresh off the floor: full magazine and reserve, its own spread seed. */
function newWeapon(id: WeaponId): WeaponState {
  return createWeaponState(id, (Math.random() * 0xffffffff) >>> 0)
}

/** The rifle/sniper a player carries (in hand or holstered), or null. */
function primaryOf(s: PlayerState): WeaponState | null {
  if (s.weapon.id !== WeaponId.Handgun) return s.weapon
  return s.holstered && s.holstered.id !== WeaponId.Handgun ? s.holstered : null
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

function toHistoryPose(s: PlayerState): HistoryPose {
  return { x: s.pos.x, y: s.pos.y, z: s.pos.z, yaw: s.yaw, crouch: s.crouchAmount, alive: s.alive }
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
