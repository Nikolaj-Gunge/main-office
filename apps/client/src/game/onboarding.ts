import {
  type Bio,
  bioDeathLine,
  bioLine,
  type DayPhase,
  dayPhase,
  type Notice,
  type SurvivalDef,
  type SurvivalSelf,
} from '@office-fps/shared'
import type { AudioEngine } from '../audio/audio-engine.ts'

/**
 * The first hour (ROADMAP 2.2, 2.3, 2.6), the client's side: the character card when somebody
 * new starts, one-time hints the first time something comes up, and Haven's horn at dusk.
 */

/** The card: on screen this long (s), fading in and out; any key or click skips it. */
export const CARD_SECONDS = 4.2
/** A character older than this (s alive) when first seen gets no card: an old save, not new. */
const CARD_MAX_AGE = 120
/** A hint stays up this long (s). */
const HINT_SECONDS = 7
/** Seconds between two hints, so they never pile up. */
const HINT_GAP = 2.5

const CARD_KEY = 'office-fps:card-seen'
const HINTS_KEY = 'office-fps:hints-seen'

/** Every hint, by key: shown once per device (localStorage), never again. */
export const HINTS = {
  loot: 'E to take it. Tab or I opens your pack.',
  full: 'Your pockets are full. A backpack holds more: wear one, or drop something (Tab).',
  zombie: 'They hear more than they see. Crouch (C) to sneak.',
  night: 'F for your torch. Light draws them.',
  bite: 'Bitten. Find adrenaline or a cure. The clock is in the corner.',
  car: 'E to get in. Engines are loud: they hear you coming.',
  hungry: 'Hungry. Open your pack (Tab) and eat something.',
  board: 'The job board by the gate: E to see who needs a hand.',
} as const
export type HintKey = keyof typeof HINTS

/** What the hints look at each frame (survival-client.ts fills it in). */
export interface HintContext {
  alive: boolean
  self: SurvivalSelf | null
  /** What E would do ("Take …", "Get in", …), or null. */
  prompt: string | null
  /** One of the dead within sight. */
  zombieNear: boolean
  /** A car close enough to get into. */
  carNear: boolean
  /** The day's clock, 0–1. */
  time: number
}

/** Which hint (if any) the moment calls for, of those not seen yet. Pure, for the tests. */
export function hintFor(ctx: HintContext, seen: ReadonlySet<string>): HintKey | null {
  if (!ctx.alive || !ctx.self) return null
  const want = (key: HintKey, when: boolean) => when && !seen.has(key)
  if (want('bite', ctx.self.infected !== null && ctx.self.infected !== undefined)) return 'bite'
  if (want('zombie', ctx.zombieNear)) return 'zombie'
  if (want('night', dayPhase(ctx.time) === 'night')) return 'night'
  if (want('loot', ctx.prompt?.startsWith('Take ') === true)) return 'loot'
  if (want('board', ctx.prompt === 'Read the job board')) return 'board'
  if (want('car', ctx.carNear)) return 'car'
  if (want('hungry', ctx.self.hunger < 35)) return 'hungry'
  return null
}

/** Is this a server notice that your pockets were full? */
export function isFullNotice(n: Notice): boolean {
  return n.kind === 'warn' && n.text.startsWith('No room')
}

/** Should this character get their card now? Not seen yet, and really new. */
export function wantsCard(self: SurvivalSelf | null, lastSeen: number | null): Bio | null {
  const bio = self?.bio
  if (!bio || bio.seed === lastSeen) return null
  if ((self.age ?? 0) > CARD_MAX_AGE) return null
  return bio
}

/**
 * How loud Haven's horn is from `d` metres away (it is meant to be heard all over the woods):
 * full by the camp, never quieter than a fifth of that.
 */
export function hornVolume(d: number): number {
  return Math.max(0.2, 1 - d / 1800) * 0.9
}

const load = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}
const store = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private mode or full: the hint just shows again next time.
  }
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  parent: HTMLElement,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  parent.appendChild(node)
  return node
}

export class Onboarding {
  /** Settings → "Hints": off shows none. */
  hintsOn = true
  private readonly def: SurvivalDef
  private readonly audio: AudioEngine
  private readonly card: HTMLDivElement
  private readonly cardName: HTMLElement
  private readonly cardPast: HTMLElement
  private readonly cardDeath: HTMLElement
  private cardAge = -1
  private readonly hint: HTMLDivElement
  private hintAge = -1
  private sinceHint = HINT_GAP
  private readonly seen: Set<string>
  private phase: DayPhase | null = null
  private pendingFull = false

