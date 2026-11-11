import { beforeAll, describe, expect, test } from 'bun:test'
import {
  Button,
  createPhysicsWorld,
  decodeServerMessage,
  type InputCommand,
  initPhysics,
  loadMap,
  MAX_PLAYERS,
  type ServerMessage,
  ServerMsg,
  SNAPSHOT_RATE,
  TICK_RATE,
} from '@office-fps/shared'
import { Game, sanitizeName } from './game.ts'

beforeAll(async () => {
  await initPhysics()
})

function makeGame() {
  const map = loadMap('gym')
  return new Game(map, createPhysicsWorld(map))
}

/** A fake client that records decoded messages. */
function fakeClient() {
  const inbox: ServerMessage[] = []
  return {
    inbox,
    send: (bytes: Uint8Array) => inbox.push(decodeServerMessage(bytes)),
    last<T extends ServerMessage['type']>(type: T) {
      return inbox.filter((m) => m.type === type).at(-1) as
        | Extract<ServerMessage, { type: T }>
        | undefined
    },
  }
}

const forward = (seq: number): InputCommand => ({
  seq,
  buttons: Button.Forward,
  yaw: 0,
  pitch: 0,
  viewTick: 0,
})

describe('Game', () => {
  test('join sends welcome and the roster; others hear about it', () => {
    const game = makeGame()
    const a = fakeClient()
    const b = fakeClient()
    const idA = game.join('Anna', a)
    const idB = game.join('Bo', b)

    expect(a.inbox[0]).toMatchObject({
      type: ServerMsg.Welcome,
      playerId: idA,
      tickRate: TICK_RATE,
    })
    expect(
      b.inbox.filter((m) => m.type === ServerMsg.PlayerJoined).map((m) => 'name' in m && m.name),
    ).toEqual(['Anna', 'Bo'])
    expect(a.last(ServerMsg.PlayerJoined)).toMatchObject({ id: idB, name: 'Bo' })
  })

  test('spawns players apart and gives them different colors', () => {
    const game = makeGame()
    const ids = [1, 2, 3].map((i) => game.join(`P${i}`, fakeClient()) ?? 0)
    const [p1, p2] = ids.map((id) => game.players.get(id))
    expect(p1?.color).not.toBe(p2?.color)
    const a = p1?.state.pos
    const b = p2?.state.pos
    expect(Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.z ?? 0) - (b?.z ?? 0))).toBeGreaterThan(5)
  })

  test('applies inputs, acks them and snapshots at the snapshot rate', () => {
    const game = makeGame()
    const a = fakeClient()
    const id = game.join('Anna', a) ?? 0
    const startZ = game.players.get(id)?.state.pos.z ?? 0

    for (let seq = 1; seq <= TICK_RATE; seq++) {
      game.handleInput(id, [forward(seq)])
      game.step()
    }
    const snapshots = a.inbox.filter((m) => m.type === ServerMsg.Snapshot)
    expect(snapshots.length).toBe(SNAPSHOT_RATE)
    const snap = a.last(ServerMsg.Snapshot)
    expect(snap?.ackSeq).toBe(TICK_RATE)
    expect(snap?.self?.pos.z).toBeLessThan(startZ - 3)
  })

  test('snapshots list everyone except the recipient', () => {
    const game = makeGame()
    const a = fakeClient()
    const idA = game.join('Anna', a) ?? 0
    const idB = game.join('Bo', fakeClient()) ?? 0
    game.step()
    game.step()
    const snap = a.last(ServerMsg.Snapshot)
    expect(snap?.players.map((p) => p.id)).toEqual([idB])
    expect(snap?.self).not.toBeNull()
    expect(idA).not.toBe(idB)
  })

  test('ignores duplicate inputs and caps how many run per tick (no speed hacks)', () => {
    const game = makeGame()
    const id = game.join('Anna', fakeClient()) ?? 0
    // A burst of 16 commands in one message, sent twice.
    const burst = Array.from({ length: 16 }, (_, i) => forward(i + 1))
    game.handleInput(id, burst)
    game.handleInput(id, burst)
    game.step()
    expect(game.players.get(id)?.ackSeq).toBe(2)
    for (let i = 0; i < 7; i++) game.step()
    expect(game.players.get(id)?.ackSeq).toBe(16)
  })

  test('leave tells everyone and frees the slot', () => {
    const game = makeGame()
    const a = fakeClient()
    game.join('Anna', a)
    const idB = game.join('Bo', fakeClient()) ?? 0
    game.leave(idB)
    expect(a.last(ServerMsg.PlayerLeft)).toEqual({ type: ServerMsg.PlayerLeft, id: idB })
    expect(game.players.size).toBe(1)
  })

  test('rejects players beyond the cap', () => {
    const game = makeGame()
    for (let i = 0; i < MAX_PLAYERS; i++) expect(game.join(`P${i}`, fakeClient())).not.toBeNull()
    expect(game.join('one too many', fakeClient())).toBeNull()
  })
})

describe('sanitizeName', () => {
  test('strips control characters, collapses spaces and caps length', () => {
    expect(sanitizeName('  Anna\u0000\n  B  ')).toBe('Anna B')
    expect(sanitizeName('x'.repeat(40))).toHaveLength(16)
    expect(sanitizeName('Ølse 🔫')).toBe('Ølse 🔫')
  })
})
