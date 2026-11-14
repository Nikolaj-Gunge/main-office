import { DurableObject } from 'cloudflare:workers'
import { AdminApi } from '@office-fps/server/admin'
import { type BudgetCounts, limitFromEnv, RequestBudget } from '@office-fps/server/budget'
import { Game } from '@office-fps/server/game'
import { GameLoop } from '@office-fps/server/loop'
import { createSession } from '@office-fps/server/session'
import {
  createPhysicsWorld,
  DEFAULT_MAP_ID,
  DEFAULT_RULES,
  initPhysics,
  loadMap,
  mergeRules,
  TICK_RATE,
} from '@office-fps/shared'
import { vaultStore } from './vault.ts'

/**
 * With no input from anyone for this long (everyone tabbed out), the loop pauses until the next
 * input. Keeps an idle room from burning the free plan's CPU and duration allowance.
 */
const IDLE_PAUSE_MS = 5000
/**
 * How often the day's request count is added to the Settings object while people play (and
 * once more when the room empties). Each sync is itself a request: 5 min ≈ 0.3% of the budget.
 */
const BUDGET_SYNC_MS = 5 * 60 * 1000

/**
 * The office room: one Durable Object running the same authoritative `Game` as the Bun server.
 * Lives in memory while anyone is connected; Cloudflare may evict it when the office is empty
 * (scores reset then, which is fine; survival characters and the world are in the vault).
 */
export class GameRoom extends DurableObject {
  private game: Game | null = null
  private loop: GameLoop | null = null
  private admin: AdminApi | null = null
  private sockets = 0
  private lastInput = 0
  /** Today's metered requests (see budget.ts). */
  private readonly budget: RequestBudget
  private readonly settings: DurableObjectStub
  private budgetTimer: ReturnType<typeof setInterval> | null = null
  private budgetSyncing = false

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.budget = new RequestBudget(limitFromEnv(env.FREE_REQUEST_LIMIT))
    this.settings = env.SETTINGS.get(env.SETTINGS.idFromName('office'))
    ctx.blockConcurrencyWhile(async () => {
      await initPhysics()
      const map = loadMap(DEFAULT_MAP_ID)
      this.game = new Game(map, createPhysicsWorld(map))
      this.loop = new GameLoop(TICK_RATE, () => this.tick())
      // Rules live in the Settings object, so they survive this room being evicted while the
      // office is empty, deploys, and updates that start a new room.
      const settings = this.settings
      this.admin = new AdminApi(this.game, {
        password: env.ADMIN_PASSWORD,
        onRulesChanged: (rules) => {
          this.budget.http()
          void settings.fetch('https://settings/rules', {
            method: 'PUT',
            body: JSON.stringify(rules),
          })
        },
        budget: () => this.budget.snapshot(),
        onBansChanged: (bans) =>
          void settings.fetch('https://settings/bans', {
            method: 'PUT',
            body: JSON.stringify(bans),
          }),
      })
      this.budget.http(2) // the two reads below
      const [saved, counted] = await Promise.all([
        settings
          .fetch('https://settings/rules')
          .then((r) => r.json())
          .catch(() => null),
        settings
          .fetch('https://settings/budget')
          .then((r) => r.json() as Promise<BudgetCounts | null>)
          .catch(() => null),
      ])
      this.budget.synced(counted)
      if (saved) this.admin.apply(mergeRules(DEFAULT_RULES, saved))
      const bans = await settings
        .fetch('https://settings/bans')
        .then((r) => r.json())
        .catch(() => null)
      this.admin.moderation.loadBans(bans)
      // Characters and the world live in the vault (after the rules: a mode or map change
      // starts a new world, which must not wipe the saved one at boot).
      await this.game.useSaves(vaultStore(env))
      console.log(`[room] map "${this.game.mapId}" ready, ${this.game.spawnPointCount} spawn spots`)
    })
  }

  override async fetch(request: Request): Promise<Response> {
    const game = this.game
    const loop = this.loop
    if (!game || !loop || !this.admin) return new Response('Room not ready', { status: 503 })
    this.budget.http()

    const { pathname } = new URL(request.url)
    if (pathname.startsWith('/admin/api/')) return this.admin.handle(request)
    if (pathname === '/healthz') {
      return Response.json({
        ok: true,
        // The client builds this map while it loads (saves a reload on join).
        map: game.mapId,
        tick: game.tick,
        players: game.players.size,
        connections: this.sockets,
        running: loop.running,
        tickMs: Number(loop.tickMs.toFixed(3)),
        budget: this.budget.snapshot(),
      })
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket', { status: 426 })
    }
    const { 0: client, 1: server } = new WebSocketPair()
    server.binaryType = 'arraybuffer'
    server.accept()
    this.sockets++
    this.budgetTimer ??= setInterval(() => void this.syncBudget(), BUDGET_SYNC_MS)

    const session = createSession(
      game,
      {
        send: (bytes) => {
          if (server.readyState === WebSocket.OPEN) server.send(bytes)
        },
        close: (code, reason) => server.close(code, reason),
      },
      () => loop.tickMs,
      {
        onInput: () => {
          this.lastInput = Date.now()
          if (!loop.running) loop.start()
        },
        budget: this.budget,
        ip: request.headers.get('CF-Connecting-IP') ?? undefined,
      },
    )
    server.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') session.message(event.data)
    })
    let closed = false
    const onClose = (code: number) => {
      if (closed) return
      closed = true
      this.sockets--
      session.close(code)
      if (game.players.size === 0) loop.stop()
      if (this.sockets === 0) {
        // Nobody left: save the count now (the room may be evicted) and stop the timer.
        if (this.budgetTimer) clearInterval(this.budgetTimer)
        this.budgetTimer = null
        void this.syncBudget()
      }
    }
    server.addEventListener('close', (event) => onClose(event.code))
    server.addEventListener('error', () => onClose(1006))

    return new Response(null, { status: 101, webSocket: client })
  }

  /** Adds what this room counted since the last sync to the day's stored total. */
  private async syncBudget(): Promise<void> {
    if (this.budgetSyncing) return // the counts would be sent twice
    const sent = this.budget.unsynced()
    if (!sent) return
    this.budgetSyncing = true
    this.budget.http() // this sync
    sent.http++
    try {
      const response = await this.settings.fetch('https://settings/budget', {
        method: 'POST',
        body: JSON.stringify(sent),
      })
      this.budget.synced((await response.json()) as BudgetCounts, sent)
    } catch (err) {
      console.warn('[room] budget sync failed:', (err as Error).message)
    } finally {
      this.budgetSyncing = false
    }
  }

  private tick(): void {
    if (!this.game || !this.loop) return
    if (Date.now() - this.lastInput > IDLE_PAUSE_MS) {
      this.loop.stop()
      return
    }
    this.game.step()
  }
}
