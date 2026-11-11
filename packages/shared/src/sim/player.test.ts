import { beforeAll, describe, expect, test } from 'bun:test'
import { TICK_DT } from '../constants.ts'
import { MapBuilder } from '../maps/builder.ts'
import { loadMap } from '../maps/index.ts'
import { createPhysicsWorld, initPhysics } from '../physics/world.ts'
import { Button, type PlayerInput } from './input.ts'
import { DEFAULT_MOVEMENT, jumpHeight } from './movement-config.ts'
import {
  clonePlayerState,
  createPlayerState,
  PlayerBody,
  type PlayerState,
  stepPlayer,
} from './player.ts'

const LIGHTING = {
  sunDirection: [0, 1, 0] as const,
  sunColor: 0,
  sunIntensity: 0,
  skyColor: 0,
  groundColor: 0,
  ambientIntensity: 0,
  fogColor: 0,
  fogNear: 0,
  fogFar: 0,
}

/** Flat 40×40 floor, player at origin looking down -Z. `build` adds obstacles. */
function setup(build: (m: MapBuilder) => void = () => {}) {
  const m = new MapBuilder('test', 'Test', LIGHTING)
  m.span([-20, -1, -20], [20, 0, 20], 'floor')
  build(m)
  const physics = createPhysicsWorld(m.build())
  const body = new PlayerBody(physics, { ...DEFAULT_MOVEMENT })
  const state = createPlayerState({ pos: [0, 0, 0], yaw: 0 })
  // Settle onto the floor.
  run(state, body, 10, 0)
  return { state, body }
}

function run(
  state: PlayerState,
  body: PlayerBody,
  ticks: number,
  buttons: number | ((tick: number) => number),
  onTick?: (s: PlayerState) => void,
) {
  for (let t = 0; t < ticks; t++) {
    const input: PlayerInput = {
      buttons: typeof buttons === 'function' ? buttons(t) : buttons,
      yaw: state.yaw,
      pitch: 0,
    }
    stepPlayer(state, input, TICK_DT, body)
    onTick?.(state)
  }
}

const seconds = (s: number) => Math.round(s / TICK_DT)
const hSpeed = (s: PlayerState) => Math.hypot(s.vel.x, s.vel.z)

beforeAll(async () => {
  await initPhysics()
})

describe('ground', () => {
  test('settles on the floor and is grounded', () => {
    const { state } = setup()
    expect(state.grounded).toBe(true)
    expect(state.pos.y).toBeCloseTo(0, 1)
  })

  const c = DEFAULT_MOVEMENT
  const speedCases = [
    { name: 'walk', buttons: Button.Forward, speed: c.walkSpeed },
    {
      name: 'sprint',
      buttons: Button.Forward | Button.Sprint,
      speed: c.walkSpeed * c.sprintMultiplier,
    },
    { name: 'crouch', buttons: Button.Forward | Button.Crouch, speed: c.crouchSpeed },
    // Diagonal input is normalized: no faster strafe-running.
    { name: 'diagonal', buttons: Button.Forward | Button.Right, speed: c.walkSpeed },
  ]
  for (const { name, buttons, speed } of speedCases) {
    test(`${name} reaches ${speed.toFixed(2)} m/s`, () => {
      const { state, body } = setup()
      run(state, body, seconds(1.5), buttons)
      expect(hSpeed(state)).toBeCloseTo(speed, 1)
    })
  }

  test('reaches walk speed quickly and stops quickly', () => {
    const { state, body } = setup()
    run(state, body, seconds(0.3), Button.Forward)
    expect(hSpeed(state)).toBeGreaterThan(DEFAULT_MOVEMENT.walkSpeed * 0.9)
    run(state, body, seconds(0.3), 0)
    expect(hSpeed(state)).toBe(0)
  })

  test('sprint only works moving forward', () => {
    const { state, body } = setup()
    run(state, body, seconds(1.5), Button.Back | Button.Sprint)
    expect(hSpeed(state)).toBeCloseTo(DEFAULT_MOVEMENT.walkSpeed, 1)
  })
})

