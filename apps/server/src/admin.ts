import {
  BOT_SKILLS,
  createPhysicsWorld,
  DEFAULT_RULES,
  type GameRules,
  ITEMS,
  JINGLES,
  loadMap,
  MAPS,
  MODE_NAMES,
  MODES,
  mergeRules,
  RULE_RANGES,
  SKINS,
  SPAWN_WEAPONS,
  WEATHER_KINDS,
  type WeatherKind,
} from '@office-fps/shared'
import { ClientErrorIntake, type ErrorLog, errorLog } from './errors.ts'
import type { Game } from './game.ts'
import { type Ban, type Moderation, moderationOf } from './moderation.ts'

/** Wrong passwords allowed per client before it is locked out for LOCKOUT_MS. */
const MAX_FAILURES = 5
const LOCKOUT_MS = 10 * 60 * 1000

export interface AdminOptions {
  /** ADMIN_PASSWORD from the environment / Cloudflare secret. Unset = admin page disabled. */
  password: string | undefined
  /** Called after every rules change (the Durable Object stores them). */
  onRulesChanged?: (rules: GameRules) => void
  /** Called after every ban / unban (the Durable Object stores them). */
  onBansChanged?: (bans: readonly Ban[]) => void
  /** Where errors are kept (default: the process-wide log). */
  errors?: ErrorLog
}

/**
 * The admin page's API (`/admin/api/*`), in plain Fetch API terms so the Bun server and the
 * Cloudflare Durable Object share it. Every request carries the password in `X-Admin-Password`,
 * URI-encoded (HTTP headers can't carry æ, ø, å and other non-ASCII characters reliably).
 *
 *   GET  /admin/api/state         rules, choices and who's online
 *   POST /admin/api/rules         partial rules JSON → applied live (map switch included)
 *   POST /admin/api/weather       {"kind": "storm" | … | null} → survival weather held / let go
 *   POST /admin/api/reset-scores
 *   GET  /admin/api/errors        the last 50 server and client errors
 *   POST /admin/api/kick          {"id", "reason"} → thrown out, the reason shown to them
 *   POST /admin/api/ban           {"id", "reason"} → kicked and kept out (name, address)
 *   POST /admin/api/unban         {"name"}
 *   POST /admin/api/teleport      {"id", "place": key} or {"id", "to": player id}
 *   POST /admin/api/give          {"id", "item", "n"} → survival: into their pockets
 *   POST /admin/api/time          {"time": 0–1} → survival: the day's clock wound forward to it
 *   POST /admin/api/reset-character {"id"} → survival: their character starts over
 *   POST /admin/api/broadcast     {"text"} → a line from the server to everyone
 *   POST /admin/api/client-error  (no password) a browser's uncaught error, rate-limited
 */
export class AdminApi {
  private readonly game: Game
  private readonly options: AdminOptions
  private readonly failures = new Map<string, { count: number; until: number }>()
  private mapNames: { id: string; name: string }[] | null = null
  private itemNames: { id: string; name: string }[] | null = null
  readonly moderation: Moderation
  private readonly errors: ErrorLog
  private readonly intake: ClientErrorIntake

  constructor(game: Game, options: AdminOptions) {
    this.game = game
    this.options = options
    this.moderation = moderationOf(game)
    this.moderation.onBansChanged = options.onBansChanged ?? null
    this.errors = options.errors ?? errorLog
    this.intake = new ClientErrorIntake(this.errors)
  }

  async handle(request: Request, now = Date.now()): Promise<Response> {
    const { password } = this.options
    if (!password) return json({ error: 'Admin is not set up: ADMIN_PASSWORD is missing' }, 503)

    const client = request.headers.get('CF-Connecting-IP') ?? 'local'
    const { pathname } = new URL(request.url)
    // Any player's page reports its errors: no password, but rate-limited per client.
    if (request.method === 'POST' && pathname === '/admin/api/client-error') {
      const body = await request.json().catch(() => null)
      return json({ ok: this.intake.take(client, body, now) })
    }
    const record = this.failures.get(client)
    if (record && record.count >= MAX_FAILURES && now < record.until) {
      return json({ error: 'Too many wrong passwords — try again in a few minutes' }, 429)
    }
    const given = passwordFrom(request)
    if (!(await samePassword(given, password))) {
      // Lengths only (never the password), to tell typos from paste artifacts in the logs.
      console.warn(
        `[admin] wrong password: got ${normalize(given).length} chars, ` +
          `expected ${normalize(password).length} (${password.length} before cleanup)`,
      )
      const count = record && now < record.until ? record.count + 1 : 1
      this.failures.set(client, { count, until: now + LOCKOUT_MS })
      // The count of what arrived helps spot autofill or paste problems (it's your own input).
      return json({ error: `Wrong password (${normalize(given).length} characters received)` }, 401)
    }
    this.failures.delete(client)

    const route = `${request.method} ${pathname}`
    switch (route) {
      case 'GET /admin/api/state':
        return json(this.state())
      case 'POST /admin/api/rules': {
        let body: unknown
        try {
          body = await request.json()
        } catch {
          return json({ error: 'Body must be JSON' }, 400)
        }
        this.apply(mergeRules(this.game.rules, body))
        return json(this.state())
      }
      case 'POST /admin/api/weather': {
        // {"kind": "storm"} holds survival's weather there; {"kind": null} lets it change again.
        let body: { kind?: unknown }
        try {
          body = (await request.json()) as { kind?: unknown }
        } catch {
          return json({ error: 'Body must be JSON' }, 400)
        }
        const kind = body?.kind ?? null
        if (kind !== null && !WEATHER_KINDS.includes(kind as WeatherKind)) {
          return json({ error: `kind must be one of ${WEATHER_KINDS.join(', ')} or null` }, 400)
        }
        if (!this.game.match.pinWeather(kind as WeatherKind | null)) {
          return json({ error: 'Not playing survival' }, 409)
        }
        return json(this.state())
      }
      case 'POST /admin/api/new-round':
        this.game.match.startRound(false)
        return json(this.state())
      case 'POST /admin/api/reset-scores':
        this.game.resetScores()
        return json(this.state())
      case 'GET /admin/api/errors':
        return json({ errors: this.errors.list() })
      case 'POST /admin/api/kick':
      case 'POST /admin/api/ban':
      case 'POST /admin/api/unban':
      case 'POST /admin/api/teleport':
      case 'POST /admin/api/give':
      case 'POST /admin/api/time':
      case 'POST /admin/api/reset-character':
      case 'POST /admin/api/broadcast': {
        const body = (await request.json().catch(() => undefined)) as Record<string, unknown>
        if (typeof body !== 'object' || body === null)
          return json({ error: 'Body must be JSON' }, 400)
        const error = this.act(pathname.slice('/admin/api/'.length), body)
        return error ? json({ error }, error.startsWith('No such') ? 404 : 400) : json(this.state())
      }
      default:
        return json({ error: 'Not found' }, 404)
    }
  }

