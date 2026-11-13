import { beforeAll, describe, expect, test } from 'bun:test'
import { TICK_DT } from '../constants.ts'
import { MapBuilder } from '../maps/builder.ts'
import { loadMap } from '../maps/index.ts'
import { createPhysicsWorld, initPhysics } from '../physics/world.ts'
import { Button, type PlayerInput } from './input.ts'
import { DEFAULT_MOVEMENT, jumpHeight } from './movement-config.ts'
import {
  bodyHeight,
  clonePlayerState,
  createPlayerState,
  eyeHeight,
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

  test('cannot jump onto 1.2 m (only climb it)', () => {
    const { state, body } = setup(ahead(1.2))
    body.config = { ...body.config, mantleMaxHeight: 0 } // no climbing
    run(state, body, seconds(2), (t) => Button.Forward | (t % 30 === 10 ? Button.Jump : 0))
    expect(state.pos.y).toBeLessThan(0.1)
  })

  test('crouch-jump (crouch in the air) clears a 1.25 m ledge', () => {
    const { state, body } = setup(ahead(1.25))
    // Jump at tick 10, pull the legs up from tick 16 (shortly after leaving the ground).
    run(
      state,
      body,
      seconds(2),
      (t) => Button.Forward | (t === 10 ? Button.Jump : 0) | (t >= 16 ? Button.Crouch : 0),
    )
    expect(state.pos.y).toBeCloseTo(1.25, 1)
  })

  test('cannot crouch-jump onto 1.6 m', () => {
    const { state, body } = setup(ahead(1.6))
    run(
      state,
      body,
      seconds(2),
      (t) => Button.Forward | (t === 10 ? Button.Jump : 0) | (t >= 16 ? Button.Crouch : 0),
    )
    expect(state.pos.y).toBeLessThan(0.1)
  })

  test('crouching in the air keeps the eye nearly still (no camera pop)', () => {
    const { state, body } = setup()
    run(state, body, 1, Button.Jump)
    run(state, body, 8, 0)
    const eye = (s: PlayerState) =>
      s.pos.y +
      DEFAULT_MOVEMENT.standEyeHeight +
      (DEFAULT_MOVEMENT.crouchEyeHeight - DEFAULT_MOVEMENT.standEyeHeight) * s.crouchAmount
    const before = eye(state)
    const vy = state.vel.y
    run(state, body, 1, Button.Crouch)
    // Gravity moves the eye by ~vy·dt this tick; the crouch itself adds no more than a few cm.
    expect(Math.abs(eye(state) - before - vy * TICK_DT)).toBeLessThan(0.08)
  })

  test('walking up a ramp is smooth: height only ever goes up, in small steps', () => {
    let top = 0
    const { state, body } = setup((m) => {
      top = m.ramp(0, 0, -1, 3, 4.5, 15.5)
      m.span([-1.5, 0, -5.5], [1.5, top, -15], 'platform')
    })
    let last = state.pos.y
    const drops: string[] = []
    let biggestRise = 0
    run(state, body, seconds(2.5), Button.Forward, (s) => {
      const onRamp = s.pos.z > -5.4 // the platform after it has sub-mm contact jitter
      if (onRamp && s.pos.y < last - 1e-3)
        drops.push(`z ${s.pos.z.toFixed(2)}: ${(s.pos.y - last).toFixed(4)}`)
      biggestRise = Math.max(biggestRise, s.pos.y - last)
      last = s.pos.y
    })
    expect(state.pos.y).toBeCloseTo(top, 1)
    expect(drops).toEqual([])
    expect(biggestRise).toBeLessThan(0.06) // ~ speed × dt × tan(15.5°), never a stair hop
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

describe('climbing', () => {
  // A crate face 1 m ahead, 7 m deep.
  const crate = (h: number) => (m: MapBuilder) => m.span([-2, 0, -1], [2, h, -8], 'marker')
  /** Walk at it, pressing jump once when it's in reach and once more on the way. */
  const climb = (state: PlayerState, body: PlayerBody, ticks = seconds(2)) => {
    const mantled: number[] = []
    for (let t = 0; t < ticks; t++) {
      const events = stepPlayer(
        state,
        { buttons: Button.Forward | (t === 5 || t === 40 ? Button.Jump : 0), yaw: 0, pitch: 0 },
        TICK_DT,
        body,
      )
      if (events.mantled) mantled.push(t)
    }
    return mantled
  }

  test('forward + jump at a 1.2 m crate pulls you up onto it', () => {
    const { state, body } = setup(crate(1.2))
    let ticks = 0
    let mantling = 0
    let lastY = 0
    let rises = true
    for (let t = 0; t < seconds(1.5); t++) {
      stepPlayer(
        state,
        { buttons: Button.Forward | (t === 25 ? Button.Jump : 0), yaw: 0, pitch: 0 },
        TICK_DT,
        body,
      )
      if (state.mantle) {
        mantling++
        if (state.pos.y < lastY - 1e-9) rises = false
        lastY = state.pos.y
      }
      ticks++
    }
    expect(ticks).toBeGreaterThan(0)
    // A short scripted move: ~0.4–0.7 s, only ever upwards.
    expect(mantling * TICK_DT).toBeGreaterThan(0.4)
    expect(mantling * TICK_DT).toBeLessThan(0.75)
    expect(rises).toBe(true)
    expect(state.mantle).toBeNull()
    expect(state.pos.y).toBeCloseTo(1.2, 1)
    expect(state.pos.z).toBeLessThan(-1.3)
    expect(state.grounded).toBe(true)
    expect(state.crouched).toBe(false)
  })

  test('climbs 2 m walls, but not 2.4 m ones', () => {
    const high = setup(crate(1.95))
    climb(high.state, high.body)
    expect(high.state.pos.y).toBeCloseTo(1.95, 1)
    const wall = setup(crate(2.4))
    expect(climb(wall.state, wall.body)).toEqual([])
    expect(wall.state.pos.y).toBeLessThan(0.1)
  })

  test('no climbing under a low ceiling (no room on top, no clipping through it)', () => {
    const { state, body } = setup((m) => {
      crate(1.2)(m)
      m.span([-3, 2.2, 2], [3, 2.4, -4], 'marker') // 2.2 m ceiling: 1 m above the crate
    })
    expect(climb(state, body)).toEqual([])
    expect(state.pos.y).toBeLessThan(0.1)
  })

  test('vaults through an open window: onto the sill (crouched), then down the other side', () => {
    const { state, body } = setup((m) => {
      m.span([-3, 0, -1], [3, 1, -1.3], 'marker') // wall below the sill
      m.span([-3, 2.3, -1], [3, 3, -1.3], 'marker') // above the window
      m.span([-3, 1, -1], [-0.6, 2.3, -1.3], 'marker') // either side of it
      m.span([0.6, 1, -1], [3, 2.3, -1.3], 'marker')
    })
    let crouchedOnSill = false
    run(
      state,
      body,
      seconds(1),
      (t) => Button.Forward | (t === 5 ? Button.Jump : 0),
      (s) => {
        if (s.mantle) crouchedOnSill ||= s.mantle.crouch // 1.3 m of opening: no standing up there
      },
    )
    expect(crouchedOnSill).toBe(true)
    run(state, body, seconds(1.5), Button.Forward)
    expect(state.pos.z).toBeLessThan(-1.8)
    expect(state.pos.y).toBeLessThan(0.1)
  })

  test('climbing is deterministic: a replay from a mid-climb copy ends in the same place', () => {
    const { state, body } = setup(crate(1.2))
    run(state, body, 26, (t) => Button.Forward | (t === 25 ? Button.Jump : 0))
    expect(state.mantle).not.toBeNull()
    const copy = clonePlayerState(state)
    run(state, body, seconds(1), Button.Forward)
    run(copy, body, seconds(1), Button.Forward)
    expect(copy).toEqual(state)
  })
})

describe('prone', () => {
  test('Z lies you down: a much lower shape and eye, a slow crawl, no sprint or jump', () => {
    const { state, body } = setup()
    run(state, body, 1, Button.Prone)
    run(state, body, seconds(0.7), 0)
    expect(state.prone).toBe(true)
    expect(state.proneAmount).toBe(1)
    expect(bodyHeight(state, body.config)).toBeLessThan(0.8)
    expect(eyeHeight(state, body.config)).toBeCloseTo(0.35, 2)
    const z = state.pos.z
    run(state, body, seconds(2), Button.Forward | Button.Sprint)
    expect(state.prone).toBe(true)
    expect(state.pos.y).toBeLessThan(0.05)
    expect(z - state.pos.z).toBeGreaterThan(1)
    expect(z - state.pos.z).toBeLessThan(2.4)
    // Jump gets you up (no jump); holding crouch, only to a crouch.
    run(state, body, 1, Button.Jump | Button.Crouch)
    expect(state.prone).toBe(false)
    expect(state.crouched).toBe(true)
    expect(state.vel.y).toBe(0)
    run(state, body, 1, 0)
    expect(state.crouched).toBe(false)
    expect(state.pos.y).toBeLessThan(0.05)
  })

  test('getting down and up takes a moment', () => {
    const { state, body } = setup()
    run(state, body, 1, Button.Prone)
    run(state, body, seconds(0.2), Button.Forward)
    expect(state.proneAmount).toBeGreaterThan(0.2)
    expect(state.proneAmount).toBeLessThan(0.8)
    expect(hSpeed(state)).toBeLessThan(1) // hardly moving while getting down
  })

  test('standing up needs head room: not under a table', () => {
    const { state, body } = setup((m) => m.span([-1, 0.85, -3], [1, 0.95, 3], 'marker'))
    // Lie down in the open and crawl under the table top.
    state.pos.z = 5
    run(state, body, 1, Button.Prone)
    run(state, body, seconds(0.7), 0)
    run(state, body, seconds(5), Button.Forward)
    expect(state.pos.z).toBeLessThan(2)
    run(state, body, 1, Button.Prone)
    run(state, body, 1, Button.Jump)
    expect(state.prone).toBe(true)
  })
})

describe('sliding', () => {
  /** Sprint up to speed, then press (and hold) crouch. */
  function slide(build?: (m: MapBuilder) => void, at?: [number, number, number]) {
    const { state, body } = setup(build)
    if (at) {
      state.pos = { x: at[0], y: at[1], z: at[2] }
      run(state, body, 10, 0)
    }
    run(state, body, seconds(1), Button.Forward | Button.Sprint)
    const sprint = hSpeed(state)
    const speeds: number[] = []
    let slid = 0
    let ticks = 0
    for (let t = 0; t < seconds(2); t++) {
      const events = stepPlayer(
        state,
        { buttons: Button.Forward | Button.Sprint | Button.Crouch, yaw: 0, pitch: 0 },
        TICK_DT,
        body,
      )
      if (events.slid) slid++
      if (state.slide > 0) ticks++
      speeds.push(hSpeed(state))
    }
    return { state, body, sprint, speeds, slid, ticks }
  }

  test('crouch while sprinting slides: a kick of speed that bleeds away, ending crouched', () => {
    const { state, sprint, speeds, slid, ticks } = slide()
    expect(slid).toBe(1)
    expect(speeds[0]).toBeGreaterThan(sprint)
    expect(speeds[seconds(0.5)]).toBeLessThan(speeds[0] ?? 0)
    expect(speeds[seconds(0.5)]).toBeGreaterThan(DEFAULT_MOVEMENT.crouchSpeed)
    expect(ticks * TICK_DT).toBeGreaterThan(0.5)
    expect(ticks * TICK_DT).toBeLessThan(1.05)
    expect(state.slide).toBe(0)
    expect(state.crouched).toBe(true)
    expect(hSpeed(state)).toBeLessThan(DEFAULT_MOVEMENT.crouchSpeed + 0.3)
  })

  test("slides can't be chained: a cooldown first", () => {
    const { state, body } = slide()
    state.pos = { x: 0, y: 0, z: 15 } // room to run again
    // Up and sprinting again at once: crouch does nothing until the cooldown is over…
    state.slideCooldown = 0.3
    run(state, body, seconds(0.1), Button.Forward | Button.Sprint)
    run(state, body, 1, Button.Forward | Button.Sprint | Button.Crouch)
    expect(state.slide).toBe(0)
    // …then it works.
    run(state, body, seconds(1), Button.Forward | Button.Sprint)
    run(state, body, 1, Button.Forward | Button.Sprint | Button.Crouch)
    expect(state.slide).toBeGreaterThan(0)
  })

  test('walking speed is not enough to slide', () => {
    const { state, body } = setup()
    run(state, body, seconds(1), Button.Forward)
    run(state, body, 1, Button.Forward | Button.Sprint | Button.Crouch)
    expect(state.slide).toBe(0)
  })

  test('a slide down a slope keeps going longer', () => {
    const flat = slide()
    let top = 0
    const down = slide(
      (m) => {
        top = m.ramp(0, 0, -16, 3, 12, 12, 'ramp', 1) // falls away towards -Z
        m.span([-1.5, top - 0.3, -4], [1.5, top, 12], 'platform')
      },
      [0, 2.6, 6],
    )
    expect(top).toBeGreaterThan(2)
    expect(down.slid).toBe(1)
    expect(down.ticks).toBeGreaterThan(flat.ticks + 10)
  })
})
