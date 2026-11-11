import { beforeAll, describe, expect, test } from 'bun:test'
import {
  Button,
  createPhysicsWorld,
  decodeServerMessage,
  type InputCommand,
  initPhysics,
  loadMap,
  MapBuilder,
  type ServerMessage,
  ServerMsg,
  TICK_RATE,
  WEAPONS,
  WeaponId,
} from '@office-fps/shared'
import { Game } from './game.ts'
import { DROPPED_LIFETIME } from './items.ts'
import { MIN_ENEMY_DISTANCE } from './spawning.ts'

beforeAll(async () => {
  await initPhysics()
})

const LIGHTING = {
  sunDirection: [0, 1, 0] as const,
  sunColor: 0,
  sunIntensity: 0,
  skyColor: 0,
  groundColor: 0,
  ambientIntensity: 0,
  fogColor: 0,
  fogNear: 0,
  fogFar: 0,
}

/** Flat 40 × 40 room with a rifle at (0, 0, -5) and a sniper at (5, 0, -5). */
function room() {
  const m = new MapBuilder('room', 'Room', LIGHTING)
  m.span([-20, -1, -20], [20, 0, 20], 'floor')
  m.spawn(0, 0, 10)
  m.pickup(0, 0, -5, WeaponId.Rifle, 10)
  m.pickup(5, 0, -5, WeaponId.Sniper, 10)
  const map = m.build()
  return new Game(map, createPhysicsWorld(map))
}

function fakeClient() {
  const inbox: ServerMessage[] = []
  return {
    inbox,
    send: (bytes: Uint8Array) => inbox.push(decodeServerMessage(bytes)),
    all<T extends ServerMessage['type']>(type: T) {
      return inbox.filter((m) => m.type === type) as Extract<ServerMessage, { type: T }>[]
    },
  }
}

function setup() {
  const game = room()
  const client = fakeClient()
  const id = game.join('Anna', client) ?? 0
  const player = game.players.get(id)
  if (!player) throw new Error('join failed')
  let seq = 1
  const tick = (buttons = 0, yaw = 0) => {
    const cmd: InputCommand = { seq: seq++, buttons, yaw, pitch: 0, viewTick: game.tick }
    game.handleInput(id, [cmd])
    game.step()
  }
  const teleport = (x: number, z: number) => {
    player.state.pos = { x, y: 0, z }
    player.state.vel = { x: 0, y: 0, z: 0 }
  }
  return { game, client, player, tick, teleport }
}

const itemsOf = (game: Game) => [...game.items.items.values()].map((i) => i.weapon).sort()

