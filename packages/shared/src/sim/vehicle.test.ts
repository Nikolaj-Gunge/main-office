import { beforeAll, describe, expect, test } from 'bun:test'
import { TICK_DT } from '../constants.ts'
import type { MapDef } from '../maps/types.ts'
import { createPhysicsWorld, initPhysics } from '../physics/world.ts'
import { Button } from './input.ts'
import {
  createVehicleState,
  forwardSpeed,
  stepVehicle,
  VehicleBody,
  type VehicleState,
} from './vehicle.ts'

beforeAll(async () => {
  await initPhysics()
})

/** A big flat floor with a wall across it at z = −40 (the way a car at yaw 0 faces). */
function yard(): MapDef {
  return {
    id: 'yard',
    name: 'Yard',
    boxes: [
      { center: [0, -0.5, 0], size: [400, 1, 400], material: 'floor' },
      { center: [0, 2, -40], size: [60, 4, 1], material: 'wall' },
    ],
    spawns: [{ pos: [0, 0, 0], yaw: 0 }],
    labels: [],
    lighting: {
      sunDirection: [0, 1, 0],
      sunColor: 0xffffff,
      sunIntensity: 1,
      skyColor: 0xffffff,
      groundColor: 0xffffff,
      ambientIntensity: 1,
      fogColor: 0,
      fogNear: 10,
      fogFar: 100,
    },
  }
}

function drive(s: VehicleState, body: VehicleBody, buttons: number, seconds: number) {
  let impact = 0
  for (let i = 0; i < seconds / TICK_DT; i++) {
    impact = Math.max(impact, stepVehicle(s, buttons, TICK_DT, body).impact)
  }
  return impact
}

describe('vehicle sim', () => {
  test('throttle drives it forward, steering turns it left and right, brakes stop it', () => {
    const physics = createPhysicsWorld(yard())
    const body = new VehicleBody(physics, null)
    const s = createVehicleState(0, 0, 0, 0)
    drive(s, body, Button.Forward, 2)
    expect(s.z).toBeLessThan(-5)
    expect(Math.abs(s.x)).toBeLessThan(0.01)
    expect(forwardSpeed(s)).toBeGreaterThan(8)
    expect(s.y).toBeCloseTo(0, 1)

    const yaw = s.yaw
    drive(s, body, Button.Left, 0.5)
    expect(s.yaw).toBeGreaterThan(yaw + 0.1)
    drive(s, body, Button.Right, 1)
    expect(s.yaw).toBeLessThan(yaw)

    const speed = forwardSpeed(s)
    drive(s, body, Button.Back, 0.4)
    expect(forwardSpeed(s)).toBeLessThan(speed - 5)
    // Held on: it stops, then reverses.
    drive(s, body, Button.Back, 2)
    expect(forwardSpeed(s)).toBeLessThan(-1)
  })

  test('a wall stops it, and hitting it hard is an impact', () => {
    const physics = createPhysicsWorld(yard())
    const body = new VehicleBody(physics, null)
    const s = createVehicleState(0, 0, 0, 0)
    const impact = drive(s, body, Button.Forward, 6)
    // Nose against the wall (its face is at z = −39.5), not through it.
    expect(s.z).toBeGreaterThan(-39.5 + 2.1)
    expect(s.z).toBeLessThan(-39.5 + 2.6)
    expect(impact).toBeGreaterThan(8)
    expect(Math.abs(forwardSpeed(s))).toBeLessThan(1)
  })

  test('at an angle it slides along the wall instead of sticking', () => {
    const physics = createPhysicsWorld(yard())
    const body = new VehicleBody(physics, null)
    // Heading north-west, into the wall at about 45°.
    const s = createVehicleState(0, 0, -25, Math.PI / 4)
    drive(s, body, Button.Forward, 4)
    expect(s.z).toBeGreaterThan(-39.5)
    expect(s.x).toBeLessThan(-12)
  })

  test('other cars are solid', () => {
    const physics = createPhysicsWorld(yard())
    const parked = new VehicleBody(physics, null)
    parked.place(createVehicleState(0, 0, -20, Math.PI / 2))
    physics.world.step()
    const body = new VehicleBody(physics, null)
    const s = createVehicleState(0, 0, 0, 0)
    drive(s, body, Button.Forward, 4)
    expect(s.z).toBeGreaterThan(-20 + 0.95 + 2.1)
  })
})
