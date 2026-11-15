import { beforeAll, describe, expect, test } from 'bun:test'
import {
  CHALK_COOLDOWN,
  CHALK_FADE_MS,
  CHALK_LIFE_MS,
  CHALK_PER_PLAYER,
  CHALK_PER_WORLD,
  CHALK_SYMBOLS,
  CHALK_WORDS,
  chalkFade,
  chalkText,
  cleanChalk,
  createPhysicsWorld,
  createPlayerState,
  DEFAULT_RULES,
  initPhysics,
  loadMap,
  mergeRules,
  type SurvivalSelf,
  seeded,
} from '@office-fps/shared'
import { Game, type ServerPlayer } from '../game.ts'
import { MemoryStore } from '../saves.ts'
import { aimChalk, Chalk, type ChalkHost } from './chalk.ts'
import type { SurvivalDirector } from './director.ts'

beforeAll(async () => {
  await initPhysics()
})

function person(id: number, account?: string): ServerPlayer {
  return {
    id,
    name: `P${id}`,
    ...(account ? { account } : {}),
    state: { pos: { x: 0, y: 0, z: 0 }, alive: true },
  } as unknown as ServerPlayer
}

function rig() {
  const w = { now: 0, clock: 1_000_000, aim: true as boolean, notices: [] as string[], changes: 0 }
  const host: ChalkHost = {
    now: () => w.now,
    clock: () => w.clock,
    aim: () => (w.aim ? { x: 1.234, y: 1.5, z: -2, nx: 0, ny: 0, nz: 1 } : null),
    owner: (p) => p.account ?? `name:${p.name}`,
    notice: (_p, _k, text) => w.notices.push(text),
    changed: () => w.changes++,
  }
  return { w, chalk: new Chalk(host) }
}

describe('chalk: what can be written', () => {
  test('only symbols and words from the lists', () => {
    expect(cleanChalk(0, 0, 0)).toEqual({ sym: 0, a: 0, b: 0 })
    expect(cleanChalk(CHALK_SYMBOLS.length, 0, 0)).toBeNull()
    expect(cleanChalk('x', 0, 0)).toBeNull()
    expect(cleanChalk(1, 999, -4)).toEqual({ sym: 1, a: -1, b: -1 })
    expect(chalkText(0, 0)).toBe('Danger ahead')
    expect(chalkText(-1, -1)).toBe('')
    expect(chalkText(CHALK_WORDS.indexOf('Thank you'), -1)).toBe('Thank you')
  })

  test('fades over its last day and is gone after its life', () => {
    expect(chalkFade(0, 0)).toBe(1)
    expect(chalkFade(0, CHALK_LIFE_MS - CHALK_FADE_MS / 2)).toBeCloseTo(0.5)
    expect(chalkFade(0, CHALK_LIFE_MS)).toBe(0)
  })
})

describe('chalk: marks in the world', () => {
  test('one goes where you look, anonymous to everyone else', () => {
    const { w, chalk } = rig()
    const p = person(1, 'acct-1')
    expect(chalk.write(p, 3, 0, 0)).toBe(true)
    const out = {} as SurvivalSelf
    chalk.attach(p, out)
    expect(out.chalk?.length).toBe(1)
    expect(out.chalk?.[0]).toMatchObject({ x: 1.23, sym: 3, a: 0, b: 0, at: w.clock })
    expect(JSON.stringify(out.chalk)).not.toContain('acct-1')
    // Sent only when it changes.
    const again = {} as SurvivalSelf
    chalk.attach(p, again)
    expect(again.chalk).toBeUndefined()
  })

  test('nothing in reach, a made-up symbol, or too soon: nothing goes on', () => {
    const { w, chalk } = rig()
    const p = person(1)
    w.aim = false
    expect(chalk.write(p, 0, 0, 0)).toBe(false)
    expect(w.notices.at(-1)).toContain('Nothing in reach')
    w.aim = true
    expect(chalk.write(p, 99, 0, 0)).toBe(false)
    expect(chalk.write(p, 0, 0, 0)).toBe(true)
    expect(chalk.write(p, 0, 0, 0)).toBe(false)
    w.now += CHALK_COOLDOWN
    expect(chalk.write(p, 0, 0, 0)).toBe(true)
  })

  test('each hand has a few on the go: a new one rubs out their oldest', () => {
    const { w, chalk } = rig()
    const p = person(1, 'a')
    const q = person(2, 'b')
    chalk.write(q, 0, 0, 0)
    for (let i = 0; i < CHALK_PER_PLAYER + 2; i++) {
      w.now += CHALK_COOLDOWN
      chalk.write(p, i % CHALK_SYMBOLS.length, i, -1)
    }
    const saved = chalk.save()
    expect(saved.filter((m) => m.by === 'a').length).toBe(CHALK_PER_PLAYER)
    expect(saved.filter((m) => m.by === 'b').length).toBe(1)
    // Their two oldest went.
    expect(saved.filter((m) => m.by === 'a').map((m) => m.a)[0]).toBe(2)
  })

  test('the world keeps the newest CHALK_PER_WORLD', () => {
    const { w, chalk } = rig()
    for (let i = 0; i < CHALK_PER_WORLD + 10; i++) {
      w.now += CHALK_COOLDOWN
      chalk.write(person(i, `acct-${i}`), 0, 0, 0)
    }
    expect(chalk.count).toBe(CHALK_PER_WORLD)
    expect(chalk.save()[0]?.by).toBe('acct-10')
  })

  test('worn-off marks go, and are not brought back from a save', () => {
    const { w, chalk } = rig()
    chalk.write(person(1), 0, 0, 0)
    const saved = chalk.save()
    w.clock += CHALK_LIFE_MS + 1
    chalk.prune()
    expect(chalk.count).toBe(0)
    chalk.restore(saved)
    expect(chalk.count).toBe(0)
    w.clock -= CHALK_LIFE_MS
    chalk.restore([...saved, { junk: true }, null, { ...saved[0], sym: 77 }])
    expect(chalk.count).toBe(1)
  })
})

describe('chalk in Deadwood', () => {
  test('chalked on the palisade, kept in the world save, there after a restart', async () => {
    const map = loadMap('deadwood')
    const store = new MemoryStore()
    const start = async () => {
      const game = new Game(map, createPhysicsWorld(map), seeded(7))
      game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
      await game.useSaves(store)
      return {
        game,
        director: (game.match as unknown as { survival: SurvivalDirector }).survival,
      }
    }
    const one = await start()
    const haven = map.survival?.pois.find((p) => p.key === 'haven')
    if (!haven) throw new Error('no haven')
    // Looking south at Haven's palisade from just outside it, beside the gate.
    const s = createPlayerState()
    s.pos = { x: haven.x - 8, y: haven.y, z: haven.z - 32 }
    s.yaw = Math.PI
    s.pitch = 0
    const spot = aimChalk(one.game.world.physics, s)
    expect(spot).not.toBeNull()
    expect(spot?.nz).toBeCloseTo(-1)
    const id = one.game.join('P0', { send: () => {} })
    const p = one.game.players.get(id ?? -1)
    if (!p) throw new Error('no player')
    p.state.pos = { ...s.pos }
    p.state.yaw = s.yaw
    p.state.pitch = 0
    p.state.alive = true
    expect(one.director.chalk.write(p, 1, 0, 0)).toBe(true)
    one.director.saveAll()
    await one.game.saves.flush()
    const two = await start()
    expect(two.director.chalk.count).toBe(1)
    expect(two.director.chalk.save()[0]).toMatchObject({ sym: 1, a: 0, b: 0 })
  })
})
