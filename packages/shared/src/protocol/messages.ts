import type { HitPose, HitZone } from '../sim/hitboxes.ts'
import type { PlayerInput } from '../sim/input.ts'
import type { PlayerState } from '../sim/player.ts'
import type { WeaponState } from '../sim/weapon-sim.ts'
import type { PrimaryWeapon, WeaponId } from '../sim/weapons.ts'
import { BinaryReader, BinaryWriter } from './binary.ts'
import { decodePitch, decodeYaw, encodePitch, encodeYaw } from './quantize.ts'

/** Message ids sent from client to server (0x01–0x7f). */
export const ClientMsg = {
  Hello: 0x01,
  Input: 0x02,
  Ping: 0x03,
  SetDebug: 0x04,
  SetLoadout: 0x05,
} as const
export type ClientMsg = (typeof ClientMsg)[keyof typeof ClientMsg]

/** Message ids sent from server to client (0x80–0xff). */
export const ServerMsg = {
  Welcome: 0x81,
  Snapshot: 0x82,
  PlayerJoined: 0x83,
  Pong: 0x84,
  PlayerLeft: 0x85,
  ShotFired: 0x86,
  HitConfirm: 0x87,
  Damaged: 0x88,
  Kill: 0x89,
  DebugShot: 0x8a,
} as const
export type ServerMsg = (typeof ServerMsg)[keyof typeof ServerMsg]

/** One tick of input, numbered so the server can acknowledge it. */
export interface InputCommand extends PlayerInput {
  seq: number
  /**
   * Fractional server tick the client was *seeing* other players at when this input was made.
   * The server rewinds everyone to this moment to check hits (lag compensation).
   */
  viewTick: number
}

/** Debug flags a client can request (SetDebug). */
export const DebugFlag = {
  /** Send the server's rewound hitbox poses back after every shot. */
  LagComp: 1,
} as const

/** What other players need to draw someone: position and pose, no physics internals. */
export interface RemotePlayerState {
  id: number
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  /** 0 = standing, 1 = fully crouched. */
  crouch: number
  grounded: boolean
  alive: boolean
  /** Just spawned: can't be damaged yet. */
  protected: boolean
  weapon: WeaponId
  /** Aiming down sights (with a sniper: scoped — others see the lens glint). */
  aiming: boolean
}

/** What a shot hit, for drawing tracers and impacts on other clients. */
export const ShotResult = {
  Nothing: 0,
  World: 1,
  Player: 2,
} as const
export type ShotResult = (typeof ShotResult)[keyof typeof ShotResult]

export type ClientMessage =
  | {
      type: typeof ClientMsg.Hello
      protocolVersion: number
      name: string
      /** Primary weapon to spawn with. */
      primary: PrimaryWeapon
    }
  | { type: typeof ClientMsg.Input; commands: InputCommand[] }
  | { type: typeof ClientMsg.Ping; clientTime: number }
  | { type: typeof ClientMsg.SetDebug; flags: number }
  /** Primary weapon for your next spawn. */
  | { type: typeof ClientMsg.SetLoadout; primary: PrimaryWeapon }

export type ServerMessage =
  | {
      type: typeof ServerMsg.Welcome
      playerId: number
      serverTick: number
      tickRate: number
      snapshotRate: number
    }
  | {
      type: typeof ServerMsg.Snapshot
      tick: number
      /** Last input seq the server has applied for the recipient. */
      ackSeq: number
      /** Recipient's own authoritative state (full precision, for reconciliation). */
      self: PlayerState | null
      /** Recipient's health (0–100). */
      health: number
      /** Seconds until respawn while dead, else 0. */
      respawnIn: number
      /** Recipient has spawn protection. */
      protected: boolean
      players: RemotePlayerState[]
    }
  | { type: typeof ServerMsg.PlayerJoined; id: number; color: number; name: string }
  | { type: typeof ServerMsg.PlayerLeft; id: number }
  | { type: typeof ServerMsg.Pong; clientTime: number; serverTime: number; tickMs: number }
  | {
      /** Someone else fired: draw their tracer to `end` and an impact if it hit something. */
      type: typeof ServerMsg.ShotFired
      shooterId: number
      weapon: WeaponId
      end: { x: number; y: number; z: number }
      normal: { x: number; y: number; z: number }
      result: ShotResult
    }
  | {
      /** Your shot hit someone (server-confirmed). */
      type: typeof ServerMsg.HitConfirm
      victimId: number
      zone: HitZone
      damage: number
      killed: boolean
    }
  | {
      /** You were hit. `from` is the attacker's position, for the direction indicator. */
      type: typeof ServerMsg.Damaged
      attackerId: number
      damage: number
      health: number
      from: { x: number; y: number; z: number }
    }
  | {
      type: typeof ServerMsg.Kill
      killerId: number
      victimId: number
      weapon: WeaponId
      headshot: boolean
    }
  | {
      /** Debug: where the server placed everyone when checking your shot. */
      type: typeof ServerMsg.DebugShot
      origin: { x: number; y: number; z: number }
      dir: { x: number; y: number; z: number }
      viewTick: number
      poses: (HitPose & { id: number })[]
    }

