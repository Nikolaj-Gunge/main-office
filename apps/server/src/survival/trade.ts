import {
  type Bag,
  cleanOffer,
  cloneBag,
  countOf,
  EMPTY_OFFER,
  give,
  type SocialEvent,
  type Stack,
  type SurvivalSelf,
  TRADE_RANGE,
  type TradeOffer,
  type TradeRequest,
  type TradeView,
} from '@office-fps/shared'
import type { ServerPlayer } from '../game.ts'

/** A survivor who could trade: alive, with a backpack. */
export interface Trader {
  player: ServerPlayer
  self: SurvivalSelf
}

/** What trading needs from the director. */
export interface TradeHost {
  /** Player `id` as somebody who can trade right now (alive, a survivor), or null. */
  trader(id: number): Trader | null
  now(): number
  send(player: ServerPlayer, event: SocialEvent): void
  /** Their backpack or money changed: tell them. */
  touch(t: Trader): void
}

/** An unanswered "trade?" lapses after this (s). */
const ASK_SECONDS = 30
/** A little slack before an open window closes for distance (m): people shuffle about. */
const LEAVE_SLACK = 1

interface Session {
  a: number
  b: number
  offers: Map<number, TradeOffer>
  ok: Set<number>
}

/**
 * Trading between two survivors standing together: each puts things from their pockets and
 * some money on the table, both confirm, and it all changes hands at once — or, if anything no
 * longer adds up (not carried any more, no room, walked off), nothing does.
 */
export class Trades {
  private readonly host: TradeHost
  /** Who asked whom, and when. */
  private readonly asks = new Map<number, { to: number; at: number }>()
  private readonly sessions = new Map<number, Session>()

  constructor(host: TradeHost) {
    this.host = host
  }

  handle(from: ServerPlayer, req: TradeRequest): void {
    switch (req.op) {
      case 'ask':
        return void this.ask(from, req.id)
      case 'offer':
        return void this.offer(from, req.offer)
      case 'confirm':
        return void this.confirm(from)
      case 'cancel': {
        const s = this.sessions.get(from.id)
        if (s) this.close(s, `${from.name} called the trade off.`)
        return
      }
    }
  }

  /** Is `id` in the middle of a trade? */
  trading(id: number): boolean {
    return this.sessions.has(id)
  }

  /** Once a second: windows close when people walk apart or die; old asks lapse. */
  step(): void {
    const now = this.host.now()
    for (const [id, ask] of this.asks) if (now - ask.at > ASK_SECONDS) this.asks.delete(id)
    for (const s of new Set(this.sessions.values())) {
      const a = this.host.trader(s.a)
      const b = this.host.trader(s.b)
      if (!a || !b) this.close(s, 'The trade is off.')
      else if (apart(a, b) > TRADE_RANGE + LEAVE_SLACK) this.close(s, 'Too far apart to trade.')
    }
  }

  /** Somebody died or left: their trade is off, and so is any ask. */
  forget(id: number): void {
    this.asks.delete(id)
    const s = this.sessions.get(id)
    if (s) this.close(s, 'The trade is off.')
  }

  private ask(from: ServerPlayer, id: unknown): void {
    if (typeof id !== 'number') return
    const me = this.host.trader(from.id)
    const them = this.host.trader(id)
    if (!me || !them || them === me) return
    if (this.sessions.has(from.id)) return
    if (this.sessions.has(id)) return void this.system(from, `${them.player.name} is busy trading.`)
    if (apart(me, them) > TRADE_RANGE) return void this.system(from, 'Get closer to trade.')
    const theirs = this.asks.get(id)
    if (theirs?.to === from.id) {
      // They asked first: the window opens for both.
      this.asks.delete(id)
      this.asks.delete(from.id)
      const s: Session = { a: id, b: from.id, offers: new Map(), ok: new Set() }
      this.sessions.set(s.a, s)
      this.sessions.set(s.b, s)
      this.sync(s)
      return
    }
    this.asks.set(from.id, { to: id, at: this.host.now() })
    this.host.send(them.player, { kind: 'tradeAsk', from: from.id, name: from.name })
    this.system(from, `You asked ${them.player.name} to trade.`)
  }

  private offer(from: ServerPlayer, raw: unknown): void {
    const s = this.sessions.get(from.id)
    const me = this.host.trader(from.id)
    if (!s || !me) return
    const offer = cleanOffer(raw)
    if (!offer) return
    if (!covers(me.self, offer)) return void this.system(from, "You don't have all of that.")
    s.offers.set(from.id, offer)
    // Anything changed: both look again.
    s.ok.clear()
    this.sync(s)
  }

