import { beforeAll, describe, expect, test } from 'bun:test'
import {
  Button,
  createPhysicsWorld,
  DEFAULT_RULES,
  decodeServerMessage,
  freshJournal,
  initPhysics,
  loadMap,
  mergeRules,
  QUESTS,
  questById,
  type ServerMessage,
  ServerMsg,
  type SurvivalSelf,
  seeded,
  stepGoal,
  TICK_RATE,
  walkerHideout,
} from '@office-fps/shared'
import { Game, type ServerPlayer } from '../game.ts'
import type { Story } from './story.ts'

beforeAll(async () => {
  await initPhysics()
})

interface Inside {
  survivors: Map<number, { player: ServerPlayer; self: SurvivalSelf }>
  story: Pick<Story, 'unlocks' | 'tick'> & {
    walkers: Map<string, { x: number; y: number; z: number; hp: number; follow: number }>
    siege: { hp: number; zeds: Set<ServerPlayer> } | null
  }
}

function setup(n = 1) {
  const map = loadMap('deadwood')
  const game = new Game(map, createPhysicsWorld(map), seeded(11))
  const clients = Array.from({ length: n }, () => {
    const inbox: ServerMessage[] = []
    return { inbox, send: (b: Uint8Array) => inbox.push(decodeServerMessage(b)) }
  })
  const ids = clients.map((c, i) => game.join(`P${i}`, c) ?? 0)
  game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
  const def = map.survival
  if (!def) throw new Error('no survival world')
  const inside = (game.match as unknown as { survival: Inside }).survival
  const sv = (i = 0) => {
    const s = inside.survivors.get(ids[i] ?? 0)
    if (!s) throw new Error('no survivor')
    return s
  }
  const last = <T extends ServerMessage['type']>(type: T, i = 0) =>
    clients[i]?.inbox
      .filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type)
      .at(-1)
  const run = (seconds: number) => {
    for (let k = 0; k < seconds * TICK_RATE; k++) game.step()
  }
  const seqs = ids.map(() => 1)
  /** Player i at a spot (feet), out of harm's way. */
  const move = (x: number, y: number, z: number, i = 0) => {
    const p = sv(i).player
    p.state.pos = { x, y, z }
    p.state.vel = { x: 0, y: 0, z: 0 }
    p.protectedUntil = Number.POSITIVE_INFINITY
  }
  /** Player i looks at a point and presses E. */
  const useAt = (x: number, y: number, z: number, i = 0) => {
    const s = sv(i).player.state
    const dx = x - s.pos.x
    const dy = y - (s.pos.y + 1.6)
    const dz = z - s.pos.z
    const yaw = Math.atan2(-dx, -dz)
    const pitch = Math.atan2(dy, Math.hypot(dx, dz))
    for (const buttons of [0, Button.Use, 0]) {
      const seq = (seqs[i] ?? 1) + 1
      seqs[i] = seq
      game.handleInput(ids[i] ?? 0, [{ seq, buttons, yaw, pitch, viewTick: game.tick }])
      game.step()
    }
  }
  /** Player i walks up to an NPC and talks. */
  const talkTo = (key: string, i = 0) => {
    const npc = def.npcs.find((p) => p.key === key)
    if (!npc) throw new Error(`no ${key}`)
    move(npc.pos[0], npc.pos[1], npc.pos[2] - 2, i)
    useAt(npc.pos[0], npc.pos[1] + 1.4, npc.pos[2], i)
    return last(ServerMsg.Dialog, i)?.dialog
  }
  const answer = (npc: string, option: string, i = 0) =>
    game.handleAction(ids[i] ?? 0, { a: 'choose', npc, option })
  /** Puts player i on a quest's step (their journal otherwise as it is). */
  const onStep = (id: string, step: number, i = 0) => {
    const j = sv(i).self.journal
    j.quests = j.quests.filter((q) => q.id !== id)
    j.quests.push({ id, step, count: 0 })
  }
  const quest = (id: string, i = 0) => sv(i).self.journal.quests.find((q) => q.id === id)
  return { game, def, inside, sv, last, run, move, useAt, talkTo, answer, onStep, quest }
}

