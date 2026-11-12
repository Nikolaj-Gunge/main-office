import { describe, expect, test } from 'bun:test'
import { TICK_DT } from '../constants.ts'
import { type HitPose, HitZone, raycastPose, viewDirection } from './hitboxes.ts'
import { Button } from './input.ts'
import {
  createWeaponState,
  stepWeapon,
  type WeaponContext,
  type WeaponState,
} from './weapon-sim.ts'
import { damageAtDistance, WEAPONS, WeaponId } from './weapons.ts'

const STILL: WeaponContext = { sprinting: false, grounded: true, crouched: false, speedFactor: 0 }
const handgun = WEAPONS[WeaponId.Handgun]

/** Runs the weapon for `ticks`, holding `buttons(t)`. Returns how many shots fired. */
function run(w: WeaponState, ticks: number, buttons: (t: number) => number, ctx = STILL) {
  let prev = 0
  let shots = 0
  for (let t = 0; t < ticks; t++) {
    const b = buttons(t)
    if (stepWeapon(w, b, b & ~prev, TICK_DT, ctx).shot) shots++
    prev = b
  }
  return shots
}

const ready = () => {
  const w = createWeaponState(WeaponId.Handgun, 1234)
  run(w, 30, () => 0) // finish drawing
  return w
}
const clickEvery = (n: number) => (t: number) => (t % n === 0 ? Button.Fire : 0)

describe('handgun', () => {
  test('can not fire while drawing', () => {
    const w = createWeaponState(WeaponId.Handgun)
    expect(run(w, 5, clickEvery(2))).toBe(0)
  })

  test('semi-auto: holding fire shoots once', () => {
    expect(run(ready(), 60, () => Button.Fire)).toBe(1)
  })

  test('spam-clicking is capped by the fire rate (0.15 s)', () => {
    const shots = run(ready(), 60, clickEvery(2)) // clicking 30×/s for 1 s
    expect(shots).toBeGreaterThanOrEqual(6)
    expect(shots).toBeLessThanOrEqual(7)
  })

  test('a click just before the gun is ready still fires (input buffer)', () => {
    const w = ready()
    run(w, 1, () => Button.Fire)
    // Click 3 ticks before the cooldown ends, release, and see it fire on its own.
    const shots = run(w, 20, (t) => (t === 5 ? Button.Fire : 0))
    expect(shots).toBe(1)
  })

  test('empties the magazine, then reloads from reserve on the next click', () => {
    const w = ready()
    expect(run(w, handgun.magSize * 10, clickEvery(10))).toBe(handgun.magSize)
    expect(w.ammo).toBe(0)
    run(w, 1, () => Button.Fire)
    expect(w.reload).toBeCloseTo(handgun.emptyReloadTime, 1)
    run(w, Math.ceil(handgun.emptyReloadTime / TICK_DT) + 1, () => 0)
    expect(w.ammo).toBe(handgun.magSize)
    expect(w.reserve).toBe(handgun.reserve - handgun.magSize)
  })

  test('R reloads a partly empty mag (faster tactical reload) and blocks firing meanwhile', () => {
    const w = ready()
    run(w, 30, clickEvery(10))
    const ammoBefore = w.ammo
    run(w, 1, () => Button.Reload)
    expect(w.reload).toBeCloseTo(handgun.reloadTime, 1)
    expect(run(w, 30, clickEvery(5))).toBe(0)
    run(w, 120, () => 0)
    expect(w.ammo).toBe(handgun.magSize)
    expect(w.reserve).toBe(handgun.reserve - (handgun.magSize - ammoBefore))
  })

  test('cannot fire while sprinting or right after', () => {
    const w = ready()
    const sprint = { ...STILL, sprinting: true, speedFactor: 1.35 }
    expect(run(w, 30, clickEvery(10), sprint)).toBe(0)
    // Stops sprinting: first shot only after sprintToFire.
    expect(run(w, 1, () => Button.Fire)).toBe(0)
    expect(run(w, 20, () => 0)).toBe(0)
    expect(run(w, 1, () => Button.Fire)).toBe(1)
  })

  test('spread is deterministic per seed and stays inside the cone', () => {
    const offsets = (seed: number) => {
      const w = createWeaponState(WeaponId.Handgun, seed)
      w.draw = 0
      const out: number[] = []
      let prev = 0
      for (let t = 0; t < 400 && out.length < 20; t++) {
        const b = t % 10 === 0 ? Button.Fire : 0
        const e = stepWeapon(w, b, b & ~prev, TICK_DT, STILL)
        prev = b
        if (e.shot) out.push(Math.hypot(e.shot.yawOffset, e.shot.pitchOffset))
        if (w.ammo === 0) w.ammo = 12
      }
      return out
    }
    expect(offsets(7)).toEqual(offsets(7))
    expect(offsets(7)).not.toEqual(offsets(8))
    const maxRad = (handgun.hipSpread * Math.PI) / 180
    for (const r of offsets(7)) expect(r).toBeLessThanOrEqual(maxRad + 1e-9)
  })

  test('damage falls off between 15 and 30 m', () => {
    expect(damageAtDistance(handgun, 5)).toBe(26)
    expect(damageAtDistance(handgun, 22.5)).toBeCloseTo(22)
    expect(damageAtDistance(handgun, 100)).toBe(18)
  })
})