  private confirm(from: ServerPlayer): void {
    const s = this.sessions.get(from.id)
    if (!s) return
    s.ok.add(from.id)
    if (s.ok.has(s.a) && s.ok.has(s.b)) this.settle(s)
    else this.sync(s)
  }

  /** Both said yes: everything changes hands, or (if anything's off) nothing does. */
  private settle(s: Session): void {
    const a = this.host.trader(s.a)
    const b = this.host.trader(s.b)
    if (!a || !b) return void this.close(s, 'The trade is off.')
    if (apart(a, b) > TRADE_RANGE + LEAVE_SLACK)
      return void this.close(s, 'Too far apart to trade.')
    const fromA = s.offers.get(s.a) ?? EMPTY_OFFER
    const fromB = s.offers.get(s.b) ?? EMPTY_OFFER
    if (!covers(a.self, fromA) || !covers(b.self, fromB)) {
      s.ok.clear()
      this.sync(s)
      for (const t of [a, b]) this.system(t.player, "Something on the table isn't there any more.")
      return
    }
    // Worked out on copies; only if both sides come out right do the copies become real.
    const bagA = cloneBag(a.self)
    const bagB = cloneBag(b.self)
    const outA = pull(bagA, fromA)
    const outB = pull(bagB, fromB)
    const roomA = putAll(bagA, outB)
    const roomB = putAll(bagB, outA)
    if (!roomA || !roomB) {
      s.ok.clear()
      this.sync(s)
      const full = !roomA ? a : b
      for (const t of [a, b])
        this.system(t.player, `${full.player.name} has no room for all of it.`)
      return
    }
    a.self.inv = bagA.inv
    b.self.inv = bagB.inv
    a.self.money += fromB.money - fromA.money
    b.self.money += fromA.money - fromB.money
    this.host.touch(a)
    this.host.touch(b)
    this.close(s, 'Trade done.')
  }

  private close(s: Session, text: string): void {
    this.sessions.delete(s.a)
    this.sessions.delete(s.b)
    for (const id of [s.a, s.b]) {
      const t = this.host.trader(id)
      if (!t) continue
      this.host.send(t.player, { kind: 'trade', trade: null })
      this.system(t.player, text)
    }
  }

  /** Both windows as they stand. */
  private sync(s: Session): void {
    for (const [me, them] of [
      [s.a, s.b],
      [s.b, s.a],
    ] as const) {
      const t = this.host.trader(me)
      const other = this.host.trader(them)
      if (!t) continue
      const view: TradeView = {
        with: them,
        name: other?.player.name ?? 'Somebody',
        mine: s.offers.get(me) ?? EMPTY_OFFER,
        theirs: s.offers.get(them) ?? EMPTY_OFFER,
        mineOk: s.ok.has(me),
        theirsOk: s.ok.has(them),
      }
      this.host.send(t.player, { kind: 'trade', trade: view })
    }
  }

  private system(to: ServerPlayer, text: string): void {
    this.host.send(to, { kind: 'system', text })
  }
}

function apart(a: Trader, b: Trader): number {
  const p = a.player.state.pos
  const q = b.player.state.pos
  return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)
}

/** Do they carry everything in the offer (and the money)? */
function covers(self: SurvivalSelf, offer: TradeOffer): boolean {
  if (offer.money > self.money) return false
  return offer.items.every((line) => countOf(self.inv, line.item) >= line.n)
}

/** Takes an offer's things out of a bag, whole stacks as they were (guns keep what's loaded). */
function pull(bag: Bag, offer: TradeOffer): Stack[] {
  const out: Stack[] = []
  for (const line of offer.items) {
    let left = line.n
    for (let i = bag.inv.length - 1; i >= 0 && left > 0; i--) {
      const s = bag.inv[i]
      if (!s || s.item !== line.item) continue
      const take = Math.min(s.n, left)
      out.push({ item: s.item, n: take, ...(s.ammo !== undefined ? { ammo: s.ammo } : {}) })
      s.n -= take
      left -= take
      if (s.n <= 0) bag.inv.splice(i, 1)
    }
  }
  return out
}

/** Puts stacks away; false if any of it didn't fit. */
function putAll(bag: Bag, stacks: readonly Stack[]): boolean {
  for (const s of stacks) if (give(bag, s.item, s.n, s.ammo) < s.n) return false
  return true
}
