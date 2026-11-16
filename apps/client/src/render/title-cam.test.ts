import { describe, expect, test } from 'bun:test'
import { EXIT_S, TitleExit, titlePose } from './title-cam.ts'

const flat = () => 10

describe('title camera', () => {
  test('stays above the ground, near the middle, looking at it', () => {
    for (let t = 0; t < 400; t += 7) {
      const p = titlePose(t, { x: 5, z: -3 }, flat, false)
      expect(p.y).toBeGreaterThan(11.5)
      const d = Math.hypot(p.x - 5, p.z + 3)
      expect(d).toBeGreaterThan(12)
      expect(d).toBeLessThan(22)
      expect(Math.hypot(p.lx - 5, p.lz + 3)).toBeLessThan(4)
    }
  })

  test('still holds the opening shot', () => {
    expect(titlePose(123, { x: 0, z: 0 }, flat, true)).toEqual(
      titlePose(0, { x: 0, z: 0 }, flat, true),
    )
  })

  test('moves slowly', () => {
    const a = titlePose(10, { x: 0, z: 0 }, flat, false)
    const b = titlePose(10.1, { x: 0, z: 0 }, flat, false)
    expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(0.1)
  })
})

describe('TitleExit', () => {
  const at = (x: number) => ({ x, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 })
  test('glides from the title pose to the player, then lets go', () => {
    const exit = new TitleExit()
    exit.hold(at(10), false)
    expect(exit.blend(at(0), 1000)?.x).toBe(10)
    const mid = exit.blend(at(0), 1000 + EXIT_S * 500)?.x ?? -1
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(10)
    expect(exit.blend(at(0), 1000 + EXIT_S * 1000)).toBeNull()
    expect(exit.blend(at(0), 5000)).toBeNull()
  })
  test('skipped on low tier / reduced motion', () => {
    const exit = new TitleExit()
    exit.hold(at(10), true)
    expect(exit.blend(at(0), 0)).toBeNull()
  })
})
