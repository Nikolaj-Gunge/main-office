import { DurableObject } from 'cloudflare:workers'

/**
 * Admin settings (game rules, bans) that outlive the game rooms. Rooms are per protocol version,
 * so every update starts a fresh room; this tiny object keeps the settings across those.
 *   GET /rules or /bans → the stored JSON (or null) · PUT → store the body
 */
export class Settings extends DurableObject {
  override async fetch(request: Request): Promise<Response> {
    const key = new URL(request.url).pathname === '/bans' ? 'bans' : 'rules'
    if (request.method === 'PUT') {
      await this.ctx.storage.put(key, await request.json())
      return new Response(null, { status: 204 })
    }
    return Response.json((await this.ctx.storage.get(key)) ?? null)
  }
}
