import { WS_PATH } from '@office-fps/shared'
// Rapier's WASM as a precompiled module: Workers can't compile WASM from bytes at runtime, so
// build.ts strips the inlined base64 copy from Rapier and points it at this instead.
import rapierWasm from './rapier.wasm'

globalThis.__RAPIER_WASM__ = rapierWasm

export { GameRoom } from './room.ts'

/**
 * Static client files (game and admin page) are served by Workers Assets before this runs (free,
 * not metered); only the WebSocket, health check and admin API reach the worker, and all of them
 * go to the single office room.
 */
export default {
  fetch(request: Request, env: Env): Response | Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname === WS_PATH || pathname === '/healthz' || pathname.startsWith('/admin/api/')) {
      const room = env.ROOM.get(env.ROOM.idFromName('office'), { locationHint: 'weur' })
      return room.fetch(request)
    }
    return new Response('Not found', { status: 404 })
  },
} satisfies ExportedHandler<Env>
