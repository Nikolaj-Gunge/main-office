import { describe, expect, test } from 'bun:test'
import { WEAPONS, WeaponId } from '@office-fps/shared'
import { Recoil } from './recoil.ts'
import { ScreenShake } from './screen-shake.ts'

const handgun = WEAPONS[WeaponId.Handgun]
const DEG = Math.PI / 180

function simulate(recoil: Recoil, seconds: number, dt = 1 / 144) {
  let pitch = 0
  let yaw = 0
  let peak = 0
  for (let t = 0; t < seconds; t += dt) {
    const d = recoil.update(dt)
    pitch += d.pitch
    yaw += d.yaw
    peak = Math.max(peak, pitch)
  }
  return { pitch, yaw, peak }
}

describe('Recoil', () => {
  test('kicks the view up by about the weapon kick, then returns to where you aimed', () => {
    const recoil = new Recoil(() => 0.5)
    recoil.kick(handgun, false)
    const r = simulate(recoil, 1.5)
    expect(r.peak).toBeGreaterThan(handgun.kickPitch * DEG * 0.85)
    expect(r.peak).toBeLessThanOrEqual(handgun.kickPitch * DEG + 1e-9)
    expect(Math.abs(r.pitch)).toBeLessThan(0.01 * DEG)
    expect(Math.abs(r.yaw)).toBeLessThan(0.01 * DEG)
  })

  test('frame rate does not change the result', () => {
    const at = (dt: number) => {
      const recoil = new Recoil(() => 1)
      recoil.kick(handgun, false)
      return simulate(recoil, 0.1, dt).pitch
    }
    expect(at(1 / 30)).toBeCloseTo(at(1 / 240), 2)
  })

  test('aiming down sights kicks less', () => {
    const hip = new Recoil(() => 0.5)
    const ads = new Recoil(() => 0.5)
    hip.kick(handgun, false)
    ads.kick(handgun, true)
    expect(simulate(ads, 0.2).peak).toBeLessThan(simulate(hip, 0.2).peak)
  })
})

describe('ScreenShake', () => {
  test('fades out completely and scales with trauma squared', () => {
    const shake = new ScreenShake()
    shake.add(0.5)
    let maxSmall = 0
    for (let i = 0; i < 20; i++) maxSmall = Math.max(maxSmall, Math.abs(shake.update(0.005).pitch))
    for (let i = 0; i < 200; i++) shake.update(0.01)
    const after = shake.update(0.01)
    expect(Math.abs(after.pitch) + Math.abs(after.yaw) + Math.abs(after.roll)).toBe(0)
    const big = new ScreenShake()
    big.add(1)
    let maxBig = 0
    for (let i = 0; i < 20; i++) maxBig = Math.max(maxBig, Math.abs(big.update(0.005).pitch))
    expect(maxBig).toBeGreaterThan(maxSmall * 2)
  })
})
