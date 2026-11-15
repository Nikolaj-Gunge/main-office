import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import {
  allowCascades,
  cascadeReaches,
  cascadeShaderInstalled,
  cascadeStep,
  snapToTexel,
} from './cascades.ts'
import { TIER_SETTINGS } from './device-tier.ts'

describe('cascaded shadows', () => {
  test('tiers: Low one map as before, Medium two, High three, nearest first', () => {
    expect(TIER_SETTINGS.low.shadowCascades).toEqual([TIER_SETTINGS.low.shadowReach])
    expect(TIER_SETTINGS.medium.shadowCascades.length).toBe(2)
    expect(TIER_SETTINGS.high.shadowCascades.length).toBe(3)
    for (const t of Object.values(TIER_SETTINGS)) {
      const r = t.shadowCascades
      for (let i = 1; i < r.length; i++) expect(r[i] ?? 0).toBeGreaterThan(r[i - 1] ?? 0)
    }
    expect(TIER_SETTINGS.low.ao).toBe(0)
    expect(TIER_SETTINGS.medium.ao).toBeGreaterThan(0)
    expect(TIER_SETTINGS.high.ao).toBeGreaterThanOrEqual(TIER_SETTINGS.medium.ao)
  })

  test('one map unless both the renderer and the shader patch allow more', () => {
    const high = TIER_SETTINGS.high
    cascadeShaderInstalled(false)
    allowCascades(true)
    expect(cascadeReaches(high.shadowCascades, high.shadowReach)).toEqual([22])
    cascadeShaderInstalled(true)
    expect(cascadeReaches(high.shadowCascades, high.shadowReach)).toEqual([22, 80, 240])
    allowCascades(false)
    expect(cascadeReaches(high.shadowCascades, high.shadowReach)).toEqual([22])
    allowCascades(true)
  })

  test('near cascades redraw sooner; a single map keeps its 20 m', () => {
    expect(cascadeStep(50, 1)).toBe(20)
    expect(cascadeStep(22, 3)).toBeLessThan(cascadeStep(240, 3))
    expect(cascadeStep(10, 2)).toBe(5)
  })

  test('snapping lands on the texel grid across the light and keeps depth along it', () => {
    const dir = new THREE.Vector3(0.3, 0.8, 0.2).normalize()
    const texel = 0.25
    const at = new THREE.Vector3(103.37, 4.2, -55.91)
    const out = snapToTexel(at, dir, texel, new THREE.Vector3())
    expect(out.dot(dir)).toBeCloseTo(at.dot(dir), 6)
    expect(out.distanceTo(at)).toBeLessThan(texel)
    // Moving a fraction of a texel snaps to the same spot.
    const nudged = snapToTexel(at.clone().addScalar(0.01), dir, texel, new THREE.Vector3())
    const off = nudged.clone().sub(out)
    expect(off.length() - Math.abs(off.dot(dir))).toBeLessThan(1e-6)
  })
})
