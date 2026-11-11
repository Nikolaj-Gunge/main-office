import {
  createPlayerState,
  DEFAULT_MOVEMENT,
  encodeServerMessage,
  type InputCommand,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  type MapDef,
  type PhysicsWorld,
  PLAYER_COLORS,
  PlayerBody,
  type PlayerState,
  type RemotePlayerState,
  type ServerMessage,
  ServerMsg,
  SNAPSHOT_RATE,
  stepPlayer,
  TICK_DT,
  TICK_RATE,
} from '@office-fps/shared'

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

/**
 * The authoritative game: players, their simulation and what everyone gets told. Knows nothing
 * about sockets — `connections.ts` adapts WebSockets to it, tests drive it directly.
 */
export class Game {
  tick = 0
  readonly players = new Map<number, ServerPlayer>()
  private nextId = 1
  private readonly map: MapDef
  private readonly physics: PhysicsWorld

  constructor(map: MapDef, physics: PhysicsWorld) {
    this.map = map
    this.physics = physics
  }

  /** Adds a player and sends them the world. Returns the id, or null if the server is full. */
  join(rawName: string, client: GameClient): number | null {
    if (this.players.size >= MAX_PLAYERS) return null
    const id = this.nextId
    this.nextId = (this.nextId % 0xffff) + 1
    const name = sanitizeName(rawName) || `Player ${id}`
    const body = new PlayerBody(this.physics, DEFAULT_MOVEMENT)
    const state = createPlayerState(this.pickSpawn())
    const player: ServerPlayer = {
      id,
      name,
      color: this.pickColor(),
      client,
      body,
      state,
      queue: [],
      lastQueuedSeq: 0,
      ackSeq: 0,
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

  /** Smoothed cost of simulation and of building + sending snapshots (ms), for /healthz. */
  readonly timing = { simMs: 0, snapshotMs: 0 }

  /** Advances the world one fixed tick. */
  step(): void {
    this.tick++
    const t0 = performance.now()
    for (const player of this.players.values()) {
      const commands = player.queue.splice(0, MAX_COMMANDS_PER_TICK)
      for (const command of commands) {
        stepPlayer(player.state, command, TICK_DT, player.body)
        player.ackSeq = command.seq
      }
    }
    const t1 = performance.now()
    this.timing.simMs += (t1 - t0 - this.timing.simMs) * 0.05
    if (this.tick % TICKS_PER_SNAPSHOT === 0) {
      this.sendSnapshots()
      this.timing.snapshotMs += (performance.now() - t1 - this.timing.snapshotMs) * 0.05
    }
  }

  private sendSnapshots(): void {
    const everyone: RemotePlayerState[] = [...this.players.values()].map(toRemote)
    for (const player of this.players.values()) {
      send(player.client, {
        type: ServerMsg.Snapshot,
        tick: this.tick,
        ackSeq: player.ackSeq,
        self: player.state,
        players: everyone.filter((p) => p.id !== player.id),
      })
    }
  }

  private broadcast(msg: ServerMessage): void {
    const bytes = encodeServerMessage(msg)
    for (const player of this.players.values()) player.client.send(bytes)
  }

  /** Spawn point farthest from everyone already playing. */
  private pickSpawn() {
    let best = this.map.spawns[0]
    let bestDistance = -1
    for (const spawn of this.map.spawns) {
      let nearest = Number.POSITIVE_INFINITY
      for (const p of this.players.values()) {
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

function toRemote(p: ServerPlayer): RemotePlayerState {
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
