import { beforeAll, describe, expect, test } from 'bun:test'
import {
  createPhysicsWorld,
  createWeaponState,
  DEFAULT_RULES,
  initPhysics,
  ITEMS,
  loadMap,
  MANUAL_BOOST,
  mergeRules,
  SKILL_GAIN,
  SKILL_XP,
  type SurvivalSelf,
  seeded,
  skillLevel,
  WeaponId,
} from '@office-fps/shared'
import { Game, type ServerPlayer } from '../game.ts'
import { MemoryStore, type SaveStore } from '../saves.ts'
import type { SurvivalDirector } from './director.ts'

beforeAll(async () => {
  await initPhysics()
})

const NO_SEND = { send: () => {} }

async function server(store: SaveStore) {
  const map = loadMap('deadwood')
  const game = new Game(map, createPhysicsWorld(map), seeded(7))
  game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
  await game.useSaves(store)
  const director = (game.match as unknown as { survival: SurvivalDirector }).survival
  const insides = director as unknown as {
    survivors: Map<number, { self: SurvivalSelf; dirty: boolean }>
    consume(sv: unknown, def: unknown): boolean
  }
  const join = async (name: string, account: string): Promise<ServerPlayer> => {
    await game.saves.loadCharacter(account)
    const id = game.join(name, { ...NO_SEND, account })
    const p = id === null ? undefined : game.players.get(id)
    if (!p) throw new Error('no player')
    return p
  }
  const sv = (p: ServerPlayer) => {
    const s = insides.survivors.get(p.id)
    if (!s) throw new Error('not a survivor')
    return s
  }
  const zed = () => {
    const z = director.poolIds.map((id) => game.players.get(id)).find(Boolean)
    if (!z) throw new Error('no dead about')
    return z
  }
  return { game, director, insides, join, sv, zed }
}

const ACCOUNT = 'b'.repeat(32)

describe('skills on the server', () => {
  test('a gun hit on one of the dead teaches Aim; a swing teaches Melee', async () => {
    const { director, join, sv, zed } = await server(new MemoryStore())
    const p = await join('Ada', ACCOUNT)
    p.state.weapon = createWeaponState(WeaponId.Handgun)
    director.onDamage(zed(), p, 10)
    expect(sv(p).self.skills?.xp.aim).toBe(SKILL_GAIN.gunHit)
    p.state.weapon = createWeaponState(WeaponId.Bat)
    director.onDamage(zed(), p, 10)
    expect(sv(p).self.skills?.xp.melee).toBe(SKILL_GAIN.meleeHit)
    // A miss (no damage) teaches nothing.
    director.onDamage(zed(), p, 0)
    expect(sv(p).self.skills?.xp.melee).toBe(SKILL_GAIN.meleeHit)
  })

  test('a level-up is told and takes effect: handling, melee damage', async () => {
    const { director, join, sv } = await server(new MemoryStore())
    const p = await join('Ada', ACCOUNT)
    const s = sv(p)
    expect(director.meleeDamage(p)).toBe(1)
    director.skills.gain(s, 'aim', SKILL_XP[2] as number)
    director.skills.gain(s, 'melee', SKILL_XP[5] as number)
    expect(skillLevel(s.self.skills, 'aim')).toBe(2)
    expect(p.body.weaponRules.aimSpeed).toBeCloseTo(1.1)
    expect(p.body.weaponRules.swayScale).toBeCloseTo(0.9)
    expect(p.body.weaponRules.swingTime).toBeCloseTo(0.8)
    expect(director.meleeDamage(p)).toBeCloseTo(1.25)
    // The rules' own handling is kept underneath.
    expect(p.body.weaponRules.spreadScale).toBe(DEFAULT_RULES.spread)
  })

  test('a field manual, read through, triples what its skill learns', async () => {
    const { director, insides, join, sv } = await server(new MemoryStore())
    const p = await join('Ada', ACCOUNT)
    const s = sv(p)
    expect(insides.consume(s, ITEMS.manual_medic)).toBe(true)
    expect(s.self.skills?.read?.medic).toBeGreaterThan(0)
    director.skills.gain(s, 'medic', 4)
    director.skills.gain(s, 'aim', 4)
    expect(s.self.skills?.xp.medic).toBe(4 * MANUAL_BOOST)
    expect(s.self.skills?.xp.aim).toBe(4)
  })

  test('Medic: bandages heal more and teach', async () => {
    const { director, insides, join, sv } = await server(new MemoryStore())
    const p = await join('Ada', ACCOUNT)
    const s = sv(p)
    const medkit = ITEMS.medkit
    if (!medkit?.health) throw new Error('no medkit')
    p.health = 10
    insides.consume(s, medkit)
    const plain = p.health - 10
    expect(s.self.skills?.xp.medic).toBeGreaterThan(SKILL_GAIN.medUse)
    director.skills.gain(s, 'medic', SKILL_XP[5] as number)
    p.health = 10
    insides.consume(s, medkit)
    expect(p.health - 10).toBe(Math.round(medkit.health * 1.25))
    expect(p.health - 10).toBeGreaterThan(plain)
  })

  test('Carpentry: boards nailed by a carpenter take less battering', async () => {
    const { director, join, sv } = await server(new MemoryStore())
    const p = await join('Ada', ACCOUNT)
    const s = sv(p)
    director.skills.nailed(s, 3)
    expect(director.skills.boardDamage(3)).toBe(1)
    director.skills.gain(s, 'carpentry', SKILL_XP[5] as number)
    director.skills.nailed(s, 3)
    expect(director.skills.boardDamage(3)).toBeCloseTo(0.75)
    director.skills.cleared(3)
    expect(director.skills.boardDamage(3)).toBe(1)
  })

  test('skills are saved with the character and come back', async () => {
    const store = new MemoryStore()
    const a = await server(store)
    const p = await a.join('Ada', ACCOUNT)
    a.director.skills.gain(a.sv(p), 'stealth', 500)
    a.director.skills.read(a.sv(p), 'fitness')
    a.game.leave(p.id)
    await a.game.saves.flush()

    const b = await server(store)
    const q = await b.join('Ada', ACCOUNT)
    const skills = b.sv(q).self.skills
    expect(skills?.xp.stealth).toBe(500)
    expect(skills?.read?.fitness).toBeGreaterThan(0)
    expect(skillLevel(skills, 'stealth')).toBe(3)
  })

  test('an old save without skills starts with none', async () => {
    const store = new MemoryStore()
    const a = await server(store)
    const p = await a.join('Ada', ACCOUNT)
    delete a.sv(p).self.skills
    a.game.leave(p.id)
    await a.game.saves.flush()
    const b = await server(store)
    const q = await b.join('Ada', ACCOUNT)
    expect(b.sv(q).self.skills).toEqual({ xp: {} })
  })

  test('skills die with the character', async () => {
    const { director, join, sv, zed } = await server(new MemoryStore())
    const p = await join('Ada', ACCOUNT)
    sv(p).self.age = 1e6 // no newcomer's luck
    director.skills.gain(sv(p), 'aim', 300)
    p.health = 0
    director.onKill(p, zed())
    expect(sv(p).self.skills?.xp.aim ?? 0).toBe(0)
  })
})
