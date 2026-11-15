import { beforeAll, describe, expect, test } from 'bun:test'
import {
  createPhysicsWorld,
  DEFAULT_RULES,
  HOOP_HEIGHT,
  hoopAt,
  initPhysics,
  JUNK_NOISE,
  junkSpots,
  KICK_SWING,
  loadMap,
  mergeRules,
  type SocialEvent,
  seeded,
  TICK_RATE,
  throughHoop,
  unpackJunk,
} from '@office-fps/shared'
import { Game, type ServerPlayer } from '../game.ts'
import type { SurvivalDirector } from './director.ts'
import { Junk, type JunkHost, RETURN_SECONDS } from './junk.ts'

beforeAll(async () => {
  await initPhysics()
})

const map = loadMap('deadwood')
const pois = map.survival?.pois ?? []
const havenY = pois.find((p) => p.key === 'haven')?.y ?? 0

function setup(clear = true) {
  let now = 100
  const told: SocialEvent[] = []
  const alerts: number[] = []
  const scored: number[] = []
  const host: JunkHost = {
    pois: () => pois,
    now: () => now,
    lineClear: () => clear,
    tell: (e) => told.push(e),
    alert: (_at, r) => alerts.push(r),
    scored: (_p, tally) => scored.push(tally),
    changed: () => {},
  }
  const junk = new Junk(host)
  const person = (x: number, z: number, yaw = 0, vx = 0, vz = 0) =>
    ({
      id: 1,
      name: 'Ada',
      state: { alive: true, pos: { x, y: havenY, z }, vel: { x: vx, y: 0, z: vz }, yaw, pitch: 0 },
    }) as unknown as ServerPlayer
  return { junk, told, alerts, scored, person, advance: (s: number) => (now += s) }
}

const yawTo = (from: { x: number; z: number }, to: { x: number; z: number }) =>
  Math.atan2(-(to.x - from.x), -(to.z - from.z))

describe('junk', () => {
  test('cans lie in Haven and outside homes, the same every time', () => {
    const spots = junkSpots(pois)
    expect(spots.length).toBeGreaterThan(20)
    expect(junkSpots(pois)).toEqual(spots)
    const haven = pois.find((p) => p.key === 'haven')
    if (!haven) throw new Error('no haven')
    expect(spots.filter((s) => Math.hypot(s.x - haven.x, s.z - haven.z) < 30).length).toBe(11)
  })

  test("Haven's barrel stands where the rules think it does", () => {
    const hoop = hoopAt(pois)
    if (!hoop) throw new Error('no hoop')
    const drum = map.boxes.find(
      (b) =>
        Math.abs(b.center[0] - hoop.x) < 0.01 &&
        Math.abs(b.center[2] - hoop.z) < 0.01 &&
        Math.abs(b.center[1] - (hoop.y + HOOP_HEIGHT / 2)) < 0.01,
    )
    expect(drum).toBeDefined()
  })

  test('walking into a can nudges it the way you walk, and the dead hear it', () => {
    const { junk, told, alerts, person } = setup()
    const can = junk.at(0)
    if (!can) throw new Error('no can')
    junk.step([person(can.x - 0.3, can.z, 0, 5, 0)])
    const now = junk.at(0)
    expect(now?.x).toBeGreaterThan(can.x + 1)
    expect(now?.z).toBeCloseTo(can.z, 5)
    expect(told[0]).toMatchObject({ kind: 'junk', i: 0 })
    expect(alerts[0]).toBeGreaterThan(0)
    expect(alerts[0]).toBeLessThanOrEqual(JUNK_NOISE)
    // Standing still next to it does nothing.
    const quiet = setup()
    quiet.junk.step([quiet.person(can.x - 0.3, can.z)])
    expect(quiet.told).toHaveLength(0)
  })

  test('a swing sends what is in front flying; a wall stops it', () => {
    const { junk, person } = setup()
    const can = junk.at(0)
    if (!can) throw new Error('no can')
    // Facing west (yaw π/2: forward is -x), standing just east of it.
    expect(junk.swing(person(can.x + 0.8, can.z, Math.PI / 2))).toBe(true)
    expect(junk.at(0)?.x).toBeCloseTo(can.x - KICK_SWING, 3)
    // Facing away: nothing.
    const away = setup()
    away.junk.swing(away.person(can.x + 0.8, can.z, -Math.PI / 2))
    expect(away.junk.at(0)).toEqual(can)
    // Into a wall: it doesn't go through.
    const walled = setup(false)
    walled.junk.swing(walled.person(can.x + 0.8, can.z, Math.PI / 2))
    expect(walled.junk.at(0)).toEqual(can)
  })

  test('a can kicked over the barrel drops in: a tally, and it goes home after', () => {
    const { junk, scored, told, person, advance } = setup()
    const hoop = hoopAt(pois)
    const can = junk.at(0)
    if (!hoop || !can) throw new Error('no hoop')
    expect(
      throughHoop(can, { x: hoop.x + (hoop.x - can.x), z: hoop.z + (hoop.z - can.z) }, hoop),
    ).toBe(true)
    // Rolling past its foot doesn't count (the barrel is in the first half of the path).
    expect(
      throughHoop(can, { x: can.x + (hoop.x - can.x) * 3, z: can.z + (hoop.z - can.z) * 3 }, hoop),
    ).toBe(false)
    // Stand behind the can, 0.8 m back, facing the barrel; ~4.3 m away, a 7 m kick: in.
    const d = Math.hypot(hoop.x - can.x, hoop.z - can.z)
    const ux = (hoop.x - can.x) / d
    const uz = (hoop.z - can.z) / d
    const me = { x: can.x - ux * 0.8, z: can.z - uz * 0.8 }
    expect(junk.swing(person(me.x, me.z, yawTo(me, hoop)))).toBe(true)
    expect(scored).toEqual([1])
    expect(told[0]).toMatchObject({ kind: 'junk', i: 0, hoop: true })
    expect(junk.tally).toBe(1)
    advance(2)
    junk.step([])
    expect(junk.at(0)).toEqual(can)
    expect(junk.shared()).toBeUndefined()
  })

  test('kicked junk is shared where it lies, and wanders home when left alone', () => {
    const { junk, person, advance } = setup()
    const can = junk.at(1)
    if (!can) throw new Error('no can')
    junk.swing(person(can.x + 0.8, can.z, Math.PI / 2))
    const lying = unpackJunk(junk.shared()).get(1)
    expect(lying?.x).toBeCloseTo(junk.at(1)?.x ?? 0, 1)
    advance(RETURN_SECONDS + 1)
    junk.second([person(can.x, can.z)]) // somebody's watching: it stays
    expect(junk.at(1)).not.toEqual(can)
    junk.second([])
    expect(junk.at(1)).toEqual(can)
  })

  test('in the game: walking through a can in Haven moves it for everybody', () => {
    const game = new Game(map, createPhysicsWorld(map), seeded(3))
    const id = game.join('Ada', { send: () => {} }) ?? 0
    game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
    const director = game.match.survivalDirector as SurvivalDirector
    const player = game.players.get(id)
    const can = director.junk.at(0)
    if (!player || !can) throw new Error('no player')
    for (let k = 0; k < TICK_RATE; k++) {
      player.state.pos = { x: can.x - 0.2, y: havenY, z: can.z }
      player.state.vel = { x: 5, y: 0, z: 0 }
      player.state.alive = true
      director.junk.step([player])
    }
    expect(director.junk.at(0)?.x).toBeGreaterThan(can.x)
    expect(director.info().junk?.[0]).toBe(0)
  })
})