describe('jumping', () => {
  test(`jump height ≈ ${jumpHeight(DEFAULT_MOVEMENT).toFixed(2)} m`, () => {
    const { state, body } = setup()
    const start = state.pos.y
    let peak = start
    run(
      state,
      body,
      seconds(1),
      (t) => (t === 0 ? Button.Jump : 0),
      (s) => {
        peak = Math.max(peak, s.pos.y)
      },
    )
    expect(peak - start).toBeGreaterThan(0.95)
    expect(peak - start).toBeLessThan(1.02)
    expect(state.grounded).toBe(true)
  })

  test('holding jump does not auto-hop', () => {
    const { state, body } = setup()
    let jumps = 0
    for (let t = 0; t < seconds(2); t++) {
      const e = stepPlayer(state, { buttons: Button.Jump, yaw: 0, pitch: 0 }, TICK_DT, body)
      if (e.jumped) jumps++
    }
    expect(jumps).toBe(1)
  })

  test('jump pressed shortly before landing is buffered', () => {
    const { state, body } = setup()
    run(state, body, 1, Button.Jump)
    // Release, then press again ~50 ms before landing.
    let airTicks = 0
    run(state, body, seconds(1), 0, (s) => {
      if (!s.grounded) airTicks++
    })
    const { state: s2, body: b2 } = setup()
    let jumps = 0
    for (let t = 0; t < airTicks + 30; t++) {
      const buttons = t === 0 || t === airTicks - 3 ? Button.Jump : 0
      if (stepPlayer(s2, { buttons, yaw: 0, pitch: 0 }, TICK_DT, b2).jumped) jumps++
    }
    expect(jumps).toBe(2)
  })

  test('coyote time: can still jump just after walking off a ledge', () => {
    // Stand on a 2 m tall platform edge, walk off, jump a few ticks later.
    const { state, body } = setup((m) => m.span([-5, 0, -1], [5, 2, 5], 'platform'))
    state.pos = { x: 0, y: 2.1, z: -0.6 }
    run(state, body, 20, 0)
    expect(state.pos.y).toBeCloseTo(2, 1)
    let leftGroundAt = -1
    let jumped = false
    for (let t = 0; t < 60; t++) {
      const buttons = leftGroundAt >= 0 && t === leftGroundAt + 3 ? Button.Jump : Button.Forward
      const e = stepPlayer(state, { buttons, yaw: 0, pitch: 0 }, TICK_DT, body)
      if (!state.grounded && leftGroundAt < 0 && !e.jumped) leftGroundAt = t
      jumped ||= e.jumped
    }
    expect(jumped).toBe(true)
  })

  test('air strafing gains no speed', () => {
    const { state, body } = setup()
    run(state, body, seconds(1), Button.Forward)
    const start = hSpeed(state)
    let max = 0
    // Classic strafe-jump: jump, hold strafe, swing the view.
    for (let t = 0; t < seconds(3); t++) {
      const buttons =
        (state.grounded ? Button.Jump : 0) | (t % 40 < 20 ? Button.Left : Button.Right)
      state.yaw += t % 40 < 20 ? 0.03 : -0.03
      stepPlayer(state, { buttons, yaw: state.yaw, pitch: 0 }, TICK_DT, body)
      max = Math.max(max, hSpeed(state))
    }
    expect(max).toBeLessThanOrEqual(start + 0.01)
  })
})

describe('obstacles', () => {
  // Obstacles start 2 m ahead and run 10 m deep, so the player can't walk off the far side.
  const ahead = (h: number) => (m: MapBuilder) => m.span([-2, 0, -2], [2, h, -12], 'marker')

  test('walks up a 0.4 m step', () => {
    const { state, body } = setup(ahead(0.4))
    run(state, body, seconds(1.5), Button.Forward)
    expect(state.pos.y).toBeCloseTo(0.4, 1)
  })

  test('is blocked by a 0.5 m step', () => {
    const { state, body } = setup(ahead(0.5))
    run(state, body, seconds(1.5), Button.Forward)
    expect(state.pos.y).toBeLessThan(0.1)
    expect(state.pos.z).toBeGreaterThan(-2.1)
  })

  test('can jump onto 0.9 m', () => {
    const { state, body } = setup(ahead(0.9))
    run(state, body, seconds(2), (t) => Button.Forward | (t === 10 ? Button.Jump : 0))
    expect(state.pos.y).toBeCloseTo(0.9, 1)
  })

  test('cannot jump onto 1.2 m', () => {
    const { state, body } = setup(ahead(1.2))
    run(state, body, seconds(2), (t) => Button.Forward | (t % 30 === 10 ? Button.Jump : 0))
    expect(state.pos.y).toBeLessThan(0.1)
  })

  test('climbs stairs (0.25 rise / 0.3 run)', () => {
    const { state, body } = setup((m) => {
      for (let i = 1; i <= 8; i++)
        m.span([-1, 0, -1 - (i - 1) * 0.3], [1, i * 0.25, -1 - i * 0.3], 'platform')
      m.span([-1, 0, -3.4], [1, 2, -15], 'platform')
    })
    run(state, body, seconds(2), Button.Forward)
    expect(state.pos.y).toBeCloseTo(2, 1)
  })

  test('stays grounded walking down stairs', () => {
    const { state, body } = setup((m) => {
      m.span([-1, 0, 1], [1, 2, -2], 'platform')
      for (let i = 1; i <= 8; i++)
        m.span([-1, 0, -2 - (i - 1) * 0.3], [1, 2 - i * 0.25, -2 - i * 0.3], 'platform')
    })
    state.pos = { x: 0, y: 2.1, z: 0 }
    run(state, body, 20, 0)
    let airborneTicks = 0
    run(state, body, seconds(1.5), Button.Forward, (s) => {
      if (!s.grounded) airborneTicks++
    })
    expect(state.pos.y).toBeCloseTo(0, 1)
    expect(airborneTicks).toBeLessThan(3)
  })

  test('walks up 40° but not 50°', () => {
    for (const [angle, climbs] of [
      [40, true],
      [50, false],
    ] as const) {
      let top = 0
      const { state, body } = setup((m) => {
        top = m.ramp(0, 0, -1, 3, 3, angle)
        m.span([-1.5, 0, -4], [1.5, top, -15], 'platform')
      })
      run(state, body, seconds(3), Button.Forward)
      if (climbs) expect(state.pos.y).toBeGreaterThan(top * 0.9)
      else expect(state.pos.y).toBeLessThan(top * 0.5)
    }
  })

  test('slides along a wall instead of stopping', () => {
    const { state, body } = setup((m) => m.span([-10, 0, -2], [10, 3, -3], 'wall'))
    state.yaw = -Math.PI / 4 // facing diagonally into the wall
    run(state, body, seconds(2), Button.Forward)
    expect(Math.abs(state.vel.x)).toBeGreaterThan(2)
    expect(state.pos.z).toBeGreaterThan(-2.1)
  })

  test('head hits ceiling and falls back', () => {
    const { state, body } = setup((m) => m.span([-5, 2.2, -5], [5, 3, 5], 'wall'))
    let peak = 0
    run(
      state,
      body,
      seconds(1),
      (t) => (t === 0 ? Button.Jump : 0),
      (s) => {
        peak = Math.max(peak, s.pos.y)
      },
    )
    expect(peak).toBeLessThan(0.45)
    expect(state.grounded).toBe(true)
  })
})