const FLAG_CROUCHED = 1
const FLAG_GROUNDED = 2
const FLAG_DEAD = 4
const FLAG_PROTECTED = 8
const FLAG_AIMING = 16

// --- Own player state: f64 everywhere so client replays start from the exact server state ---

function writePlayerState(w: BinaryWriter, s: PlayerState): void {
  w.f64(s.pos.x).f64(s.pos.y).f64(s.pos.z)
  w.f64(s.vel.x).f64(s.vel.y).f64(s.vel.z)
  w.f64(s.yaw).f64(s.pitch)
  w.f64(s.crouchAmount).f64(s.airTime).f64(s.jumpBuffer)
  w.u8(
    (s.crouched ? FLAG_CROUCHED : 0) | (s.grounded ? FLAG_GROUNDED : 0) | (s.alive ? 0 : FLAG_DEAD),
  )
  w.u16(s.prevButtons)
  writeWeapon(w, s.weapon)
  writeWeapon(w, s.holstered)
}

function writeWeapon(w: BinaryWriter, wp: WeaponState): void {
  w.u8(wp.id).u8(wp.ammo).u16(wp.reserve)
  w.f64(wp.cooldown).f64(wp.reload).f64(wp.draw).f64(wp.fireBuffer).f64(wp.sprintRecover)
  w.u32(wp.shotIndex).u32(wp.spreadSeed)
  w.f64(wp.aimTime)
    .f64(wp.swayTime)
    .f64(wp.breath)
    .u8(wp.steady ? 1 : 0)
}

function readWeapon(r: BinaryReader): WeaponState {
  return {
    id: r.u8() as WeaponId,
    ammo: r.u8(),
    reserve: r.u16(),
    cooldown: r.f64(),
    reload: r.f64(),
    draw: r.f64(),
    fireBuffer: r.f64(),
    sprintRecover: r.f64(),
    shotIndex: r.u32(),
    spreadSeed: r.u32(),
    aimTime: r.f64(),
    swayTime: r.f64(),
    breath: r.f64(),
    steady: r.u8() === 1,
  }
}

function readPlayerState(r: BinaryReader): PlayerState {
  const pos = { x: r.f64(), y: r.f64(), z: r.f64() }
  const vel = { x: r.f64(), y: r.f64(), z: r.f64() }
  const yaw = r.f64()
  const pitch = r.f64()
  const crouchAmount = r.f64()
  const airTime = r.f64()
  const jumpBuffer = r.f64()
  const flags = r.u8()
  const prevButtons = r.u16()
  const weapon = readWeapon(r)
  const holstered = readWeapon(r)
  return {
    pos,
    vel,
    yaw,
    pitch,
    crouchAmount,
    airTime,
    jumpBuffer,
    crouched: (flags & FLAG_CROUCHED) !== 0,
    grounded: (flags & FLAG_GROUNDED) !== 0,
    prevButtons,
    alive: (flags & FLAG_DEAD) === 0,
    weapon,
    holstered,
  }
}

// --- Other players: compact (f32 position, quantized angles) ------------------------------

function writeRemote(w: BinaryWriter, p: RemotePlayerState): void {
  w.u16(p.id).f32(p.x).f32(p.y).f32(p.z)
  w.u16(encodeYaw(p.yaw)).i16(encodePitch(p.pitch))
  w.u8(Math.round(Math.max(0, Math.min(1, p.crouch)) * 255))
  w.u8(
    (p.grounded ? FLAG_GROUNDED : 0) |
      (p.alive ? 0 : FLAG_DEAD) |
      (p.protected ? FLAG_PROTECTED : 0) |
      (p.aiming ? FLAG_AIMING : 0),
  )
  w.u8(p.weapon)
}

