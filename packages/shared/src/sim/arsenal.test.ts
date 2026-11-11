import { beforeAll, describe, expect, test } from 'bun:test'
import { TICK_DT } from '../constants.ts'
import { MapBuilder } from '../maps/builder.ts'
import { createPhysicsWorld, initPhysics } from '../physics/world.ts'
import { Button } from './input.ts'
import { DEFAULT_MOVEMENT } from './movement-config.ts'
import { createPlayerState, PlayerBody, type PlayerState, stepPlayer } from './player.ts'
import {
  aimProgress,
  createWeaponState,
  currentSpread,
  MAX_BREATH,
  stepWeapon,
  type WeaponState,
  weaponSway,
} from './weapon-sim.ts'
import { WEAPONS, WeaponId } from './weapons.ts'

const STILL = { sprinting: false, grounded: true, crouched: false, speedFactor: 0 }
const seconds = (s: number) => Math.round(s / TICK_DT)

function drawn(id: WeaponId): WeaponState {
  const w = createWeaponState(id, 99)
  w.draw = 0
  return w
}

/** Steps a lone weapon with `buttons(t)`, returns the number of shots. */
function run(w: WeaponState, ticks: number, buttons: (t: number) => number) {
  let prev = 0
  let shots = 0
  for (let t = 0; t < ticks; t++) {
    const b = buttons(t)
    if (stepWeapon(w, b, b & ~prev, TICK_DT, STILL).shot) shots++
    prev = b
  }
  return shots
}

describe('rifle', () => {
  test('full-auto: holding fire for 1 s fires 10 rounds (600 RPM)', () => {
    expect(run(drawn(WeaponId.Rifle), seconds(1), () => Button.Fire)).toBe(10)
  })

  test('a full spray empties the 30-round magazine in 3 s', () => {
    const w = drawn(WeaponId.Rifle)
    expect(run(w, seconds(3.2), () => Button.Fire)).toBe(30)
    expect(w.ammo).toBe(0)
  })
})

describe('sniper', () => {
  test('bolt action: one shot per click, at most one per 1.4 s', () => {
    const w = drawn(WeaponId.Sniper)
    expect(run(w, seconds(1), () => Button.Fire)).toBe(1)
    expect(run(w, seconds(3), (t) => (t % 6 === 0 ? Button.Fire : 0))).toBe(2)
  })

  test('only accurate once fully scoped in', () => {
    const w = drawn(WeaponId.Sniper)
    expect(currentSpread(w, STILL)).toBe(WEAPONS[WeaponId.Sniper].hipSpread)
    run(w, seconds(0.1), () => Button.Aim)
    expect(currentSpread(w, STILL)).toBeGreaterThan(4)
    run(w, seconds(0.4), () => Button.Aim)
    expect(aimProgress(w)).toBe(1)
    expect(currentSpread(w, STILL)).toBe(0)
  })

  test('scope sways; holding breath steadies it for 3 s, then it gives out', () => {
    const w = drawn(WeaponId.Sniper)
    const swayOver = (ticks: number, buttons: number) => {
      let max = 0
      for (let t = 0; t < ticks; t++) {
        stepWeapon(w, buttons, 0, TICK_DT, STILL)
        const s = weaponSway(w)
        max = Math.max(max, Math.hypot(s.yaw, s.pitch))
      }
      return max
    }
    const free = swayOver(seconds(4), Button.Aim)
    expect(free).toBeGreaterThan((0.2 * Math.PI) / 180)
    const steady = swayOver(seconds(2), Button.Aim | Button.Sprint)
    expect(steady).toBeLessThan(free * 0.25)
    swayOver(seconds(1.2), Button.Aim | Button.Sprint) // breath runs out
    expect(w.steady).toBe(false)
    expect(w.breath).toBe(0)
    swayOver(seconds(3), Button.Aim) // let go of Shift: breath comes back
    expect(w.breath).toBeGreaterThan(MAX_BREATH / 2)
  })

  test('the sway really moves the shot', () => {
    const w = drawn(WeaponId.Sniper)
    let prev = Button.Aim
    for (let t = 0; t < seconds(1.7); t++) stepWeapon(w, Button.Aim, 0, TICK_DT, STILL)
    const sway = weaponSway(w)
    const e = stepWeapon(w, Button.Aim | Button.Fire, Button.Fire & ~prev, TICK_DT, STILL)
    prev = Button.Aim | Button.Fire
    expect(e.shot).not.toBeNull()
    expect(e.shot?.yawOffset).toBeCloseTo(sway.yaw, 2)
    expect(prev).toBeGreaterThan(0)
  })
})

