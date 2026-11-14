import { describe, expect, test } from 'bun:test'
import {
  CHAT_MAX,
  cleanChat,
  DEFAULT_RULES,
  filterProfanity,
  type GameRules,
  type ModeId,
  RateLimit,
  type ServerMessage,
  ServerMsg,
  type SocialEvent,
  TICK_RATE,
} from '@office-fps/shared'
import type { ServerPlayer } from './game.ts'
import { type SocialHost, SocialRelay } from './social.ts'

/** A pretend game: players at chosen spots, and everything each one was sent. */
function world(mode: ModeId) {
  const players = new Map<number, ServerPlayer>()
  const inbox = new Map<number, SocialEvent[]>()
  const host: SocialHost & { tick: number } = {
    players,
    tick: 1000,
    rules: { ...DEFAULT_RULES, mode } as GameRules,
    sendTo(player: ServerPlayer, msg: ServerMessage) {
      if (msg.type === ServerMsg.Social) inbox.get(player.id)?.push(msg.social)
    },
  }
  const add = (id: number, x: number, team = 1, extra: Partial<ServerPlayer> = {}) => {
    const p = {
      id,
      name: `P${id}`,
      team,
      state: { pos: { x, y: 0, z: 0 }, alive: true },
      ...extra,
    } as unknown as ServerPlayer
    players.set(id, p)
    inbox.set(id, [])
    return p
  }
  const relay = new SocialRelay(host)
  const got = (id: number) => inbox.get(id) ?? []
  return { host, relay, add, got }
}

describe('chat cleaning', () => {
  test('strips control characters and markup, collapses spaces, caps the length', () => {
    expect(cleanChat('  hi\u0000\u0007 <b>there</b>\n\n friend ')).toBe('hi bthere/b friend')
    expect(cleanChat('‮evil')).toBe('evil')
    expect(cleanChat('   ')).toBe('')
    expect(cleanChat('x'.repeat(500))).toHaveLength(CHAT_MAX)
  })

  test('the profanity filter hides listed words, not the words they hide in', () => {
    expect(filterProfanity('oh shit, a FUCKING horde')).toBe('oh ****, a ******* horde')
    expect(filterProfanity('Scunthorpe class assassin')).toBe('Scunthorpe class assassin')
  })

  test('rate limit: a burst, then one per interval', () => {
    const limit = new RateLimit(3, 5 / 3)
    expect([0, 0, 0, 0].map(() => limit.take(0))).toEqual([true, true, true, false])
    expect(limit.take(1)).toBe(false)
    expect(limit.take(1.7)).toBe(true)
    expect(limit.take(1.7)).toBe(false)
  })
})

