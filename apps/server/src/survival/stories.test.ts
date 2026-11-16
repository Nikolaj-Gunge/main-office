import { beforeAll, describe, expect, test } from 'bun:test'
import {
  composeDawnReport,
  createPhysicsWorld,
  DEFAULT_RULES,
  decodeServerMessage,
  ECHO_DAYS,
  ECHO_FRAMES,
  ECHO_MAX,
  ECHO_STRIDE,
  echoPose,
  emptyNight,
  heightAt,
  initPhysics,
  loadMap,
  mergeRules,
  PLAYER_QUERY_GROUPS,
  PROJECTS,
  projectBlocks,
  RAPIER,
  readEchoes,
  type ServerMessage,
  ServerMsg,
  type SurvivalSelf,
  seeded,
  setProjects,
  TICK_RATE,
} from '@office-fps/shared'
import { Game, type ServerPlayer } from '../game.ts'
import { MemoryStore } from '../saves.ts'
import { BOUNTY_BASE, BOUNTY_MAX, BOUNTY_PER_DAY, bountyReward, wantedLines } from './bounties.ts'
import type { SurvivalDirector } from './director.ts'
import { Echoes, echoCaption } from './echoes.ts'
import { SHIELD_SECONDS } from './newcomer.ts'
import { radioLine } from './radio.ts'

beforeAll(async () => {
  await initPhysics()
})

describe('bounties on the long-lived turned', () => {
  test('nothing for the first day, then a reward that grows and stops growing', () => {
    expect(bountyReward(undefined, 9)).toBe(0)
    expect(bountyReward(3, 3)).toBe(0)
    expect(bountyReward(3, 3.9)).toBe(0)
    expect(bountyReward(3, 4)).toBe(BOUNTY_BASE)
    expect(bountyReward(3, 6)).toBe(BOUNTY_BASE + 2 * BOUNTY_PER_DAY)
    expect(bountyReward(0, 500)).toBe(BOUNTY_MAX)
  })

  test('the board: name, last seen, reward, biggest first', () => {
    const lines = wantedLines([
      { name: 'Ellen Voss', place: 'the quarry', reward: 60 },
      { name: 'Bo Kade', place: 'Mill Road', reward: 140 },
    ])
    expect(lines[0]).toContain('Bo Kade')
    expect(lines[1]).toBe(
      'WANTED: put Ellen Voss to rest. Last seen near the quarry. $60 to whoever does.',
    )
  })

  test('the radio and the Dawn Report say who collected', () => {
    const { text } = radioLine(
      { kind: 'bounty', who: 'Ellen Voss', by: 'Ray', reward: 100 },
      () => 0,
    )
    expect(text).toContain('Ellen Voss')
    expect(text).toContain('Ray')
    expect(text).not.toContain('{')
    const log = emptyNight()
    log.putDown = 1
    log.turnedDown.push({ name: 'Ellen Voss', by: 'Ray', reward: 100 })
    const report = composeDawnReport(log, { world: 'Deadwood', night: 2 })
    expect(report.lines.join('\n')).toContain(
      'Ray put down what was left of Ellen Voss and collected the $100 bounty.',
    )
  })
})