describe('loadout and switching', () => {
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
  beforeAll(async () => {
    await initPhysics()
  })

  function setup(primary: WeaponId = WeaponId.Rifle) {
    const m = new MapBuilder('t', 't', LIGHTING)
    m.span([-50, -1, -50], [50, 0, 50], 'floor')
    const body = new PlayerBody(createPhysicsWorld(m.build()), { ...DEFAULT_MOVEMENT })
    const state = createPlayerState(
      { pos: [0, 0, 0], yaw: 0 },
      createWeaponState(primary),
      createWeaponState(WeaponId.Handgun),
    )
    return { state, body }
  }

  function play(
    state: PlayerState,
    body: PlayerBody,
    ticks: number,
    buttons: (t: number) => number,
  ) {
    let shots = 0
    let switches = 0
    for (let t = 0; t < ticks; t++) {
      const e = stepPlayer(state, { buttons: buttons(t), yaw: 0, pitch: 0 }, TICK_DT, body)
      if (e.shot) shots++
      if (e.switched) switches++
    }
    return { shots, switches }
  }

  test('2 draws the handgun, 1 the primary, Q swaps; each keeps its own ammo', () => {
    const { state, body } = setup()
    play(state, body, seconds(1), (t) => (t < 30 && t % 6 === 0 ? Button.Fire : 0))
    const rifleAmmo = state.weapon.ammo
    expect(play(state, body, 2, (t) => (t === 0 ? Button.Slot2 : 0)).switches).toBe(1)
    expect(state.weapon.id).toBe(WeaponId.Handgun)
    expect(state.holstered.ammo).toBe(rifleAmmo)
    // Pressing 2 again does nothing; Q swaps back.
    expect(play(state, body, 2, (t) => (t === 0 ? Button.Slot2 : 0)).switches).toBe(0)
    play(state, body, 2, (t) => (t === 0 ? Button.SwapWeapon : 0))
    expect(state.weapon.id).toBe(WeaponId.Rifle)
    expect(state.weapon.ammo).toBe(rifleAmmo)
  })

  test("can't shoot until the drawn weapon is up (draw time)", () => {
    const { state, body } = setup()
    play(state, body, seconds(1), () => 0)
    play(state, body, 1, () => Button.Slot2)
    const early = play(state, body, seconds(0.3), (t) => (t % 4 === 0 ? Button.Fire : 0))
    expect(early.shots).toBe(0)
    const later = play(state, body, seconds(0.5), (t) => (t % 12 === 0 ? Button.Fire : 0))
    expect(later.shots).toBeGreaterThan(0)
  })

  test('switching interrupts a reload', () => {
    const { state, body } = setup()
    play(state, body, seconds(1), () => 0)
    play(state, body, seconds(0.5), () => Button.Fire)
    play(state, body, 1, () => Button.Reload)
    expect(state.weapon.reload).toBeGreaterThan(0)
    play(state, body, 1, () => Button.Slot2)
    expect(state.holstered.reload).toBe(0)
    expect(state.holstered.ammo).toBeLessThan(WEAPONS[WeaponId.Rifle].magSize)
  })

  test('heavier weapons are slower; aiming slows you and blocks sprint', () => {
    const speed = (primary: WeaponId, buttons: number) => {
      const { state, body } = setup(primary)
      play(state, body, seconds(2), () => buttons)
      return Math.hypot(state.vel.x, state.vel.z)
    }
    const walk = DEFAULT_MOVEMENT.walkSpeed
    expect(speed(WeaponId.Rifle, Button.Forward)).toBeCloseTo(walk, 1)
    expect(speed(WeaponId.Sniper, Button.Forward)).toBeCloseTo(walk * 0.9, 1)
    expect(speed(WeaponId.Rifle, Button.Forward | Button.Aim)).toBeCloseTo(walk * 0.6, 1)
    expect(speed(WeaponId.Rifle, Button.Forward | Button.Aim | Button.Sprint)).toBeCloseTo(
      walk * 0.6,
      1,
    )
  })
})
