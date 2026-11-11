import {
  Button,
  createPlayerState,
  createWeaponState,
  DEFAULT_MOVEMENT,
  DebugFlag,
  damageAtDistance,
  encodeServerMessage,
  type HitPose,
  HitZone,
  hasButton,
  type InputCommand,
  isPrimary,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  type MapDef,
  type PhysicsWorld,
  PLAYER_COLORS,
  PLAYER_QUERY_GROUPS,
  PlayerBody,
  type PlayerState,
  type PrimaryWeapon,
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
  WEAPONS,
  WeaponId,
  ZONE_MULTIPLIER,
} from '@office-fps/shared'
import { type HistoryPose, PoseHistory } from './lagcomp.ts'

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
  /** Primary weapon for the next spawn (the handgun is always the secondary). */
  loadout: PrimaryWeapon
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

  constructor(map: MapDef, physics: PhysicsWorld) {
    this.map = map
    this.physics = physics
  }

  /** Adds a player and sends them the world. Returns the id, or null if the server is full. */
  join(
    rawName: string,
    client: GameClient,
    primary: PrimaryWeapon = WeaponId.Rifle,
  ): number | null {
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
      state: this.freshState(0, isPrimary(primary) ? primary : WeaponId.Rifle),
      queue: [],
      lastQueuedSeq: 0,
      ackSeq: 0,
      health: MAX_HEALTH,
      respawnAt: 0,
      protectedUntil: this.tick + SPAWN_PROTECTION_SECONDS * TICK_RATE,
      kills: 0,
      deaths: 0,
      debugFlags: 0,
      loadout: isPrimary(primary) ? primary : WeaponId.Rifle,
    }

    send(client, {
      type: ServerMsg.Welcome,
      playerId: id,
      serverTick: this.tick,
      tickRate: TICK_RATE,
      snapshotRate: SNAPSHOT_RATE,
    })
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

  /** Changes the primary weapon for the player's next spawn. */
  setLoadout(id: number, primary: number): void {
    const player = this.players.get(id)
    if (player && isPrimary(primary)) player.loadout = primary
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
        const events = stepPlayer(player.state, command, TICK_DT, player.body)
        player.ackSeq = command.seq
        if (events.shot) this.fire(player, events.shot, command.viewTick)
      }
    }
    for (const player of this.players.values()) {
      if (!player.state.alive && this.tick >= player.respawnAt) this.respawn(player)
    }
    const t1 = performance.now()
    this.timing.simMs += (t1 - t0 - this.timing.simMs) * 0.05

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
  }

  private respawn(player: ServerPlayer): void {
    const previous = player.state
    player.state = this.freshState(player.id, player.loadout)
    // Keep input edge detection continuous so a held button isn't seen as a new press.
    player.state.prevButtons = previous.prevButtons
    player.health = MAX_HEALTH
    player.protectedUntil = this.tick + SPAWN_PROTECTION_SECONDS * TICK_RATE
  }

  private freshState(excludeId: number, primary: PrimaryWeapon): PlayerState {
    const seed = () => (Math.random() * 0xffffffff) >>> 0
    return createPlayerState(
      this.pickSpawn(excludeId),
      createWeaponState(primary, seed()),
      createWeaponState(WeaponId.Handgun, seed()),
    )
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

  private broadcast(msg: ServerMessage): void {
    const bytes = encodeServerMessage(msg)
    for (const player of this.players.values()) player.client.send(bytes)
  }

  /** Spawn point farthest from every living player (other than `excludeId`). */
  private pickSpawn(excludeId = 0) {
    let best = this.map.spawns[0]
    let bestDistance = -1
    for (const spawn of this.map.spawns) {
      let nearest = Number.POSITIVE_INFINITY
      for (const p of this.players.values()) {
        if (p.id === excludeId || !p.state.alive) continue
        const d = Math.hypot(p.state.pos.x - spawn.pos[0], p.state.pos.z - spawn.pos[2])
        nearest = Math.min(nearest, d)
      }
      if (nearest > bestDistance) {
        bestDistance = nearest
        best = spawn
      }
    }
    return best
  }

  private pickColor(): number {
    const used = new Set([...this.players.values()].map((p) => p.color))
    for (let i = 0; i < PLAYER_COLORS.length; i++) if (!used.has(i)) return i
    return this.players.size % PLAYER_COLORS.length
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