describe('hitboxes', () => {
  const target: HitPose = { x: 0, y: 0, z: -10, yaw: 0, crouch: 0 }
  /** Shoot horizontally from 10 m away at a given height. */
  const shootAt = (height: number, pose = target, x = 0) =>
    raycastPose({ x, y: height, z: 0 }, { x: 0, y: 0, z: -1 }, 100, pose)?.zone ?? HitZone.None

  test('zones by height', () => {
    expect(shootAt(1.68)).toBe(HitZone.Head)
    expect(shootAt(1.3)).toBe(HitZone.Chest)
    expect(shootAt(0.95)).toBe(HitZone.Stomach)
    expect(shootAt(0.4, target, 0.1)).toBe(HitZone.Leg)
    // Arms hold the gun out in front: from the front, the right arm covers the right of the chest.
    const fromFront = raycastPose({ x: 0.2, y: 1.3, z: -20 }, { x: 0, y: 0, z: 1 }, 100, target)
    expect(fromFront?.zone).toBe(HitZone.Arm)
    expect(shootAt(1.9)).toBe(HitZone.None)
    expect(shootAt(1.3, target, 0.6)).toBe(HitZone.None)
  })

  test('crouching lowers the head', () => {
    const crouched = { ...target, crouch: 1 }
    expect(shootAt(1.68, crouched)).toBe(HitZone.None)
    expect(shootAt(1.12, crouched)).toBe(HitZone.Head)
  })

  test('works from any side and respects max distance', () => {
    const side = raycastPose({ x: 10, y: 1.3, z: -10 }, { x: -1, y: 0, z: 0 }, 100, {
      ...target,
      yaw: 0.7,
    })
    expect(side?.zone).toBe(HitZone.Chest)
    expect(side?.distance).toBeGreaterThan(9.5)
    expect(raycastPose({ x: 0, y: 1.3, z: 0 }, { x: 0, y: 0, z: -1 }, 5, target)).toBeNull()
  })

  test('a shot grazing the head from above-front counts as the head', () => {
    const dir = viewDirection(0, -Math.atan2(0.3, 10))
    expect(raycastPose({ x: 0, y: 1.98, z: 0 }, dir, 100, target)?.zone).toBe(HitZone.Head)
  })
})

describe('animated hitboxes', () => {
  const base: HitPose = { x: 0, y: 0, z: -10, yaw: Math.PI, crouch: 0 } // facing the shooter
  const zoneAt = (pose: HitPose, x: number, y: number) =>
    raycastPose({ x, y, z: 0 }, { x: 0, y: 0, z: -1 }, 100, pose)?.zone ?? HitZone.None

  test('a running leg swings: the hitbox moves with it', () => {
    // Shoot just in front of the standing legs: nothing there while standing…
    const low = (pose: HitPose) =>
      raycastPose({ x: 0.11, y: 0.5, z: -10.4 }, { x: 0, y: 0, z: 1 }, 0.25, pose)?.zone ??
      HitZone.None
    expect(low(base)).toBe(HitZone.None)
    // …but mid-stride, one knee is out front.
    const striding = [0.25, 0.75].map((stride) => low({ ...base, stride, speed: 6.5 }))
    expect(striding).toContain(HitZone.Leg)
  })

  test('aiming down tilts the head: a shot just over it misses standing, hits looking up', () => {
    expect(zoneAt(base, 0, 1.86)).toBe(HitZone.None)
    expect(zoneAt({ ...base, pitch: 0.6 }, 0, 1.86)).not.toBe(HitZone.Chest)
  })

  test('crouching lowers everything and bends the knees (feet stay on the floor)', () => {
    const crouched = { ...base, crouch: 1 }
    expect(zoneAt(crouched, 0, 1.6)).toBe(HitZone.None)
    expect(zoneAt(crouched, 0.11, 0.1)).toBe(HitZone.Leg)
  })
})
