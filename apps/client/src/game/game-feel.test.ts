import { describe, expect, test } from 'bun:test'
import { ITEMS } from '@office-fps/shared'
import {
  casingCap,
  flinchCurve,
  footstepTone,
  hitStopSeconds,
  pickupPitch,
  SprintKick,
  stepSurface,
  traumaAt,
} from './game-feel.ts'
import { ScreenShake } from './screen-shake.ts'

/** Biggest rotation the shake produces over `seconds` (sampled at 200 Hz). */
function peak(shake: ScreenShake, seconds: number): number {
  let max = 0
  for (let t = 0; t < seconds; t += 0.005) {
    const s = shake.update(0.005)
    max = Math.max(max, Math.abs(s.pitch), Math.abs(s.yaw), Math.abs(s.roll))
  }
  return max
}

describe('screen shake', () => {
  test('the setting scales it, and 0 turns it off', () => {
    const full = new ScreenShake(() => 0.3)
    const half = new ScreenShake(() => 0.3)
    const off = new ScreenShake(() => 0.3)
    half.scale = 0.5
    off.scale = 0
    for (const s of [full, half, off]) s.add(0.8)
    const a = peak(full, 0.3)
    expect(peak(half, 0.3)).toBeCloseTo(a / 2, 6)
    expect(peak(off, 0.3)).toBe(0)
  })

  test('a full jolt is gone in about two thirds of a second', () => {
    const shake = new ScreenShake()
    shake.add(1)
    shake.update(0.6)
    expect(shake.level).toBeGreaterThan(0)
    shake.update(0.1)
    expect(shake.level).toBe(0)
  })

  test('trauma never goes above 1', () => {
    const shake = new ScreenShake()
    for (let i = 0; i < 10; i++) shake.add(0.5)
    expect(shake.level).toBe(1)
  })

  test('rumbles fall off with distance and stop at the radius', () => {
    expect(traumaAt(0.6, 0, 40)).toBeCloseTo(0.6)
    expect(traumaAt(0.6, 20, 40)).toBeCloseTo(0.15)
    expect(traumaAt(0.6, 40, 40)).toBe(0)
    expect(traumaAt(0.6, 400, 40)).toBe(0)
  })
})

describe('melee hit-stop', () => {
  test('40 ms for a knife, 80 ms for a sledge, never outside that', () => {
    expect(hitStopSeconds(0.08)).toBeCloseTo(0.04)
    expect(hitStopSeconds(0.8)).toBeCloseTo(0.08)
    expect(hitStopSeconds(0.35)).toBeGreaterThan(0.04)
    expect(hitStopSeconds(0.35)).toBeLessThan(0.08)
    expect(hitStopSeconds(0)).toBeCloseTo(0.04)
    expect(hitStopSeconds(5)).toBeCloseTo(0.08)
  })
})

describe('sprint FOV kick', () => {
  test('eases in, settles at full, and eases back out to exactly zero', () => {
    const kick = new SprintKick()
    expect(kick.update(1 / 60, true)).toBeLessThan(0.2)
    for (let i = 0; i < 120; i++) kick.update(1 / 60, true)
    expect(kick.value).toBe(1)
    for (let i = 0; i < 120; i++) kick.update(1 / 60, false)
    expect(kick.value).toBe(0)
  })

  test('frame rate does not change how fast it comes in', () => {
    const at = (dt: number) => {
      const kick = new SprintKick()
      for (let i = 0; i < Math.round(0.5 / dt); i++) kick.update(dt, true)
      return kick.value
    }
    expect(at(1 / 30)).toBeCloseTo(at(1 / 240), 3)
  })
})

describe('casings', () => {
  test('fewer lie about on coarser quality steps', () => {
    expect(casingCap(0)).toBeGreaterThan(casingCap(1))
    expect(casingCap(1)).toBeGreaterThan(casingCap(2))
    expect(casingCap(5)).toBe(casingCap(2))
  })
})

describe('footsteps', () => {
  test('no terrain (the office, a cabin floor) sounds like a floor', () => {
    expect(stepSurface(null, 0, 0, 0)).toBe('floor')
  })

  test('every surface has its own sound', () => {
    const tones = (['floor', 'leaves', 'grass', 'dirt', 'sand', 'rock'] as const).map((s) =>
      JSON.stringify(footstepTone(s)),
    )
    expect(new Set(tones).size).toBe(tones.length)
  })
})

describe('pickup pitch', () => {
  const items = Object.values(ITEMS)
    .filter((d) => d.value > 0)
    .sort((a, b) => a.value - b.value)
  const cheap = items[0]
  const dear = items[items.length - 1]

  test('the more it is worth, the lower it lands', () => {
    expect(pickupPitch('+ $5')).toBeGreaterThan(pickupPitch('+ $50'))
    expect(pickupPitch('+ $50')).toBeGreaterThan(pickupPitch('+ $500'))
    if (cheap && dear)
      expect(pickupPitch(`+ ${cheap.name}`)).toBeGreaterThan(pickupPitch(`+ ${dear.name}`))
  })

  test('stays within a gentle range; unknown things sound ordinary', () => {
    for (const text of ['+ $0', '+ $1', '+ $99999', '+ Something odd ×3']) {
      expect(pickupPitch(text)).toBeGreaterThanOrEqual(0.78)
      expect(pickupPitch(text)).toBeLessThanOrEqual(1.22)
    }
    expect(pickupPitch('+ Something odd')).toBe(1)
  })
})

describe('hit flinch', () => {
  test('snaps in fast and is over within a quarter second', () => {
    expect(flinchCurve(-5)).toBe(0)
    expect(flinchCurve(40)).toBe(1)
    expect(flinchCurve(20)).toBeCloseTo(0.5)
    expect(flinchCurve(150)).toBeLessThan(0.25)
    expect(flinchCurve(400)).toBe(0)
  })
})
