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
  DEFAULT_WORLD_ID,
  initPhysics,
  isPrivateWorld,
  loadMap,
  mergeRules,
  TICK_RATE,
  WORLD_HEADER,
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
/** Joins and leaves within this long are reported to the world list as one head count. */
const PRESENCE_DELAY_MS = 2000

/**
 * A world's room (worlds.ts: one GameRoom instance per world, by name): one Durable Object running the same authoritative `Game` as the Bun server.
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
  /** Which world this room runs (the worker says, see worker.ts); its save is read on first use. */
  private worldId: string | null = null
  private savesReady: Promise<void> | null = null
  private presenceTimer: ReturnType<typeof setTimeout> | null = null

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
      console.log(`[room] map "${this.game.mapId}" ready, ${this.game.spawnPointCount} spawn spots`)
    })
  }

  /**
   * Reads this world's save from the vault, once, on the first request (only the worker knows
   * which world this room is). After the rules: a mode or map change starts a new world, which
   * must not wipe the saved one at boot. Characters are in the vault too, shared by every world.
   */
  private useWorld(game: Game, header: string | null): Promise<void> {
    if (!this.savesReady) {
      const worldId = header || DEFAULT_WORLD_ID
      this.worldId = worldId
      this.savesReady = game
        .useSaves(vaultStore(this.env as Env), worldId)
        .then(() => console.log(`[room] world "${worldId}" loaded`))
    }
    return this.savesReady
  }

  override async fetch(request: Request): Promise<Response> {
    const game = this.game
    const loop = this.loop
    if (!game || !loop || !this.admin) return new Response('Room not ready', { status: 503 })
    this.budget.http()
    await this.useWorld(game, request.headers.get(WORLD_HEADER))

    const { pathname } = new URL(request.url)
    if (pathname.startsWith('/admin/api/')) return this.admin.handle(request)
    if (pathname === '/healthz') {
      return Response.json({
        ok: true,
        // The client builds this map while it loads (saves a reload on join).
        map: game.mapId,
        world: this.worldId,
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
    this.budgetTimer ??= setInterval(() => {
      void this.syncBudget()
      this.schedulePresence() // the world list forgets head counts that aren't renewed
    }, BUDGET_SYNC_MS)
    this.schedulePresence()

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
      this.schedulePresence()
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

  /**
   * Tells the Settings object how many people are here (for the world list), shortly after a
   * join or leave so a burst is one request. Private worlds aren't listed, so they don't.
   */
  private schedulePresence(): void {
    if (this.presenceTimer || !this.worldId || isPrivateWorld(this.worldId)) return
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null
      void this.reportPresence()
    }, PRESENCE_DELAY_MS)
  }

  private async reportPresence(): Promise<void> {
    const game = this.game
    if (!game || !this.worldId) return
    let players = 0
    for (const p of game.players.values()) if (!p.zombie && !p.dummy && !p.bot) players++
    this.budget.http() // this report
    try {
      const response = await this.settings.fetch('https://settings/presence', {
        method: 'POST',
        body: JSON.stringify({ world: this.worldId, players }),
      })
      // The answer is the day's total from every world: keeps the cutoff global between syncs.
      this.budget.synced((await response.json()) as BudgetCounts | null)
    } catch (err) {
      console.warn('[room] presence report failed:', (err as Error).message)
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
