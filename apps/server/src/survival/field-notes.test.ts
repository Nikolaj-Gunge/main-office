import { beforeAll, describe, expect, test } from 'bun:test'
import {
  createPhysicsWorld,
  createWeaponState,
  DEFAULT_RULES,
  type FieldNotes,
  initPhysics,
  loadMap,
  mergeRules,
  type SurvivalSelf,
  seeded,
  WeaponId,
} from '@office-fps/shared'
import { Game, type ServerPlayer } from '../game.ts'
import { MemoryStore, type SaveStore } from '../saves.ts'
import type { SurvivalDirector } from './director.ts'
import { NOTES_KEY } from './field-notes.ts'

beforeAll(async () => {
  await initPhysics()
})

async function server(store: SaveStore) {
  const map = loadMap('deadwood')
  const game = new Game(map, createPhysicsWorld(map), seeded(7))
  game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
  await game.useSaves(store)
  const director = (game.match as unknown as { survival: SurvivalDirector }).survival
  const insides = director as unknown as {
    survivors: Map<number, { self: SurvivalSelf }>
    note(sv: unknown, event: string, n?: number): void
  }
  const join = async (name: string, account: string): Promise<ServerPlayer> => {
    await game.saves.loadCharacter(account)
    await game.saves.loadAccount(account)
    const id = game.join(name, { send: () => {}, account })
    const p = id === null ? undefined : game.players.get(id)
    if (!p) throw new Error('no player')
    return p
  }
  const sv = (p: ServerPlayer) => {
    const s = insides.survivors.get(p.id)
    if (!s) throw new Error('not a survivor')
    return s
  }
  const notes = (p: ServerPlayer): FieldNotes => director.fieldNotes.of(sv(p) as never)
  return { game, director, insides, join, sv, notes }
}

describe('field notes on the server', () => {
  test('a knife kill counts for knife notes and the journal', async () => {
    const { game, director, join, notes } = await server(new MemoryStore())
    const p = await join('Ada', 'a'.repeat(32))
    p.state.weapon = createWeaponState(WeaponId.Knife)
    const zed = director.poolIds.map((id) => game.players.get(id)).find(Boolean)
    if (!zed) throw new Error('no dead about')
    director.onKill(zed, p)
    expect(notes(p).stats.kill).toBe(1)
    expect(notes(p).stats.kill_knife).toBe(1)
    expect(notes(p).got.map(([id]) => id)).toContain('first_kill')
  })

  test('cosmetics: only owned ones can be worn, and others see the hat', async () => {
    const { director, join, notes } = await server(new MemoryStore())
    const p = await join('Bo', 'b'.repeat(32))
    const before = director.gearOf(p)
    director.onAction(p, { a: 'cosmetic', kind: 'hat', id: 'hat_ranger' })
    expect(director.gearOf(p)).toBe(before)
    notes(p).owned.push('hat_ranger')
    director.onAction(p, { a: 'cosmetic', kind: 'hat', id: 'hat_ranger' })
    expect(director.gearOf(p) & 15).toBe(10)
    director.onAction(p, { a: 'cosmetic', kind: 'hat', id: null })
    expect(director.gearOf(p)).toBe(before)
  })

  test('kept in the account record: through death, leaving and a new world', async () => {
    const store = new MemoryStore()
    const account = 'c'.repeat(32)
    const first = await server(store)
    const p = await first.join('Cy', account)
    first.insides.note(first.sv(p), 'rescue')
    first.notes(p).owned.push('wrap_rust')
    first.director.onAction(p, { a: 'cosmetic', kind: 'wrap', id: 'wrap_rust' })
    // Dying makes somebody new; the record stays with the player.
    p.state.weapon = createWeaponState(WeaponId.Knife)
    first.sv(p).self.age = 99_999
    first.game.killPlayer(p.id, p.id)
    expect(first.notes(p).got.map(([id]) => id)).toContain('carried_home')
    expect(first.notes(p).stats.death).toBe(1)
    first.game.step()
    expect(first.sv(p).self.notes?.wear.wrap).toBe('wrap_rust')
    first.game.leave(p.id)
    await first.game.saves.flush()
    // Not in the character save: the account has it.
    expect(JSON.stringify(await store.get(`char:${account}`))).not.toContain('wrap_rust')
    expect(JSON.stringify(await store.get(`account:${account}`))).toContain('wrap_rust')

    const second = await server(store)
    second.game.saves.newWorld()
    const q = await second.join('Cy', account)
    expect(second.notes(q).wear.wrap).toBe('wrap_rust')
    expect(second.notes(q).got.map(([id]) => id)).toContain('carried_home')
    expect(second.game.saves.account(account)[NOTES_KEY]).toBeTruthy()
  })
})
