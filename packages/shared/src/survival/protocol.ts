import type { SupplyDrop } from './drops.ts'
import { BAREFOOT_NOISE, GEAR, type WearSlot } from './gear.ts'
import type { ContainerId, ItemDest, ItemRef } from './grid.ts'
import { ITEMS } from './items.ts'
import type { WeatherShared } from './weather.ts'

/** Some of one item. Weapons never stack (n = 1) and remember what's loaded. */
export interface Stack {
  item: string
  n: number
  ammo?: number
}

/**
 * A stack in a pocket or the backpack (grid.ts): in container `c` with its top-left cell at
 * (x, y), turned on its side when r = 1.
 */
export interface Held extends Stack {
  c: ContainerId
  x: number
  y: number
  r?: 1
}

/** What a survivor has and how they're doing (sent to them alone, when it changes). */
export interface SurvivalSelf {
  /** Everything carried that isn't in your hands or on you, and where it lies (grid.ts). */
  inv: Held[]
  /** The backpack worn (an item id), or null: pockets only. */
  pack: string | null
  /** Clothes and gear worn, by slot (item ids, see gear.ts). */
  wear: Partial<Record<WearSlot, string>>
  money: number
  /** 0 (starving / parched) – 100. */
  hunger: number
  thirst: number
  bleeding: boolean
  /** Torch battery, 0–100. */
  battery: number
  light: boolean
  /** Bitten: seconds until you turn (see infection.ts), or null when you're clean. */
  infected: number | null
  /** Your story and jobs (yours alone: a new character starts a new one). */
  journal: Journal
}

export interface QuestState {
  id: string
  /** Index of the step you are on. */
  step: number
  /** Kill and hold steps: how far along (kills, or seconds); collect steps: bits of what's done. */
  count: number
  /** What you chose, on a quest that makes you choose (see QuestStep 'choose'). */
  pick?: string
}

/** One survivor's quests: what they're doing, what they've done, read and decided. */
export interface Journal {
  quests: QuestState[]
  /** Ids of finished quests, in the order they were finished. */
  done: string[]
  /** Notes, letters and clues read (interactable or LORE keys), in the order found. */
  notes: string[]
  /** What you chose ("quest:option") and what people do for you (e.g. 'gus_discount'). */
  flags: string[]
}

/** Somebody who walks with you (see WALKERS): where they are, and who they follow. */
export interface WalkerState {
  /** This one's key (a walker's key, or key@player for one being rescued). */
  key: string
  /** Which walker (WALKERS). */
  who: string
  x: number
  y: number
  z: number
  yaw: number
  /** Id of the player they follow, or 0 to stand where they are. */
  follow: number
  /** 0–100. */
  hp: number
}

/** The dead are at a place's gate (a 'defend' step): everyone near is in it. */
export interface SiegeState {
  /** The place under attack (Poi key). */
  poi: string
  /** Seconds left to hold. */
  left: number
  /** How much the place can take before they're through, 0–100. */
  hp: number
}

/** The state of the world everybody shares (part of MatchInfo, once a second). */
export interface SurvivalShared {
  /** The day's clock, 0–1 and round again (see daytime.ts: night, dawn, day, dusk). */
  time: number
  /** Bit i set = gate i is open (story doors). */
  gates: number
  /** Ids of quests somebody in this world has finished (what the world remembers). */
  done: string[]
  /** What the world has gained for good (see UNLOCKS): it outlives whoever earned it. */
  unlocks?: string[]
  /** A place under attack right now, or none. */
  siege?: SiegeState
  /** People walking with somebody, or waiting to be found. */
  walkers?: WalkerState[]
  /** Indices of the places somebody has been to (shown on the map). */
  found: number[]
  /** The story is over: everyone got out. */
  won: boolean
  /** Boarded-up gaps: spot index, battering left, … (see planksFor; only gaps with planks). */
  boards: number[]
  /** Supply drops on their way down or lying unopened (see drops.ts). */
  drops?: SupplyDrop[]
  /** The weather's seed and clock: everything else follows from them (see weather.ts). */
  weather?: WeatherShared
}

export type SurvivalAction =
  /**
   * The obvious thing: eat, drink, bandage, load batteries; put on clothes or a backpack, take a
   * weapon in hand; take off what's worn; pick up what's on the ground.
   */
  | { a: 'use'; from: ItemRef }
  /**
   * Drag and drop: from a cell, a slot or the ground to a cell, a slot, the ground or wherever it
   * fits. `n` moves only that many of a stack (splitting it); onto the same item, it tops it up.
   */
  | { a: 'move'; from: ItemRef; to: ItemDest; n?: number }
  | { a: 'buy'; item: string; n: number }
  | { a: 'sell'; item: string; n: number }
  | { a: 'light'; on: boolean }
  /** Answer in a conversation. */
  | { a: 'choose'; npc: string; option: string }

/** What somebody says to you, and what you can say back. */
export interface Dialog {
  npc: string
  name: string
  text: string
  options: { id: string; label: string }[]
  /** Open the trade screen with this: item and price. */
  shop?: [string, number][]
}

export interface Notice {
  /** `story` (and `note`, on paper) is shown big in the middle; the others as a line at the side. */
  kind: 'info' | 'loot' | 'warn' | 'quest' | 'story' | 'scream' | 'note'
  text: string
  /** `note`: what it is ("Hollis' letter"), shown as its heading. */
  title?: string
  /** `scream`: where it came from (it is heard, not shown). */
  at?: { x: number; y: number; z: number }
}

/** Something lying in the world to pick up. */
export interface LootItem {
  id: number
  item: string
  n: number
  x: number
  y: number
  z: number
}

// --- Inventory arithmetic (the grid itself: grid.ts) ------------------------------------------

/**
 * What everything worn adds up to (armour by where it covers, how hidden and how quiet).
 * Barefoot is a little louder than nothing at all.
 */
export function wornStats(self: Pick<SurvivalSelf, 'wear'>): {
  headArmour: number
  bodyArmour: number
  stealth: number
  quiet: number
} {
  const out = { headArmour: 0, bodyArmour: 0, stealth: 0, quiet: 0 }
  for (const id of Object.values(self.wear ?? {})) {
    const g = id ? GEAR[id] : undefined
    if (!g) continue
    if (g.slot === 'head') out.headArmour += g.armour ?? 0
    else out.bodyArmour += g.armour ?? 0
    out.stealth += g.stealth ?? 0
    out.quiet += g.quiet ?? 0
  }
  if (!self.wear?.feet) out.quiet -= BAREFOOT_NOISE
  return out
}

export function weightOf(stacks: readonly Stack[]): number {
  let kg = 0
  for (const s of stacks) kg += (ITEMS[s.item]?.weight ?? 0) * s.n
  return kg
}

export function countOf(stacks: readonly Stack[], item: string): number {
  let n = 0
  for (const s of stacks) if (s.item === item) n += s.n
  return n
}

/** Takes up to `n` out of the backpack and pockets; returns how many it got. */
export function takeStack(stacks: Stack[], item: string, n: number): number {
  let left = n
  for (let i = stacks.length - 1; i >= 0 && left > 0; i--) {
    const s = stacks[i] as Stack
    if (s.item !== item) continue
    const take = Math.min(s.n, left)
    s.n -= take
    left -= take
    if (s.n <= 0) stacks.splice(i, 1)
  }
  return n - left
}
