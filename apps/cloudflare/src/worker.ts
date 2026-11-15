import {
  PROTOCOL_VERSION,
  roomName,
  routeWorld,
  WORLD_HEADER,
  WORLD_PARAM,
  WS_PATH,
} from '@office-fps/shared'
// Rapier's WASM as a precompiled module: Workers can't compile WASM from bytes at runtime, so
// build.ts strips the inlined base64 copy from Rapier and points it at this instead.
import rapierWasm from './rapier.wasm'

globalThis.__RAPIER_WASM__ = rapierWasm

export { GameRoom } from './room.ts'
export { Settings } from './settings.ts'
export { SaveVault } from './vault.ts'

/**
 * Static client files (game and admin page) are served by Workers Assets before this runs (free,
 * not metered); only the WebSocket, health check, world list and admin API reach the worker.
 * `?world=` picks the room (worlds.ts): each world is its own GameRoom instance (idFromName), so
 * no new Durable Object class is needed; without it everything goes to the original world.
 */
export default {
  fetch(request: Request, env: Env): Response | Promise<Response> {
    const url = new URL(request.url)
    const { pathname } = url
    if (pathname === '/worlds') {
      // Head counts live in the Settings object (rooms report them), so listing the worlds
      // never wakes a sleeping room.
      return env.SETTINGS.get(env.SETTINGS.idFromName('office')).fetch('https://settings/worlds')
    }
    if (pathname === WS_PATH || pathname === '/healthz' || pathname.startsWith('/admin/api/')) {
      // One room per world and protocol version: Cloudflare keeps a running room on its old code
      // while anyone is connected, so a protocol bump must land in a fresh room (old tabs reload).
      const world = routeWorld(url.searchParams.get(WORLD_PARAM))
      const name = roomName(world, PROTOCOL_VERSION)
      const room = env.ROOM.get(env.ROOM.idFromName(name), { locationHint: 'weur' })
      const forwarded = new Request(request)
      forwarded.headers.set(WORLD_HEADER, world)
      return room.fetch(forwarded)
    }
    return new Response('Not found', { status: 404 })
  },
} satisfies ExportedHandler<Env>
