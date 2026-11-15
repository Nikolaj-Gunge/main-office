import { beforeAll, describe, expect, test } from 'bun:test'
import {
  createPhysicsWorld,
  DEFAULT_RULES,
  decodeServerMessage,
  initPhysics,
  loadMap,
  mergeRules,
  type Notice,
  type ServerMessage,
  ServerMsg,
  type SurvivalDef,
  seeded,
  TICK_RATE,
  WeaponId,
  ZombieKind,
} from '@office-fps/shared'
import { Game, type ServerPlayer } from '../game.ts'
import type { Point } from '../items.ts'
import {
  DRIFT_FAR,
  type FirstShotHost,
  FirstShotLesson,
  GROAN_DELAY,
  GUNFIRE_HINT,
  HINT_DELAY,
  LESSONS_KEY,
  learnt,
  MAX_DRIFTERS,
  type Shooter,
} from './first-shot.ts'
import { Zed } from './horde.ts'
import { SHIELD_SECONDS } from './newcomer.ts'

function world(
  o: { flocks?: { x: number; z: number }[]; zombies?: [number, number, ZombieKind][] } = {},
) {
  let now = 100
  const accounts = new Map<string, Record<string, unknown>>()
  const scattered: number[] = []
  const away = new Set<number>()
  const spawned: { at: Point; kind: ZombieKind; goal: Point }[] = []
  const sent: { id: number; notice: Notice }[] = []
  const zombies = (o.zombies ?? []).map(([x, z, kind]) => {
    const zed = new Zed(() => 0.5)
    zed.kind = kind
    return { player: { state: { pos: { x, y: 0, z }, alive: true } }, zed }
  })
  const host: FirstShotHost = {
    def: () =>
      ({ terrain: { heights: new Proxy([], { get: () => 0 }) } }) as unknown as SurvivalDef,
    random: () => 0.5,
    now: () => now,
    account: (a) => accounts.get(a) ?? {},
    putAccount: (a, key, value) => accounts.set(a, { ...accounts.get(a), [key]: value }),
    flocks: () => (o.flocks ?? []).map((f) => ({ ...f, n: 5 })),
    isAway: (i) => away.has(i),
    scatter: (i) => {
      away.add(i)
      scattered.push(i)
      return true
    },
    zombies: () => zombies,
    spawn: (at, kind, goal) => {
      spawned.push({ at, kind, goal })
      return true
    },
    hidden: () => true,
    notice: (id, notice) => sent.push({ id, notice }),
  }
  return {
    lesson: new FirstShotLesson(host),
    accounts,
    scattered,
    away,
    spawned,
    sent,
    zombies,
    wait: (s: number) => {
      now += s
    },
  }
}

const newcomer = (over: Partial<Shooter> = {}): Shooter => ({
  id: 7,
  account: 'acc',
  pos: { x: 0, y: 0, z: 0 },
  age: 60,
  safe: false,
  noise: 90,
  ...over,
})