describe('SocialRelay', () => {
  test('survival: nearby chat reaches 40 m, "all" reaches everyone; the sender sees it too', () => {
    const { relay, add, got } = world('survival')
    const me = add(1, 0)
    add(2, 30)
    add(3, 90)
    relay.handle(me, { kind: 'chat', text: 'anyone <there>?', channel: 'nearby' })
    expect(got(1)).toEqual([
      { kind: 'chat', from: 1, name: 'P1', text: 'anyone there?', channel: 'nearby' },
    ])
    expect(got(2)).toHaveLength(1)
    expect(got(3)).toHaveLength(0)
    relay.handle(me, { kind: 'chat', text: 'heading to Haven', channel: 'all' })
    expect(got(3)).toMatchObject([{ text: 'heading to Haven', channel: 'all' }])
    // "team" isn't a survival channel: it goes out as nearby.
    relay.handle(me, { kind: 'chat', text: 'x', channel: 'team' })
    expect(got(3)).toHaveLength(1)
  })

  test('arena: team chat stays on the team; ffa has no teams, so it goes to all', () => {
    const tdm = world('tdm')
    const a = tdm.add(1, 0, 1)
    tdm.add(2, 500, 1)
    tdm.add(3, 1, 2)
    tdm.relay.handle(a, { kind: 'chat', text: 'push B', channel: 'team' })
    expect(tdm.got(2)).toMatchObject([{ channel: 'team' }])
    expect(tdm.got(3)).toHaveLength(0)
    const ffa = world('ffa')
    const b = ffa.add(1, 0)
    ffa.add(2, 900)
    ffa.relay.handle(b, { kind: 'chat', text: 'gg', channel: 'team' })
    expect(ffa.got(2)).toMatchObject([{ channel: 'all' }])
  })

  test('zombies, bots and junk get nothing through', () => {
    const { relay, add, got } = world('survival')
    const me = add(1, 0)
    add(2, 1, 2, { zombie: {} as NonNullable<ServerPlayer['zombie']> })
    relay.handle(me, { kind: 'chat', text: '\u0001\u0002', channel: 'nearby' })
    relay.handle(me, { kind: 'chat', text: 42 as unknown as string, channel: 'nearby' })
    relay.handle(me, { kind: 'ping', ping: 'nuke' as 'go', x: 0, y: 0, z: 0 })
    relay.handle(me, { kind: 'ping', ping: 'go', x: Number.NaN, y: 0, z: 0 })
    relay.handle(me, { kind: 'ping', ping: 'go', x: 5000, y: 0, z: 0 })
    relay.handle(me, null as unknown as { kind: 'emote' })
    expect(got(1)).toHaveLength(0)
    expect(got(2)).toHaveLength(0)
  })

  test('chat is rate limited (3 at once), with one warning', () => {
    const { host, relay, add, got } = world('survival')
    const me = add(1, 0)
    for (let i = 0; i < 6; i++) relay.handle(me, { kind: 'chat', text: `m${i}`, channel: 'all' })
    const chats = got(1).filter((e) => e.kind === 'chat')
    const warnings = got(1).filter((e) => e.kind === 'system')
    expect(chats).toHaveLength(3)
    expect(warnings).toHaveLength(1)
    host.tick += 2 * TICK_RATE
    relay.handle(me, { kind: 'chat', text: 'later', channel: 'all' })
    expect(got(1).at(-1)).toMatchObject({ kind: 'chat', text: 'later' })
  })

  test('pings: within 150 m in survival; a team hears its own wherever they are', () => {
    const s = world('survival')
    const me = s.add(1, 0)
    s.add(2, 140)
    s.add(3, 200)
    s.relay.handle(me, { kind: 'ping', ping: 'zombie', x: 10, y: 0, z: 5 })
    expect(s.got(1)).toEqual([{ kind: 'ping', from: 1, ping: 'zombie', x: 10, y: 0, z: 5 }])
    expect(s.got(2)).toHaveLength(1)
    expect(s.got(3)).toHaveLength(0)
    const tdm = world('tdm')
    const a = tdm.add(1, 0, 1)
    tdm.add(2, 900, 1)
    tdm.add(3, 2, 2)
    tdm.relay.handle(a, { kind: 'ping', ping: 'go', x: 1, y: 0, z: 1 })
    expect(tdm.got(2)).toHaveLength(1)
    expect(tdm.got(3)).toHaveLength(0)
  })

  test('emote: seen within 60 m in survival, once per 3 s, not from the dead', () => {
    const { host, relay, add, got } = world('survival')
    const me = add(1, 0)
    add(2, 50)
    add(3, 70)
    relay.handle(me, { kind: 'emote' })
    relay.handle(me, { kind: 'emote' })
    expect(got(2)).toEqual([{ kind: 'emote', from: 1 }])
    expect(got(3)).toHaveLength(0)
    host.tick += 3 * TICK_RATE
    me.state.alive = false
    relay.handle(me, { kind: 'emote' })
    expect(got(2)).toHaveLength(1)
  })

  test('mute: the muted player is no longer heard by whoever muted them, until unmuted', () => {
    const { relay, add, got, host } = world('survival')
    const me = add(1, 0)
    const loud = add(2, 1)
    add(3, 2)
    relay.handle(me, { kind: 'mute', id: 2, muted: true })
    expect(got(1)).toEqual([{ kind: 'system', text: 'Muted P2.' }])
    relay.handle(loud, { kind: 'chat', text: 'spam', channel: 'all' })
    relay.handle(loud, { kind: 'ping', ping: 'help', x: 0, y: 0, z: 0 })
    relay.handle(loud, { kind: 'emote' })
    expect(got(1)).toHaveLength(1)
    expect(got(3)).toHaveLength(3)
    host.tick += 5 * TICK_RATE
    relay.handle(me, { kind: 'mute', id: 2, muted: false })
    relay.handle(loud, { kind: 'chat', text: 'back', channel: 'all' })
    expect(got(1).at(-1)).toMatchObject({ kind: 'chat', text: 'back' })
    // Muting yourself or nobody does nothing; leaving clears it all.
    relay.handle(me, { kind: 'mute', id: 1, muted: true })
    relay.handle(me, { kind: 'mute', id: 99, muted: true })
    relay.handle(me, { kind: 'mute', id: 2, muted: true })
    relay.forget(1)
    expect(relay.isMuted(1, 2)).toBe(false)
  })
})
