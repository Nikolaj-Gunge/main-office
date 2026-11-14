import { ClientMsg } from '@office-fps/shared'

/** A token bucket: `rate` tokens a second, holding at most `burst`. */
export class TokenBucket {
  private tokens: number
  private last: number

  constructor(
    readonly rate: number,
    readonly burst: number,
    now = Date.now(),
  ) {
    this.tokens = burst
    this.last = now
  }

  /** Spends a token if there is one. */
  take(now = Date.now()): boolean {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate)
    this.last = now
    if (this.tokens < 1) return false
    this.tokens -= 1
    return true
  }
}

/**
 * Allowance per message type, per connection (messages/s, burst). Generous for an honest client:
 * Input is ~15/s plus a flush per button press, Ping 1/s, Actions a few per second when someone
 * drags things around the backpack fast. Anything beyond is a broken or hostile client.
 */
const LIMITS: Record<ClientMsg, { rate: number; burst: number }> = {
  [ClientMsg.Hello]: { rate: 1, burst: 3 },
  [ClientMsg.Input]: { rate: 60, burst: 60 },
  [ClientMsg.Ping]: { rate: 4, burst: 8 },
  [ClientMsg.SetDebug]: { rate: 2, burst: 5 },
  [ClientMsg.Action]: { rate: 10, burst: 20 },
  // Chat, pings and waves have their own, stricter limits in social.ts; this only stops floods.
  [ClientMsg.Social]: { rate: 4, burst: 8 },
}

/** Log at most one line per connection this often, however hard it floods. */
const LOG_EVERY_MS = 5000

/** Per-connection limiter over all client message types; over-limit messages are dropped. */
export class MessageLimiter {
  private readonly buckets = new Map<number, TokenBucket>()
  private lastLog = Number.NEGATIVE_INFINITY
  /** Messages dropped since the last log line. */
  private droppedSinceLog = 0
  /** All messages dropped on this connection. */
  dropped = 0

  constructor(private readonly log: (text: string) => void = console.warn) {}

  /** True if this message may be handled. */
  allow(type: number, label: () => string, now = Date.now()): boolean {
    const limit = LIMITS[type as ClientMsg]
    if (!limit) return true // the decoder rejects unknown types anyway
    let bucket = this.buckets.get(type)
    if (!bucket) {
      bucket = new TokenBucket(limit.rate, limit.burst, now)
      this.buckets.set(type, bucket)
    }
    if (bucket.take(now)) return true
    this.dropped++
    this.droppedSinceLog++
    if (now - this.lastLog >= LOG_EVERY_MS) {
      this.log(`[ws] rate limit: dropped ${this.droppedSinceLog} message(s) from ${label()}`)
      this.lastLog = now
      this.droppedSinceLog = 0
    }
    return false
  }
}
