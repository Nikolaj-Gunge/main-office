import { DurableObject } from 'cloudflare:workers'
import { AdminApi } from '@office-fps/server/admin'
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

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      await initPhysics()
      const map = loadMap(DEFAULT_MAP_ID)
      this.game = new Game(map, createPhysicsWorld(map))
      this.loop = new GameLoop(TICK_RATE, () => this.tick())
      // Rules live in the Settings object, so they survive this room being evicted while the
      // office is empty, deploys, and updates that start a new room.
      const settings = env.SETTINGS.get(env.SETTINGS.idFromName('office'))
      this.admin = new AdminApi(this.game, {
        password: env.ADMIN_PASSWORD,
        onRulesChanged: (rules) =>
          void settings.fetch('https://settings/rules', {
            method: 'PUT',
            body: JSON.stringify(rules),
          }),
      })
      const saved = await settings
        .fetch('https://settings/rules')
        .then((r) => r.json())
        .catch(() => null)
      if (saved) this.admin.apply(mergeRules(DEFAULT_RULES, saved))
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
      })
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket', { status: 426 })
    }
    const { 0: client, 1: server } = new WebSocketPair()
    server.binaryType = 'arraybuffer'
    server.accept()
    this.sockets++

    const session = createSession(
      game,
      {
        send: (bytes) => {
          if (server.readyState === WebSocket.OPEN) server.send(bytes)
        },
        close: (code, reason) => server.close(code, reason),
      },
      () => loop.tickMs,
      () => {
        this.lastInput = Date.now()
        if (!loop.running) loop.start()
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
    }
    server.addEventListener('close', (event) => onClose(event.code))
    server.addEventListener('error', () => onClose(1006))

    return new Response(null, { status: 101, webSocket: client })
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