  /** One of the moderation tools; returns an error message, or null when done. */
  private act(action: string, body: Record<string, unknown>): string | null {
    const m = this.moderation
    const id = Number(body.id)
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 80) : ''
    switch (action) {
      case 'kick':
        return m.kick(id, reason) ? null : 'No such player'
      case 'ban':
        return m.ban(id, reason) ? null : 'No such player'
      case 'unban':
        return m.unban(String(body.name ?? '')) ? null : 'No such ban'
      case 'teleport':
        return m.teleport(id, {
          ...(typeof body.place === 'string' ? { place: body.place } : {}),
          ...(body.to !== undefined && body.to !== null ? { to: Number(body.to) } : {}),
        })
      case 'give':
        return m.give(id, String(body.item ?? ''), Number(body.n ?? 1))
      case 'time':
        return m.setTime(Number(body.time)) ? null : 'Not playing survival (or no time given)'
      case 'reset-character':
        return m.resetCharacter(id)
      case 'broadcast':
        if (typeof body.text !== 'string' || !body.text.trim()) return 'Say something'
        m.broadcast(body.text)
        return null
    }
    return 'Unknown action'
  }

  /** Applies rules (switching map first if it changed) and reports them. */
  apply(rules: GameRules): void {
    if (rules.map !== this.game.mapId) {
      const map = loadMap(rules.map)
      this.game.changeMap(map, createPhysicsWorld(map))
    }
    this.game.setRules(rules)
    this.options.onRulesChanged?.(this.game.rules)
  }

  private state() {
    this.mapNames ??= Object.keys(MAPS).map((id) => ({ id, name: loadMap(id).name }))
    return {
      rules: this.game.rules,
      choices: {
        maps: this.mapNames,
        skins: SKINS,
        jingles: JINGLES,
        spawnWeapons: SPAWN_WEAPONS,
        botSkills: BOT_SKILLS,
        modes: MODES.map((id) => ({ id, name: MODE_NAMES[id] })),
        ranges: RULE_RANGES,
        defaults: DEFAULT_RULES,
      },
      // People and bots: survival's and zombies mode's dead aren't anybody you'd kick or rank.
      players: [...this.game.players.values()]
        .filter((p) => !p.zombie)
        .map((p) => ({
          id: p.id,
          name: p.name,
          kills: p.kills,
          deaths: p.deaths,
          ping: Math.round(p.ping),
          bot: p.bot !== undefined,
          alive: p.state.alive,
        })),
      bans: this.moderation.bans,
      places: this.moderation.places(),
      survival: this.survivalState(),
      errorCount: this.errors.list().length,
    }
  }

  /** Survival's clock and weather, and what can be given (null when not surviving). */
  private survivalState() {
    const director = this.game.match.survivalDirector
    if (!director) return null
    this.itemNames ??= Object.values(ITEMS)
      .filter((d) => d.kind !== 'money')
      .map((d) => ({ id: d.id, name: d.name }))
      .sort((a, b) => a.name.localeCompare(b.name))
    const weather = director.info().weather
    return {
      time: director.time,
      weather: weather?.kind ?? null,
      pinned: weather?.pin ?? null,
      weathers: WEATHER_KINDS,
      items: this.itemNames,
    }
  }
}

/** The password a request carries (see the class comment); '' if missing or malformed. */
function passwordFrom(request: Request): string {
  // A cached copy of the old admin page still sends `Authorization: Bearer …`.
  const raw =
    request.headers.get('X-Admin-Password') ??
    encodeURIComponent((request.headers.get('Authorization') ?? '').replace(/^Bearer /, ''))
  try {
    return decodeURIComponent(raw)
  } catch {
    return ''
  }
}

/**
 * Same text either way: without terminal paste markers and other control characters (pasting
 * into `wrangler secret put` can store them invisibly), Unicode-normalized, no stray spaces.
 */
export const normalizePassword = (password: string) =>
  password
    .replaceAll('\u001b[200~', '') // bracketed paste: start…
    .replaceAll('\u001b[201~', '') // …and end
    .replace(/\p{Cc}/gu, '')
    .normalize('NFC')
    .trim()
const normalize = normalizePassword

/** Compares SHA-256 digests in constant time, so response timing doesn't leak the password. */
async function samePassword(given: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(normalize(given))),
    crypto.subtle.digest('SHA-256', encoder.encode(normalize(expected))),
  ])
  const x = new Uint8Array(a)
  const y = new Uint8Array(b)
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}
