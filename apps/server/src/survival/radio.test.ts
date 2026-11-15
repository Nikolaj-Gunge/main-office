import { beforeAll, describe, expect, test } from 'bun:test'
import {
  createPhysicsWorld,
  DEFAULT_RULES,
  decodeServerMessage,
  give,
  initPhysics,
  loadMap,
  MOODS,
  mergeRules,
  type Notice,
  ServerMsg,
  type SurvivalSelf,
  seeded,
  TICK_RATE,
  type WeatherKind,
} from '@office-fps/shared'
import { Game, type ServerPlayer } from '../game.ts'
import { MemoryStore } from '../saves.ts'
import type { SurvivalDirector } from './director.ts'
import {
  DJ,
  hearsRadio,
  RADIO_GAP,
  RADIO_QUEUE,
  RADIO_STALE,
  Radio,
  type RadioEvent,
  radioLine,
  radioStations,
  radioTemplates,
} from './radio.ts'

beforeAll(async () => {
  await initPhysics()
})

const def = () => {
  const d = loadMap('deadwood').survival
  if (!d) throw new Error('no survival map')
  return d
}

/** A radio on a clock we turn by hand, heard by one listener in Haven. */
function onAir(weather: WeatherKind = 'clear') {
  const d = def()
  const haven = d.pois.find((p) => p.key === 'haven')
  if (!haven) throw new Error('no haven')
  const heard: Notice[] = []
  const clock = { now: 0, weather }
  const player = { id: 1 } as ServerPlayer
  const radio = new Radio({
    def: () => d,
    now: () => clock.now,
    random: seeded(3),
    listeners: () => [
      { player, pos: { x: haven.x, y: haven.y, z: haven.z }, seated: false, carrying: false },
    ],
    send: (_p, n) => heard.push(n),
    weather: () => clock.weather,
  })
  const at = (now: number) => {
    clock.now = now
    return radio.tick()
  }
  return { radio, heard, clock, at }
}

describe('what Wes says', () => {
  test('every kind of news has lines, with the names filled in', () => {
    const e: RadioEvent = { kind: 'death', who: 'Ellen Voss' }
    for (let i = 0; i < 20; i++) {
      const { text } = radioLine(e, Math.random)
      expect(text).toContain('Ellen Voss')
      expect(text).not.toContain('{')
    }
    const alpha = radioLine(
      { kind: 'alpha', alpha: 'Old Teeth', by: 'Ray Dunn', place: 'Quarry' },
      () => 0,
    ).text
    expect(alpha).toContain('Old Teeth')
    expect(alpha).toContain('Ray Dunn')
    expect(radioLine({ kind: 'drop', near: 'Quarry' }, () => 0.5).text).toContain('Quarry')
    expect(radioLine({ kind: 'siege', place: 'Haven', held: false }, () => 0).text).toContain(
      'Haven',
    )
    expect(radioLine({ kind: 'death', who: 'Bo', turned: true }, () => 0).text).toContain('turned')
  })

  test("the night's mood is the Rot's own radio line, not a second copy of it", () => {
    for (const mood of ['calm', 'fog', 'hunting', 'choir'] as const) {
      expect(radioTemplates({ kind: 'mood', mood })).toEqual([MOODS[mood].news])
    }
  })

  test('the weather has something for every kind of weather', () => {
    for (const w of ['clear', 'overcast', 'fog', 'drizzle', 'rain', 'storm'] as const) {
      expect(radioLine({ kind: 'weather', weather: w }, Math.random).text.length).toBeGreaterThan(
        20,
      )
    }
  })

  test('it never says the same thing twice in a row about the same kind of news', () => {
    const e: RadioEvent = { kind: 'death', who: 'X' }
    let last = -1
    for (let i = 0; i < 30; i++) {
      // Even a die that always lands the same way gets moved off the last line.
      const { index } = radioLine(e, () => 0.1, last)
      expect(index).not.toBe(last)
      last = index
    }
  })
})

describe('on the air', () => {
  test('one line at a time, RADIO_GAP apart', () => {
    const { radio, heard, at } = onAir()
    expect(radio.say({ kind: 'death', who: 'Ann' })).toBe(true)
    expect(radio.say({ kind: 'evac', who: 'Bea' })).toBe(true)
    expect(at(1)).not.toBeNull()
    expect(heard.length).toBe(1)
    expect(heard[0]?.kind).toBe('radio')
    expect(heard[0]?.from).toBe(DJ)
    // The evacuation matters more: it went first.
    expect(heard[0]?.text).toContain('Bea')
    expect(at(1 + RADIO_GAP - 1)).toBeNull()
    expect(at(1 + RADIO_GAP)).toContain('Ann')
    expect(heard.length).toBe(2)
  })

  test('the same kind of news again too soon is let go', () => {
    const { radio, at } = onAir()
    expect(radio.say({ kind: 'drop', near: 'the Quarry' })).toBe(true)
    at(30)
    expect(radio.say({ kind: 'drop', near: 'the Sawmill' })).toBe(false)
    at(200)
    expect(radio.say({ kind: 'drop', near: 'the Sawmill' })).toBe(true)
  })

  test('news that waits too long is dropped; the queue only holds so much, the big news kept', () => {
    const r = onAir()
    r.radio.say({ kind: 'weather', weather: 'rain' })
    for (const who of ['A', 'B', 'C', 'D', 'E']) {
      r.clock.now += 10
      r.radio.say({ kind: 'death', who })
    }
    r.radio.say({ kind: 'alpha', alpha: 'the Choir', by: 'Sam', place: "St. Agnes' church" })
    expect(r.radio.waiting.length).toBe(RADIO_QUEUE)
    expect(r.radio.waiting[0]?.kind).toBe('alpha')
    expect(r.radio.waiting.some((e) => e.kind === 'weather')).toBe(false)
    // Nobody got round to the rest for a long while: it's old news.
    r.at(r.clock.now + 1)
    r.at(r.clock.now + RADIO_STALE + 1)
    expect(r.radio.waiting.length).toBe(0)
  })

  test('a change in the weather is news, but not every flicker of it', () => {
    const { radio, clock, at, heard } = onAir('clear')
    at(1)
    clock.weather = 'rain'
    at(2)
    expect(heard.at(-1)?.text.length).toBeGreaterThan(10)
    const n = heard.length
    clock.weather = 'drizzle'
    at(30)
    clock.weather = 'rain'
    at(60)
    expect(heard.length).toBe(n)
    expect(radio.waiting.length).toBe(0)
  })
})