  constructor(parent: HTMLElement, def: SurvivalDef, audio: AudioEngine) {
    this.def = def
    this.audio = audio
    this.seen = new Set(load<string[]>(HINTS_KEY, []))
    this.card = el('div', 'sv-card', parent)
    this.card.hidden = true
    const inner = el('div', 'sv-card-inner', this.card)
    this.cardName = el('div', 'sv-card-name', inner)
    this.cardPast = el('div', 'sv-card-past', inner)
    this.cardDeath = el('div', 'sv-card-death', inner)
    el('div', 'sv-card-skip', this.card, 'any key to skip')
    this.hint = el('div', 'sv-hint', parent)
    this.hint.hidden = true
    const skip = () => {
      if (this.cardAge >= 0) this.cardAge = Math.max(this.cardAge, CARD_SECONDS - 0.4)
    }
    window.addEventListener('keydown', skip)
    window.addEventListener('mousedown', skip)
  }

  /** The card is up (the game keeps running underneath). */
  get showingCard(): boolean {
    return this.cardAge >= 0
  }

  /** Shows the card for this person now. */
  showCard(bio: Bio): void {
    store(CARD_KEY, bio.seed)
    this.cardName.textContent = bio.name
    this.cardPast.textContent = bioLine(bio).slice(bio.name.length + 2)
    this.cardDeath.textContent = bioDeathLine(bio)
    this.cardAge = 0
    this.card.hidden = false
    this.card.style.opacity = '0'
  }

  /** A notice from the server: some hints answer those ("No room…"). */
  onNotice(n: Notice): void {
    if (isFullNotice(n)) this.pendingFull = true
  }

  /** Shows a hint now (if it's on and not seen before); true if it showed. */
  show(key: HintKey): boolean {
    if (!this.hintsOn || this.seen.has(key)) return false
    this.seen.add(key)
    store(HINTS_KEY, [...this.seen])
    this.hint.textContent = HINTS[key]
    this.hint.hidden = false
    this.hintAge = 0
    this.sinceHint = 0
    return true
  }

  /** Forget every hint seen (they'll show again). */
  resetHints(): void {
    this.seen.clear()
    store(HINTS_KEY, [])
  }

  update(dt: number, ctx: HintContext, listener: { x: number; y: number; z: number }): void {
    // The card: fade in, hold, fade out.
    if (this.cardAge < 0 && ctx.alive) {
      const bio = wantsCard(ctx.self, load<number | null>(CARD_KEY, null))
      if (bio) this.showCard(bio)
    }
    if (this.cardAge >= 0) {
      this.cardAge += dt
      const a = Math.min(1, this.cardAge / 0.5, (CARD_SECONDS - this.cardAge) / 0.6)
      this.card.style.opacity = String(Math.max(0, a))
      this.cardDeath.style.opacity = String(Math.max(0, Math.min(1, (this.cardAge - 1.4) / 0.6)))
      if (this.cardAge >= CARD_SECONDS) {
        this.cardAge = -1
        this.card.hidden = true
      }
    }

    // Hints: one at a time, not over the card.
    this.sinceHint += dt
    if (this.hintAge >= 0) {
      this.hintAge += dt
      this.hint.style.opacity = String(Math.max(0, Math.min(1, HINT_SECONDS - this.hintAge)))
      if (this.hintAge >= HINT_SECONDS) {
        this.hintAge = -1
        this.hint.hidden = true
      }
    }
    if (this.hintsOn && this.cardAge < 0 && this.hintAge < 0 && this.sinceHint > HINT_GAP) {
      if (this.pendingFull) {
        this.pendingFull = false
        this.show('full')
      } else {
        const key = hintFor(ctx, this.seen)
        if (key) this.show(key)
      }
    }

    // The horn at Haven as dusk comes (heard from wherever you are, from Haven's way).
    const phase = dayPhase(ctx.time)
    if (this.phase !== null && phase !== this.phase && phase === 'dusk') this.horn(listener)
    this.phase = phase
  }

  /** Haven's horn: louder near, duller and later far away, and from Haven's direction. */
  horn(listener: { x: number; y: number; z: number }): void {
    const haven = this.def.pois.find((p) => p.key === 'haven')
    if (!haven) return
    const d = Math.hypot(haven.x - listener.x, haven.z - listener.z)
    // Direction only: put it on a ring 40 m out that way, so the panner points right.
    const k = d > 40 ? 40 / d : 1
    const at = {
      x: listener.x + (haven.x - listener.x) * k,
      y: haven.y + 8,
      z: listener.z + (haven.z - listener.z) * k,
    }
    this.audio.play('horn', {
      at,
      volume: hornVolume(d),
      lowpass: Math.max(700, 9000 * Math.exp(-d / 900)),
      delay: Math.min(4, d / 343),
      rate: 1,
    })
  }
}
