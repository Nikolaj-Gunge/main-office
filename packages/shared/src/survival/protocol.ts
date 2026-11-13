import type { WeaponSlot } from '../sim/weapons.ts'
import { ITEMS, POCKETS_KG } from './items.ts'

/** Some of one item in a backpack. Weapons never stack (n = 1) and remember what's loaded. */
export interface Stack {
  item: string
  n: number
  ammo?: number
}

/** What a survivor has and how they're doing (sent to them alone, when it changes). */
export interface SurvivalSelf {
  /** The backpack: everything carried that isn't in your hands. */
  inv: Stack[]
  /** The backpack worn (an item id), or null: pockets only. */
  pack: string | null
  money: number
  /** 0 (starving / parched) – 100. */
  hunger: number
  thirst: number
  bleeding: boolean
  /** Torch battery, 0–100. */
  battery: number
  light: boolean
  /** The bed you wake up in after dying (an interactable key), or null: the start. */
  bed: string | null
}

export interface QuestState {
  id: string
  /** Index of the step the team is on. */
  step: number
  /** Kill and hold steps: how far along (kills, or seconds). */
  count: number
}

/** The state of the world everybody shares (part of MatchInfo, once a second). */
export interface SurvivalShared {
  /**
   * The night's clock, 0–1 and round again: it is darkest around 0.3, and from 0.8 to 1 comes
   * the grey hour, when you can see a little further and fewer of the dead are about.
   */
  time: number
  /** Bit i set = gate i is open (story doors). */
  gates: number
  quests: QuestState[]
  /** Ids of finished quests. */
  done: string[]
  /** Indices of the places somebody has been to (shown on the map). */
  found: number[]
  /** The story is over: everyone got out. */
  won: boolean
}

export type SurvivalAction =
  /** Eat, drink, bandage, put on a backpack, load batteries. */
  | { a: 'use'; item: string }
  | { a: 'drop'; item: string; n: number }
  /** Take the weapon at this backpack index in hand (what was in that slot goes in the pack). */
  | { a: 'equip'; index: number }
  /** Put the weapon in this slot into the backpack. */
  | { a: 'stow'; slot: WeaponSlot }
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
  /** `story` is shown big in the middle; the others as a line at the side. */
  kind: 'info' | 'loot' | 'warn' | 'quest' | 'story' | 'scream'
  text: string
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

// --- Inventory arithmetic (shared so the client can show what will fit) -----------------------

export function capacityOf(self: Pick<SurvivalSelf, 'pack'>): number {
  return (self.pack ? ITEMS[self.pack]?.capacity : undefined) ?? POCKETS_KG
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

/** How many of `item` still fit in the backpack (weightless things always do). */
export function roomFor(self: Pick<SurvivalSelf, 'pack' | 'inv'>, item: string): number {
  const weight = ITEMS[item]?.weight ?? 0
  if (weight <= 0) return Number.POSITIVE_INFINITY
  return Math.max(0, Math.floor((capacityOf(self) - weightOf(self.inv) + 1e-6) / weight))
}

/** Adds to the backpack (no capacity check: see roomFor). Weapons get their own stack each. */
export function addStack(stacks: Stack[], item: string, n: number, ammo?: number): void {
  if (n <= 0) return
  if (ITEMS[item]?.kind === 'weapon') {
    for (let i = 0; i < n; i++) stacks.push({ item, n: 1, ammo: ammo ?? 0 })
    return
  }
  const existing = stacks.find((s) => s.item === item)
  if (existing) existing.n += n
  else stacks.push({ item, n })
}

/** Takes up to `n` out of the backpack; returns how many it got. */
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
