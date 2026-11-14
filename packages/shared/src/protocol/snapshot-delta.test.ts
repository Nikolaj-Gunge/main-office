import { describe, expect, test } from 'bun:test'
import { WeaponId } from '../sim/weapons.ts'
import {
  type ClientMessage,
  ClientMsg,
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeServerMessage,
  type RemotePlayerState,
  type ServerMessage,
  ServerMsg,
} from './messages.ts'
import { FULL_MASK, fromWire, SNAPSHOT_HISTORY, SnapshotCodec, toWire } from './snapshot-delta.ts'

function remote(id: number, over: Partial<RemotePlayerState> = {}): RemotePlayerState {
  return {
    id,
    x: 10 * id + 0.25,
    y: 1.5,
    z: -3.75,
    yaw: 1,
    pitch: -0.2,
    crouch: 0,
    grounded: true,
    alive: true,
    protected: false,
    weapon: WeaponId.Handgun,
    aiming: false,
    stride: 0.5,
    speed: 4,
    moveDir: 0,
    vy: 0,
    land: 0,
    ads: 0,
    shotAge: 1,
    prone: 0,
    slide: 0,
    mantle: 0,
    ledge: 0,
    ...over,
  }
}

function snapshot(
  tick: number,
  players: RemotePlayerState[],
  extra: { baseTick?: number; removed?: number[] } = {},
): ServerMessage {
  return {
    type: ServerMsg.Snapshot,
    tick,
    ackSeq: 0,
    self: null,
    health: 100,
    respawnIn: 0,
    protected: false,
    players,
    ...extra,
  }
}

/** A server-side and a client-side codec, wired like one connection. */
function link() {
  const server = new SnapshotCodec()
  const client = new SnapshotCodec()
  const sizes: number[] = []
  const send = (msg: ServerMessage) => {
    const bytes = encodeServerMessage(msg, server)
    sizes.push(bytes.byteLength)
    const out = decodeServerMessage(bytes, client)
    if (out.type !== ServerMsg.Snapshot) throw new Error('wrong type')
    return out
  }
  return { server, client, sizes, send }
}