describe('crouching', () => {
  test('fits under a 1.5 m overhang and cannot stand up under it', () => {
    const { state, body } = setup((m) => m.span([-2, 1.5, -2], [2, 2.5, -6], 'wall'))
    // Standing: blocked by the overhang.
    run(state, body, seconds(1), Button.Forward)
    expect(state.pos.z).toBeGreaterThan(-2)
    // Crouched: passes under.
    run(state, body, seconds(1.5), Button.Forward | Button.Crouch)
    expect(state.pos.z).toBeLessThan(-2.5)
    expect(state.pos.z).toBeGreaterThan(-5.5)
    // Release crouch underneath: must stay crouched.
    run(state, body, 5, 0)
    expect(state.crouched).toBe(true)
  })

  test('eye height animates instead of snapping', () => {
    const { state, body } = setup()
    run(state, body, 1, Button.Crouch)
    expect(state.crouchAmount).toBeGreaterThan(0)
    expect(state.crouchAmount).toBeLessThan(1)
    run(state, body, seconds(0.5), Button.Crouch)
    expect(state.crouchAmount).toBe(1)
  })
})

describe('robustness', () => {
  /** Seeded random input stream: mashes every movement button and swings the view. */
  function randomInputs(seed: number, ticks: number): PlayerInput[] {
    let a = seed
    const rand = () => {
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const inputs: PlayerInput[] = []
    let buttons = 0
    let yaw = 0
    for (let i = 0; i < ticks; i++) {
      if (rand() < 0.08) buttons = Math.floor(rand() * 128) & ~(Button.Forward & Button.Back)
      yaw += (rand() - 0.5) * 0.3
      inputs.push({ buttons, yaw, pitch: 0 })
    }
    return inputs
  }

  function simulateGym(inputs: PlayerInput[]) {
    const map = loadMap('gym')
    const body = new PlayerBody(createPhysicsWorld(map), { ...DEFAULT_MOVEMENT })
    const state = createPlayerState(map.spawns[0])
    const trace: PlayerState[] = []
    for (const input of inputs) {
      stepPlayer(state, input, TICK_DT, body)
      trace.push(clonePlayerState(state))
    }
    return trace
  }

  test('is deterministic: same inputs give bit-identical states in separate worlds', () => {
    const inputs = randomInputs(42, seconds(20))
    const a = simulateGym(inputs)
    const b = simulateGym(inputs)
    expect(a).toEqual(b)
  })

  test('random play on the gym never falls through the world or produces NaN', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const trace = simulateGym(randomInputs(seed, seconds(30)))
      for (const s of trace) {
        expect(Number.isFinite(s.pos.x + s.pos.y + s.pos.z)).toBe(true)
        expect(s.pos.y).toBeGreaterThan(-0.1)
        expect(Math.abs(s.pos.x)).toBeLessThan(30)
        expect(Math.abs(s.pos.z)).toBeLessThan(50)
      }
    }
  })
})
