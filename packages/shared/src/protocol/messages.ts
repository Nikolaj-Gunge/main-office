import type { PlayerInput } from '../sim/input.ts'
import type { PlayerState } from '../sim/player.ts'
import { BinaryReader, BinaryWriter } from './binary.ts'
import { decodePitch, decodeYaw, encodePitch, encodeYaw } from './quantize.ts'

/** Message ids sent from client to server (0x01–0x7f). */
export const ClientMsg = {
  Hello: 0x01,
  Input: 0x02,
  Ping: 0x03,
} as const
export type ClientMsg = (typeof ClientMsg)[keyof typeof ClientMsg]

/** Message ids sent from server to client (0x80–0xff). */
export const ServerMsg = {
  Welcome: 0x81,
  Snapshot: 0x82,
  PlayerJoined: 0x83,
  Pong: 0x84,
  PlayerLeft: 0x85,
} as const
export type ServerMsg = (typeof ServerMsg)[keyof typeof ServerMsg]

/** One tick of input, numbered so the server can acknowledge it. */
export interface InputCommand extends PlayerInput {
  seq: number
}

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
}

export type ClientMessage =
  | { type: typeof ClientMsg.Hello; protocolVersion: number; name: string }
  | { type: typeof ClientMsg.Input; commands: InputCommand[] }
  | { type: typeof ClientMsg.Ping; clientTime: number }

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
      players: RemotePlayerState[]
    }
  | { type: typeof ServerMsg.PlayerJoined; id: number; color: number; name: string }
  | { type: typeof ServerMsg.PlayerLeft; id: number }
  | { type: typeof ServerMsg.Pong; clientTime: number; serverTime: number; tickMs: number }

const FLAG_CROUCHED = 1
const FLAG_GROUNDED = 2

// --- Own player state: f64 everywhere so client replays start from the exact server state ---

function writePlayerState(w: BinaryWriter, s: PlayerState): void {
  w.f64(s.pos.x).f64(s.pos.y).f64(s.pos.z)
  w.f64(s.vel.x).f64(s.vel.y).f64(s.vel.z)
  w.f64(s.yaw).f64(s.pitch)
  w.f64(s.crouchAmount).f64(s.airTime).f64(s.jumpBuffer)
  w.u8((s.crouched ? FLAG_CROUCHED : 0) | (s.grounded ? FLAG_GROUNDED : 0))
  w.u16(s.prevButtons)
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
  }
}

// --- Other players: compact (f32 position, quantized angles) ------------------------------

function writeRemote(w: BinaryWriter, p: RemotePlayerState): void {
  w.u16(p.id).f32(p.x).f32(p.y).f32(p.z)
  w.u16(encodeYaw(p.yaw)).i16(encodePitch(p.pitch))
  w.u8(Math.round(Math.max(0, Math.min(1, p.crouch)) * 255))
  w.u8(p.grounded ? FLAG_GROUNDED : 0)
}

function readRemote(r: BinaryReader): RemotePlayerState {
  const id = r.u16()
  const x = r.f32()
  const y = r.f32()
  const z = r.f32()
  const yaw = decodeYaw(r.u16())
  const pitch = decodePitch(r.i16())
  const crouch = r.u8() / 255
  const grounded = (r.u8() & FLAG_GROUNDED) !== 0
  return { id, x, y, z, yaw, pitch, crouch, grounded }
}

export function encodeClientMessage(msg: ClientMessage): Uint8Array<ArrayBuffer> {
  const w = new BinaryWriter(32).u8(msg.type)
  switch (msg.type) {
    case ClientMsg.Hello:
      w.u16(msg.protocolVersion).str8(msg.name)
      break
    case ClientMsg.Input:
      w.u8(msg.commands.length)
      for (const c of msg.commands) {
        w.u32(c.seq).u16(c.buttons).u16(encodeYaw(c.yaw)).i16(encodePitch(c.pitch))
      }
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
      return { type, protocolVersion: r.u16(), name: r.str8() }
    case ClientMsg.Input: {
      const count = r.u8()
      const commands: InputCommand[] = []
      for (let i = 0; i < count; i++) {
        commands.push({
          seq: r.u32(),
          buttons: r.u16(),
          yaw: decodeYaw(r.u16()),
          pitch: decodePitch(r.i16()),
        })
      }
      return { type, commands }
    }
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
      const count = r.u8()
      const players: RemotePlayerState[] = []
      for (let i = 0; i < count; i++) players.push(readRemote(r))
      return { type, tick, ackSeq, self, players }
    }
    case ServerMsg.PlayerJoined:
      return { type, id: r.u16(), color: r.u8(), name: r.str8() }
    case ServerMsg.PlayerLeft:
      return { type, id: r.u16() }
    case ServerMsg.Pong:
      return { type, clientTime: r.f64(), serverTime: r.f64(), tickMs: r.f32() }
    default:
      throw new Error(`Unknown server message type 0x${type.toString(16)}`)
  }
}