describe('quests: the journal is yours', () => {
  test('progress is per player, and dying starts a new journal but keeps what the world gained', () => {
    const t = setup(2)
    t.run(1)
    expect(t.sv(0).self.journal.quests[0]?.id).toBe('wake')
    expect(t.sv(1).self.journal.quests[0]?.id).toBe('wake')
    // Player 0 reads the note; player 1 hasn't.
    const note = t.def.interactables.find((i) => i.key === 'start_note')
    if (!note) throw new Error('no note')
    t.move(note.pos[0] + 1, note.pos[1] - 0.8, note.pos[2])
    t.useAt(...note.pos)
    expect(t.quest('wake', 0)?.step).toBe(1)
    expect(t.quest('wake', 1)?.step).toBe(0)
    expect(t.sv(0).self.journal.notes).toContain('start_note')
    // The paper note shows with its title.
    const shown = t.last(ServerMsg.Notice)?.notice
    expect(shown?.kind).toBe('note')
    expect(shown?.title).toBe('Note on the cabin table')

    t.inside.story.unlocks.push('workshop')
    t.sv(0).self.journal.done.push('wake', 'keep')
    t.game.killPlayer(t.sv(0).player.id, t.sv(0).player.id)
    t.run(0.2)
    const j = t.sv(0).self.journal
    expect(j.done).toEqual([])
    expect(j.notes).toEqual([])
    // Somebody new wakes at Haven: their story starts there.
    expect(j.quests.map((q) => q.id)).toEqual(['keep'])
    expect(t.inside.story.unlocks).toContain('workshop')
  })
})

describe('quests: clues', () => {
  test('no waypoint until you have the clue, then only a search area', () => {
    const t = setup()
    const voss = questById('voss')
    const desk = voss?.steps[1]
    if (!desk) throw new Error('no step')
    const before = stepGoal(t.def, desk, { count: 0 }, freshJournal())
    expect(before.hidden).toBe(true)
    expect(before.points).toEqual([])
    const after = stepGoal(t.def, desk, { count: 0 }, { notes: ['bunker_note_1'] })
    expect(after.hidden).toBe(false)
    const town = t.def.pois.find((p) => p.key === 'millcreek')
    const thing = t.def.interactables.find((i) => i.key === 'voss_desk')
    if (!town || !thing) throw new Error('no town')
    // The middle of Mill Creek and a radius to search, not the desk itself.
    expect(after.points).toEqual([[town.x, town.y, town.z]])
    expect(after.area).toBeGreaterThan(town.r)
    expect(Math.hypot(thing.pos[0] - town.x, thing.pos[2] - town.z)).toBeLessThan(after.area)
  })

  test('reading the note in Bunker 12 is the clue that moves the trail on', () => {
    const t = setup()
    t.run(1)
    t.onStep('voss', 0)
    t.sv().self.journal.notes.push('hollis_locker')
    const note = t.def.interactables.find((i) => i.key === 'bunker_note_1')
    if (!note) throw new Error('no note')
    t.move(note.pos[0] + 0.9, note.pos[1] - 0.85, note.pos[2])
    t.useAt(...note.pos)
    expect(t.quest('voss')?.step).toBe(1)
    expect(t.sv().self.journal.notes).toContain('bunker_note_1')
    expect(t.last(ServerMsg.Notice)?.notice.text).toContain('his name is still on the house')
  })
})