describe('who hears it', () => {
  test('in Haven, by a radio set, in a car or carrying a two-way radio; not alone in the woods', () => {
    const d = def()
    const stations = radioStations(d)
    const haven = d.pois.find((p) => p.key === 'haven')
    const tower = d.pois.find((p) => p.kind === 'radio')
    if (!haven || !tower) throw new Error('missing')
    // The booth at Haven, the tower and the sets you can use.
    expect(stations.some((s) => Math.hypot(s.x - haven.x, s.z - haven.z) < 35)).toBe(true)
    expect(stations.length).toBeGreaterThanOrEqual(3)
    const woods = { x: haven.x + 400, y: 0, z: haven.z + 400 }
    const at = (pos: { x: number; y: number; z: number }, seated = false, carrying = false) =>
      hearsRadio(d, stations, { pos, seated, carrying })
    expect(at({ x: haven.x + 5, y: haven.y, z: haven.z })).toBe(true)
    expect(at({ x: tower.x + 3, y: tower.y, z: tower.z })).toBe(true)
    expect(at(woods)).toBe(false)
    expect(at(woods, true)).toBe(true)
    expect(at(woods, false, true)).toBe(true)
  })

  test('the booth has its DJ: Wes, somebody to talk to', () => {
    const wes = def().npcs.find((n) => n.key === 'wes')
    expect(wes?.role).toBe('radio')
  })
})

describe('the radio on the server', () => {
  async function server() {
    const map = loadMap('deadwood')
    const game = new Game(map, createPhysicsWorld(map), seeded(5))
    game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
    await game.useSaves(new MemoryStore())
    const director = (game.match as unknown as { survival: SurvivalDirector }).survival
    const inbox = new Map<number, Notice[]>()
    const join = (name: string) => {
      const box: Notice[] = []
      const id = game.join(name, {
        send: (bytes) => {
          const msg = decodeServerMessage(bytes)
          if (msg?.type === ServerMsg.Notice) box.push(msg.notice)
        },
      })
      const p = id === null ? undefined : game.players.get(id)
      if (!p) throw new Error('no player')
      p.protectedUntil = Number.POSITIVE_INFINITY
      inbox.set(p.id, box)
      return p
    }
    const self = (p: ServerPlayer) =>
      (director as unknown as { survivors: Map<number, { self: SurvivalSelf }> }).survivors.get(
        p.id,
      )?.self as SurvivalSelf
    const run = (seconds: number, hold: () => void) => {
      for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) {
        hold()
        game.step()
      }
    }
    return { game, director, join, inbox, self, run }
  }

  test('a death is read out to those listening, and only to them', async () => {
    const { game, director, join, inbox, self, run } = await server()
    const d = def()
    const haven = d.pois.find((p) => p.key === 'haven')
    if (!haven) throw new Error('no haven')
    const home = join('Home')
    const away = join('Away')
    const radioMan = join('Radio')
    const victim = join('Victim')
    const woods = (dx: number) => ({ x: haven.x + 500 + dx, y: 0, z: haven.z + 300 })
    for (const p of [away, radioMan, victim]) self(p).age = 99999
    give(self(radioMan), 'radio', 1)
    const hold = () => {
      home.state.pos = { x: haven.x + 3, y: haven.y + 0.1, z: haven.z + 8 }
      away.state.pos = { ...woods(0) }
      radioMan.state.pos = { ...woods(30) }
      victim.state.pos = { ...woods(60) }
      for (const p of [home, away, radioMan]) p.health = p.maxHealth
    }
    run(1, hold)
    const name = self(victim).bio?.name ?? ''
    game.killPlayer(victim.id, victim.id)
    run(RADIO_GAP + 2, hold)
    const said = (p: ServerPlayer) =>
      (inbox.get(p.id) ?? []).filter((n) => n.kind === 'radio' && n.text.includes(name))
    expect(said(home).length).toBe(1)
    expect(said(radioMan).length).toBe(1)
    expect(said(away).length).toBe(0)
    expect(director.radio.log.some((l) => l.includes(name))).toBe(true)
  }, 60000)
})
