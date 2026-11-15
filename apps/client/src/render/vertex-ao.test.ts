import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { type Aabb, AabbGrid, bakeVertexAo, vertexOpenness } from './vertex-ao.ts'

const floor: Aabb = { min: [-5, -0.2, -5], max: [5, 0, 5] }
const wall: Aabb = { min: [-5, 0, 2], max: [5, 3, 2.2] }

describe('baked vertex AO', () => {
  test('open space stays fully lit', () => {
    const grid = new AabbGrid([floor])
    expect(vertexOpenness(grid, [0, 0, 0], [0, 1, 0])).toBe(1)
  })

  test('a wall darkens at its foot, not at its top', () => {
    const grid = new AabbGrid([floor, wall])
    const foot = vertexOpenness(grid, [0, 0, 2], [0, 0, -1])
    const top = vertexOpenness(grid, [0, 3, 2], [0, 0, -1])
    expect(foot).toBeLessThan(1)
    expect(top).toBe(1)
    // …and the floor darkens where it meets the wall.
    expect(vertexOpenness(grid, [0, 0, 2], [0, 1, 0])).toBeLessThan(1)
    expect(vertexOpenness(grid, [0, 0, 0], [0, 1, 0])).toBe(1)
  })

  test('bakes into vertex colours, never below the floor', () => {
    const grid = new AabbGrid([floor, wall])
    const g = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 1.5)
    bakeVertexAo(g, grid)
    const c = g.getAttribute('color')
    let min = 1
    let max = 0
    for (let i = 0; i < c.count; i++) {
      min = Math.min(min, c.getX(i))
      max = Math.max(max, c.getX(i))
    }
    expect(max).toBe(1)
    expect(min).toBeLessThan(1)
    expect(min).toBeGreaterThan(0.5)
  })
})
