import {
  createPhysicsWorld,
  DEFAULT_MAP_ID,
  DEFAULT_SERVER_PORT,
  initPhysics,
  loadMap,
  TICK_RATE,
  WS_PATH,
} from '@office-fps/shared'
import { createConnections, type SocketData } from './connections.ts'
import { GameLoop } from './loop.ts'
import { serveStatic } from './static.ts'

const port = Number(process.env.PORT ?? DEFAULT_SERVER_PORT)
const clientDist = process.env.CLIENT_DIST ?? new URL('../../client/dist', import.meta.url).pathname

await initPhysics()
const map = loadMap(process.env.MAP ?? DEFAULT_MAP_ID)
// Phase 3: players get a PlayerBody in this world and are simulated with stepPlayer.
const physics = createPhysicsWorld(map)
console.log(
  `[server] map "${map.name}": ${physics.mapColliders.length} colliders, ${map.spawns.length} spawns`,
)

const loop = new GameLoop(TICK_RATE, () => {
  // Phase 3: step the world and broadcast snapshots here.
})

const connections = createConnections(() => loop.tick)

const server = Bun.serve<SocketData>({
  port,
  fetch(req, server) {
    const url = new URL(req.url)

    if (url.pathname === '/healthz') {
      return Response.json({ ok: true, tick: loop.tick, players: connections.count() })
    }

    if (url.pathname === WS_PATH) {
      const upgraded = server.upgrade(req, { data: { playerId: 0, name: '' } })
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

function shutdown() {
  console.log('[server] shutting down')
  loop.stop()
  server.stop(true)
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