describe('the first gunshot lesson', () => {
  test('the nearest flock takes off, a groan answers, then the hint; once per account', () => {
    const w = world({
      flocks: [
        { x: 200, z: 0 },
        { x: 40, z: 10 },
        { x: 900, z: 0 },
      ],
    })
    expect(w.lesson.onShot(newcomer())).toBe(true)
    expect(w.scattered).toEqual([1])
    expect(learnt(w.accounts.get('acc') ?? null)).toBe(true)
    w.lesson.step()
    expect(w.sent).toEqual([])
    w.wait(GROAN_DELAY)
    w.lesson.step()
    expect(w.sent.map((s) => s.notice.sound)).toEqual(['groan'])
    w.wait(HINT_DELAY)
    w.lesson.step()
    expect(w.sent[1]?.notice).toEqual({ kind: 'info', text: GUNFIRE_HINT, hint: 'gunfire' })
    expect(w.lesson.waiting).toBe(0)
    // Not again: the account remembers (a new visit, a new character).
    w.lesson.forget(7)
    expect(w.lesson.onShot(newcomer())).toBe(false)
  })

  test('a flock already in the air is skipped for the next nearest', () => {
    const w = world({
      flocks: [
        { x: 20, z: 0 },
        { x: 60, z: 0 },
      ],
    })
    w.away.add(0)
    w.lesson.onShot(newcomer())
    expect(w.scattered).toEqual([1])
  })

  test('up to two walkers nearby drift towards the shot; runners and close ones are left be', () => {
    const w = world({
      zombies: [
        [10, 0, ZombieKind.Walker], // too close: it heard anyway
        [60, 0, ZombieKind.Walker],
        [70, 0, ZombieKind.Runner],
        [80, 0, ZombieKind.Walker],
        [90, 0, ZombieKind.Walker],
        [DRIFT_FAR + 20, 0, ZombieKind.Walker],
      ],
    })
    w.lesson.onShot(newcomer({ pos: { x: 0, y: 0, z: 0 } }))
    w.wait(GROAN_DELAY)
    w.lesson.step()
    const drifting = w.zombies.filter((z) => z.zed.mood === 'investigate')
    expect(drifting.length).toBe(MAX_DRIFTERS)
    expect(drifting.map((z) => z.player.state.pos.x)).toEqual([60, 80])
    expect(w.spawned).toEqual([])
    // The groan comes from the nearest of them.
    expect(w.sent[0]?.notice.at?.x).toBe(60)
  })

  test('nothing out there: one walker comes from off in the trees', () => {
    const w = world()
    w.lesson.onShot(newcomer())
    w.wait(GROAN_DELAY)
    w.lesson.step()
    expect(w.spawned.length).toBe(1)
    expect(w.spawned[0]?.kind).toBe(ZombieKind.Walker)
    expect(Math.hypot(w.spawned[0]?.at.x ?? 0, w.spawned[0]?.at.z ?? 0)).toBeGreaterThan(60)
  })

  test('veterans, safe places and quiet guns are no lesson', () => {
    const w = world({ flocks: [{ x: 20, z: 0 }] })
    expect(w.lesson.onShot(newcomer({ id: 1, age: SHIELD_SECONDS + 1 }))).toBe(false)
    expect(w.lesson.onShot(newcomer({ id: 1, age: 10 }))).toBe(false) // seen as a veteran
    expect(w.lesson.onShot(newcomer({ id: 2, age: undefined }))).toBe(false)
    expect(w.lesson.onShot(newcomer({ id: 3, safe: true }))).toBe(false)
    expect(w.lesson.onShot(newcomer({ id: 3, noise: 4 }))).toBe(false)
    // …but the lesson still waits for their first loud shot outside.
    expect(w.lesson.onShot(newcomer({ id: 3 }))).toBe(true)
    expect(w.accounts.get('acc')?.[LESSONS_KEY]).toEqual({ firstShot: true })
  })

  test('guests get it once per visit', () => {
    const w = world()
    expect(w.lesson.onShot(newcomer({ account: null }))).toBe(true)
    expect(w.lesson.onShot(newcomer({ account: null }))).toBe(false)
    expect(w.accounts.size).toBe(0)
  })
})

describe('in the survival game', () => {
  beforeAll(async () => {
    await initPhysics()
  })

  test("a newcomer's first shot in the woods: birds, a groan, the hint; the second shot nothing", () => {
    const map = loadMap('deadwood')
    const game = new Game(map, createPhysicsWorld(map), seeded(5))
    const inbox: ServerMessage[] = []
    const id = game.join('P0', { send: (b: Uint8Array) => inbox.push(decodeServerMessage(b)) }) ?? 0
    game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
    for (let k = 0; k < TICK_RATE; k++) game.step()
    const player = game.players.get(id) as ServerPlayer
    player.state.weapon = { ...player.state.weapon, id: WeaponId.Handgun }
    const notices = () => inbox.flatMap((m) => (m.type === ServerMsg.Notice ? [m.notice] : []))
    const before = notices().length
    game.match.onShot(player)
    for (let k = 0; k < 4 * TICK_RATE; k++) game.step()
    const got = notices().slice(before)
    expect(got.some((n) => n.sound === 'birds')).toBe(true)
    expect(got.some((n) => n.sound === 'groan')).toBe(true)
    expect(got.filter((n) => n.hint === 'gunfire').length).toBe(1)
    const after = notices().length
    game.match.onShot(player)
    for (let k = 0; k < 4 * TICK_RATE; k++) game.step()
    expect(
      notices()
        .slice(after)
        .some((n) => n.sound === 'groan' || n.hint),
    ).toBe(false)
  })
})
