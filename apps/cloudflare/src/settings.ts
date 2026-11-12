import { DurableObject } from 'cloudflare:workers'

/**
 * Admin settings (game rules) that outlive the game rooms. Rooms are per protocol version, so
 * every update starts a fresh room; this tiny object keeps the rules across those.
 *   GET  → the stored rules JSON (or null) · PUT → store the body
 */
export class Settings extends DurableObject {
  override async fetch(request: Request): Promise<Response> {
    if (request.method === 'PUT') {
      await this.ctx.storage.put('rules', await request.json())
      return new Response(null, { status: 204 })
    }
    return Response.json((await this.ctx.storage.get('rules')) ?? null)
  }
}
