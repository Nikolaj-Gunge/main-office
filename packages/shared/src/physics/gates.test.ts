import { beforeAll, describe, expect, test } from 'bun:test'
import { MapBuilder } from '../maps/builder.ts'
import { createPhysicsWorld, initPhysics, PLAYER_QUERY_GROUPS, RAPIER, setGates } from './world.ts'

beforeAll(async () => {
  await initPhysics()
})

describe('gates', () => {
  test('an open gate stops blocking rays; shutting it blocks them again', () => {
    const m = new MapBuilder('t', 'T', {
      sunDirection: [0, 1, 0],
      sunColor: 0,
      sunIntensity: 0,
      skyColor: 0,
      groundColor: 0,
      ambientIntensity: 0,
      fogColor: 0,
      fogNear: 1,
      fogFar: 2,
    })
    m.span([-2, 0, -0.2], [2, 3, 0.2], 'wall', { gate: 1 })
    m.spawn(0, 0, 5)
    const physics = createPhysicsWorld(m.build())
    const ray = new RAPIER.Ray({ x: 0, y: 1, z: 5 }, { x: 0, y: 0, z: -1 })
    const blocked = () =>
      physics.world.castRay(ray, 10, true, undefined, PLAYER_QUERY_GROUPS) !== null
    expect(blocked()).toBe(true)
    setGates(physics, (id) => id === 1)
    expect(blocked()).toBe(false)
    setGates(physics, () => false)
    expect(blocked()).toBe(true)
  })
})
