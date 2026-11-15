import { describe, expect, test } from 'bun:test'
import { CLIP_ROWS, clipMoment, clipSize, dropCount } from './clip-buffer.ts'
import { muxWebm, vintSize } from './webm.ts'

/** Frames every `step` µs, a keyframe every `keyEvery` frames. */
const frames = (n: number, step: number, keyEvery: number) =>
  Array.from({ length: n }, (_, i) => ({
    data: new Uint8Array([i]),
    timestamp: i * step,
    key: i % keyEvery === 0,
  }))

describe('clip ring', () => {
  test('keeps the window, starting on a keyframe', () => {
    // 30 s at 1 fps, a keyframe every 4 s, a 20 s window: the newest is at 29 s, so 9 s and
    // earlier may go; the last keyframe at or before 9 s is at 8 s.
    const ring = frames(30, 1e6, 4)
    const drop = dropCount(ring, 20e6)
    expect(drop).toBe(8)
    expect(ring[drop]?.key).toBe(true)
    expect(29 - (ring[drop]?.timestamp ?? 0) / 1e6).toBeGreaterThanOrEqual(20)
  })

  test('drops nothing while shorter than the window', () => {
    expect(dropCount(frames(10, 1e6, 2), 20e6)).toBe(0)
    expect(dropCount([], 20e6)).toBe(0)
  })

  test('never drops the only keyframe', () => {
    expect(dropCount(frames(40, 1e6, 100), 20e6)).toBe(0)
  })
})

describe('clip size', () => {
  test('shrinks to the clip rows, keeping the shape, even sides', () => {
    expect(clipSize(1600, 900)).toEqual({ width: 640, height: CLIP_ROWS })
    expect(clipSize(481, 271)).toEqual({ width: 482, height: 272 })
    expect(clipSize(1000, 1000).height).toBe(CLIP_ROWS)
  })
})

describe('clip moments', () => {
  test('alpha kills and a held Red Night', () => {
    expect(clipMoment({ kind: 'quest', text: 'Old Tom is dead. For now.' })).toBe('alpha')
    expect(
      clipMoment({ kind: 'quest', text: 'Mother is dead. Word will get round: Gus will have…' }),
    ).toBe('alpha')
    expect(clipMoment({ kind: 'story', text: 'Haven held.\n\nThe last of them…' })).toBe(
      'red-night',
    )
    expect(clipMoment({ kind: 'story', text: "They're inside." })).toBeNull()
    expect(clipMoment({ kind: 'info', text: 'Old Tom is dead. For now.' })).toBeNull()
  })
})

/** Reads one EBML element at `at`: its id, body start and body size. */
function readEl(b: Uint8Array, at: number): { id: number; body: number; size: number } {
  const first = b[at] ?? 0
  const idLen = Math.clz32(first) - 23
  let id = 0
  for (let i = 0; i < idLen; i++) id = id * 256 + (b[at + i] ?? 0)
  const s0 = b[at + idLen] ?? 0
  const sLen = Math.clz32(s0) - 23
  let size = s0 & (0xff >> sLen)
  for (let i = 1; i < sLen; i++) size = size * 256 + (b[at + idLen + i] ?? 0)
  return { id, body: at + idLen + sLen, size }
}

/** The ids of the elements directly inside [from, to). */
function children(b: Uint8Array, from: number, to: number) {
  const out: ReturnType<typeof readEl>[] = []
  for (let at = from; at < to; ) {
    const e = readEl(b, at)
    out.push(e)
    at = e.body + e.size
  }
  return out
}

describe('webm', () => {
  test('sizes are the shortest EBML form', () => {
    expect([...vintSize(0)]).toEqual([0x80])
    expect([...vintSize(126)]).toEqual([0xfe])
    expect([...vintSize(127)]).toEqual([0x40, 0x7f])
    expect([...vintSize(300)]).toEqual([0x41, 0x2c])
  })

  test('header, segment, a cluster per keyframe, blocks in order', () => {
    // 5 s at 10 fps, keyframes every 2 s, starting at an odd origin.
    const f = frames(50, 100_000, 20).map((x) => ({ ...x, timestamp: x.timestamp + 7e6 }))
    const file = muxWebm({ width: 640, height: 360 }, f)
    const top = children(file, 0, file.length)
    expect(top.map((e) => e.id)).toEqual([0x1a45dfa3, 0x18538067])
    const seg = top[1]
    if (!seg) throw new Error('no segment')
    expect(seg.body + seg.size).toBe(file.length)
    const inSeg = children(file, seg.body, seg.body + seg.size)
    expect(inSeg.map((e) => e.id)).toEqual([
      0x1549a966, // Info
      0x1654ae6b, // Tracks
      0x1f43b675,
      0x1f43b675,
      0x1f43b675,
    ])
    // Cluster times in ms from the first frame; each opens on a keyframe block.
    const times: number[] = []
    let blocks = 0
    for (const c of inSeg.slice(2)) {
      const inner = children(file, c.body, c.body + c.size)
      const tc = inner[0]
      if (!tc) throw new Error('empty cluster')
      expect(tc.id).toBe(0xe7)
      let t = 0
      for (let i = 0; i < tc.size; i++) t = t * 256 + (file[tc.body + i] ?? 0)
      times.push(t)
      const first = inner[1]
      expect(first?.id).toBe(0xa3)
      expect((file[(first?.body ?? 0) + 3] ?? 0) & 0x80).toBe(0x80)
      blocks += inner.length - 1
    }
    expect(times).toEqual([0, 2000, 4000])
    expect(blocks).toBe(50)
  })
})
