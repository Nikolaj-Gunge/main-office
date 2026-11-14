/** How many recent errors are kept (older ones fall off the end). */
export const MAX_ERRORS = 50
/** Longest message / stack kept per error (characters). */
const MAX_MESSAGE = 300
const MAX_STACK = 1500

export interface ReportedError {
  /** Date.now() of the latest occurrence. */
  at: number
  /** Where it happened: 'tick', 'session', 'process', 'client', … */
  source: string
  message: string
  stack?: string
  /** Extra context (player, URL, user agent…), short. */
  context?: string
  /** Same source and message seen again while still in the buffer: counted, not repeated. */
  count: number
}

/**
 * The last MAX_ERRORS errors, server and client, for the admin page (`/admin/api/errors`).
 * One per server process / Durable Object isolate; nothing is stored beyond memory.
 */
export class ErrorLog {
  private readonly entries: ReportedError[] = []

  /** Records an error; a repeat of one still in the buffer bumps its count instead. */
  add(source: string, error: unknown, context?: string, now = Date.now()): ReportedError {
    const message = clip(messageOf(error), MAX_MESSAGE)
    const stack = error instanceof Error && error.stack ? clip(error.stack, MAX_STACK) : undefined
    const same = this.entries.find((e) => e.source === source && e.message === message)
    if (same) {
      same.count++
      same.at = now
      if (context) same.context = clip(context, MAX_MESSAGE)
      // Most recent first.
      this.entries.splice(this.entries.indexOf(same), 1)
      this.entries.unshift(same)
      return same
    }
    const entry: ReportedError = {
      at: now,
      source,
      message,
      ...(stack ? { stack } : {}),
      ...(context ? { context: clip(context, MAX_MESSAGE) } : {}),
      count: 1,
    }
    this.entries.unshift(entry)
    if (this.entries.length > MAX_ERRORS) this.entries.length = MAX_ERRORS
    return entry
  }

  /** Newest first. */
  list(): readonly ReportedError[] {
    return this.entries
  }

  clear(): void {
    this.entries.length = 0
  }
}

/** The process-wide log (the loop, sessions and the admin API all add to it). */
export const errorLog = new ErrorLog()

function messageOf(error: unknown): string {
  // A browser's report already reads "TypeError: …".
  if (error instanceof Error)
    return error.name === 'ClientError' ? error.message : `${error.name}: ${error.message}`
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error) ?? String(error)
  } catch {
    return String(error)
  }
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** Client error reports allowed per client (IP) per window, beyond which they're dropped. */
const CLIENT_REPORTS = 10
const CLIENT_WINDOW_MS = 60_000

/**
 * Takes uncaught errors browsers send (`POST /admin/api/client-error`, no password: any player's
 * page may report). Rate-limited per client so a page stuck in an error loop can't flood it.
 */
export class ClientErrorIntake {
  private readonly log: ErrorLog
  private readonly recent = new Map<string, { n: number; since: number }>()

  constructor(log: ErrorLog) {
    this.log = log
  }

  /** True if recorded, false if dropped (rate limit, junk). */
  take(client: string, body: unknown, now = Date.now()): boolean {
    const r = this.recent.get(client)
    if (r && now - r.since < CLIENT_WINDOW_MS) {
      if (r.n >= CLIENT_REPORTS) return false
      r.n++
    } else {
      this.recent.set(client, { n: 1, since: now })
      // Keep the map small: forget clients whose window has passed.
      if (this.recent.size > 500)
        for (const [k, v] of this.recent)
          if (now - v.since >= CLIENT_WINDOW_MS) this.recent.delete(k)
    }
    if (typeof body !== 'object' || body === null) return false
    const b = body as Record<string, unknown>
    const message = typeof b.message === 'string' ? b.message : ''
    if (!message) return false
    const error = new Error(message)
    error.name = 'ClientError'
    if (typeof b.stack === 'string') error.stack = b.stack
    else delete error.stack
    const context = [b.where, b.url, b.agent].filter((x) => typeof x === 'string' && x).join(' · ')
    this.log.add('client', error, context || undefined, now)
    return true
  }
}
