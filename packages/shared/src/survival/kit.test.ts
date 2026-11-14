import { describe, expect, test } from 'bun:test'
import { emptyBuild, type ShellOptions, Site } from './kit.ts'
import type { Poi } from './types.ts'

const poi: Poi = { key: 'test', kind: 'house', name: 'Test', x: 10, z: -4, y: 2, r: 10, danger: 0 }

function build(o: Partial<ShellOptions> = {}, turn = 0) {
  const b = emptyBuild()
  new Site(b, poi, 0, 0, 0, turn).shell(0, 0, {
    w: 8,
    d: 6,
    h: 2.8,
    wall: 'brick',
    roof: 'shingle',
    pitch: 1.4,
    doors: [{ side: 's', at: 0 }],
    windows: [
      { side: 'n', at: -2, glass: true },
      { side: 'e', at: 1 },
    ],
    ...o,
  })
  return b
}

describe('shell trim', () => {
  test('dresses a building without changing what collides', () => {
    for (const turn of [0, 1]) {
      const plain = build({ trim: false }, turn)
      const dressed = build({}, turn)
      expect(dressed.boxes.length).toBeGreaterThan(plain.boxes.length + 30)
      const solid = (boxes: typeof plain.boxes) =>
        boxes.filter((box) => box.collide !== false).map((box) => JSON.stringify(box))
      expect(solid(dressed.boxes)).toEqual(solid(plain.boxes))
      // Same doors, rooms and board spots too.
      expect(dressed.rooms).toEqual(plain.rooms)
      expect(dressed.spots).toEqual(plain.spots)
    }
  })

  test('frames stand proud of the wall but never block a doorway', () => {
    const b = build()
    const deco = b.boxes.filter((box) => box.collide === false)
    expect(deco.filter((box) => box.material === 'trim').length).toBeGreaterThan(10)
    // The south door is 1.4 m wide at x = 10 (world): nothing reaches into it below its head.
    const blocking = deco.filter((box) => {
      const [cx, cy, cz] = box.center
      const [sx, sy] = box.size
      const inDoorway = Math.abs(cx - 10) - sx / 2 < 0.7 - 1e-6
      const low = cy - sy / 2 < 2 + 0.12 + 2.2 - 1e-6 && cy + sy / 2 > 2 + 0.12 + 1e-6
      const atSouthWall = Math.abs(cz - (-4 + 3)) < 0.3
      return inDoorway && low && atSouthWall
    })
    expect(blocking).toEqual([])
  })

  test('walls that take no trim get none', () => {
    const glass = build({ wall: 'glass' })
    expect(glass.boxes.some((box) => box.material === 'trim')).toBe(false)
  })
})
