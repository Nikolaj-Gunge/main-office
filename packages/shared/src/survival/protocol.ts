import type { CampShared } from './camp.ts'
import type { Bio } from './characters.ts'
import type { Chart } from './chart.ts'
import type { Busy } from './crafting.ts'
import type { SupplyDrop } from './drops.ts'
import type { EvacShared } from './evac.ts'
import type { CosmeticKind, FieldNotes } from './field-notes.ts'
import { BAREFOOT_NOISE, GEAR, type WearSlot } from './gear.ts'
import type { ContainerId, ItemDest, ItemRef } from './grid.ts'
import { ITEMS } from './items.ts'
import type { Legacy, LifeStats, ObitWall, TraitId } from './legacy.ts'
import type { Needs } from './needs.ts'
import type { RotMood } from './rot.ts'
import type { Skills } from './skills.ts'
import type { OpenBox } from './storage.ts'
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
  /** Who this character was before (characters.ts); absent on very old saves. */
  bio?: Bio
  /** Seconds this character has been alive (the newcomer's shield, newcomer.ts, reads it). */
  age?: number
  /** Rested, wet, cold, a sprain, a bad stomach (see needs.ts); absent in old saves. */
  needs?: Needs
  /** Eating, bandaging or making something right now (see crafting.ts). */
  busy?: Busy | null
  /** The container you have open (a car's trunk, your locker), see storage.ts. */
  box?: OpenBox | null
  /** Field Notes, achievements and cosmetics (field-notes.ts): the account's, not the character's. */
  notes?: FieldNotes
  /** What this character has done with their life so far (legacy.ts); absent in old saves. */
  life?: LifeStats
  /** The trait a past life left them (legacy.ts), if they carry one. */
  trait?: TraitId | null
  /**
   * Sent, never saved: the account's past lives and earned traits (only when they change),
   * and Haven's obituary wall (only when it changes). Absent: as last sent.
   */
  legacy?: Legacy
  wall?: ObitWall
  /** Reputation (pvp.ts: Raider at or below RAIDER_AT, Saint from SAINT_AT); absent = 0. */
  rep?: number
  /** Oathbreaker: seconds of play the mark has left (pvp.ts); absent or 0 = none. */
  oath?: number
  /** What this character has learned by doing (skills.ts); absent in old saves. */
  skills?: Skills
  /**
   * The map this character has drawn (chart.ts): saved with them, but sent only when it
   * changes (absent: as last sent).
   */
  chart?: Chart
  /** Sent, never saved: the account's faded old map (chart.ts bitset), only when it changes. */
  oldChart?: string
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
  /** The Rot (rot.ts): tonight's mood (absent by day) and the flocks that have taken off. */
  rot?: { mood?: RotMood; birds: number[] }
  /** Somebody called in the evacuation helicopter (evac.ts), or none. */
  evac?: EvacShared
  /** Who wears an armband or the Oathbreaker mark (pvp.ts packStanding); absent = nobody. */
  standing?: number[]
  /**
   * A horde on the move in the fog (weather-world.ts): roughly where the radio says it is (a
   * rumour, not a fix) and the place it is heading for.
   */
  horde?: { x: number; z: number; to: string }
  /** Built pieces (building.ts): id, kind, x×10, z×10, turns, battering left, flags, … */
  builds?: number[]
  /** Haven: Red Night, morale, the gone and the graves (camp.ts). */
  camp?: CampShared
  /** Kicked junk lying away from where it belongs (junk.ts packJunk); absent = all home. */
  junk?: number[]
  /** Cans in Haven's barrel so far (junk.ts); absent = none yet. */
  hoop?: number
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
  /** Make something (see RECIPES); `stop` gives up whatever you're busy with. */
  | { a: 'craft'; recipe: string }
  | { a: 'stop' }
  /** The inventory opened: open the container in reach, if any. `close`: it closed. */
  | { a: 'open' }
  | { a: 'close' }
  /** Wear an earned cosmetic (field-notes.ts), or take it off (id null). */
  | { a: 'cosmetic'; kind: CosmeticKind; id: string | null }
  /** A new character picks which earned trait to carry (legacy.ts; null: none). */
  | { a: 'trait'; id: TraitId | null }
  /** Put up a piece from a kit you carry (building.ts) where you point, turned `rot` eighths. */
  | { a: 'build'; kit: string; x: number; z: number; rot: number }

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
  kind: 'info' | 'loot' | 'warn' | 'quest' | 'story' | 'scream' | 'note' | 'sound' | 'radio'
  text: string
  /**
   * `sound` (heard, not shown): birds taking off (flock index in `flock`), a car alarm, a named
   * alpha's roar as it charges or leaps (alphas.ts), or a groan answering somebody's first
   * gunshot (first-shot.ts).
   */
  sound?: 'birds' | 'alarm' | 'roar' | 'groan'
  /** `radio`: who is on the air (Radio Free Deadwood's DJ, radio.ts on the server). */
  from?: string
  flock?: number
  /** `sound` alarm: how long it goes on (s). */
  seconds?: number
  /** `note`: what it is ("Hollis' letter"), shown as its heading. */
  title?: string
  /** The Dawn Report (dawn-report.ts, title DAWN_TITLE): its paste-anywhere line. */
  share?: string
  /** `scream`: where it came from (it is heard, not shown). */
  at?: { x: number; y: number; z: number }
  /** A one-time hint the client shows as such (onboarding.ts HINTS), not a line in the feed. */
  hint?: 'gunfire'
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
