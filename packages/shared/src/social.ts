/**
 * Talking without a microphone: text chat, map pings and the friendly wave. Rules shared by the
 * server (which enforces them) and the client (which shows the same limits before sending).
 */

/** Longest chat line (characters, after cleaning). */
export const CHAT_MAX = 120
/** Survival "nearby" chat reaches this far (m). */
export const CHAT_NEARBY = 40
/** Pings reach everyone within this (m) in survival (and in modes without teams). */
export const PING_RANGE = 150
/** A wave is seen this far away (m) in survival. */
export const EMOTE_RANGE = 60

/** Who a chat line goes to. Survival: nearby / all; arena modes: all / team. */
export type ChatChannel = 'nearby' | 'all' | 'team'

/** What a ping says (the wheel's options, clockwise from the top). */
export const PING_KINDS = ['go', 'zombie', 'loot', 'help', 'infected'] as const
export type PingKind = (typeof PING_KINDS)[number]

export const PING_LABELS: Record<PingKind, string> = {
  go: 'Go here',
  zombie: 'Zombie!',
  loot: 'Loot here',
  help: 'Help!',
  infected: 'Infected!',
}

/** Client → server. */
export type SocialRequest =
  | { kind: 'chat'; text: string; channel: ChatChannel }
  | { kind: 'ping'; ping: PingKind; x: number; y: number; z: number }
  | { kind: 'emote' }
  /** Stop (or start again) hearing from player `id`: their chat, pings and waves. */
  | { kind: 'mute'; id: number; muted: boolean }

/** Server → client. */
export type SocialEvent =
  | { kind: 'chat'; from: number; name: string; text: string; channel: ChatChannel }
  | { kind: 'ping'; from: number; ping: PingKind; x: number; y: number; z: number }
  | { kind: 'emote'; from: number }
  /** Only to you: "slow down", "muted Ray" and the like. */
  | { kind: 'system'; text: string }

/** Control characters, zero-width marks and text-direction overrides. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g

/**
 * A chat line as it may be shown: control characters and markup brackets gone, whitespace
 * collapsed, cut to CHAT_MAX. Empty when nothing is left.
 */
export function cleanChat(text: string): string {
  return String(text)
    .replace(UNSAFE, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CHAT_MAX)
    .trim()
}

/** Words the filter hides (whole words and simple plurals / -ing / -er forms). */
const BAD_WORDS = [
  'fuck',
  'fucking',
  'fucker',
  'shit',
  'cunt',
  'bitch',
  'bastard',
  'dick',
  'cock',
  'pussy',
  'asshole',
  'arsehole',
  'whore',
  'slut',
  'fag',
  'faggot',
  'nigger',
  'nigga',
  'retard',
  'twat',
  'wanker',
  'motherfucker',
]
const BAD = new RegExp(`\\b(${BAD_WORDS.join('|')})(s|es|ed|ing|er|ers)?\\b`, 'gi')

/** The profanity filter: each listed word becomes asterisks of the same length. */
export function filterProfanity(text: string): string {
  return text.replace(BAD, (word) => '*'.repeat(word.length))
}

/**
 * A token bucket: `burst` actions at once, refilled at one per `every` seconds. Times are in
 * seconds (the server passes its tick clock, so tests are exact).
 */
export class RateLimit {
  private tokens: number
  private last = Number.NEGATIVE_INFINITY
  private readonly burst: number
  private readonly every: number

  constructor(burst: number, every: number) {
    this.burst = burst
    this.every = every
    this.tokens = burst
  }

  /** Takes one token if there is one. */
  take(now: number): boolean {
    if (this.last !== Number.NEGATIVE_INFINITY) {
      this.tokens = Math.min(this.burst, this.tokens + (now - this.last) / this.every)
    }
    this.last = now
    if (this.tokens < 1) return false
    this.tokens -= 1
    return true
  }
}