describe('delta snapshots', () => {
  test('the wire form round-trips to what the old full encoding gave', () => {
    const p = remote(3, { gear: 0x1234, windup: 0.5, light: true, aiming: true, ledge: 1.2 })
    const back = fromWire(toWire(p))
    expect(back.id).toBe(3)
    expect(back.x).toBeCloseTo(p.x, 5)
    expect(back.gear).toBe(0x1234)
    expect(back.windup).toBeCloseTo(0.5, 2)
    expect(back.light).toBe(true)
    expect(back.aiming).toBe(true)
    expect(back.ledge).toBeCloseTo(1.2, 2)
    // Quantizing twice changes nothing: a delta compares like with like.
    expect(toWire(back)).toEqual(toWire(p))
  })

  test('only what changed is sent, and the client rebuilds the exact same state', () => {
    const { send, sizes } = link()
    const a = remote(1)
    const b = remote(2)
    const full = send(snapshot(10, [a, b]))
    expect(full.baseTick).toBeUndefined()
    // Client acked 10: tick 12 is relative to it. Only player 1 moved.
    const moved = { ...a, x: a.x + 0.5, stride: 0.6 }
    const delta = send(snapshot(12, [moved, b], { baseTick: 10 }))
    expect(delta.baseTick).toBe(10)
    expect(delta.players.map(toWire)).toEqual([toWire(moved), toWire(b)])
    expect(sizes[1] ?? 0).toBeLessThan((sizes[0] ?? 0) - 40)
    // Standing still costs just id + mask.
    const still = send(snapshot(14, [moved, b], { baseTick: 12 }))
    expect(still.players.map(toWire)).toEqual([toWire(moved), toWire(b)])
    expect((sizes[0] ?? 0) - (sizes[2] ?? 0)).toBeGreaterThan(2 * 30)
  })

  test('a baseline older than the last snapshot still decodes (acks lag behind)', () => {
    const { send } = link()
    send(snapshot(2, [remote(1)]))
    send(snapshot(4, [remote(1, { x: 5 })], { baseTick: 2 }))
    const out = send(snapshot(6, [remote(1, { x: 6 }), remote(9)], { baseTick: 2 }))
    expect(out.players[0]?.x).toBe(6)
    expect(out.players[1]?.id).toBe(9) // new to the client: sent whole
  })

  test('no baseline, or one the server has forgotten: everything goes whole', () => {
    const { server, client } = link()
    const msg = snapshot(2, [remote(1)])
    decodeServerMessage(encodeServerMessage(msg, server), client)
    // Ack of a snapshot that never existed (or fell out of the history): sent as a full one.
    const out = decodeServerMessage(
      encodeServerMessage(snapshot(4, [remote(1)], { baseTick: 3 }), server),
      client,
    )
    if (out.type !== ServerMsg.Snapshot) throw new Error('wrong type')
    expect(out.baseTick).toBeUndefined()
    // Past the history the baseline is gone on both ends.
    for (let i = 0; i < SNAPSHOT_HISTORY + 1; i++) server.record(100 + i, [], [])
    expect(server.knownAt(2)).toBeUndefined()
  })

  test('a delta without the baseline it needs is refused, not misread', () => {
    const server = new SnapshotCodec()
    encodeServerMessage(snapshot(2, [remote(1)]), server)
    const delta = encodeServerMessage(snapshot(4, [remote(1, { x: 3 })], { baseTick: 2 }), server)
    expect(() => decodeServerMessage(delta)).toThrow()
    expect(() => decodeServerMessage(delta, new SnapshotCodec())).toThrow()
  })

  test('removals reach the client, and someone coming back is sent whole', () => {
    const { send, client } = link()
    send(snapshot(2, [remote(1), remote(2)]))
    const gone = send(snapshot(4, [remote(1)], { baseTick: 2, removed: [2] }))
    expect(gone.removed).toEqual([2])
    expect(client.known.has(2)).toBe(false)
    // Back (baseline 4 doesn't have them): whole, at their new place.
    const back = send(snapshot(6, [remote(1), remote(2, { x: 400 })], { baseTick: 4 }))
    expect(back.players[1]?.x).toBe(400)
    expect(client.known.get(2)?.[1]).toBe(400)
  })

  test('someone left out of a snapshot (far, taking turns) is still known for later deltas', () => {
    const { send } = link()
    send(snapshot(2, [remote(1), remote(2)]))
    send(snapshot(4, [remote(1)], { baseTick: 2 }))
    const out = send(snapshot(6, [remote(2, { x: 21 })], { baseTick: 4 }))
    expect(out.players[0]?.x).toBe(21)
  })

  test('every field survives a delta', () => {
    const { send } = link()
    const a = remote(5)
    send(snapshot(2, [a]))
    const b = remote(5, {
      x: -100.5,
      y: 3,
      z: 77,
      yaw: 2,
      pitch: 0.4,
      crouch: 1,
      grounded: false,
      alive: false,
      protected: true,
      weapon: WeaponId.Sniper,
      aiming: true,
      stride: 0.1,
      speed: 7,
      moveDir: 1,
      vy: -3,
      land: 0.5,
      ads: 1,
      shotAge: 0.2,
      prone: 1,
      slide: 0.3,
      mantle: 0.4,
      ledge: 1,
      light: true,
      gear: 0x4321,
      windup: 0.6,
    })
    const out = send(snapshot(4, [b], { baseTick: 2 }))
    expect(out.players.map(toWire)).toEqual([toWire(b)])
  })

  test('full mask covers every group', () => {
    expect(FULL_MASK).toBe(0xffff)
  })

  test('inputs carry the snapshot ack', () => {
    const msg: ClientMessage = {
      type: ClientMsg.Input,
      commands: [{ seq: 1, buttons: 0, yaw: 0, pitch: 0, viewTick: 5 }],
      snapAck: 1234,
    }
    const out = decodeClientMessage(encodeClientMessage(msg))
    expect(out.type === ClientMsg.Input && out.snapAck).toBe(1234)
  })
})
