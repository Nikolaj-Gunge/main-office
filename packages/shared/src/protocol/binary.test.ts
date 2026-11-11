import { describe, expect, test } from 'bun:test'
import { BinaryReader, BinaryWriter } from './binary.ts'

describe('BinaryWriter / BinaryReader', () => {
  test('round-trips every primitive', () => {
    const bytes = new BinaryWriter(1)
      .u8(255)
      .u16(65535)
      .i16(-32768)
      .u32(4294967295)
      .f32(1.5)
      .f64(Math.PI)
      .str8('Hej kontoret 🔫')
      .finish()

    const r = new BinaryReader(bytes)
    expect(r.u8()).toBe(255)
    expect(r.u16()).toBe(65535)
    expect(r.i16()).toBe(-32768)
    expect(r.u32()).toBe(4294967295)
    expect(r.f32()).toBe(1.5)
    expect(r.f64()).toBe(Math.PI)
    expect(r.str8()).toBe('Hej kontoret 🔫')
    expect(r.remaining).toBe(0)
  })

  test('grows past the initial size', () => {
    const w = new BinaryWriter(2)
    for (let i = 0; i < 1000; i++) w.u32(i)
    const r = new BinaryReader(w.finish())
    for (let i = 0; i < 1000; i++) expect(r.u32()).toBe(i)
  })

  test('truncates str8 to 255 bytes', () => {
    const r = new BinaryReader(new BinaryWriter().str8('x'.repeat(300)).finish())
    expect(r.str8()).toHaveLength(255)
  })

  test('reads from a Uint8Array view with a byte offset', () => {
    const inner = new BinaryWriter().u16(1234).finish()
    const outer = new Uint8Array(inner.length + 3)
    outer.set(inner, 3)
    expect(new BinaryReader(outer.subarray(3)).u16()).toBe(1234)
  })

  test('throws when reading past the end', () => {
    expect(() => new BinaryReader(new Uint8Array(1)).u32()).toThrow(RangeError)
  })
})
