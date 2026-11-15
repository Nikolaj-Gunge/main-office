import { beforeAll, describe, expect, test } from 'bun:test'
import {
  ClientMsg,
  createPhysicsWorld,
  DEFAULT_RULES,
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeServerMessage,
  give,
  initPhysics,
  loadMap,
  MAX_VOICE_PEERS,
  mergeRules,
  RADIO_ITEM,
  type ServerMessage,
  ServerMsg,
  type SurvivalSelf,
  seeded,
  TICK_RATE,
  VOICE_DROP,
  VOICE_NOISE,
  VOICE_RANGE,
  type VoiceEvent,
  voiceLevel,
  voiceLinks,
} from '@office-fps/shared'
import { Game, type ServerPlayer } from './game.ts'
import { MessageLimiter } from './rate-limit.ts'
import { type VoiceHost, VoiceHub } from './voice.ts'

const OFFER = { sdp: { type: 'offer' as const, sdp: 'v=0\r\n' } }
const ICE = { ice: { candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host', sdpMid: '0' } }

/** A pretend game: players at chosen spots, and everything each one was sent. */
function world() {
  const players = new Map<number, ServerPlayer>()
  const inbox = new Map<number, VoiceEvent[]>()
  const muted = new Set<string>()
  const radios = new Set<number>()
  const noise: { id: number; metres: number }[] = []
  const host: VoiceHost & { tick: number } = {
    players,
    tick: 1000,
    sendTo(player, msg: ServerMessage) {
      if (msg.type === ServerMsg.Voice) inbox.get(player.id)?.push(msg.voice)
    },
    social: { isMuted: (listener, speaker) => muted.has(`${listener}>${speaker}`) },
    match: {
      survivalDirector: {
        carries: (p, item) => item === RADIO_ITEM && radios.has(p.id),
        voiceNoise: (p, metres) => void noise.push({ id: p.id, metres }),
      },
    },
  }
  const hub = new VoiceHub(host)
  const add = (id: number, x: number, extra: Partial<ServerPlayer> = {}) => {
    const p = {
      id,
      name: `P${id}`,
      state: { pos: { x, y: 0, z: 0 }, alive: true },
      ...extra,
    } as unknown as ServerPlayer
    players.set(id, p)
    inbox.set(id, [])
    return p
  }
  /** Adds a player with voice switched on. */
  const on = (id: number, x: number, extra: Partial<ServerPlayer> = {}) => {
    const p = add(id, x, extra)
    hub.handle(p, { kind: 'on', on: true })
    return p
  }
  const got = (id: number) => inbox.get(id) ?? []
  /** The peers last announced to `id` (ids, sorted). */
  const peers = (id: number) =>
    (
      got(id)
        .filter((e) => e.kind === 'peers')
        .at(-1) as Extract<VoiceEvent, { kind: 'peers' }> | undefined
    )?.peers
      .map((p) => p.id)
      .sort((a, b) => a - b) ?? []
  const clear = () => {
    for (const list of inbox.values()) list.length = 0
  }
  return { host, hub, add, on, got, peers, clear, muted, radios, noise, players }
}

describe('voice links', () => {
  test('only people with voice on, within range, get linked', () => {
    const w = world()
    w.on(1, 0)
    w.on(2, VOICE_RANGE - 1)
    w.on(3, VOICE_RANGE + 5) // 45 m from 1, 6 m from 2
    w.add(4, 1) // voice off
    w.hub.update()
    expect(w.peers(1)).toEqual([2])
    expect(w.peers(2)).toEqual([1, 3])
    expect(w.peers(3)).toEqual([2])
    expect(w.got(4)).toEqual([])
  })

  test('a link holds until VOICE_DROP (hysteresis), then drops', () => {
    const w = world()
    w.on(1, 0)
    const b = w.on(2, 10)
    w.hub.update()
    expect(w.hub.peersOf(1).map((p) => p.id)).toEqual([2])
    b.state.pos.x = (VOICE_RANGE + VOICE_DROP) / 2
    w.hub.update()
    expect(w.hub.peersOf(1).map((p) => p.id)).toEqual([2])
    b.state.pos.x = VOICE_DROP + 1
    w.hub.update()
    expect(w.hub.peersOf(1)).toEqual([])
    // Coming back, it links again only inside VOICE_RANGE.
    b.state.pos.x = (VOICE_RANGE + VOICE_DROP) / 2
    w.hub.update()
    expect(w.hub.peersOf(1)).toEqual([])
    b.state.pos.x = VOICE_RANGE - 1
    w.hub.update()
    expect(w.hub.peersOf(1).map((p) => p.id)).toEqual([2])
  })

  test('each person gets at most MAX_VOICE_PEERS, the nearest, and links stay symmetric', () => {
    const w = world()
    for (let i = 1; i <= 10; i++) w.on(i, i)
    w.hub.update()
    for (let i = 1; i <= 10; i++) {
      const mine = w.hub.peersOf(i)
      expect(mine.length).toBeLessThanOrEqual(MAX_VOICE_PEERS)
      for (const p of mine) expect(w.hub.peersOf(p.id).some((q) => q.id === i)).toBe(true)
    }
    expect(w.hub.peersOf(1).map((p) => p.id)).toEqual([2, 3, 4, 5, 6, 7])
  })

  test('kept links are not dropped for somebody nearer', () => {
    const links = voiceLinks(
      [
        { id: 1, x: 0, y: 0, z: 0, radio: false },
        { id: 2, x: 30, y: 0, z: 0, radio: false },
        { id: 3, x: 1, y: 0, z: 0, radio: false },
      ],
      new Set(['1:2']),
      new Set(),
      1,
    )
    expect(links.get(1)).toEqual([{ id: 2 }])
    expect(links.get(3)).toEqual([])
  })

  test('the dead go silent: no links until they are alive again', () => {
    const w = world()
    w.on(1, 0)
    const b = w.on(2, 5)
    w.hub.update()
    expect(w.peers(1)).toEqual([2])
    b.state.alive = false
    w.hub.update()
    expect(w.peers(1)).toEqual([])
    expect(w.peers(2)).toEqual([])
    b.state.alive = true
    w.hub.update()
    expect(w.peers(1)).toEqual([2])
  })

  test('zombies, bots and dummies cannot switch voice on', () => {
    const w = world()
    w.on(1, 0)
    w.on(2, 1, { bot: {} } as Partial<ServerPlayer>)
    w.on(3, 1, { zombie: {} } as Partial<ServerPlayer>)
    w.hub.update()
    expect(w.hub.isOn(2)).toBe(false)
    expect(w.hub.isOn(3)).toBe(false)
    expect(w.peers(1)).toEqual([])
  })

  test('muting either way keeps two people unlinked', () => {
    const w = world()
    w.on(1, 0)
    w.on(2, 5)
    w.muted.add('2>1')
    w.hub.update()
    expect(w.peers(1)).toEqual([])
    w.muted.clear()
    w.hub.update()
    expect(w.peers(1)).toEqual([2])
  })

  test('two radios talk at any range; one radio is not enough', () => {
    const w = world()
    w.on(1, 0)
    w.on(2, 2000)
    w.on(3, 3000)
    w.radios.add(1)
    w.radios.add(2)
    w.hub.update()
    expect(w.hub.peersOf(1)).toEqual([{ id: 2, radio: true }])
    expect(w.hub.peersOf(3)).toEqual([])
  })

  test('only changes are sent; switching off drops the links', () => {
    const w = world()
    const a = w.on(1, 0)
    w.on(2, 5)
    w.hub.update()
    w.clear()
    w.hub.update()
    expect(w.got(1)).toEqual([])
    w.hub.handle(a, { kind: 'on', on: false })
    expect(w.hub.isOn(1)).toBe(false)
    expect(w.peers(2)).toEqual([])
  })
})

describe('voice signalling', () => {
  test('handshake steps pass only between linked people, cleaned', () => {
    const w = world()
    const a = w.on(1, 0)
    w.on(2, 5)
    w.on(3, 500)
    w.hub.update()
    w.clear()
    w.hub.handle(a, { kind: 'signal', to: 2, signal: { ...OFFER, extra: 'x' } as never })
    w.hub.handle(a, { kind: 'signal', to: 2, signal: ICE })
    w.hub.handle(a, { kind: 'signal', to: 3, signal: OFFER })
    w.hub.handle(a, { kind: 'signal', to: 99, signal: OFFER })
    expect(w.got(2)).toEqual([
      { kind: 'signal', from: 1, signal: OFFER },
      { kind: 'signal', from: 1, signal: ICE },
    ])
    expect(w.got(3)).toEqual([])
  })

  test('malformed or oversized signals are dropped', () => {
    const w = world()
    const a = w.on(1, 0)
    w.on(2, 5)
    w.hub.update()
    w.clear()
    const bad: unknown[] = [
      null,
      'offer',
      { sdp: { type: 'pranswer', sdp: 'v=0' } },
      { sdp: { type: 'offer', sdp: 'x'.repeat(20000) } },
      { ice: { candidate: 5 } },
      { ice: { candidate: 'c', sdpMLineIndex: 'zero' } },
    ]
    for (const signal of bad) w.hub.handle(a, { kind: 'signal', to: 2, signal } as never)
    expect(w.got(2)).toEqual([])
  })

  test('signals are rate limited per sender', () => {
    const w = world()
    const a = w.on(1, 0)
    w.on(2, 5)
    w.hub.update()
    w.clear()
    for (let i = 0; i < 100; i++) w.hub.handle(a, { kind: 'signal', to: 2, signal: ICE })
    expect(w.got(2).length).toBe(40)
    w.host.tick += TICK_RATE // a second later: 8 more
    for (let i = 0; i < 100; i++) w.hub.handle(a, { kind: 'signal', to: 2, signal: ICE })
    expect(w.got(2).length).toBe(48)
  })

  test('voice messages survive the wire both ways', () => {
    const req = { type: ClientMsg.Voice, voice: { kind: 'signal', to: 7, signal: ICE } } as const
    expect(decodeClientMessage(encodeClientMessage(req))).toEqual(req)
    const ev: ServerMessage = {
      type: ServerMsg.Voice,
      voice: { kind: 'peers', peers: [{ id: 2 }, { id: 9, radio: true }] },
    }
    expect(decodeServerMessage(encodeServerMessage(ev))).toEqual(ev)
  })

  test('the connection limiter has a bucket for voice messages', () => {
    const limiter = new MessageLimiter(() => {})
    let allowed = 0
    for (let i = 0; i < 200; i++) if (limiter.allow(ClientMsg.Voice, () => 'x', 0)) allowed++
    expect(allowed).toBeGreaterThan(10)
    expect(allowed).toBeLessThan(200)
  })
})

describe('voice: talking', () => {
  test('push-to-talk is relayed to linked people only, and makes noise when loud', () => {
    const w = world()
    const a = w.on(1, 0)
    w.on(2, 5)
    w.on(3, 500)
    w.hub.update()
    w.clear()
    w.hub.handle(a, { kind: 'talk', talking: true, level: 3 })
    expect(w.got(2)).toEqual([{ kind: 'talk', from: 1, talking: true }])
    expect(w.got(3)).toEqual([])
    expect(w.noise).toEqual([{ id: 1, metres: VOICE_NOISE[3] }])
    // Still talking, quieter: noise again, no repeat of the speaking mark.
    w.host.tick += TICK_RATE
    w.hub.handle(a, { kind: 'talk', talking: true, level: 0 })
    expect(w.got(2).length).toBe(1)
    expect(w.noise.length).toBe(1)
    w.hub.handle(a, { kind: 'talk', talking: false })
    expect(w.got(2).at(-1)).toEqual({ kind: 'talk', from: 1, talking: false })
  })

  test('the dead make no noise talking, and talk updates are rate limited', () => {
    const w = world()
    const a = w.on(1, 0)
    a.state.alive = false
    for (let i = 0; i < 20; i++) w.hub.handle(a, { kind: 'talk', talking: true, level: 3 })
    expect(w.noise).toEqual([])
    a.state.alive = true
    w.host.tick += TICK_RATE // the dead used up the burst: a second later, 4 more
    for (let i = 0; i < 20; i++) w.hub.handle(a, { kind: 'talk', talking: true, level: 2 })
    expect(w.noise.length).toBe(4)
  })

  test('loudness from a mic level', () => {
    expect(voiceLevel(0)).toBe(0)
    expect(voiceLevel(0.05)).toBe(1)
    expect(voiceLevel(0.2)).toBe(2)
    expect(voiceLevel(0.6)).toBe(3)
  })
})

describe('voice in a survival game', () => {
  beforeAll(async () => {
    await initPhysics()
  })

  test('radios link across the map; a shout carries to the dead', () => {
    const map = loadMap('deadwood')
    const game = new Game(map, createPhysicsWorld(map), seeded(3))
    const inbox = new Map<number, ServerMessage[]>()
    const join = (name: string) => {
      const list: ServerMessage[] = []
      const client = { send: (b: Uint8Array) => list.push(decodeServerMessage(b)) }
      const id = game.join(name, client) ?? 0
      inbox.set(id, list)
      return id
    }
    const a = join('A')
    const b = join('B')
    game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
    for (let i = 0; i < TICK_RATE; i++) game.step()
    const pa = game.players.get(a) as ServerPlayer
    const pb = game.players.get(b) as ServerPlayer
    pb.state.pos = { ...pa.state.pos, x: pa.state.pos.x + 900 }
    game.handleVoice(a, { kind: 'on', on: true })
    game.handleVoice(b, { kind: 'on', on: true })
    expect(game.voice.peersOf(a)).toEqual([])

    const inside = (
      game.match as unknown as {
        survival: {
          survivors: Map<number, { self: SurvivalSelf }>
          heardFrom(p: ServerPlayer): number
        }
      }
    ).survival
    for (const id of [a, b]) {
      const self = inside.survivors.get(id)?.self as SurvivalSelf
      self.pack = 'pack_hiking'
      expect(give(self, RADIO_ITEM, 1)).toBe(1)
    }
    game.voice.update()
    expect(game.voice.peersOf(a)).toEqual([{ id: b, radio: true }])
    const peers = inbox
      .get(b)
      ?.filter((m) => m.type === ServerMsg.Voice && m.voice.kind === 'peers')
      .at(-1)
    expect(peers).toEqual({
      type: ServerMsg.Voice,
      voice: { kind: 'peers', peers: [{ id: a, radio: true }] },
    })

    pa.state.vel = { x: 0, y: 0, z: 0 }
    const quiet = inside.heardFrom(pa)
    game.handleVoice(a, { kind: 'talk', talking: true, level: 3 })
    expect(inside.heardFrom(pa)).toBeGreaterThan(quiet)
    expect(inside.heardFrom(pa)).toBeLessThanOrEqual(VOICE_NOISE[3])
  })
})
