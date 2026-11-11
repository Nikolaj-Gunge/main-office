import { BinaryReader, BinaryWriter } from './binary.ts'

/** Message ids sent from client to server (0x01–0x7f). */
export const ClientMsg = {
  Hello: 0x01,
  Ping: 0x03,
} as const
export type ClientMsg = (typeof ClientMsg)[keyof typeof ClientMsg]

/** Message ids sent from server to client (0x80–0xff). */
export const ServerMsg = {
  Welcome: 0x81,
  Pong: 0x84,
} as const
export type ServerMsg = (typeof ServerMsg)[keyof typeof ServerMsg]

export type ClientMessage =
  | { type: typeof ClientMsg.Hello; protocolVersion: number; name: string }
  | { type: typeof ClientMsg.Ping; clientTime: number }

export type ServerMessage =
  | { type: typeof ServerMsg.Welcome; playerId: number; serverTick: number; tickRate: number }
  | { type: typeof ServerMsg.Pong; clientTime: number; serverTime: number }

export function encodeClientMessage(msg: ClientMessage): Uint8Array<ArrayBuffer> {
  const w = new BinaryWriter(32).u8(msg.type)
  switch (msg.type) {
    case ClientMsg.Hello:
      w.u16(msg.protocolVersion).str8(msg.name)
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
    case ClientMsg.Ping:
      return { type, clientTime: r.f64() }
    default:
      throw new Error(`Unknown client message type 0x${type.toString(16)}`)
  }
}

export function encodeServerMessage(msg: ServerMessage): Uint8Array<ArrayBuffer> {
  const w = new BinaryWriter(32).u8(msg.type)
  switch (msg.type) {
    case ServerMsg.Welcome:
      w.u16(msg.playerId).u32(msg.serverTick).u8(msg.tickRate)
      break
    case ServerMsg.Pong:
      w.f64(msg.clientTime).f64(msg.serverTime)
      break
  }
  return w.finish()
}

export function decodeServerMessage(data: ArrayBuffer | Uint8Array): ServerMessage {
  const r = new BinaryReader(data)
  const type = r.u8()
  switch (type) {
    case ServerMsg.Welcome:
      return { type, playerId: r.u16(), serverTick: r.u32(), tickRate: r.u8() }
    case ServerMsg.Pong:
      return { type, clientTime: r.f64(), serverTime: r.f64() }
    default:
      throw new Error(`Unknown server message type 0x${type.toString(16)}`)
  }
}
