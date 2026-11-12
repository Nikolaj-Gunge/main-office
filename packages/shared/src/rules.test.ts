import { describe, expect, test } from 'bun:test'
import { DEFAULT_RULES, mergeRules, movementFor } from './rules.ts'
import { Button } from './sim/input.ts'
import { DEFAULT_MOVEMENT } from './sim/movement-config.ts'
import { createWeaponState, stepWeapon } from './sim/weapon-sim.ts'
import { WEAPONS, WeaponId } from './sim/weapons.ts'

describe('game rules', () => {
  test('merging ignores junk and clamps numbers', () => {
    const r = mergeRules(DEFAULT_RULES, {
      gravity: -5,
      speed: '2',
      skin: 'dragon',
      map: 'gym',
      oneShot: 'yes',
      infiniteAmmo: true,
      respawnSeconds: Number.NaN,
    })
    expect(r.gravity).toBe(0.1)
    expect(r.speed).toBe(1)
    expect(r.skin).toBe('worker')
    expect(r.map).toBe('gym')
    expect(r.oneShot).toBe(false)
    expect(r.infiniteAmmo).toBe(true)
    expect(r.respawnSeconds).toBe(DEFAULT_RULES.respawnSeconds)
    expect(mergeRules(DEFAULT_RULES, null)).toEqual(DEFAULT_RULES)
  })

  test('normal rules give the normal movement', () => {
    expect(movementFor(DEFAULT_RULES)).toEqual(DEFAULT_MOVEMENT)
  })

  test('tiny people are scaled down but can still climb stairs', () => {
    const m = movementFor({ ...DEFAULT_RULES, playerScale: 0.5, gravity: 0.5 })
    expect(m.standHeight).toBeCloseTo(0.9)
    expect(m.standEyeHeight).toBeCloseTo(DEFAULT_MOVEMENT.standEyeHeight / 2)
    expect(m.stepHeight).toBeGreaterThanOrEqual(0.25)
    expect(m.gravity).toBeCloseTo(DEFAULT_MOVEMENT.gravity / 2)
  })

  const ctx = { sprinting: false, grounded: true, crouched: false, speedFactor: 1 }

  test('zero spread: every bullet goes exactly where you aim', () => {
    const w = createWeaponState(WeaponId.Rifle, 1234)
    w.draw = 0
    for (let i = 0; i < 5; i++) {
      const events = stepWeapon(w, Button.Fire, Button.Fire, 1 / 60, {
        ...ctx,
        rules: { spreadScale: 0, infiniteAmmo: false },
      })
      if (events.shot) {
        expect(events.shot.yawOffset).toBe(0)
        expect(events.shot.pitchOffset).toBe(0)
      }
      w.cooldown = 0
    }
  })

  test('infinite ammo: reloading keeps the spare ammo', () => {
    const w = createWeaponState(WeaponId.Handgun)
    w.draw = 0
    w.ammo = 0
    const reserve = w.reserve
    const rules = { spreadScale: 1, infiniteAmmo: true }
    stepWeapon(w, 0, Button.Reload, 1 / 60, { ...ctx, rules })
    for (let t = 0; t < 4 * 60; t++) stepWeapon(w, 0, 0, 1 / 60, { ...ctx, rules })
    expect(w.ammo).toBe(WEAPONS[WeaponId.Handgun].magSize)
    expect(w.reserve).toBe(reserve)
  })
})
