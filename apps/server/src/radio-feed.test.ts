import { beforeAll, describe, expect, test } from 'bun:test'
import {
  createPhysicsWorld,
  DEFAULT_RULES,
  initPhysics,
  loadMap,
  mergeRules,
  RADIO_CACHE_MS,
  RADIO_FEED_LINES,
  type RadioFeed,
  type RadioVoteReply,
  radioClock,
  seeded,
  TICK_RATE,
} from '@office-fps/shared'
import { AdminApi } from './admin.ts'
import { Game } from './game.ts'
import { RadioDesk, votingNight } from './radio-feed.ts'
import { MemoryStore } from './saves.ts'
import { MOOD_VOTERS_MAX, MoodVote } from './survival/mood-vote.ts'

beforeAll(async () => {
  await initPhysics()
})

async function survival() {
  const map = loadMap('deadwood')
  const game = new Game(map, createPhysicsWorld(map), seeded(7))
  game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
  await game.useSaves(new MemoryStore(), 'deadwood-2')
  const director = game.match.survivalDirector
  if (!director) throw new Error('not surviving')
  let now = 1_000_000
  const desk = new RadioDesk(
    game,
    () => 'deadwood-2',
    () => now,
  )
  const later = (ms: number) => {
    now += ms
  }
  return { game, director, desk, later }
}

const get = (desk: RadioDesk) =>
  desk.handle(new Request('http://x/radio/feed?world=deadwood-2'), '1.2.3.4')
const vote = (desk: RadioDesk, voter: string, body: unknown) =>
  desk.handle(
    new Request('http://x/radio/vote', { method: 'POST', body: JSON.stringify(body) }),
    voter,
  )

describe('the radio clock', () => {
  test('dawn reads six in the morning, and it wraps', () => {
    expect(radioClock(0.4)).toBe('06:00')
    expect(radioClock(0.9)).toBe('18:00')
    expect(radioClock(0.15)).toBe('00:00')
  })
})

describe('the mood vote', () => {
  test('off, it takes nothing', () => {
    const v = new MoodVote()
    expect(v.vote('a', 'fog', 1)).toEqual({ ok: false, error: 'off' })
    expect(v.close('calm')).toBeNull()
  })

  test('one vote per voter per night, and junk is turned away', () => {
    const v = new MoodVote()
    v.setOn(true)
    expect(v.vote('a', 'fog', 3).ok).toBe(true)
    expect(v.vote('a', 'choir', 3)).toMatchObject({ ok: false, error: 'voted' })
    expect(v.vote('b', 'dance', 3)).toEqual({ ok: false, error: 'bad' })
    expect(v.vote('', 'fog', 3)).toEqual({ ok: false, error: 'bad' })
    expect(v.votes(3).tally).toEqual({ calm: 0, fog: 1, hunting: 0, choir: 0 })
    // A new night: everybody may vote again.
    expect(v.vote('a', 'choir', 4).ok).toBe(true)
    expect(v.votes(4).tally.fog).toBe(0)
  })

  test('the most votes win at dusk; the seeded mood wins a tie it is in', () => {
    const v = new MoodVote()
    v.setOn(true)
    v.vote('a', 'fog', 1)
    v.vote('b', 'hunting', 1)
    v.vote('c', 'hunting', 1)
    expect(v.close('calm')).toBe('hunting')
    // Emptied for the next night.
    expect(v.close('calm')).toBeNull()
    v.vote('a', 'fog', 2)
    v.vote('b', 'choir', 2)
    expect(v.close('choir')).toBe('choir')
    v.vote('a', 'fog', 3)
    v.vote('b', 'choir', 3)
    expect(v.close('calm')).toBe('fog')
  })

  test('it remembers a bounded number of voters', () => {
    const v = new MoodVote()
    v.setOn(true)
    for (let i = 0; i < MOOD_VOTERS_MAX; i++) v.vote(`v${i}`, 'calm', 1)
    expect(v.vote('late', 'fog', 1)).toEqual({ ok: false, error: 'busy' })
  })

  test('the vote is for tonight by day, and for tomorrow once dusk comes', () => {
    expect(votingNight(5, 0.6)).toBe(5)
    expect(votingNight(5, 0.9)).toBe(6)
    expect(votingNight(5, 0.1)).toBe(6)
  })
})

describe('the radio desk', () => {
  test('the feed tells the world, and is reused for a while', async () => {
    const { game, director, desk, later } = await survival()
    director.radio.say({ kind: 'mood', mood: 'fog' })
    for (let i = 0; i < 40; i++) director.radio.log.push(`line ${i}`)
    const r = await get(desk)
    expect(r.status).toBe(200)
    const feed = (await r.json()) as RadioFeed
    expect(feed.live).toBe(true)
    expect(feed.name).toBe('Deadwood 2')
    expect(feed.lines).toHaveLength(RADIO_FEED_LINES)
    expect(feed.lines.at(-1)).toBe('line 39')
    expect(feed.survivors).toBe(0)
    expect(feed.votes).toBeUndefined()
    expect(feed.clock).toMatch(/^\d\d:\d\d$/)
    expect(typeof feed.morale).toBe('number')

    // Somebody joins: the copy still says nobody, until it's old enough.
    game.join('Ada', { send: () => {} })
    expect(((await (await get(desk)).json()) as RadioFeed).survivors).toBe(0)
    later(RADIO_CACHE_MS)
    expect(((await (await get(desk)).json()) as RadioFeed).survivors).toBe(1)
  })

  test('listeners give way when the day is nearly spent', async () => {
    const { desk } = await survival()
    const r = await desk.handle(new Request('http://x/radio/feed'), 'a', true)
    expect(r.status).toBe(503)
  })

  test('votes only on a streamer night, once each, and the feed shows the count', async () => {
    const { game, desk } = await survival()
    expect((await vote(desk, 'a', { mood: 'fog' })).status).toBe(409)

    // The admin turns it on for this world.
    const admin = new AdminApi(game, { password: 'pw' })
    const on = await admin.handle(
      new Request('http://x/admin/api/streamer', {
        method: 'POST',
        headers: { 'X-Admin-Password': 'pw' },
        body: JSON.stringify({ on: true }),
      }),
    )
    expect(await on.json()).toEqual({ streamer: true })

    const first = (await (await vote(desk, 'a', { mood: 'fog' })).json()) as RadioVoteReply
    expect(first.ok).toBe(true)
    const again = await vote(desk, 'a', { mood: 'choir' })
    expect(again.status).toBe(409)
    expect(((await again.json()) as RadioVoteReply).error).toBe('voted')
    expect((await vote(desk, 'b', 'not json')).status).toBe(400)
    const feed = (await (await get(desk)).json()) as RadioFeed
    expect(feed.votes?.tally.fog).toBe(1)
  })

  test("at dusk the listeners' pick is the night's mood", async () => {
    const { game, director } = await survival()
    game.join('Ada', { send: () => {} })
    const step = (s: number) => {
      for (let i = 0; i < s * TICK_RATE; i++) game.step()
    }
    director.setTime(0.6)
    step(1)
    director.moodVote.setOn(true)
    const night = votingNight(director.night, director.time)
    for (const voter of ['a', 'b', 'c']) director.moodVote.vote(voter, 'choir', night)
    director.moodVote.vote('d', 'calm', night)
    director.setTime(0.885)
    step(2)
    expect(director.mood).toBe('choir')
  })
})