function readRemote(r: BinaryReader): RemotePlayerState {
  const id = r.u16()
  const x = r.f32()
  const y = r.f32()
  const z = r.f32()
  const yaw = decodeYaw(r.u16())
  const pitch = decodePitch(r.i16())
  const crouch = r.u8() / 255
  const flags = r.u8()
  const weapon = r.u8() as WeaponId
  return {
    id,
    x,
    y,
    z,
    yaw,
    pitch,
    crouch,
    grounded: (flags & FLAG_GROUNDED) !== 0,
    alive: (flags & FLAG_DEAD) === 0,
    protected: (flags & FLAG_PROTECTED) !== 0,
    aiming: (flags & FLAG_AIMING) !== 0,
    weapon,
  }
}

// --- Small helpers ---------------------------------------------------------------------------

function writeVec(w: BinaryWriter, v: { x: number; y: number; z: number }): void {
  w.f32(v.x).f32(v.y).f32(v.z)
}

function readVec(r: BinaryReader): { x: number; y: number; z: number } {
  return { x: r.f32(), y: r.f32(), z: r.f32() }
}

/** Unit vector → 3 × i8 (≈1° precision, plenty for impact orientation). */
function writeNormal(w: BinaryWriter, n: { x: number; y: number; z: number }): void {
  const q = (v: number) => (Math.round(Math.max(-1, Math.min(1, v)) * 127) + 256) % 256
  w.u8(q(n.x)).u8(q(n.y)).u8(q(n.z))
}

function readNormal(r: BinaryReader): { x: number; y: number; z: number } {
  const d = (b: number) => (b > 127 ? b - 256 : b) / 127
  return { x: d(r.u8()), y: d(r.u8()), z: d(r.u8()) }
}

/** Fractional tick → u32 whole tick + u8 fraction. */
function writeTick(w: BinaryWriter, tick: number): void {
  const whole = Math.max(0, Math.floor(tick))
  w.u32(whole).u8(Math.min(255, Math.round((tick - whole) * 255)))
}

function readTick(r: BinaryReader): number {
  return r.u32() + r.u8() / 255
}

export function encodeClientMessage(msg: ClientMessage): Uint8Array<ArrayBuffer> {
  const w = new BinaryWriter(32).u8(msg.type)
  switch (msg.type) {
    case ClientMsg.Hello:
      w.u16(msg.protocolVersion).str8(msg.name).u8(msg.primary)
      break
    case ClientMsg.SetLoadout:
      w.u8(msg.primary)
      break
    case ClientMsg.Input:
      w.u8(msg.commands.length)
      for (const c of msg.commands) {
        w.u32(c.seq).u16(c.buttons).u16(encodeYaw(c.yaw)).i16(encodePitch(c.pitch))
        writeTick(w, c.viewTick)
      }
      break
    case ClientMsg.SetDebug:
      w.u8(msg.flags)
      break
    case ClientMsg.Ping:
      w.f64(msg.clientTime)
      break
  }
  return w.finish()
}

export function decodeClientMessage(data: ArrayBuffer | Uint8Array): ClientMessage {
  const r = new BinaryReader(data)
  const type = r.u8()
  switch (type) {
    case ClientMsg.Hello:
      return {
        type,
        protocolVersion: r.u16(),
        name: r.str8(),
        primary: r.u8() as PrimaryWeapon,
      }
    case ClientMsg.SetLoadout:
      return { type, primary: r.u8() as PrimaryWeapon }
    case ClientMsg.Input: {
      const count = r.u8()
      const commands: InputCommand[] = []
      for (let i = 0; i < count; i++) {
        commands.push({
          seq: r.u32(),
          buttons: r.u16(),
          yaw: decodeYaw(r.u16()),
          pitch: decodePitch(r.i16()),
          viewTick: readTick(r),
        })
      }
      return { type, commands }
    }
    case ClientMsg.SetDebug:
      return { type, flags: r.u8() }
    case ClientMsg.Ping:
      return { type, clientTime: r.f64() }
    default:
      throw new Error(`Unknown client message type 0x${type.toString(16)}`)
  }
}

