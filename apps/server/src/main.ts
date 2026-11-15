import {
  createPhysicsWorld,
  DEFAULT_MAP_ID,
  DEFAULT_SERVER_PORT,
  initPhysics,
  loadMap,
  SURVIVAL_MAP,
  TICK_RATE,
  WORLD_PARAM,
  WS_PATH,
} from '@office-fps/shared'
import { AdminApi } from './admin.ts'
import { limitFromEnv, RequestBudget } from './budget.ts'
import { createConnections, type SocketData } from './connections.ts'
import { errorLog } from './errors.ts'
import { FileStore } from './file-store.ts'
import { Game } from './game.ts'
import { GameLoop } from './loop.ts'
import { serveStatic } from './static.ts'
import { WorldHost } from './world-host.ts'

const port = Number(process.env.PORT ?? DEFAULT_SERVER_PORT)
const clientDist = process.env.CLIENT_DIST ?? new URL('../../client/dist', import.meta.url).pathname

await initPhysics()
const mapId = process.env.MAP ?? DEFAULT_MAP_ID
// Characters and the worlds are kept in JSON files (gitignored), so a restart carries on.
const saveDir = process.env.SAVE_DIR ?? new URL('../data/saves', import.meta.url).pathname
const saveStore = new FileStore(saveDir)
// What this server would cost on Cloudflare's free plan, counted the same way (in memory, and
// once for every world, as the Cloudflare rooms share theirs).
const budget = new RequestBudget(limitFromEnv(process.env.FREE_REQUEST_LIMIT))

/** One running world: its game, loop and sockets (see world-host.ts). */
interface HostedWorld {
  id: string
  game: Game
  loop: GameLoop
  connections: ReturnType<typeof createConnections>
}

// Survival runs several worlds (worlds.ts), each opened the first time somebody asks for it.
const worlds = new WorldHost<HostedWorld>(async (id) => {
  const map = loadMap(mapId)
  const physics = createPhysicsWorld(map)
  const game = new Game(map, physics)
  await game.useSaves(saveStore, id)
  const loop = new GameLoop(TICK_RATE, () => game.step())
  loop.start()
  console.log(
    `[server] world "${id}", map "${map.name}": ${physics.mapColliders.length} colliders, ` +
      `${game.spawnPointCount} spawn spots, ${map.pickups?.length ?? 0} weapon pickups`,
  )
  return { id, game, loop, connections: createConnections(game, () => loop.tickMs, budget) }
}, mapId === SURVIVAL_MAP)
const main = await worlds.get(worlds.route(null))
const { game } = main
console.log(`[server] saves in ${saveDir}`)

// The admin page runs the original world.
const admin = new AdminApi(game, {
  password: process.env.ADMIN_PASSWORD,
  budget: () => budget.snapshot(),
})
if (!process.env.ADMIN_PASSWORD) console.log('[server] admin page disabled (set ADMIN_PASSWORD)')

type WorldSocket = SocketData & { world: HostedWorld }

const server = Bun.serve<WorldSocket>({
  port,
  async fetch(req, server) {
    const url = new URL(req.url)
    // Only what reaches a Durable Object on Cloudflare (static files are served free there).
    if (
      url.pathname === '/worlds' ||
      url.pathname === '/healthz' ||
      url.pathname === WS_PATH ||
      url.pathname.startsWith('/admin/api/')
    ) {
      budget.http()
    }

    if (url.pathname === '/worlds') return Response.json(worlds.reply())

    if (url.pathname === '/healthz') {
      const { id, game, loop, connections } = await worlds.get(
        worlds.route(url.searchParams.get(WORLD_PARAM)),
      )
      return Response.json({
        ok: true,
        // The client builds this map while it loads (saves a reload on join).
        map: game.mapId,
        world: id,
        tick: game.tick,
        players: game.players.size,
        connections: connections.count(),
        tickMs: Number(loop.tickMs.toFixed(3)),
        simMs: Number(game.timing.simMs.toFixed(3)),
        snapshotMs: Number(game.timing.snapshotMs.toFixed(3)),
        budget: budget.snapshot(),
      })
    }

    if (url.pathname.startsWith('/admin/api/')) return admin.handle(req)
    if (url.pathname === '/admin') return serveStatic(clientDist, '/admin.html')

    if (url.pathname === WS_PATH) {
      const ip = server.requestIP(req)?.address
      const world = await worlds.get(worlds.route(url.searchParams.get(WORLD_PARAM)))
      const upgraded = server.upgrade(req, {
        data: { session: null, world, ...(ip ? { ip } : {}) },
      })
      return upgraded ? undefined : new Response('WebSocket upgrade failed', { status: 400 })
    }

    return serveStatic(clientDist, url.pathname)
  },
  // Each socket goes to its own world's handlers.
  websocket: {
    open: (ws) => ws.data.world.connections.handlers.open?.(ws),
    message: (ws, raw) => ws.data.world.connections.handlers.message?.(ws, raw),
    close: (ws, code, reason) => ws.data.world.connections.handlers.close?.(ws, code, reason),
  },
})

console.log(
  `[server] listening on http://localhost:${server.port} (ws ${WS_PATH}, ${TICK_RATE} Hz)`,
)

// Periodic health line while people are playing.
setInterval(() => {
  for (const [id, { game, loop }] of worlds.worlds()) {
    if (game.players.size === 0) continue
    console.log(
      `[game] ${id}: ${game.players.size} players · tick avg ${loop.tickMs.toFixed(2)} ms · max ${loop.takeMaxTickMs().toFixed(2)} ms`,
    )
  }
}, 10_000)

// Anything that escapes is logged where the admin page can see it (and the server keeps going).
process.on('uncaughtException', (err) => {
  console.error('[server] uncaught:', err)
  errorLog.add('process', err)
})
process.on('unhandledRejection', (err) => {
  console.error('[server] unhandled rejection:', err)
  errorLog.add('process', err)
})

async function shutdown() {
  console.log('[server] shutting down')
  for (const [, w] of worlds.worlds()) w.loop.stop()
  server.stop(true)
  // Everybody still playing is saved where they stand (give up after a few seconds).
  const saved = [...worlds.worlds()].map(([, w]) => w.game.saveAll())
  await Promise.race([Promise.all(saved), new Promise((r) => setTimeout(r, 3000))])
  process.exit(0)
}
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
