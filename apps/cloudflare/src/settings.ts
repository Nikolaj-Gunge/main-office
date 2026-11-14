import { DurableObject } from 'cloudflare:workers'
import { addCounts, type BudgetCounts } from '@office-fps/server/budget'

/**
 * Admin settings (game rules, bans) and the day's request count, which outlive the game rooms.
 * Rooms are per protocol version, so every update starts a fresh room; this tiny object keeps them.
 *   GET  /rules or /bans → the stored JSON (or null) · PUT → store the body
 *   GET  /budget → today's total counts (or null)  · POST /budget → add a room's counts, returns
 *                                                     the new total
 */
export class Settings extends DurableObject {
  override async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname === '/budget') {
      const stored = (await this.ctx.storage.get<BudgetCounts>('budget')) ?? null
      if (request.method !== 'POST') return Response.json(stored)
      const total = addCounts(stored, (await request.json()) as BudgetCounts)
      await this.ctx.storage.put('budget', total)
      return Response.json(total)
    }
    const key = pathname === '/bans' ? 'bans' : 'rules'
    if (request.method === 'PUT') {
      await this.ctx.storage.put(key, await request.json())
      return new Response(null, { status: 204 })
    }
    return Response.json((await this.ctx.storage.get(key)) ?? null)
  }
}
