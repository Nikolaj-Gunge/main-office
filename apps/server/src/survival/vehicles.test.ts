import { beforeAll, describe, expect, test } from 'bun:test'
import {
  Button,
  CAR_HALF_LENGTH,
  createPhysicsWorld,
  DEFAULT_RULES,
  decodeServerMessage,
  distanceToCar,
  forwardSpeed,
  initPhysics,
  loadMap,
  MAP_COLLISION_GROUPS,
  mergeRules,
  RAPIER,
  type ServerMessage,
  ServerMsg,
  seeded,
  TICK_RATE,
  type VehicleNet,
} from '@office-fps/shared'
import { Game } from '../game.ts'

beforeAll(async () => {
  await initPhysics()
})

function setup() {
  const map = loadMap('deadwood')
  const physics = createPhysicsWorld(map)
  const game = new Game(map, physics, seeded(11))
  const inbox: ServerMessage[] = []
  const id = game.join('Driver', { send: (b) => inbox.push(decodeServerMessage(b)) }) ?? 0
  game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
  const player = () => {
    const p = game.players.get(id)
    if (!p) throw new Error('no player')
    return p
  }
  player().protectedUntil = Number.POSITIVE_INFINITY
  let seq = 1
  const input = (buttons: number, yaw = 0) => {
    game.handleInput(id, [{ seq: seq++, buttons, yaw, pitch: 0, viewTick: game.tick }])
    game.step()
  }
  const hold = (buttons: number, seconds: number) => {
    for (let i = 0; i < seconds * TICK_RATE; i++) input(buttons)
  }
  const press = (button: number) => {
    input(0)
    input(button)
    input(0)
  }
  /** The cars in the last snapshot. */
  const cars = (): VehicleNet[] => {
    const snap = inbox.filter((m) => m.type === ServerMsg.Snapshot).at(-1)
    return snap?.type === ServerMsg.Snapshot ? (snap.vehicles ?? []) : []
  }
  /** Stands the player at the driver's door of the nearest car and returns it. */
  const toCar = (): VehicleNet => {
    game.step()
    game.step()
    const p = player().state.pos
    const near = cars().sort(
      (a, b) =>
        Math.hypot(a.state.x - p.x, a.state.z - p.z) - Math.hypot(b.state.x - p.x, b.state.z - p.z),
    )[0]
    if (!near) throw new Error('no car near')
    const s = near.state
    // The driver's door: left of the car (car space x −1.5).
    const x = s.x - Math.cos(s.yaw) * 1.5
    const z = s.z + Math.sin(s.yaw) * 1.5
    player().state.pos = { x, y: s.y + 0.1, z }
    player().state.vel = { x: 0, y: 0, z: 0 }
    return near
  }
  const car = (carId: number) => {
    game.step()
    game.step()
    const c = cars().find((v) => v.id === carId)
    if (!c) throw new Error('car gone')
    return c
  }
  return { game, id, player, input, hold, press, cars, toCar, car, physics }
}