describe('quests: choices', () => {
  test('who gets the penicillin decides the reward, the flag and what the world gains', () => {
    const t = setup(2)
    t.run(1)
    for (const i of [0, 1]) {
      t.onStep('vial', 1, i)
      t.sv(i).self.inv.push({ item: 'vial', n: 1 })
    }
    const asked = t.talkTo('lena', 0)
    expect(asked?.options.map((o) => o.id)).toEqual(['pick:vial:sam', 'pick:vial:ortiz', 'bye'])
    t.answer('lena', 'pick:vial:sam', 0)
    expect(t.sv(0).self.journal.done).toContain('vial')
    expect(t.sv(0).self.journal.flags).toContain('vial:sam')
    expect(t.sv(0).self.inv.some((s) => s.item === 'adrenaline')).toBe(true)
    expect(t.inside.story.unlocks).not.toContain('armoury')

    t.talkTo('lena', 1)
    t.answer('lena', 'pick:vial:ortiz', 1)
    expect(t.sv(1).self.journal.flags).toContain('vial:ortiz')
    expect(t.sv(1).self.inv.some((s) => s.item === 'militaryvest')).toBe(true)
    expect(t.inside.story.unlocks).toContain('armoury')
    // Gus now sells the army's leftovers (to everybody).
    t.talkTo('gus', 0)
    t.answer('gus', 'shop', 0)
    const shop = t.last(ServerMsg.Dialog, 0)?.dialog?.shop ?? []
    expect(shop.some(([id]) => id === 'm4')).toBe(true)
    // And people talk about it.
    expect(QUESTS.find((q) => q.id === 'vial')?.endings?.ortiz).toBeDefined()
  })

  test('the finale branches: the Haven ending skips the flight out', () => {
    const t = setup()
    t.run(1)
    t.onStep('lastlight', 0)
    t.talkTo('lena')
    t.answer('lena', 'pick:lastlight:haven')
    const q = t.quest('lastlight')
    const step = q && questById('lastlight')?.steps[q.step]
    expect(step?.kind).toBe('defend')
    expect(q?.pick).toBe('haven')
  })
})

describe('quests: escort', () => {
  test('Nell follows you, and getting her to Haven finishes the step and settles her there', () => {
    const t = setup()
    t.run(1)
    t.onStep('nell', 0)
    const hide = walkerHideout(t.def, 'nell')
    if (!hide) throw new Error('no hideout')
    t.move(hide[0] + 2, hide[1], hide[2])
    t.run(1.1)
    const key = `nell@${t.sv().player.id}`
    const nell = t.inside.story.walkers.get(key)
    if (!nell) throw new Error('nell is not there')
    t.useAt(nell.x, nell.y + 1.4, nell.z)
    expect(t.last(ServerMsg.Dialog)?.dialog?.name).toBe('Nell')
    expect(t.quest('nell')?.step).toBe(1)
    expect(nell.follow).toBe(t.sv().player.id)

    // She walks where you walked.
    const p = t.sv().player.state
    for (let k = 0; k < 120; k++) {
      p.pos = { x: p.pos.x + 0.1, y: p.pos.y, z: p.pos.z }
      t.game.step()
    }
    // A few steps behind while you move, and close once you stop.
    expect(Math.hypot(nell.x - p.pos.x, nell.z - p.pos.z)).toBeLessThan(7)
    t.run(1.5)
    expect(Math.hypot(nell.x - p.pos.x, nell.z - p.pos.z)).toBeLessThan(3)

    // At Haven's fire: delivered.
    const haven = t.def.pois.find((x) => x.key === 'haven')
    if (!haven) throw new Error('no haven')
    t.move(haven.x + 2, haven.y + 0.1, haven.z + 6)
    nell.x = haven.x
    nell.z = haven.z + 6
    nell.y = haven.y
    t.run(1.1)
    expect(t.quest('nell')?.step).toBe(2)
    expect(t.inside.story.unlocks).toContain('nell')
    expect(t.inside.story.walkers.has(key)).toBe(false)
    const home = t.inside.story.walkers.get('nell')
    if (!home) throw new Error('nell does not live at haven')
    // She tells you the rest, and gives you her card.
    t.move(home.x, home.y, home.z - 2)
    t.useAt(home.x, home.y + 1.4, home.z)
    expect(t.sv().self.journal.done).toContain('nell')
    expect(t.sv().self.inv.some((s) => s.item === 'keycard_blue')).toBe(true)
    expect(t.quest('site7')).toBeDefined()
    expect(t.game.match.info().survival?.walkers?.some((w) => w.key === 'nell')).toBe(true)
  })

  test('if Nell dies on the way, you get her card off her and the story goes on without her', () => {
    const t = setup()
    t.run(1)
    t.onStep('nell', 0)
    const hide = walkerHideout(t.def, 'nell')
    if (!hide) throw new Error('no hideout')
    t.move(hide[0] + 2, hide[1], hide[2])
    t.run(1.1)
    const nell = t.inside.story.walkers.get(`nell@${t.sv().player.id}`)
    if (!nell) throw new Error('nell is not there')
    t.useAt(nell.x, nell.y + 1.4, nell.z)
    nell.hp = 1
    t.run(3)
    const zombie = [...t.game.players.values()].find((p) => p.zombie && p.state.alive)
    if (!zombie) throw new Error('nothing dead about')
    zombie.state.pos = { x: nell.x + 0.5, y: nell.y, z: nell.z }
    t.inside.story.tick([])
    t.inside.story.tick([t.sv()])
    expect(t.sv().self.journal.done).toContain('nell')
    expect(t.sv().self.journal.flags).toContain('nell:dead')
    expect(t.sv().self.inv.some((s) => s.item === 'keycard_blue')).toBe(true)
    expect(t.inside.story.unlocks).not.toContain('nell')
  })
})

