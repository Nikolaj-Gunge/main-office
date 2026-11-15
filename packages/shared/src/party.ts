/**
 * Parties ("camps") and trading between players. Rules shared by the server (which enforces
 * them) and the client (which shows the same limits). Both travel inside ClientMsg.Social /
 * ServerMsg.Social as extra kinds (see social.ts), so the binary wire format is unchanged.
 */
import { ITEMS } from './survival/items.ts'

/** At most this many people in one camp. */
export const PARTY_MAX = 4
/** A delivery counts for camp-mates this close to whoever hands it over (m). */
export const PARTY_CREDIT_RANGE = 50
/** Both traders must stand this close together (m). */
export const TRADE_RANGE = 3
/** Different things one side of a trade can hold. */
export const TRADE_MAX_LINES = 12

/** No 0/O, 1/I/L: codes get read out loud and typed by hand. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const PARTY_CODE_LENGTH = 6
const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${PARTY_CODE_LENGTH}}$`)

/** A fresh camp code. */
export function makePartyCode(random: () => number = Math.random): string {
  let code = ''
  for (let i = 0; i < PARTY_CODE_LENGTH; i++)
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)] ?? 'A'
  return code
}

/** The code as typed (any case, stray spaces), or null when it isn't one. */
export function cleanPartyCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const code = raw.trim().toUpperCase()
  return CODE_PATTERN.test(code) ? code : null
}

/** The query parameter an invite link carries. */
export const PARTY_PARAM = 'camp'

/** One camp-mate, as their camp sees them (positions arrive once a second). */
export interface PartyMember {
  id: number
  name: string
  x: number
  y: number
  z: number
  alive: boolean
}

/** Your camp: its code, who leads it (the first in), and everyone in it, you included. */
export interface PartyInfo {
  code: string
  leader: number
  members: PartyMember[]
}

/** Some of one item put on the table. */
export interface TradeLine {
  item: string
  n: number
}

/** What one side of a trade puts on the table. */
export interface TradeOffer {
  items: TradeLine[]
  money: number
}

/** A trade as one side sees it. */
export interface TradeView {
  with: number
  name: string
  mine: TradeOffer
  theirs: TradeOffer
  mineOk: boolean
  theirsOk: boolean
}

export const EMPTY_OFFER: TradeOffer = { items: [], money: 0 }

/** Things that can't change hands: quest items stay with whoever the story gave them to. */
export function tradeable(item: string): boolean {
  const def = ITEMS[item]
  return !!def && def.kind !== 'quest' && def.kind !== 'money'
}

/**
 * An offer as a client sent it (it could be anything), made safe: known tradeable items only,
 * whole positive counts, the same item merged, at most TRADE_MAX_LINES lines. Null when it
 * isn't an offer at all.
 */
export function cleanOffer(raw: unknown): TradeOffer | null {
  if (!raw || typeof raw !== 'object') return null
  const { items, money } = raw as { items?: unknown; money?: unknown }
  if (!Array.isArray(items) || items.length > TRADE_MAX_LINES * 2) return null
  if (typeof money !== 'number' || !Number.isFinite(money) || money < 0) return null
  const counts = new Map<string, number>()
  for (const line of items) {
    if (!line || typeof line !== 'object') return null
    const { item, n } = line as { item?: unknown; n?: unknown }
    if (typeof item !== 'string' || !tradeable(item)) return null
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 9999) return null
    counts.set(item, (counts.get(item) ?? 0) + n)
  }
  if (counts.size > TRADE_MAX_LINES) return null
  return {
    items: [...counts].map(([item, n]) => ({ item, n })),
    money: Math.min(1_000_000, Math.floor(money)),
  }
}

/** Client → server (inside ClientMsg.Social). */
export type PartyRequest =
  /** Join camp `code` (made if nobody is in it yet: your own code works after a reconnect). */
  | { kind: 'party'; op: 'join'; code: string }
  /** Leave and start a camp of your own. */
  | { kind: 'party'; op: 'leave' }

export type TradeRequest =
  /** Ask player `id` to trade; asking somebody who asked you opens the window for both. */
  | { kind: 'trade'; op: 'ask'; id: number }
  /** What you put on the table now (un-confirms both sides). */
  | { kind: 'trade'; op: 'offer'; offer: TradeOffer }
  | { kind: 'trade'; op: 'confirm' }
  | { kind: 'trade'; op: 'cancel' }

/** Server → client (inside ServerMsg.Social). */
export type PartyEvent =
  | { kind: 'party'; party: PartyInfo }
  /** The trade window as it stands (null: closed). */
  | { kind: 'trade'; trade: TradeView | null }
  /** Somebody wants to trade with you. */
  | { kind: 'tradeAsk'; from: number; name: string }