describe('survival: cars', () => {
  test('a dozen cars stand by the roads; there is one near the cabin you wake in', () => {
    const t = setup()
    t.game.step()
    t.game.step()
    const near = t.cars()
    expect(near.length).toBeGreaterThanOrEqual(1)
    const p = t.player().state.pos
    const closest = Math.min(...near.map((c) => Math.hypot(c.state.x - p.x, c.state.z - p.z)))
    expect(closest).toBeLessThan(120)
    for (const c of near) {
      expect(c.health).toBe(100)
      expect(c.wrecked).toBe(false)
      expect(c.seats).toEqual([0, 0, 0, 0])
    }
    // Everyone everywhere: walk the player round the whole map's spots and count.
    const seen = new Set<number>()
    for (let x = -1400; x <= 1400; x += 350) {
      for (let z = -1400; z <= 1400; z += 350) {
        t.player().state.pos = { x, y: 50, z }
        t.game.step()
        t.game.step()
        for (const c of t.cars()) seen.add(c.id)
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(8)
    expect(seen.size).toBeLessThanOrEqual(15)
  })

  test('E gets you in at the driver door; driving moves the car; E gets you out beside it', () => {
    const t = setup()
    const parked = t.toCar()
    t.press(Button.Use)
    let c = t.car(parked.id)
    expect(c.seats[0]).toBe(t.id)
    // You sit in the car: where it is, low enough for the roof to cover you.
    const me = t.player().state.pos
    expect(distanceToCar(c.state, me.x, me.z)).toBe(0)
    expect(me.y).toBeLessThan(c.state.y)

    t.hold(Button.Forward, 2)
    c = t.car(parked.id)
    const moved = Math.hypot(c.state.x - parked.state.x, c.state.z - parked.state.z)
    expect(moved).toBeGreaterThan(5)
    expect(forwardSpeed(c.state)).toBeGreaterThan(4)
    // The player went with it.
    expect(distanceToCar(c.state, t.player().state.pos.x, t.player().state.pos.z)).toBe(0)

    // Brake to a stop and get out.
    t.hold(Button.Back, 1.2)
    t.hold(0, 1)
    t.press(Button.Use)
    c = t.car(parked.id)
    expect(c.seats[0]).toBe(0)
    const out = t.player().state.pos
    const d = distanceToCar(c.state, out.x, out.z)
    expect(d).toBeGreaterThan(0.2)
    expect(d).toBeLessThan(2.5)
    // And walking works again.
    const before = { ...out }
    t.hold(Button.Forward, 0.5)
    expect(
      Math.hypot(t.player().state.pos.x - before.x, t.player().state.pos.z - before.z),
    ).toBeGreaterThan(1)
  })

  test('something solid in the way stops the car, and a hard hit dents it', () => {
    const t = setup()
    const parked = t.toCar()
    t.press(Button.Use)
    // A wall across the road 30 m ahead.
    const s = parked.state
    const fx = -Math.sin(s.yaw)
    const fz = -Math.cos(s.yaw)
    t.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(4, 3, 0.5)
        .setTranslation(s.x + fx * 30, s.y + 2, s.z + fz * 30)
        .setRotation({ x: 0, y: Math.sin(s.yaw / 2), z: 0, w: Math.cos(s.yaw / 2) })
        .setCollisionGroups(MAP_COLLISION_GROUPS),
    )
    t.physics.world.step()
    t.hold(Button.Forward, 6)
    const c = t.car(parked.id)
    const along = (c.state.x - s.x) * fx + (c.state.z - s.z) * fz
    expect(along).toBeGreaterThan(20)
    expect(along).toBeLessThan(30 - 0.5 - CAR_HALF_LENGTH + 0.1)
    expect(Math.abs(forwardSpeed(c.state))).toBeLessThan(1.5)
    expect(c.health).toBeLessThan(100)
  })

  test('the dead in the road are run down, and the car takes a knock', () => {
    const t = setup()
    const parked = t.toCar()
    t.press(Button.Use)
    const s = parked.state
    const fx = -Math.sin(s.yaw)
    const fz = -Math.cos(s.yaw)
    // Get up to speed first, then put one of the dead in the road ahead.
    t.hold(Button.Forward, 2)
    const c0 = t.car(parked.id)
    const zombie = [...t.game.players.values()].find((p) => p.zombie && !p.state.alive)
    if (!zombie) throw new Error('no zombie in the pool')
    const x = c0.state.x + fx * 12
    const z = c0.state.z + fz * 12
    t.game.placeZombie(zombie, { pos: [x, c0.state.y + 0.2, z], yaw: 0 }, 220)
    const speed = forwardSpeed(c0.state)
    expect(speed).toBeGreaterThan(8)
    t.hold(Button.Forward, 1.2)
    // Killed by the driver (the pool may already have sent it walking somewhere else).
    expect(t.player().kills).toBe(1)
    const c = t.car(parked.id)
    expect(c.health).toBeLessThan(100)
    expect(c.health).toBeGreaterThan(80)
  })

  test('a wrecked car throws its driver out and is put back later', () => {
    const t = setup()
    const parked = t.toCar()
    t.press(Button.Use)
    // Ram a wall again and again.
    const s = parked.state
    const fx = -Math.sin(s.yaw)
    const fz = -Math.cos(s.yaw)
    t.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(6, 3, 0.5)
        .setTranslation(s.x + fx * 45, s.y + 2, s.z + fz * 45)
        .setRotation({ x: 0, y: Math.sin(s.yaw / 2), z: 0, w: Math.cos(s.yaw / 2) })
        .setCollisionGroups(MAP_COLLISION_GROUPS),
    )
    t.physics.world.step()
    for (let i = 0; i < 8 && t.car(parked.id).seats[0] === t.id; i++) {
      t.hold(Button.Back, 3)
      t.hold(Button.Forward, 5)
    }
    const c = t.car(parked.id)
    expect(c.wrecked).toBe(true)
    expect(c.seats[0]).toBe(0)
    expect(distanceToCar(c.state, t.player().state.pos.x, t.player().state.pos.z)).toBeGreaterThan(
      0,
    )
    // E does nothing for a wreck.
    t.press(Button.Use)
    expect(t.car(parked.id).seats[0]).toBe(0)
    // Walk far away and wait: a fresh one stands where it was.
    t.player().state.pos = { x: s.x + 500, y: 60, z: s.z }
    for (let i = 0; i < 160 * TICK_RATE; i++) t.game.step()
    t.player().state.pos = { x: s.x + 5, y: s.y + 1, z: s.z }
    const back = t.car(parked.id)
    expect(back.wrecked).toBe(false)
    expect(back.health).toBe(100)
    expect(Math.hypot(back.state.x - s.x, back.state.z - s.z)).toBeLessThan(0.5)
  })
})
