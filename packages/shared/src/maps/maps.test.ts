import { describe, expect, test } from 'bun:test'
import { loadMap, MAPS, MATERIALS } from './index.ts'

for (const id of Object.keys(MAPS)) {
  describe(`map "${id}"`, () => {
    const map = loadMap(id)

    test('has spawns', () => {
      expect(map.spawns.length).toBeGreaterThan(0)
    })

    test('boxes have positive size and known materials', () => {
      for (const box of map.boxes) {
        for (const s of box.size) expect(s).toBeGreaterThan(0)
        expect(MATERIALS).toContain(box.material)
      }
    })

    test('spawns are not inside any unrotated box', () => {
      for (const { pos } of map.spawns) {
        const head = [pos[0], pos[1] + 1.0, pos[2]]
        for (const box of map.boxes) {
          if (box.rotation) continue
          const inside = head.every(
            (v, i) => Math.abs(v - (box.center[i] ?? 0)) < (box.size[i] ?? 0) / 2,
          )
          expect(inside).toBe(false)
        }
      }
    })
  })
}

test('unknown map throws', () => {
  expect(() => loadMap('nope')).toThrow()
})
