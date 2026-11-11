import { describe, expect, test } from 'bun:test'
import {
  type ClientMessage,
  ClientMsg,
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeServerMessage,
  type ServerMessage,
  ServerMsg,
} from './messages.ts'

describe('client messages', () => {
  const cases: ClientMessage[] = [
    { type: ClientMsg.Hello, protocolVersion: 1, name: 'Nikolaj' },
    { type: ClientMsg.Ping, clientTime: 12345.678 },
  ]
  for (const msg of cases) {
    test(`round-trips 0x${msg.type.toString(16)}`, () => {
      expect(decodeClientMessage(encodeClientMessage(msg))).toEqual(msg)
    })
  }

  test('rejects unknown ids', () => {
    expect(() => decodeClientMessage(new Uint8Array([0x7f]))).toThrow()
  })
})

describe('server messages', () => {
  const cases: ServerMessage[] = [
    { type: ServerMsg.Welcome, playerId: 7, serverTick: 99999, tickRate: 60 },
    { type: ServerMsg.Pong, clientTime: 1.25, serverTime: 1700000000000.5 },
  ]
  for (const msg of cases) {
    test(`round-trips 0x${msg.type.toString(16)}`, () => {
      expect(decodeServerMessage(encodeServerMessage(msg))).toEqual(msg)
    })
  }
})
