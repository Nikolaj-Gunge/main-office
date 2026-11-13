import { beforeAll, describe, expect, test } from 'bun:test'
import {
  Button,
  createPhysicsWorld,
  decodeServerMessage,
  type InputCommand,
  initPhysics,
  loadMap,
  MAX_PLAYERS,
  packAppearance,
  type ServerMessage,
  ServerMsg,
  SKIN_TONES,
  SNAPSHOT_RATE,
  TICK_RATE,
  unpackAppearance,
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

  test('join carries the chosen look to everyone (sanitised); without one, a random look', () => {
    const game = makeGame()
    const a = fakeClient()
    const b = fakeClient()
    const look = { body: 1, skin: 6, hair: 7, hairColor: 4, eyes: 3, beard: 0 }
    const idA = game.join('Anna', a, undefined, undefined, packAppearance(look)) ?? 0
    // Junk in every field (15s): clamped to the last valid value, not passed on as is.
    const idB = game.join('Bo', b, undefined, undefined, 0xffffff) ?? 0
    const idC = game.join('Cy', fakeClient()) ?? 0
    const joinedA = b.inbox.find((m) => m.type === ServerMsg.PlayerJoined && m.id === idA)
    expect(joinedA).toMatchObject({ appearance: packAppearance(look) })
    const joinedB = a.last(ServerMsg.PlayerJoined)
    expect(joinedB?.id).toBe(idC)
    const bo = b.inbox.find((m) => m.type === ServerMsg.PlayerJoined && m.id === idB)
    if (bo?.type !== ServerMsg.PlayerJoined || bo.appearance === undefined)
      throw new Error('no look')
    expect(bo.appearance).toBe(packAppearance(unpackAppearance(0xffffff)))
    expect(unpackAppearance(bo.appearance).skin).toBe(SKIN_TONES.length - 1)
    // Nobody is left without a look (Cy sent none).
    expect(joinedB?.appearance).toBeNumber()
    expect(game.players.get(idC)?.appearance).toBe(joinedB?.appearance)
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
    // Spawns are random now: start from a known open spot so walking forward is never blocked.
    const p = game.players.get(id)
    if (p) p.state.pos = { x: 0, y: 0, z: 45 }
    const startZ = 45

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

  test("others see a player's aim ease in and out, which way they move, and their shots", () => {
    const game = makeGame()
    const a = fakeClient()
    game.join('Anna', a)
    const id = game.join('Bo', fakeClient()) ?? 0
    const p = game.players.get(id)
    if (p) p.state.pos = { x: 0, y: 0, z: 45 }
    let seq = 0
    const run = (buttons: number, ticks: number) => {
      for (let i = 0; i < ticks; i++) {
        game.handleInput(id, [{ seq: ++seq, buttons, yaw: 0, pitch: 0, viewTick: 0 }])
        game.step()
      }
      return a.last(ServerMsg.Snapshot)?.players.find((o) => o.id === id)
    }
    expect(run(Button.Aim, TICK_RATE)?.ads).toBe(1)
    // The weapon drops its aim at once; the body others see lowers it over ~0.15 s.
    const lowering = run(0, 4)?.ads ?? 0
    expect(lowering).toBeGreaterThan(0.3)
    expect(lowering).toBeLessThan(1)
    expect(run(0, 10)?.ads).toBe(0)
    // Strafing right, then walking forward.
    expect(Math.sin(run(Button.Right, 20)?.moveDir ?? 0)).toBeCloseTo(1, 1)
    expect(Math.cos(run(Button.Forward, 30)?.moveDir ?? 0)).toBeCloseTo(1, 1)
    // A shot restarts the shot clock (recoil, swings and claw swipes play from it).
    expect(run(0, TICK_RATE)?.shotAge).toBe(1)
    expect(run(Button.Fire, 2)?.shotAge).toBeLessThan(0.1)
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
    // Catches up 2 per tick while there's a backlog, then settles to 1 per tick.
    for (let i = 0; i < 5; i++) game.step()
    expect(game.players.get(id)?.ackSeq).toBe(12)
    for (let i = 0; i < 4; i++) game.step()
    expect(game.players.get(id)?.ackSeq).toBe(16)
  })

  test('a normal batch of inputs is spread over ticks, one per tick', () => {
    const game = makeGame()
    const id = game.join('Anna', fakeClient()) ?? 0
    game.handleInput(id, [forward(1), forward(2)])
    game.step()
    expect(game.players.get(id)?.ackSeq).toBe(1)
    game.step()
    expect(game.players.get(id)?.ackSeq).toBe(2)
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
