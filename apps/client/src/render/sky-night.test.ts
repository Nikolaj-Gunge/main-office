import { describe, expect, test } from 'bun:test'
import { DAWN, NIGHTFALL } from '@office-fps/shared'
import * as THREE from 'three'
import {
  applyGrade,
  colourScript,
  MOON_CYCLE,
  moonDirection,
  moonLit,
  moonPhase,
  nightProgress,
  nightSkyUniforms,
  updateNightSky,
} from './sky-night.ts'
import { TORCH_SHADOW } from './torch-shadow.ts'

describe('the moon', () => {
  test('goes round its phases every MOON_CYCLE nights', () => {
    const phases = Array.from({ length: MOON_CYCLE }, (_, d) => moonPhase(d))
    expect(new Set(phases).size).toBe(MOON_CYCLE)
    expect(moonPhase(MOON_CYCLE + 3)).toBe(moonPhase(3))
    for (const p of phases) expect(p).toBeGreaterThanOrEqual(0)
    for (const p of phases) expect(p).toBeLessThan(1)
  })

  test('is dark when new and lit when full', () => {
    expect(moonLit(0)).toBeCloseTo(0)
    expect(moonLit(0.5)).toBeCloseTo(1)
    expect(moonLit(0.25)).toBeCloseTo(0.5)
  })

  test('rises in the east, is highest mid-night and sets in the west, never low', () => {
    const v = new THREE.Vector3()
    expect(nightProgress(NIGHTFALL)).toBeCloseTo(0)
    expect(nightProgress(DAWN)).toBeCloseTo(1)
    const rise = moonDirection(NIGHTFALL + 0.001, v).clone()
    const mid = moonDirection((NIGHTFALL + 1 + DAWN) / 2, v).clone()
    const set = moonDirection(DAWN - 0.001, v).clone()
    expect(rise.x).toBeGreaterThan(0)
    expect(set.x).toBeLessThan(0)
    expect(mid.y).toBeGreaterThan(rise.y)
    for (const d of [rise, mid, set]) {
      expect(d.length()).toBeCloseTo(1)
      expect(Math.asin(d.y)).toBeGreaterThan(0.65)
    }
  })
})

describe('colour script', () => {
  test('leaves full day alone and tints the night', () => {
    expect(colourScript(0.7).k).toBe(0)
    expect(colourScript(0.1).k).toBeGreaterThan(0.2)
    expect(colourScript(0.92).k).toBeGreaterThan(0.1)
  })

  test('night is blue, dusk and dawn warm, the hour before dawn grey', () => {
    const night = colourScript(0.1).tint
    expect(night.b).toBeGreaterThan(night.r)
    const dusk = colourScript(0.925).tint
    expect(dusk.r).toBeGreaterThan(dusk.b)
    const dawn = colourScript(DAWN + 0.045).tint
    expect(dawn.r).toBeGreaterThan(dawn.b)
    const grey = colourScript(0.34).tint
    expect(Math.abs(grey.r - grey.b)).toBeLessThan(0.1)
  })

  test('moves the hue, not the brightness, at a gain of 1', () => {
    const c = new THREE.Color(0.1, 0.1, 0.1)
    const g = colourScript(0.1)
    const lum = (x: THREE.Color) => 0.2126 * x.r + 0.7152 * x.g + 0.0722 * x.b
    const before = lum(c)
    applyGrade(c, { ...g, gain: 1 }, 1)
    expect(lum(c)).toBeCloseTo(before, 5)
    expect(c.b).toBeGreaterThan(c.r)
  })
})

describe('night sky', () => {
  test('stars and moon come out at night and hide under cloud and fog, and by day', () => {
    const u = nightSkyUniforms()
    updateNightSky(u, 0.1, 0, 0, { cloud: 0, fog: 0 })
    expect(u.starAlpha.value).toBeGreaterThan(0.9)
    expect(u.moonAlpha.value).toBeGreaterThan(0.9)
    updateNightSky(u, 0.1, 0, 0, { cloud: 1, fog: 0 })
    expect(u.starAlpha.value).toBe(0)
    expect(u.moonAlpha.value).toBeLessThan(0.3)
    updateNightSky(u, 0.1, 0, 0, { cloud: 0, fog: 1 })
    expect(u.starAlpha.value).toBe(0)
    expect(u.moonAlpha.value).toBe(0)
    updateNightSky(u, 0.7, 1, 0, { cloud: 0, fog: 0 })
    expect(u.starAlpha.value).toBe(0)
    expect(u.moonAlpha.value).toBe(0)
  })
})

describe('torch shadow tiers', () => {
  test('Low has none; Medium and High a small map', () => {
    expect(TORCH_SHADOW.low).toBeNull()
    expect(TORCH_SHADOW.medium?.map).toBeLessThanOrEqual(512)
    expect(TORCH_SHADOW.high?.map).toBeLessThanOrEqual(512)
  })
})
