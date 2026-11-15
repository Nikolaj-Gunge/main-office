import { DurableObject } from 'cloudflare:workers'
import { addCounts, type BudgetCounts, utcDay } from '@office-fps/server/budget'
import { type Presence, presenceCounts, reportPresence, worldsReply } from '@office-fps/shared'

/**
 * Admin settings (game rules, bans), the day's request count and each world's head count, which
 * outlive the game rooms. Rooms are per world and protocol version, so every update starts fresh
 * rooms; this one tiny object is shared by all of them (so the budget is counted across worlds).
 *   GET  /rules or /bans → the stored JSON (or null) · PUT → store the body
 *   GET  /budget → today's total counts (or null)  · POST /budget → add a room's counts, returns
 *                                                     the new total
 *   POST /presence {world, players} → a room's head count; returns the day's budget total
 *   GET  /worlds → the public worlds with head counts and where to go (worlds.ts)
 */
export class Settings extends DurableObject {
  /** /worlds requests answered here and not yet added to the stored budget. */
  private uncounted = 0

  override async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname === '/worlds') {
      // Only the worker asks this, so the room counts don't see it: count it here.
      this.uncounted++
      const presence = (await this.ctx.storage.get<Presence>('presence')) ?? {}
      return Response.json(worldsReply(presenceCounts(presence, Date.now())), {
        headers: { 'Cache-Control': 'no-store' },
      })
    }
    if (pathname === '/presence' && request.method === 'POST') {
      const { world, players } = (await request.json()) as { world: string; players: number }
      const presence = (await this.ctx.storage.get<Presence>('presence')) ?? {}
      const next = reportPresence(presence, String(world), Number(players), Date.now())
      if (next !== presence) await this.ctx.storage.put('presence', next)
      return Response.json(await this.addBudget(null))
    }
    if (pathname === '/budget') {
      if (request.method !== 'POST') {
        return Response.json((await this.ctx.storage.get<BudgetCounts>('budget')) ?? null)
      }
      return Response.json(await this.addBudget((await request.json()) as BudgetCounts))
    }
    const key = pathname === '/bans' ? 'bans' : 'rules'
    if (request.method === 'PUT') {
      await this.ctx.storage.put(key, await request.json())
      return new Response(null, { status: 204 })
    }
    return Response.json((await this.ctx.storage.get(key)) ?? null)
  }

  /** Adds a room's counts (and the /worlds requests seen here) to today's total; returns it. */
  private async addBudget(add: BudgetCounts | null): Promise<BudgetCounts | null> {
    let total = (await this.ctx.storage.get<BudgetCounts>('budget')) ?? null
    const changed = add !== null || this.uncounted > 0
    if (add) total = addCounts(total, add)
    if (this.uncounted > 0) {
      total = addCounts(total, { day: utcDay(Date.now()), messages: 0, http: this.uncounted })
      this.uncounted = 0
    }
    if (changed) await this.ctx.storage.put('budget', total)
    return total
  }
}
