/**
 * Counts what Cloudflare's Durable Objects free plan meters, per UTC day: every HTTP request
 * (WebSocket upgrades, /healthz, admin API) is one request, and every 20 incoming WebSocket
 * messages are one more (outgoing messages are free). The free plan allows 100,000 a day; past
 * that the room errors for everyone until midnight UTC. So once usage passes JOIN_CUTOFF of the
 * limit, new joins are turned away politely and the people already playing keep their evening.
 *
 * The Bun server counts the same way (in memory), so the numbers can be checked locally.
 */

/** Cloudflare's free allowance of Durable Object requests per day. */
export const FREE_REQUEST_LIMIT = 100_000
/** Incoming WebSocket messages per metered request. */
export const MESSAGES_PER_REQUEST = 20
/** Share of the limit after which nobody new may join. */
export const JOIN_CUTOFF = 0.95

export interface BudgetSnapshot {
  /** UTC day these counts are for, YYYY-MM-DD. */
  day: string
  messages: number
  http: number
  /** Request units used today: http + messages / 20. */
  usedToday: number
  /** 0 = no limit (paid plan). */
  freeLimit: number
  /** usedToday as a percentage of freeLimit (0 with no limit). */
  pct: number
  /** True once new joins are turned away. */
  resting: boolean
}

/** A day's counts, as stored (the Cloudflare rooms keep the total in the Settings object). */
export interface BudgetCounts {
  day: string
  messages: number
  http: number
}

export const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10)

/**
 * Reads FREE_REQUEST_LIMIT from the environment: unset → the free plan's 100,000, 0 → no limit
 * (the owner moved to the paid plan), anything else → that many requests a day.
 */
export function limitFromEnv(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return FREE_REQUEST_LIMIT
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : FREE_REQUEST_LIMIT
}

/**
 * Today's request use. `local` is what this process counted since it last synced; `base` is the
 * day's total from storage as of that sync (other rooms included). The Bun server never syncs.
 */
export class RequestBudget {
  private base: BudgetCounts
  private local: BudgetCounts

  constructor(
    readonly freeLimit = FREE_REQUEST_LIMIT,
    private readonly now: () => number = Date.now,
  ) {
    const day = utcDay(now())
    this.base = { day, messages: 0, http: 0 }
    this.local = { day, messages: 0, http: 0 }
  }

  /** Incoming WebSocket messages. */
  message(count = 1): void {
    this.rollover()
    this.local.messages += count
  }

  /** HTTP requests (a WebSocket upgrade counts as one too). */
  http(count = 1): void {
    this.rollover()
    this.local.http += count
  }

  get usedToday(): number {
    this.rollover()
    const http = this.base.http + this.local.http
    return http + (this.base.messages + this.local.messages) / MESSAGES_PER_REQUEST
  }

  /** Past the cutoff: turn new players away (the limit itself is a hard wall for everyone). */
  get resting(): boolean {
    return this.freeLimit > 0 && this.usedToday >= this.freeLimit * JOIN_CUTOFF
  }

  snapshot(): BudgetSnapshot {
    const used = this.usedToday
    return {
      day: this.local.day,
      messages: this.base.messages + this.local.messages,
      http: this.base.http + this.local.http,
      usedToday: Math.round(used),
      freeLimit: this.freeLimit,
      pct: this.freeLimit > 0 ? Number(((used / this.freeLimit) * 100).toFixed(1)) : 0,
      resting: this.resting,
    }
  }

  /** Counted here since the last sync (to add to the stored total); null if nothing new. */
  unsynced(): BudgetCounts | null {
    this.rollover()
    if (this.local.messages === 0 && this.local.http === 0) return null
    return { ...this.local }
  }

  /**
   * The stored total after adding `sent` (an earlier `unsynced()`) to it — or simply the stored
   * total on start-up, with `sent` omitted. Counts from other days are ignored.
   */
  synced(total: Partial<BudgetCounts> | null | undefined, sent?: BudgetCounts): void {
    this.rollover()
    if (sent && sent.day === this.local.day) {
      this.local.messages = Math.max(0, this.local.messages - sent.messages)
      this.local.http = Math.max(0, this.local.http - sent.http)
    }
    if (total?.day === this.local.day) {
      this.base = {
        day: this.local.day,
        messages: Math.max(0, Number(total.messages) || 0),
        http: Math.max(0, Number(total.http) || 0),
      }
    }
  }

  private rollover(): void {
    const day = utcDay(this.now())
    if (day === this.local.day) return
    this.base = { day, messages: 0, http: 0 }
    this.local = { day, messages: 0, http: 0 }
  }
}

/**
 * Adds a room's unsynced counts to the stored day total (the Settings object's side of a sync).
 * A new day starts from zero.
 */
export function addCounts(
  stored: BudgetCounts | null | undefined,
  add: BudgetCounts,
): BudgetCounts {
  if (!stored || stored.day !== add.day) return { ...add }
  return {
    day: add.day,
    messages: stored.messages + add.messages,
    http: stored.http + add.http,
  }
}