export function encodeServerMessage(msg: ServerMessage): Uint8Array<ArrayBuffer> {
  const w = new BinaryWriter(64).u8(msg.type)
  switch (msg.type) {
    case ServerMsg.Welcome:
      w.u16(msg.playerId).u32(msg.serverTick).u8(msg.tickRate).u8(msg.snapshotRate)
      break
    case ServerMsg.Snapshot:
      w.u32(msg.tick).u32(msg.ackSeq)
      w.u8(msg.self ? 1 : 0)
      if (msg.self) writePlayerState(w, msg.self)
      w.u8(Math.max(0, Math.min(255, Math.ceil(msg.health))))
      w.f32(msg.respawnIn)
      w.u8(msg.protected ? 1 : 0)
      w.u8(msg.players.length)
      for (const p of msg.players) writeRemote(w, p)
      break
    case ServerMsg.PlayerJoined:
      w.u16(msg.id).u8(msg.color).str8(msg.name)
      break
    case ServerMsg.PlayerLeft:
      w.u16(msg.id)
      break
    case ServerMsg.Pong:
      w.f64(msg.clientTime).f64(msg.serverTime).f32(msg.tickMs)
      break
    case ServerMsg.ShotFired:
      w.u16(msg.shooterId).u8(msg.weapon)
      writeVec(w, msg.end)
      writeNormal(w, msg.normal)
      w.u8(msg.result)
      break
    case ServerMsg.HitConfirm:
      w.u16(msg.victimId)
        .u8(msg.zone)
        .u8(Math.min(255, Math.round(msg.damage)))
      w.u8(msg.killed ? 1 : 0)
      break
    case ServerMsg.Damaged:
      w.u16(msg.attackerId).u8(Math.min(255, Math.round(msg.damage)))
      w.u8(Math.max(0, Math.ceil(msg.health)))
      writeVec(w, msg.from)
      break
    case ServerMsg.Kill:
      w.u16(msg.killerId)
        .u16(msg.victimId)
        .u8(msg.weapon)
        .u8(msg.headshot ? 1 : 0)
      break
    case ServerMsg.DebugShot:
      writeVec(w, msg.origin)
      writeVec(w, msg.dir)
      writeTick(w, msg.viewTick)
      w.u8(msg.poses.length)
      for (const p of msg.poses) {
        w.u16(p.id).f32(p.x).f32(p.y).f32(p.z).u16(encodeYaw(p.yaw))
        w.u8(Math.round(p.crouch * 255))
      }
      break
  }
  return w.finish()
}

export function decodeServerMessage(data: ArrayBuffer | Uint8Array): ServerMessage {
  const r = new BinaryReader(data)
  const type = r.u8()
  switch (type) {
    case ServerMsg.Welcome:
      return {
        type,
        playerId: r.u16(),
        serverTick: r.u32(),
        tickRate: r.u8(),
        snapshotRate: r.u8(),
      }
    case ServerMsg.Snapshot: {
      const tick = r.u32()
      const ackSeq = r.u32()
      const self = r.u8() ? readPlayerState(r) : null
      const health = r.u8()
      const respawnIn = r.f32()
      const isProtected = r.u8() === 1
      const count = r.u8()
      const players: RemotePlayerState[] = []
      for (let i = 0; i < count; i++) players.push(readRemote(r))
      return { type, tick, ackSeq, self, health, respawnIn, protected: isProtected, players }
    }
    case ServerMsg.PlayerJoined:
      return { type, id: r.u16(), color: r.u8(), name: r.str8() }
    case ServerMsg.PlayerLeft:
      return { type, id: r.u16() }
    case ServerMsg.Pong:
      return { type, clientTime: r.f64(), serverTime: r.f64(), tickMs: r.f32() }
    case ServerMsg.ShotFired:
      return {
        type,
        shooterId: r.u16(),
        weapon: r.u8() as WeaponId,
        end: readVec(r),
        normal: readNormal(r),
        result: r.u8() as ShotResult,
      }
    case ServerMsg.HitConfirm:
      return {
        type,
        victimId: r.u16(),
        zone: r.u8() as HitZone,
        damage: r.u8(),
        killed: r.u8() === 1,
      }
    case ServerMsg.Damaged:
      return { type, attackerId: r.u16(), damage: r.u8(), health: r.u8(), from: readVec(r) }
    case ServerMsg.Kill:
      return {
        type,
        killerId: r.u16(),
        victimId: r.u16(),
        weapon: r.u8() as WeaponId,
        headshot: r.u8() === 1,
      }
    case ServerMsg.DebugShot: {
      const origin = readVec(r)
      const dir = readVec(r)
      const viewTick = readTick(r)
      const count = r.u8()
      const poses: (HitPose & { id: number })[] = []
      for (let i = 0; i < count; i++) {
        poses.push({
          id: r.u16(),
          x: r.f32(),
          y: r.f32(),
          z: r.f32(),
          yaw: decodeYaw(r.u16()),
          crouch: r.u8() / 255,
        })
      }
      return { type, origin, dir, viewTick, poses }
    }
    default:
      throw new Error(`Unknown server message type 0x${type.toString(16)}`)
  }
}
