import {
  dayPhase,
  isPublicWorld,
  moraleWord,
  RADIO_CACHE_MS,
  RADIO_FEED_LINES,
  RADIO_FEED_PATH,
  RADIO_VOTE_PATH,
  type RadioFeed,
  type RadioVoteReply,
  radioClock,
  worldName,
} from '@office-fps/shared'
import type { Game } from './game.ts'
import { peopleIn } from './world-host.ts'

/** The night listeners vote on now: tonight until dusk, then tomorrow's. */
export function votingNight(night: number, time: number): number {
  const phase = dayPhase(time)
  return phase === 'night' || phase === 'dusk' ? night + 1 : night
}

/** The world as the /radio page sees it (shared radio-feed.ts). */
export function radioFeed(game: Game, world: string, now: number): RadioFeed {
  const name = isPublicWorld(world) ? worldName(world) : 'Private world'
  const d = game.match.survivalDirector
  if (!d) {
    return {
      live: false,
      world,
      name,
      night: 0,
      time: 0,
      phase: 'day',
      clock: '--:--',
      weather: 'clear',
      survivors: peopleIn(game),
      morale: 0,
      moraleWord: '',
      day: 0,
      redIn: 0,
      lines: [],
      at: now,
    }
  }
  const time = d.time
  const camp = d.camp.shared()
  const report = d.dawnDesk.report
  const phase = dayPhase(time)
  // The Rot's mood is news from dusk on (it lingers on the director until dawn is ticked).
  const mood = phase === 'night' || phase === 'dusk' ? d.mood : null
  return {
    live: true,
    world,
    name,
    night: d.night,
    time,
    phase,
    clock: radioClock(time),
    weather: d.weather.kind,
    ...(mood ? { mood } : {}),
    survivors: peopleIn(game),
    morale: Math.round(camp.morale),
    moraleWord: moraleWord(camp.morale),
    day: camp.day,
    redIn: camp.redIn,
    lines: d.radio.log.slice(-RADIO_FEED_LINES),
    ...(report ? { dawn: report } : {}),
    ...(d.moodVote.on ? { votes: d.moodVote.votes(votingNight(d.night, time)) } : {}),
    at: now,
  }
}

const json = (body: unknown, status = 200, cache = 'no-store') =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': cache },
  })

/**
 * The /radio page's two requests, for one world (the Bun server and the Cloudflare room both
 * route `/radio/*` here). The feed is written at most once every RADIO_CACHE_MS and handed to
 * everybody who asks in between, so listeners cost a lookup, not a walk over the world.
 */
export class RadioDesk {
  private cached: { feed: RadioFeed; body: string } | null = null

  constructor(
    private readonly game: Game,
    private readonly world: () => string,
    private readonly clock: () => number = Date.now,
  ) {}

  /** The feed, from the copy if it's fresh enough. */
  feed(): RadioFeed {
    const now = this.clock()
    if (!this.cached || now - this.cached.feed.at >= RADIO_CACHE_MS) {
      const feed = radioFeed(this.game, this.world(), now)
      this.cached = { feed, body: JSON.stringify(feed) }
    }
    return this.cached.feed
  }

  /**
   * GET /radio/feed or POST /radio/vote. `voter` is who's asking (their address); `resting`:
   * the day's free requests are nearly spent, and listeners give way to players.
   */
  async handle(request: Request, voter: string, resting = false): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (resting) return json({ error: 'resting' }, 503)
    if (request.method === 'GET' && pathname === RADIO_FEED_PATH) {
      this.feed()
      return new Response(this.cached?.body, {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `public, max-age=${Math.floor(RADIO_CACHE_MS / 1000)}`,
        },
      })
    }
    if (request.method === 'POST' && pathname === RADIO_VOTE_PATH) {
      const d = this.game.match.survivalDirector
      if (!d) return json({ ok: false, error: 'off' } satisfies RadioVoteReply, 409)
      const text = await request.text().catch(() => '')
      let mood: unknown
      try {
        mood = text.length < 200 ? (JSON.parse(text) as { mood?: unknown })?.mood : undefined
      } catch {
        mood = undefined
      }
      const reply = d.moodVote.vote(voter, mood, votingNight(d.night, d.time))
      // The next feed shows the new count.
      if (reply.ok) this.cached = null
      return json(reply, reply.ok ? 200 : reply.error === 'bad' ? 400 : 409)
    }
    return json({ error: 'Not found' }, 404)
  }
}
