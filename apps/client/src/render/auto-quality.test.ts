import { describe, expect, test } from 'bun:test'
import { AutoQuality } from './auto-quality.ts'

const run = (q: AutoQuality, seconds: number, frameMs: number) => {
  let changed = 0
  for (let t = 0; t < seconds; t += frameMs / 1000) if (q.frame(frameMs / 1000)) changed++
  return changed
}

describe('automatic quality', () => {
  test('goes coarser when frames are slow, one step at a time, up to the limit', () => {
    const q = new AutoQuality(2)
    run(q, 2, 30)
    expect(q.bias).toBe(1)
    run(q, 2, 30)
    expect(q.bias).toBe(1)
    run(q, 3, 30)
    expect(q.bias).toBe(2)
    run(q, 30, 40)
    expect(q.bias).toBe(2)
  })

  test('comes back finer after a long calm spell at 60 fps', () => {
    const q = new AutoQuality(2)
    run(q, 2, 30)
    expect(q.bias).toBe(1)
    run(q, 30, 16.7)
    expect(q.bias).toBe(0)
  })

  test('a finer step that fails at once is not retried for a minute', () => {
    const q = new AutoQuality(2)
    run(q, 2, 30)
    run(q, 30, 16.7)
    expect(q.bias).toBe(0)
    run(q, 2, 30)
    expect(q.bias).toBe(1)
    run(q, 40, 16.7)
    expect(q.bias).toBe(1)
    run(q, 60, 16.7)
    expect(q.bias).toBe(0)
  })

  test('stalls (a hidden tab) count for nothing', () => {
    const q = new AutoQuality(2)
    for (let i = 0; i < 20; i++) q.frame(0.25)
    expect(q.bias).toBe(0)
  })
})
