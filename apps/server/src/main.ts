import {
  createPhysicsWorld,
  DEFAULT_MAP_ID,
  DEFAULT_SERVER_PORT,
  initPhysics,
  loadMap,
  TICK_RATE,
  WS_PATH,
} from '@office-fps/shared'
import { AdminApi } from './admin.ts'
import { createConnections, type SocketData } from './connections.ts'
import { errorLog } from './errors.ts'
import { Game } from './game.ts'
import { GameLoop } from './loop.ts'
import { serveStatic } from './static.ts'

const port = Number(process.env.PORT ?? DEFAULT_SERVER_PORT)
const clientDist = process.env.CLIENT_DIST ?? new URL('../../client/dist', import.meta.url).pathname

await initPhysics()
const map = loadMap(process.env.MAP ?? DEFAULT_MAP_ID)
const physics = createPhysicsWorld(map)
const game = new Game(map, physics)
console.log(
  `[server] map "${map.name}": ${physics.mapColliders.length} colliders, ` +
    `${game.spawnPointCount} spawn spots, ${map.pickups?.length ?? 0} weapon pickups`,
)

const admin = new AdminApi(game, { password: process.env.ADMIN_PASSWORD })
if (!process.env.ADMIN_PASSWORD) console.log('[server] admin page disabled (set ADMIN_PASSWORD)')

const loop = new GameLoop(TICK_RATE, () => game.step())
const connections = createConnections(game, () => loop.tickMs)

const server = Bun.serve<SocketData>({
  port,
  fetch(req, server) {
    const url = new URL(req.url)

    if (url.pathname === '/healthz') {
      return Response.json({
        ok: true,
        // The client builds this map while it loads (saves a reload on join).
        map: game.mapId,
        tick: game.tick,
        players: game.players.size,
        connections: connections.count(),
        tickMs: Number(loop.tickMs.toFixed(3)),
        simMs: Number(game.timing.simMs.toFixed(3)),
        snapshotMs: Number(game.timing.snapshotMs.toFixed(3)),
      })
    }

    if (url.pathname.startsWith('/admin/api/')) return admin.handle(req)
    if (url.pathname === '/admin') return serveStatic(clientDist, '/admin.html')

    if (url.pathname === WS_PATH) {
      const ip = server.requestIP(req)?.address
      const upgraded = server.upgrade(req, { data: { session: null, ...(ip ? { ip } : {}) } })
      return upgraded ? undefined : new Response('WebSocket upgrade failed', { status: 400 })
    }

    return serveStatic(clientDist, url.pathname)
  },
  websocket: connections.handlers,
})

loop.start()
console.log(
  `[server] listening on http://localhost:${server.port} (ws ${WS_PATH}, ${TICK_RATE} Hz)`,
)

// Periodic health line while people are playing.
setInterval(() => {
  if (game.players.size === 0) return
  console.log(
    `[game] ${game.players.size} players · tick avg ${loop.tickMs.toFixed(2)} ms · max ${loop.takeMaxTickMs().toFixed(2)} ms`,
  )
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

function shutdown() {
  console.log('[server] shutting down')
  loop.stop()
  server.stop(true)
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
