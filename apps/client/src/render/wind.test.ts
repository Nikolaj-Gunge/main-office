import { describe, expect, test } from 'bun:test'
import { loadMap, MAPS, type MapLight } from '@office-fps/shared'
import * as THREE from 'three'
import { gustAt, hangingLightPos, lampSwing } from './wind.ts'

describe('wind', () => {
  test('gusts stay between calm and full', () => {
    for (let t = 0; t < 600; t += 0.37) {
      const g = gustAt(t)
      expect(g).toBeGreaterThanOrEqual(0)
      expect(g).toBeLessThanOrEqual(1)
    }
  })

  test('lamps swing a little indoors and more in the wind, never wildly', () => {
    const e = new THREE.Euler()
    let indoors = 0
    let outdoors = 0
    for (let t = 0; t < 120; t += 0.1) {
      lampSwing(3, 0.6, t, false, e)
      indoors = Math.max(indoors, Math.abs(e.x), Math.abs(e.z))
      lampSwing(3, 0.6, t, true, e)
      outdoors = Math.max(outdoors, Math.abs(e.x), Math.abs(e.z))
    }
    expect(indoors).toBeGreaterThan(0.01)
    expect(indoors).toBeLessThan(0.06)
    expect(outdoors).toBeGreaterThan(indoors)
    expect(outdoors).toBeLessThan(0.5)
  })

  test('a hanging light stays on its cord', () => {
    const light: MapLight = {
      kind: 'point',
      pos: [1, 2, 3],
      color: 0,
      intensity: 1,
      distance: 5,
      hang: 0.8,
    }
    const p = new THREE.Vector3()
    for (const t of [0, 1.3, 7.9]) {
      hangingLightPos(light, 2, t, true, p)
      expect(p.distanceTo(new THREE.Vector3(1, 2.8, 3))).toBeCloseTo(0.8, 5)
    }
  })
})

describe('hanging lamps in the maps', () => {
  test('every swinging box hangs from a light on a cord', () => {
    let lamps = 0
    for (const id of Object.keys(MAPS)) {
      const map = loadMap(id)
      for (const box of map.boxes) {
        if (box.swing === undefined) continue
        lamps++
        expect(box.collide).toBe(false)
        expect(map.lights?.[box.swing]?.hang).toBeGreaterThan(0)
      }
    }
    expect(lamps).toBeGreaterThan(0)
  })
})
