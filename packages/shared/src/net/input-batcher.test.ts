import { beforeAll, describe, expect, test } from 'bun:test'
import { INPUT_BATCH_TICKS, TICK_DT, TICK_RATE } from '../constants.ts'
import { loadMap } from '../maps/index.ts'
import { createPhysicsWorld, initPhysics } from '../physics/world.ts'
import type { InputCommand } from '../protocol/messages.ts'
import { Button } from '../sim/input.ts'
import { DEFAULT_MOVEMENT } from '../sim/movement-config.ts'
import {
  clonePlayerState,
  createPlayerState,
  PlayerBody,
  type PlayerState,
  stepPlayer,
} from '../sim/player.ts'
import { InputBatcher } from './input-batcher.ts'
import { Predictor } from './prediction.ts'

beforeAll(async () => {
  await initPhysics()
})

const command = (seq: number, buttons = 0): InputCommand => ({
  seq,
  buttons,
  yaw: 0,
  pitch: 0,
  viewTick: 0,
})

/** Scripted play: run, strafe, a jump every 2 s, a burst of fire, a reload. */
function inputAt(tick: number) {
  let buttons = Button.Forward
  if (tick % 90 > 60) buttons |= Button.Right
  if (tick % 120 === 30) buttons |= Button.Jump
  if (tick % 200 > 170) buttons |= Button.Crouch
  if (tick % 150 < 40) buttons |= Button.Sprint
  if (tick % 25 === 0) buttons |= Button.Fire
  if (tick === 400) buttons |= Button.Reload
  return { buttons, yaw: Math.sin(tick / 50) * 2, pitch: 0 }
}

describe('InputBatcher', () => {
  test('sends every INPUT_BATCH_TICKS ticks while just moving', () => {
    expect(INPUT_BATCH_TICKS).toBe(4)
    const batcher = new InputBatcher()
    const sent: number[][] = []
    for (let seq = 1; seq <= 12; seq++) {
      if (batcher.add(command(seq, Button.Forward))) sent.push(batcher.take().map((c) => c.seq))
    }
    expect(sent).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
      [9, 10, 11, 12],
    ])
  })

  test('a press flushes at once; holding the button does not', () => {
    const batcher = new InputBatcher()
    expect(batcher.add(command(1))).toBe(false)
    expect(batcher.add(command(2, Button.Fire))).toBe(true)
    expect(batcher.take().map((c) => c.seq)).toEqual([1, 2])
    // Held fire (a spray): back to full batches.
    for (let seq = 3; seq <= 5; seq++) expect(batcher.add(command(seq, Button.Fire))).toBe(false)
    expect(batcher.add(command(6, Button.Fire))).toBe(true)
    expect(batcher.take()).toHaveLength(4)
    // Letting go isn't urgent; jumping is.
    expect(batcher.add(command(7))).toBe(false)
    expect(batcher.add(command(8, Button.Jump))).toBe(true)
  })

  test('several ticks in one frame still leave as one message', () => {
    const batcher = new InputBatcher()
    batcher.add(command(1, Button.Use)) // urgent…
    batcher.add(command(2)) // …and the frame simulated one more tick before sending
    expect(batcher.ready).toBe(true)
    expect(batcher.take().map((c) => c.seq)).toEqual([1, 2])
    expect(batcher.ready).toBe(false)
  })

  test('reset drops what was collected (disconnect)', () => {
    const batcher = new InputBatcher()
    batcher.add(command(1))
    batcher.add(command(2, Button.Fire))
    batcher.reset()
    expect(batcher.pendingCount).toBe(0)
    expect(batcher.ready).toBe(false)
    // Fire still held from before the reset counts as a fresh press.
    expect(batcher.add(command(3, Button.Fire))).toBe(true)
  })

  test('scripted play sends ~15 messages/s instead of 30 (2-tick batches)', () => {
    const rate = (size: number) => {
      const batcher = new InputBatcher(size)
      let messages = 0
      const seconds = 60
      for (let t = 0; t < seconds * TICK_RATE; t++) {
        if (batcher.add({ ...inputAt(t), seq: t + 1, viewTick: 0 })) {
          batcher.take()
          messages++
        }
      }
      return messages / seconds
    }
    // Before: a message every 2 ticks, no early flushes.
    expect(TICK_RATE / 2).toBe(30)
    const now = rate(INPUT_BATCH_TICKS)
    // 15/s plus the odd early flush for a shot, jump or reload.
    expect(now).toBeGreaterThanOrEqual(15)
    expect(now).toBeLessThan(17)
  })
})

describe('Predictor with batched input', () => {
  test('4-tick batches, early flushes and jitter: never a correction, both sides agree', () => {
    const map = loadMap('gym')
    const side = () => ({
      body: new PlayerBody(createPhysicsWorld(map), { ...DEFAULT_MOVEMENT }),
      state: createPlayerState(map.spawns[0]),
    })
    const client = side()
    const server = side()
    const predictor = new Predictor(client.state, client.body)
    const batcher = new InputBatcher()
    const LAG = 9 // ticks each way (150 ms)

    const toServer: { at: number; commands: InputCommand[] }[] = []
    const toClient: { at: number; state: PlayerState; ack: number }[] = []
    const queue: InputCommand[] = []
    let serverAck = 0
    let maxCorrection = 0
    let reconciles = 0
    let messages = 0

    for (let t = 0; t < 900; t++) {
      const { command } = predictor.predict(inputAt(t))
      if (batcher.add(command)) {
        // Up to 2 ticks of jitter, but in order (one WebSocket).
        const jitter = t % 7 === 0 ? 2 : t % 3
        const at = Math.max(t + LAG + jitter, toServer.at(-1)?.at ?? 0)
        toServer.push({ at, commands: batcher.take() })
        messages++
      }

      // Server: queue what arrived, simulate one command a tick (two when behind), like game.ts.
      while (toServer[0] && toServer[0].at <= t) queue.push(...(toServer.shift()?.commands ?? []))
      const take = queue.length > INPUT_BATCH_TICKS + 1 ? 2 : 1
      for (const cmd of queue.splice(0, take)) {
        stepPlayer(server.state, cmd, TICK_DT, server.body)
        serverAck = cmd.seq
      }
      if (t % 2 === 0)
        toClient.push({ at: t + LAG, state: clonePlayerState(server.state), ack: serverAck })

      while (toClient[0] && toClient[0].at <= t) {
        const snap = toClient.shift() as { state: PlayerState; ack: number }
        const c = predictor.reconcile(snap.state, snap.ack)
        maxCorrection = Math.max(maxCorrection, Math.hypot(c.x, c.y, c.z))
        reconciles++
      }
    }
    // Drain: once everything has arrived both sides agree exactly, weapon included.
    for (const msg of toServer) queue.push(...msg.commands)
    queue.push(...batcher.take())
    for (const cmd of queue) {
      stepPlayer(server.state, cmd, TICK_DT, server.body)
      serverAck = cmd.seq
    }
    predictor.reconcile(clonePlayerState(server.state), serverAck)
    expect(predictor.state).toEqual(server.state)
    expect(server.state.weapon.shotIndex).toBeGreaterThan(10)

    expect(reconciles).toBeGreaterThan(400)
    expect(maxCorrection).toBe(0)
    // Half the messages of 2-tick batching, give or take the early flushes.
    expect(messages).toBeLessThan(900 / 3)
  })
})