describe('quests: defend Haven', () => {
  test('telling Ortiz starts a siege everyone near is in; holding it finishes the step', () => {
    const t = setup(2)
    t.run(1)
    t.onStep('gate', 1)
    const d = t.talkTo('ortiz')
    expect(d?.options.some((o) => o.id === 'defend:gate')).toBe(true)
    t.answer('ortiz', 'defend:gate')
    expect(t.game.match.info().survival?.siege?.poi).toBe('haven')
    const haven = t.def.pois.find((p) => p.key === 'haven')
    if (!haven) throw new Error('no haven')
    t.move(haven.x + 3, haven.y + 0.1, haven.z - 20, 1)
    const money = t.sv(1).self.money
    let spawned = 0
    // The defenders put every one of them down as it comes.
    for (let s = 0; s < 125 && t.inside.story.siege; s++) {
      t.run(1)
      for (const z of t.inside.story.siege?.zeds ?? []) {
        spawned++
        t.game.retireZombie(z)
      }
    }
    expect(spawned).toBeGreaterThan(0)
    expect(t.inside.story.siege).toBeNull()
    expect(t.sv(0).self.journal.done).toContain('gate')
    expect(t.inside.story.unlocks).toContain('held')
    // Player 1 had no quest, but stood at the gate: paid, and their journal untouched.
    expect(t.sv(1).self.money).toBe(money + 40)
    expect(t.sv(1).self.journal.done).not.toContain('gate')
  })

  test('if they get inside the walls, the siege fails and can be tried again', () => {
    const t = setup()
    t.run(1)
    t.onStep('gate', 1)
    t.talkTo('ortiz')
    t.answer('ortiz', 'defend:gate')
    t.run(4)
    const siege = t.inside.story.siege
    const haven = t.def.pois.find((p) => p.key === 'haven')
    const z = siege && [...siege.zeds][0]
    if (!siege || !z || !haven) throw new Error('no siege')
    siege.hp = 2
    z.state.pos = { x: haven.x + 5, y: haven.y + 0.1, z: haven.z }
    t.run(1.05)
    expect(t.inside.story.siege).toBeNull()
    expect(t.quest('gate')?.step).toBe(1)
    expect(t.sv().self.journal.done).not.toContain('gate')
  })
})

describe('quests: Hollis', () => {
  test('he is waiting in Site 7; putting him down leaves his last words in your journal', () => {
    const t = setup()
    t.run(1)
    t.onStep('site7', 4)
    const site = t.def.pois.find((p) => p.key === 'site7')
    if (!site) throw new Error('no site 7')
    t.move(site.x, site.y + 0.2, site.z + site.r)
    t.run(1.1)
    const hollis = [...t.game.players.values()].find((p) => p.zombie && p.name === 'Hollis')
    if (!hollis) throw new Error('no Hollis')
    expect(hollis.state.alive).toBe(true)
    t.run(1)
    // Standing in his bunker, not fallen out of the world.
    expect(Math.abs(hollis.state.pos.y - site.y)).toBeLessThan(25)
    t.game.killPlayer(hollis.id, t.sv().player.id)
    t.run(0.1)
    expect(t.quest('site7')?.step).toBe(5)
    expect(t.sv().self.journal.notes).toContain('hollis_last')
  })
})
