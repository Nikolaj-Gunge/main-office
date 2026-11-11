import {
  createPhysicsWorld,
  DEFAULT_RULES,
  type GameRules,
  JINGLES,
  loadMap,
  MAPS,
  mergeRules,
  RULE_RANGES,
  SKINS,
} from '@office-fps/shared'
import type { Game } from './game.ts'

/** Wrong passwords allowed per client before it is locked out for LOCKOUT_MS. */
const MAX_FAILURES = 5
const LOCKOUT_MS = 10 * 60 * 1000

export interface AdminOptions {
  /** ADMIN_PASSWORD from the environment / Cloudflare secret. Unset = admin page disabled. */
  password: string | undefined
  /** Called after every rules change (the Durable Object stores them). */
  onRulesChanged?: (rules: GameRules) => void
}

/**
 * The admin page's API (`/admin/api/*`), in plain Fetch API terms so the Bun server and the
 * Cloudflare Durable Object share it. Every request carries the password as a Bearer token.
 *
 *   GET  /admin/api/state         rules, choices and who's online
 *   POST /admin/api/rules         partial rules JSON → applied live (map switch included)
 *   POST /admin/api/reset-scores
 */
export class AdminApi {
  private readonly game: Game
  private readonly options: AdminOptions
  private readonly failures = new Map<string, { count: number; until: number }>()
  private mapNames: { id: string; name: string }[] | null = null

  constructor(game: Game, options: AdminOptions) {
    this.game = game
    this.options = options
  }

  async handle(request: Request, now = Date.now()): Promise<Response> {
    const { password } = this.options
    if (!password) return json({ error: 'Admin is not set up: ADMIN_PASSWORD is missing' }, 503)

    const client = request.headers.get('CF-Connecting-IP') ?? 'local'
    const record = this.failures.get(client)
    if (record && record.count >= MAX_FAILURES && now < record.until) {
      return json({ error: 'Too many wrong passwords — try again in a few minutes' }, 429)
    }
    const given = (request.headers.get('Authorization') ?? '').replace(/^Bearer /, '')
    if (!(await samePassword(given, password))) {
      const count = record && now < record.until ? record.count + 1 : 1
      this.failures.set(client, { count, until: now + LOCKOUT_MS })
      return json({ error: 'Wrong password' }, 401)
    }
    this.failures.delete(client)

    const { pathname } = new URL(request.url)
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
      case 'POST /admin/api/reset-scores':
        this.game.resetScores()
        return json(this.state())
      default:
        return json({ error: 'Not found' }, 404)
    }
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
        ranges: RULE_RANGES,
        defaults: DEFAULT_RULES,
      },
      players: [...this.game.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        kills: p.kills,
        deaths: p.deaths,
        ping: Math.round(p.ping),
      })),
    }
  }
}

/** Compares SHA-256 digests in constant time, so response timing doesn't leak the password. */
async function samePassword(given: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(given)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
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