describe('bloodstain echoes', () => {
  const at = { x: 100, y: 2, z: 50 }

  test('keeps the last few seconds, relative to where they fell, and the last words', () => {
    const e = new Echoes()
    for (let i = 0; i < ECHO_FRAMES + 10; i++)
      e.sample(1, { x: at.x - (ECHO_FRAMES + 9 - i) * 0.3, y: at.y, z: at.z }, 0.5, i % 7 === 0)
    e.said(1, 'tell them I tried', 10)
    const echo = e.died(1, 'Ada', at, 4, 20)
    expect(echo.frames).toHaveLength(ECHO_FRAMES * ECHO_STRIDE)
    expect(echo.words).toBe('tell them I tried')
    const last = echoPose(echo, ECHO_FRAMES - 1)
    expect(last?.x).toBeCloseTo(at.x)
    expect(last?.yaw).toBeCloseTo(0.5)
    expect(echoPose(echo, 0)?.x).toBeCloseTo(at.x - (ECHO_FRAMES - 1) * 0.3, 1)
    expect(echoCaption(echo)).toContain('"tell them I tried"')
  })

  test('words said long before dying are not last words', () => {
    const e = new Echoes()
    e.sample(2, at, 0, false)
    e.said(2, 'hello', 0)
    expect(e.died(2, 'Bo', at, 1, 10_000).words).toBeUndefined()
  })

  test('E near a fresh stain, or at their grave later; stains fade after a few days', () => {
    const e = new Echoes()
    e.sample(1, at, 0, false)
    e.died(1, 'Ada', at, 4, 0)
    expect(e.stains(4)).toHaveLength(1)
    expect(e.near({ x: at.x + 1, y: at.y, z: at.z }, 4, [])?.name).toBe('Ada')
    expect(e.near({ x: at.x + 5, y: at.y, z: at.z }, 4, [])).toBeNull()
    expect(e.stains(4 + ECHO_DAYS)).toHaveLength(0)
    expect(e.near(at, 4 + ECHO_DAYS, [])).toBeNull()
    const grave = { name: 'Ada', x: 0, z: 0 }
    expect(e.near({ x: 0.5, y: 0, z: 0 }, 4 + ECHO_DAYS, [grave])?.name).toBe('Ada')
    expect(e.near({ x: 0.5, y: 0, z: 0 }, 4, [{ ...grave, name: 'Cy' }])).toBeNull()
  })

  test('capped, and through the world save', () => {
    const e = new Echoes()
    for (let i = 0; i < ECHO_MAX + 5; i++) e.died(i, `P${i}`, at, 1, 0)
    expect(e.all).toHaveLength(ECHO_MAX)
    const back = new Echoes()
    back.restore(JSON.parse(JSON.stringify(e.save())))
    expect(back.all.map((x) => x.name)).toEqual(e.all.map((x) => x.name))
    // New ids carry on past the saved ones.
    const next = back.died(99, 'New', at, 1, 0)
    expect(next.id).toBeGreaterThan(Math.max(...e.all.map((x) => x.id)))
    expect(readEchoes('junk')).toEqual([])
    expect(
      readEchoes([{ id: 1, name: 'X', x: 0, y: 0, z: 0, frames: [1, 2, 3] }])[0]?.frames,
    ).toEqual([])
  })
})

describe('community projects are solid', () => {
  test('a finished project blocks the way; unbuilt, nothing there', () => {
    const map = loadMap('deadwood')
    const def = map.survival
    if (!def) throw new Error('no survival map')
    const physics = createPhysicsWorld(map)
    for (const p of PROJECTS) {
      const blocks = projectBlocks(def, p.id)
      expect(blocks.length).toBeGreaterThan(0)
      const b = blocks[0]
      if (!b) continue
      // A short ray straight down onto the top of its first box.
      const [x, y, z] = b.center
      const top = y + b.half[1]
      const ray = new RAPIER.Ray({ x, y: top + 0.5, z }, { x: 0, y: -1, z: 0 })
      const hit = () => physics.world.castRay(ray, 0.6, true, undefined, PLAYER_QUERY_GROUPS)
      const before = hit()?.timeOfImpact ?? 1
      setProjects(physics, def, [p.id])
      expect(hit()?.timeOfImpact ?? 1).toBeLessThan(Math.min(before, 0.55))
      setProjects(physics, def, [])
      expect(hit()?.timeOfImpact ?? 1).toBeCloseTo(before)
    }
  })

  test('setProjects only changes what changed', () => {
    const map = loadMap('deadwood')
    const def = map.survival
    if (!def) throw new Error('no survival map')
    const physics = createPhysicsWorld(map)
    expect(setProjects(physics, def, ['well'])).toBe(true)
    expect(setProjects(physics, def, ['well'])).toBe(false)
    expect(setProjects(physics, def, ['well', 'wall'])).toBe(true)
  })
})

