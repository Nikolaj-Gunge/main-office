import { describe, expect, test } from 'bun:test'
import { insideBody } from './body-kit.ts'

describe('inside somebody', () => {
  const at = { x: 10, y: 2, z: -4 }
  test('an eye in their head or body counts; a step away does not', () => {
    expect(insideBody({ x: 10.1, y: 3.6, z: -4 }, at, 1)).toBe(true)
    expect(insideBody({ x: 10, y: 2.8, z: -3.8 }, at, 1)).toBe(true)
    expect(insideBody({ x: 10.6, y: 3.6, z: -4 }, at, 1)).toBe(false)
    expect(insideBody({ x: 10, y: 3.6, z: -3.5 }, at, 1)).toBe(false)
  })

  test('above their head or below their feet does not', () => {
    expect(insideBody({ x: 10, y: 4.2, z: -4 }, at, 1)).toBe(false)
    expect(insideBody({ x: 10, y: 1.5, z: -4 }, at, 1)).toBe(false)
  })
})
