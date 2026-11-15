import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import {
  decimate,
  paintForestFloor,
  paintSheetMetal,
  planarUVs,
  quantizePalette,
} from './pixel-textures.ts'

const shades = (data: Uint8Array | Uint8ClampedArray) => {
  const set = new Set<string>()
  for (let i = 0; i < data.length; i += 4) set.add(`${data[i]},${data[i + 1]},${data[i + 2]}`)
  return set
}

describe('pixel textures', () => {
  test('painters are deterministic and seed-dependent', () => {
    expect(paintForestFloor(96, 6, 7)).toEqual(paintForestFloor(96, 6, 7))
    expect(paintForestFloor(96, 6, 7)).not.toEqual(paintForestFloor(96, 6, 8))
    expect(paintSheetMetal(32, 3)).toEqual(paintSheetMetal(32, 3))
  })

  test('painters stay palette-limited at any density', () => {
    for (const size of [96, 192])
      expect(shades(paintForestFloor(size, 6, 1)).size).toBeLessThanOrEqual(5)
    expect(shades(paintSheetMetal(32, 1)).size).toBeLessThanOrEqual(5)
  })

  test('quantizePalette snaps to at most N shades, deterministically', () => {
    const noisy = () => {
      const d = new Uint8ClampedArray(32 * 32 * 4)
      let s = 1
      for (let i = 0; i < d.length; i++) {
        s = (s * 1103515245 + 12345) & 0x7fffffff
        d[i] = i % 4 === 3 ? 255 : s & 255
      }
      return d
    }
    const a = noisy()
    const b = noisy()
    const palette = quantizePalette(a, 8)
    quantizePalette(b, 8)
    expect(palette.length).toBe(8)
    expect(shades(a).size).toBeLessThanOrEqual(8)
    expect(a).toEqual(b)
  })

  test('quantizePalette leaves an already flat image alone', () => {
    const d = new Uint8ClampedArray(16 * 4).fill(100)
    expect(quantizePalette(d, 8)).toEqual([[100, 100, 100]])
    expect([...d].every((v) => v === 100)).toBe(true)
  })

  test('decimate keeps every n-th texel', () => {
    const size = 4
    const d = new Uint8ClampedArray(size * size * 4)
    for (let i = 0; i < size * size; i++) d[i * 4] = i
    const half = decimate(d, size, 2)
    expect(half.length).toBe(2 * 2 * 4)
    expect([half[0], half[4], half[8], half[12]]).toEqual([0, 2, 8, 10])
  })

  test('planarUVs are in metres, whatever the box size', () => {
    for (const [w, h, d] of [
      [1, 1, 1],
      [4, 0.5, 2],
    ] as const) {
      const g = new THREE.BoxGeometry(w, h, d)
      planarUVs(g)
      const uv = g.getAttribute('uv')
      const n = g.getAttribute('normal')
      const pos = g.getAttribute('position')
      for (let i = 0; i < uv.count; i++) {
        const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)]
        const up = Math.abs(n.getY(i)) > 0.5
        const side = Math.abs(n.getX(i)) > 0.5
        expect([uv.getX(i), uv.getY(i)]).toEqual(up ? [x, z] : side ? [z, y] : [x, y])
      }
      // Top face spans exactly the box's width in u: one texel per 1/32 m on any box.
      const us: number[] = []
      for (let i = 0; i < uv.count; i++) if (n.getY(i) > 0.5) us.push(uv.getX(i))
      expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(w)
    }
  })

  test('planarUVs adds a uv attribute when there is none', () => {
    const g = new THREE.BoxGeometry(2, 2, 2)
    g.deleteAttribute('uv')
    planarUVs(g)
    expect(g.getAttribute('uv').count).toBe(g.getAttribute('position').count)
  })
})