describe('in a running world', () => {
  /** A Deadwood server with P0 out in the woods and P1 beside them. */
  async function world() {
    const map = loadMap('deadwood')
    const game = new Game(map, createPhysicsWorld(map), seeded(7))
    game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
    await game.useSaves(new MemoryStore())
    const director = (game.match as unknown as { survival: SurvivalDirector }).survival
    const insides = director as unknown as {
      survivors: Map<number, { self: SurvivalSelf }>
      turned: Map<number, { since: number }>
      pool: ServerPlayer[]
    }
    const def = map.survival
    if (!def) throw new Error('no survival world')
    const join = (name: string, box: ServerMessage[]) => {
      const id = game.join(name, { send: (b: Uint8Array) => box.push(decodeServerMessage(b)) })
      const p = game.players.get(id ?? -1)
      if (!p) throw new Error('no player')
      return p
    }
    const box0: ServerMessage[] = []
    const box1: ServerMessage[] = []
    const p0 = join('P0', box0)
    const p1 = join('P1', box1)
    const run = (seconds: number) => {
      for (let i = 0; i < seconds * TICK_RATE; i++) game.step()
    }
    run(0.5)
    const haven = def.pois.find((p) => p.safe)
    if (!haven) throw new Error('no haven')
    const x = haven.x + haven.r + 260
    for (const [p, dx] of [
      [p0, 0],
      [p1, 3],
    ] as const) {
      const self = insides.survivors.get(p.id)?.self
      if (self) self.age = SHIELD_SECONDS
      p.state.pos = { x: x + dx, y: heightAt(def.terrain, x + dx, haven.z) + 0.05, z: haven.z }
      p.protectedUntil = 0
    }
    run(2)
    return { game, director, insides, p0, p1, box1, run }
  }

  const notices = (box: ServerMessage[]) =>
    box.flatMap((m) => (m.type === ServerMsg.Notice ? [m.notice] : []))

  test('a long-walking turned is wanted; putting it down pays, airs and goes in the report', async () => {
    const t = await world()
    t.game.killPlayer(t.p0.id, (t.insides.pool[0] as ServerPlayer).id)
    const [bodyId] = [...t.insides.turned.keys()]
    const turned = t.insides.turned.get(bodyId ?? -1)
    if (!turned || bodyId === undefined) throw new Error('nobody turned')
    expect(t.director.wanted()).toHaveLength(0)
    // It has walked three days.
    turned.since -= 3
    const wanted = t.director.wanted()
    expect(wanted[0]?.reward).toBe(BOUNTY_BASE + 2 * BOUNTY_PER_DAY)
    const self = t.insides.survivors.get(t.p1.id)?.self
    const before = self?.money ?? 0
    t.game.killPlayer(bodyId, t.p1.id)
    expect((self?.money ?? 0) - before).toBe(BOUNTY_BASE + 2 * BOUNTY_PER_DAY)
    expect(notices(t.box1).some((n) => n.text.includes("Haven's bounty is yours"))).toBe(true)
    t.run(1)
    expect(t.director.radio.log.some((l) => l.includes(wanted[0]?.name ?? '?'))).toBe(true)
  })

  test('a death leaves a stain; E on it plays the echo', async () => {
    const t = await world()
    const at = { ...t.p0.state.pos }
    t.game.killPlayer(t.p0.id, (t.insides.pool[0] as ServerPlayer).id)
    expect(t.director.echoes.all).toHaveLength(1)
    expect(t.director.echoes.all[0]?.frames.length).toBeGreaterThan(0)
    expect(t.director.info().camp?.stains).toHaveLength(1)
    t.p1.state.pos = { ...at, x: at.x + 1 }
    t.box1.length = 0
    t.director.onUse(t.p1)
    // Loot lying there is taken first; once it's gone, the stain answers.
    for (let i = 0; i < 40 && !notices(t.box1).some((n) => n.echo); i++) t.director.onUse(t.p1)
    expect(notices(t.box1).find((n) => n.echo)?.echo?.x).toBeCloseTo(at.x, 1)
  })
})
