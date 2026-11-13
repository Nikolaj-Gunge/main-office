import { describe, expect, test } from 'bun:test'
import type { HitPose } from '@office-fps/shared'
import * as THREE from 'three'
import { Spectator } from './spectator.ts'

/** A bare-bones stand-in for the HUD root (the spectator only appends its label). */
function fakeParent(): HTMLElement {
  const label = { hidden: true, textContent: '', className: '' }
  ;(globalThis as { document?: unknown }).document ??= {
    createElement: () => ({ ...label }),
    body: { classList: { add() {}, remove() {} } },
  }
  return { append() {} } as unknown as HTMLElement
}

const pose = (x: number, z: number, yaw = 0): HitPose => ({
  x,
  y: 0,
  z,
  yaw,
  pitch: 0,
  crouch: 0,
  stride: 0,
  speed: 0,
  grounded: true,
})

describe('spectator', () => {
  const open = (_from: THREE.Vector3, _dir: THREE.Vector3, max: number) => max
  const name = (id: number) => `P${id}`

  test('alive, or just died: your own view', () => {
    const s = new Spectator(fakeParent())
    const camera = new THREE.PerspectiveCamera()
    const poses = new Map([[2, pose(0, -10)]])
    expect(s.update(0.1, true, [2], poses, camera, open, name)).toBe(false)
    expect(s.update(1, false, [2], poses, camera, open, name)).toBe(false)
    expect(s.active).toBe(false)
  })

  test('dead a moment: behind a living teammate, looking where they look', () => {
    const s = new Spectator(fakeParent())
    const camera = new THREE.PerspectiveCamera()
    const poses = new Map([[2, pose(0, -10)]])
    s.update(1, false, [2], poses, camera, open, name)
    expect(s.update(1, false, [2], poses, camera, open, name)).toBe(true)
    expect(s.target).toBe(2)
    // Facing −Z: the camera sits behind them (larger z), above their feet.
    expect(camera.position.z).toBeGreaterThan(-10 + 2)
    expect(camera.position.y).toBeGreaterThan(1.5)
    expect(camera.rotation.y).toBeCloseTo(0, 5)
  })

  test('no teammate alive: nothing to watch', () => {
    const s = new Spectator(fakeParent())
    const camera = new THREE.PerspectiveCamera()
    s.update(2, false, [2], new Map(), camera, open, name)
    expect(s.active).toBe(false)
  })

  test('a click moves on to the next teammate; a wall pulls the camera in', () => {
    const s = new Spectator(fakeParent())
    const camera = new THREE.PerspectiveCamera()
    const poses = new Map([
      [2, pose(0, -10)],
      [3, pose(20, -10)],
    ])
    s.update(2, false, [2, 3], poses, camera, open, name)
    expect(s.target).toBe(2)
    s.cycle(1)
    s.update(0.016, false, [2, 3], poses, camera, open, name)
    expect(s.target).toBe(3)
    const wall = (_f: THREE.Vector3, _d: THREE.Vector3, _max: number) => 0.8
    s.update(0.016, false, [2, 3], poses, camera, wall, name)
    const head = new THREE.Vector3(20, 1.95, -10)
    expect(camera.position.distanceTo(head)).toBeLessThan(0.8)
  })
})
