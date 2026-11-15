import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_WORLD_ID,
  isPrivateWorld,
  listWorlds,
  PRESENCE_STALE_MS,
  parseWorldId,
  pickWorld,
  presenceCounts,
  privateWorldId,
  reportPresence,
  roomName,
  routeWorld,
  WORLD_SOFT_CAP,
  worldName,
  worldsReply,
} from './worlds.ts'

describe('world ids', () => {
  test('public names and private codes parse; junk does not', () => {
    expect(parseWorldId('deadwood-2')).toBe('deadwood-2')
    expect(parseWorldId(' Deadwood-1 ')).toBe('deadwood-1')
    expect(parseWorldId('p-abcd2345')).toBe('p-abcd2345')
    expect(parseWorldId('deadwood-99')).toBeNull()
    expect(parseWorldId('p-short')).toBeNull()
    expect(parseWorldId('../world')).toBeNull()
    expect(parseWorldId(null)).toBeNull()
  })

  test('fresh private codes are valid and differ', () => {
    const a = privateWorldId()
    const b = privateWorldId()
    expect(isPrivateWorld(a)).toBe(true)
    expect(parseWorldId(a)).toBe(a)
    expect(a).not.toBe(b)
    expect(worldName('p-abcd2345')).toBe('Private abcd2345')
  })

  test('routing: unknown or missing goes to the original world', () => {
    expect(routeWorld(undefined)).toBe(DEFAULT_WORLD_ID)
    expect(routeWorld('nope')).toBe(DEFAULT_WORLD_ID)
    expect(routeWorld('deadwood-3')).toBe('deadwood-3')
  })

  test('the original world keeps its old room name, others get their own', () => {
    expect(roomName(DEFAULT_WORLD_ID, 33)).toBe('office-v33')
    expect(roomName('deadwood-2', 33)).toBe('office-v33-deadwood-2')
    expect(roomName('p-abcd2345', 33)).toBe('office-v33-p-abcd2345')
  })
})

describe('pickWorld', () => {
  test('fills the busiest world that has room', () => {
    expect(pickWorld(listWorlds({ 'deadwood-1': 2, 'deadwood-2': 5 }))).toBe('deadwood-2')
  })

  test('ties (and an empty server) go to the earlier world', () => {
    expect(pickWorld(listWorlds({}))).toBe('deadwood-1')
    expect(pickWorld(listWorlds({ 'deadwood-1': 3, 'deadwood-2': 3 }))).toBe('deadwood-1')
  })

  test('skips full worlds', () => {
    const counts = { 'deadwood-1': WORLD_SOFT_CAP, 'deadwood-2': 1 }
    const worlds = listWorlds(counts)
    expect(worlds[0]?.full).toBe(true)
    expect(pickWorld(worlds)).toBe('deadwood-2')
  })

  test('all full: the emptiest', () => {
    const counts = {
      'deadwood-1': WORLD_SOFT_CAP + 3,
      'deadwood-2': WORLD_SOFT_CAP,
      'deadwood-3': WORLD_SOFT_CAP + 1,
    }
    expect(pickWorld(listWorlds(counts))).toBe('deadwood-2')
  })

  test('the /worlds reply lists every public world with its pick', () => {
    const reply = worldsReply({ 'deadwood-3': 4 })
    expect(reply.worlds.map((w) => w.players)).toEqual([0, 0, 4])
    expect(reply.pick).toBe('deadwood-3')
  })
})

describe('presence', () => {
  test('keeps public counts, ignores private worlds, forgets stale ones', () => {
    let p = reportPresence({}, 'deadwood-1', 3, 1000)
    p = reportPresence(p, 'p-abcd2345', 2, 1000)
    p = reportPresence(p, 'deadwood-2', 1, 1000 + PRESENCE_STALE_MS)
    expect(Object.keys(p).sort()).toEqual(['deadwood-1', 'deadwood-2'])
    expect(presenceCounts(p, 2000)).toEqual({ 'deadwood-1': 3, 'deadwood-2': 1 })
    expect(presenceCounts(p, 1000 + PRESENCE_STALE_MS + 1)).toEqual({ 'deadwood-2': 1 })
  })

  test('a private report changes nothing (no storage write)', () => {
    const p = reportPresence({}, 'deadwood-1', 1, 0)
    expect(reportPresence(p, 'p-abcd2345', 4, 0)).toBe(p)
  })
})