describe('weapons on the floor', () => {
  test('you spawn with only the handgun; the map weapons are on the floor', () => {
    const { game, client, player } = setup()
    expect(player.state.weapon.id).toBe(WeaponId.Handgun)
    expect(player.state.holstered).toBeNull()
    expect(itemsOf(game)).toEqual([WeaponId.Rifle, WeaponId.Sniper])
    expect(client.all(ServerMsg.ItemSpawn).length).toBe(2)
  })

  test('walking over a weapon with an empty slot picks it up and draws it, full ammo', () => {
    const { game, client, player, tick, teleport } = setup()
    teleport(0, -4.5)
    tick()
    expect(player.state.weapon.id).toBe(WeaponId.Rifle)
    expect(player.state.weapon.ammo).toBe(WEAPONS[WeaponId.Rifle].magSize)
    expect(player.state.weapon.reserve).toBe(WEAPONS[WeaponId.Rifle].reserve)
    expect(player.state.holstered?.id).toBe(WeaponId.Handgun)
    expect(itemsOf(game)).toEqual([WeaponId.Sniper])
    expect(client.all(ServerMsg.ItemRemove).length).toBe(1)
  })

  test('with the slot filled you walk over weapons; E swaps and throws yours down', () => {
    const { game, player, tick, teleport } = setup()
    teleport(0, -4.5)
    tick() // rifle
    for (let i = 0; i < 40; i++) tick(Button.Fire) // spend some ammo
    expect(player.state.weapon.ammo).toBeLessThan(30)
    teleport(5, -4.5)
    tick()
    expect(player.state.weapon.id).toBe(WeaponId.Rifle) // no auto-swap
    tick(Button.Use)
    expect(player.state.weapon.id).toBe(WeaponId.Sniper)
    expect(player.state.holstered?.id).toBe(WeaponId.Handgun)
    // The rifle now lies on the floor; picked up again it's full.
    expect(itemsOf(game)).toEqual([WeaponId.Rifle])
    tick() // release E
    tick(Button.Use)
    expect(player.state.weapon.id).toBe(WeaponId.Rifle)
    expect(player.state.weapon.ammo).toBe(30)
  })

  test('E also swaps while holding the handgun (rifle holstered)', () => {
    const { player, tick, teleport } = setup()
    teleport(0, -4.5)
    tick()
    tick(Button.Slot2)
    expect(player.state.weapon.id).toBe(WeaponId.Handgun)
    teleport(5, -4.5)
    tick(Button.Use)
    expect(player.state.weapon.id).toBe(WeaponId.Sniper)
    expect(player.state.holstered?.id).toBe(WeaponId.Handgun)
  })

  test('taken map weapons come back after their respawn time', () => {
    const { game, tick, teleport } = setup()
    teleport(0, -4.5)
    tick()
    teleport(-10, 10)
    for (let i = 0; i < 9 * TICK_RATE; i++) tick()
    expect(itemsOf(game)).toEqual([WeaponId.Sniper])
    for (let i = 0; i < 2 * TICK_RATE; i++) tick()
    expect(itemsOf(game)).toEqual([WeaponId.Rifle, WeaponId.Sniper])
  })

  test('thrown weapons disappear after a while', () => {
    const { game, tick, teleport } = setup()
    teleport(0, -4.5)
    tick()
    teleport(5, -4.5)
    tick(Button.Use) // rifle thrown
    teleport(-10, 10)
    expect([...game.items.items.values()].some((i) => i.spawner === null)).toBe(true)
    for (let i = 0; i < (DROPPED_LIFETIME + 1) * TICK_RATE; i++) tick()
    // The thrown rifle is gone; both map weapons have long respawned at their spots.
    expect(game.items.items.size).toBe(2)
    expect([...game.items.items.values()].every((i) => i.spawner !== null)).toBe(true)
  })
})

test('dying drops your rifle/sniper on the floor (full ammo); you respawn with the handgun', () => {
  const { game, player, tick, teleport } = setup()
  teleport(0, -4.5)
  tick()
  for (let i = 0; i < 30; i++) tick(Button.Fire)
  teleport(10, 10)
  const kill = (game as unknown as { kill: (v: unknown, k: unknown, h: boolean) => void }).kill
  kill.call(game, player, player, false)
  const dropped = [...game.items.items.values()].find((i) => i.spawner === null)
  expect(dropped?.weapon).toBe(WeaponId.Rifle)
  expect(dropped?.pos.x).toBeCloseTo(10, 3)
  for (let i = 0; i < 4 * TICK_RATE; i++) tick()
  expect(player.state.alive).toBe(true)
  expect(player.state.weapon.id).toBe(WeaponId.Handgun)
  expect(player.state.holstered).toBeNull()
})

describe('random spawns', () => {
  test('spread over the office, away from and out of sight of the enemy', () => {
    const map = loadMap('office')
    const game = new Game(map, createPhysicsWorld(map))
    const enemyId = game.join('Enemy', fakeClient()) ?? 0
    const enemy = game.players.get(enemyId)
    if (!enemy) throw new Error()
    enemy.state.pos = { x: 0, y: 0, z: 6 } // middle of the hall
    const spots = new Set<string>()
    for (let i = 0; i < 40; i++) {
      const id = game.join(`P${i}`, fakeClient()) ?? 0
      const p = game.players.get(id)
      if (!p) throw new Error()
      const { x, y, z } = p.state.pos
      spots.add(`${x},${y},${z}`)
      expect(Math.hypot(x - 0, y - 0, z - 6)).toBeGreaterThanOrEqual(MIN_ENEMY_DISTANCE)
      game.leave(id)
    }
    expect(spots.size).toBeGreaterThan(30)
  })
})
