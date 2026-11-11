import { beforeAll, describe, expect, test } from 'bun:test'
import { TICK_DT } from '../constants.ts'
import { loadMap } from '../maps/index.ts'
import { createPhysicsWorld, initPhysics } from '../physics/world.ts'
import type { InputCommand, RemotePlayerState } from '../protocol/messages.ts'
import { Button } from '../sim/input.ts'
import { DEFAULT_MOVEMENT } from '../sim/movement-config.ts'
import {
  clonePlayerState,
  createPlayerState,
  PlayerBody,
  type PlayerState,
  stepPlayer,
} from '../sim/player.ts'
import { InterpolationBuffer, ServerClock } from './interpolation.ts'
import { Predictor } from './prediction.ts'

beforeAll(async () => {
  await initPhysics()
})

/** Client and server each get their own world, like in reality. */
function makeSide() {
  const map = loadMap('gym')
  const body = new PlayerBody(createPhysicsWorld(map), { ...DEFAULT_MOVEMENT })
  return { body, state: createPlayerState(map.spawns[0]) }
}

/** Scripted input: run, strafe, jump, crouch, turn. */
function inputAt(tick: number) {
  let buttons = Button.Forward
  if (tick % 90 > 60) buttons |= Button.Right
  if (tick % 120 === 30) buttons |= Button.Jump
  if (tick % 200 > 170) buttons |= Button.Crouch
  if (tick % 150 < 40) buttons |= Button.Sprint
  return { buttons, yaw: Math.sin(tick / 50) * 2, pitch: 0 }
}

describe('Predictor', () => {
  test('with lag, reconciliation never corrects a correct prediction', () => {
    const client = makeSide()
    const server = makeSide()
    const predictor = new Predictor(client.state, client.body)
    const LAG = 9 // ticks each way (150 ms)

    const toServer: { at: number; cmd: InputCommand }[] = []
    const toClient: { at: number; state: PlayerState; ack: number }[] = []
    let serverAck = 0
    let maxCorrection = 0
    let reconciles = 0

    for (let t = 0; t < 600; t++) {
      const { command } = predictor.predict(inputAt(t))
      toServer.push({ at: t + LAG, cmd: command })

      // Server: apply whatever arrived, send a snapshot every other tick.
      while (toServer[0] && toServer[0].at <= t) {
        const { cmd } = toServer.shift() as { cmd: InputCommand }
        stepPlayer(server.state, cmd, TICK_DT, server.body)
        serverAck = cmd.seq
      }
      if (t % 2 === 0)
        toClient.push({ at: t + LAG, state: clonePlayerState(server.state), ack: serverAck })

      // Client: reconcile on arrival.
      while (toClient[0] && toClient[0].at <= t) {
        const snap = toClient.shift() as { state: PlayerState; ack: number }
        const c = predictor.reconcile(snap.state, snap.ack)
        maxCorrection = Math.max(maxCorrection, Math.hypot(c.x, c.y, c.z))
        reconciles++
      }
    }
    expect(reconciles).toBeGreaterThan(250)
    expect(maxCorrection).toBe(0)
    expect(predictor.pendingCount).toBeLessThanOrEqual(2 * LAG + 1)
  })

  test('a server-side change (e.g. teleport) is corrected and replayed on top', () => {
    const client = makeSide()
    const predictor = new Predictor(client.state, client.body)
    for (let t = 0; t < 10; t++) predictor.predict({ buttons: 0, yaw: 0, pitch: 0 })

    const teleported = createPlayerState({ pos: [5, 0, 5], yaw: 0 })
    teleported.grounded = true
    const c = predictor.reconcile(teleported, 4) // server applied inputs 1–4
    expect(Math.hypot(c.x, c.z)).toBeGreaterThan(1)
    expect(predictor.pendingCount).toBe(6)
    expect(predictor.state.pos.x).toBeCloseTo(5, 3)
  })
})

describe('InterpolationBuffer', () => {
  const at = (x: number): RemotePlayerState => ({
    id: 1,
    x,
    y: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    crouch: 0,
    grounded: true,
  })

  test('blends between snapshots', () => {
    const buf = new InterpolationBuffer()
    buf.push(10, at(0))
    buf.push(12, at(2))
    buf.push(14, at(4))
    expect(buf.sample(11)?.x).toBeCloseTo(1)
    expect(buf.sample(13.5)?.x).toBeCloseTo(3.5)
  })

  test('extrapolates briefly past the newest snapshot, then holds', () => {
    const buf = new InterpolationBuffer()
    buf.push(10, at(0))
    buf.push(12, at(2))
    expect(buf.sample(13)?.x).toBeCloseTo(3)
    expect(buf.sample(100)?.x).toBeCloseTo(8) // capped at 6 ticks of extrapolation
  })

  test('yaw takes the short way round', () => {
    const buf = new InterpolationBuffer()
    buf.push(0, { ...at(0), yaw: Math.PI * 2 - 0.1 })
    buf.push(2, { ...at(0), yaw: 0.1 })
    const yaw = buf.sample(1)?.yaw ?? NaN
    expect(Math.abs(Math.sin(yaw))).toBeLessThan(0.01)
  })

  test('ignores out-of-order and duplicate snapshots', () => {
    const buf = new InterpolationBuffer()
    buf.push(10, at(0))
    buf.push(12, at(2))
    buf.push(11, at(100))
    buf.push(12, at(100))
    expect(buf.sample(11)?.x).toBeCloseTo(1)
  })
})

describe('ServerClock', () => {
  test('tracks the server tick and resyncs after big jumps', () => {
    const clock = new ServerClock(60)
    clock.onSnapshot(600, 0)
    expect(clock.tick(1000)).toBeCloseTo(660)
    clock.onSnapshot(5000, 1000)
    expect(clock.tick(1000)).toBeCloseTo(5000)
  })
})
