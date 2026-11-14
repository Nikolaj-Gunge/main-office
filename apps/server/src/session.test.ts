import { beforeAll, describe, expect, test } from 'bun:test'
import {
  Button,
  CLOSE_RESTING,
  type ClientMessage,
  ClientMsg,
  createPhysicsWorld,
  encodeClientMessage,
  INPUT_BATCH_TICKS,
  type InputCommand,
  initPhysics,
  loadMap,
  PROTOCOL_VERSION,
} from '@office-fps/shared'
import { RequestBudget } from './budget.ts'
import { Game } from './game.ts'
import { createSession } from './session.ts'

beforeAll(async () => {
  await initPhysics()
})

function setup(budget?: RequestBudget) {
  const map = loadMap('gym')
  const game = new Game(map, createPhysicsWorld(map))
  const closed: { code: number; reason: string }[] = []
  const session = createSession(
    game,
    { send: () => {}, close: (code, reason) => closed.push({ code, reason }) },
    () => 0,
    { budget },
  )
  const send = (msg: ClientMessage) => session.message(encodeClientMessage(msg))
  // Joining reads the character's save first, so it completes a moment later.
  const hello = async () => {
    send({ type: ClientMsg.Hello, protocolVersion: PROTOCOL_VERSION, name: 'Ann' })
    await Bun.sleep(5)
  }
  return { game, session, closed, send, hello }
}

const forward = (seq: number): InputCommand => ({
  seq,
  buttons: Button.Forward,
  yaw: 0,
  pitch: 0,
  viewTick: 0,
})

describe('session', () => {
  test('4-tick input batches are simulated one command a tick, evenly', async () => {
    const { game, session, send, hello } = setup()
    await hello()
    const player = game.players.get(session.playerId)
    if (!player) throw new Error('not joined')
    let seq = 1
    const acks: number[] = []
    for (let t = 0; t < 120; t++) {
      if (t % INPUT_BATCH_TICKS === 0) {
        const commands = Array.from({ length: INPUT_BATCH_TICKS }, () => forward(seq++))
        send({ type: ClientMsg.Input, commands })
      }
      game.step()
      acks.push(player.ackSeq)
    }
    // One more input acknowledged every tick: no stalls, no double steps.
    for (let i = 1; i < acks.length; i++) expect((acks[i] ?? 0) - (acks[i - 1] ?? 0)).toBe(1)
    expect(player.queue.length).toBeLessThan(INPUT_BATCH_TICKS)
  })

  test('a late batch is caught up at two a tick, then back to one', async () => {
    const { game, session, send, hello } = setup()
    await hello()
    const player = game.players.get(session.playerId)
    if (!player) throw new Error('not joined')
    let seq = 1
    const batch = () => Array.from({ length: INPUT_BATCH_TICKS }, () => forward(seq++))
    // A hiccup: three batches arrive at once.
    send({ type: ClientMsg.Input, commands: [...batch(), ...batch(), ...batch()] })
    const before = player.ackSeq
    for (let t = 0; t < 4; t++) game.step()
    expect(player.ackSeq - before).toBe(8)
    for (let t = 0; t < 4; t++) game.step()
    expect(player.ackSeq).toBe(12)
  })

  test('budget: every message counts; past 95% new players are turned away, players stay', async () => {
    const budget = new RequestBudget(100)
    const a = setup(budget)
    await a.hello()
    expect(a.session.playerId).toBeGreaterThan(0)
    budget.http(94)
    a.send({ type: ClientMsg.Ping, clientTime: 0, rtt: 0 })
    expect(budget.snapshot().messages).toBe(2)
    budget.message(18) // 20 messages = 1 request → 95
    expect(budget.resting).toBe(true)

    const b = setup(budget)
    await b.hello()
    expect(b.session.playerId).toBe(0)
    expect(b.closed).toEqual([{ code: CLOSE_RESTING, reason: 'The servers are resting' }])
    // The player already in keeps playing.
    a.send({ type: ClientMsg.Input, commands: [forward(1)] })
    a.game.step()
    expect(a.game.players.get(a.session.playerId)?.ackSeq).toBe(1)
    expect(a.closed).toEqual([])
  })

  test('flooded Actions are dropped', async () => {
    const { game, session, send, hello } = setup()
    await hello()
    let handled = 0
    const original = game.handleAction.bind(game)
    game.handleAction = (id, action) => {
      handled++
      original(id, action)
    }
    for (let i = 0; i < 200; i++) send({ type: ClientMsg.Action, action: { a: 'light', on: true } })
    expect(session.playerId).toBeGreaterThan(0)
    expect(handled).toBeLessThanOrEqual(21)
    expect(handled).toBeGreaterThanOrEqual(20)
  })
})
