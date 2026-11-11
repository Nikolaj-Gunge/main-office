import { beforeAll, describe, expect, test } from 'bun:test'
import { TICK_DT } from '../constants.ts'
import { createPhysicsWorld, initPhysics } from '../physics/world.ts'
import { Button, type PlayerInput } from '../sim/input.ts'
import { DEFAULT_MOVEMENT } from '../sim/movement-config.ts'
import { createPlayerState, PlayerBody, type PlayerState, stepPlayer } from '../sim/player.ts'
import { buildOffice } from './office.ts'

const map = buildOffice()
const UP = 4.5

beforeAll(async () => {
  await initPhysics()
})

function spawnAt(pos: [number, number, number], yawDeg = 0) {
  const body = new PlayerBody(createPhysicsWorld(map), { ...DEFAULT_MOVEMENT })
  const state = createPlayerState({ pos, yaw: (yawDeg * Math.PI) / 180 })
  return { body, state }
}

function run(s: PlayerState, body: PlayerBody, seconds: number, input: (t: number) => PlayerInput) {
  for (let t = 0; t < Math.round(seconds / TICK_DT); t++) stepPlayer(s, input(t), TICK_DT, body)
}

describe('office map', () => {
  test('every spawn is free and on solid floor', () => {
    for (const spawn of map.spawns) {
      const { body, state } = spawnAt([...spawn.pos])
      expect(body.fits(state.pos, DEFAULT_MOVEMENT.standHeight)).toBe(true)
      run(state, body, 1, () => ({ buttons: 0, yaw: spawn.yaw, pitch: 0 }))
      expect(state.grounded).toBe(true)
      expect(Math.abs(state.pos.y - spawn.pos[1])).toBeLessThan(0.15)
    }
  })

  test('has 12–16 spawns on both floors', () => {
    expect(map.spawns.length).toBeGreaterThanOrEqual(12)
    expect(map.spawns.length).toBeLessThanOrEqual(16)
    expect(map.spawns.some((s) => s.pos[1] >= UP)).toBe(true)
    expect(map.spawns.some((s) => s.pos[1] === 0)).toBe(true)
  })

  const routes: [string, [number, number, number], number][] = [
    ['grand stairs', [0, 0, 1.5], -6.5],
    ['east stairs', [27.9, 0, 1.5], -6.5],
    ['west stairwell', [-28, 0, -6.8], -14],
  ]
  for (const [name, start, reachZ] of routes) {
    test(`${name} lead up to the gallery`, () => {
      const { body, state } = spawnAt(start)
      run(state, body, 4, () => ({ buttons: Button.Forward, yaw: 0, pitch: 0 }))
      expect(state.pos.y).toBeCloseTo(UP, 1)
      expect(state.pos.z).toBeLessThan(reachZ)
    })
  }

  test('random play from every spawn stays inside the building', () => {
    let seed = 7
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 4294967296
    }
    for (const spawn of map.spawns) {
      const { body, state } = spawnAt([...spawn.pos], (spawn.yaw * 180) / Math.PI)
      let buttons = 0
      let yaw = spawn.yaw
      for (let t = 0; t < Math.round(15 / TICK_DT); t++) {
        if (rand() < 0.05) buttons = Math.floor(rand() * 128)
        yaw += (rand() - 0.5) * 0.2
        stepPlayer(state, { buttons, yaw, pitch: 0 }, TICK_DT, body)
        const p = state.pos
        expect(Number.isFinite(p.x + p.y + p.z)).toBe(true)
        expect(p.y).toBeGreaterThan(-0.1)
        expect(p.y).toBeLessThan(9)
        expect(Math.abs(p.x)).toBeLessThan(30)
        expect(Math.abs(p.z)).toBeLessThan(20)
      }
    }
  })
})
