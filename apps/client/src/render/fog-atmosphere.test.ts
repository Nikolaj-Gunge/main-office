import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import {
  Atmosphere,
  FOG_TIERS,
  fogDensity,
  MAX_DENSITY,
  mistLine,
  nearLakes,
} from './fog-atmosphere.ts'

const calm = { cloud: 0, rain: 0, fog: 0 }

describe('mist tiers', () => {
  test('low draws nothing, medium mist and halos, high the full march with shafts', () => {
    expect(FOG_TIERS.low.mode).toBe('off')
    expect(FOG_TIERS.low.steps).toBe(0)
    expect(FOG_TIERS.medium.mode).toBe('height')
    expect(FOG_TIERS.medium.shafts).toBe(false)
    expect(FOG_TIERS.high.mode).toBe('full')
    expect(FOG_TIERS.high.shafts).toBe(true)
    expect(FOG_TIERS.high.steps).toBeGreaterThan(FOG_TIERS.medium.steps)
    // Never finer than the game's own pixels.
    for (const t of Object.values(FOG_TIERS)) expect(t.scale).toBeGreaterThanOrEqual(1)
  })
})

describe('mist density', () => {
  test('thicker at night than by day', () => {
    expect(fogDensity(calm, 0, 0)).toBeGreaterThan(fogDensity(calm, 0, 1))
    expect(fogDensity(calm, 0, 1)).toBeGreaterThan(0)
  })

  test('fog weather, rain and Fog Night thicken it', () => {
    const night = fogDensity(calm, 0, 0)
    expect(fogDensity({ ...calm, fog: 1 }, 0, 0)).toBeGreaterThan(night)
    expect(fogDensity({ ...calm, rain: 1 }, 0, 0)).toBeGreaterThan(night)
    expect(fogDensity(calm, 0.6, 0)).toBeGreaterThan(night)
    // The Rot's mood only counts after dark.
    expect(fogDensity(calm, 0.6, 1)).toBeCloseTo(fogDensity(calm, 0, 1))
  })

  test('never past the cap', () => {
    expect(fogDensity({ cloud: 1, rain: 1, fog: 1 }, 1, 0)).toBe(MAX_DENSITY)
  })
})

describe('where the mist lies', () => {
  test('the mist line follows the land around you', () => {
    expect(mistLine(() => 10, 0, 0)).toBeCloseTo(8.5)
    // In a hollow (low here, high around): the line sits above your feet.
    const bowl = (x: number, z: number) => Math.hypot(x, z) * 0.2
    expect(mistLine(bowl, 0, 0)).toBeGreaterThan(bowl(0, 0))
  })

  test('nearest lakes first, far ones left out', () => {
    const lakes = [
      { x: 1000, z: 0, r: 50, y: 0 },
      { x: 100, z: 0, r: 50, y: 0 },
      { x: 5000, z: 0, r: 50, y: 0 },
    ]
    expect(nearLakes(lakes, 0, 0).map((l) => l.x)).toEqual([100])
    expect(nearLakes(lakes, 0, 0, 2, 2000).map((l) => l.x)).toEqual([100, 1000])
  })
})

describe('Atmosphere', () => {
  const moon = new THREE.DirectionalLight(0xffffff, 1)
  const inputs = (mood: number) => ({
    weather: calm,
    mood,
    day: 0,
    fogColor: new THREE.Color(0.01, 0.01, 0.02),
    fogFar: 78,
    lamps: [],
    torch: null,
    moon,
  })

  test('stays idle when the tier is off', () => {
    const a = new Atmosphere(() => 0, [])
    a.update(0.016, new THREE.Vector3(), inputs(0))
    expect(a.frame.density).toBe(0)
  })

  test('Fog Night thickens the frame', () => {
    const a = new Atmosphere(() => 0, [])
    a.setTier('high')
    a.update(0.016, new THREE.Vector3(), inputs(0))
    const plain = a.frame.density
    a.update(0.016, new THREE.Vector3(), inputs(0.6))
    expect(a.frame.density).toBeGreaterThan(plain)
    expect(a.frame.base).toBeCloseTo(-1.5)
  })

  test('mist over water glows a little at night, even under full cloud, not by day', () => {
    const a = new Atmosphere(() => 0, [])
    a.setTier('medium')
    a.update(0.016, new THREE.Vector3(), { ...inputs(0), weather: { cloud: 1, rain: 0, fog: 0 } })
    expect(a.frame.lakeGlow.b).toBeGreaterThan(0.01)
    a.update(0.016, new THREE.Vector3(), { ...inputs(0), day: 1 })
    expect(a.frame.lakeGlow.b).toBe(0)
  })
})
