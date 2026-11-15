import { ZombieKind } from '../modes.ts'
import { DAY_SECONDS } from './daytime.ts'

/**
 * Named alphas (roadmap 6.7): one boss of the dead per part of the valley, at its own place. Each
 * is a bigger, worse version of an ordinary kind with a special move, a name you can read up
 * close, and something it leaves behind. Killing one is news on the radio, gives the world
 * something for good (UNLOCKS: Gus gets new stock) and keeps it away for a few days.
 */

export type AlphaMove = 'charge' | 'summon' | 'leap'

export interface AlphaDef {
  key: string
  name: string
  kind: ZombieKind
  /** The place it haunts (Poi key). */
  poi: string
  move: AlphaMove
  /** What drops when it goes down: the trophy first. */
  drop: [item: string, n: number][]
  /** What the world gains the first time it's killed (UNLOCKS key). */
  unlock: string
}

export const ALPHAS: readonly AlphaDef[] = [
  {
    key: 'sawmill',
    name: 'the Sawmill Brute',
    kind: ZombieKind.AlphaBrute,
    poi: 'sawmill',
    move: 'charge',
    drop: [
      ['trophy_chain', 1],
      ['sledge', 1],
      ['planks', 6],
    ],
    unlock: 'alpha_sawmill',
  },
  {
    key: 'choir',
    name: 'the Choir',
    kind: ZombieKind.AlphaChoir,
    poi: 'church',
    move: 'summon',
    drop: [
      ['trophy_hymnal', 1],
      ['antibiotics', 1],
      ['adrenaline', 1],
    ],
    unlock: 'alpha_choir',
  },
  {
    key: 'teeth',
    name: 'Old Teeth',
    kind: ZombieKind.AlphaRunner,
    poi: 'quarry',
    move: 'leap',
    drop: [
      ['trophy_jaw', 1],
      ['hunting', 1],
      ['ammo308', 10],
    ],
    unlock: 'alpha_teeth',
  },
]

/** An alpha turns up when somebody comes this close to its place (m), and goes when nobody is. */
export const ALPHA_NEAR = 140
export const ALPHA_GONE = 190
/** Killed, it's back after this many in-game days (real seconds: the days go by as you play). */
export const ALPHA_RESPAWN_DAYS = 3
export const ALPHA_RESPAWN_MS = ALPHA_RESPAWN_DAYS * DAY_SECONDS * 1000
/** Its name shows over its head this close (m). */
export const ALPHA_TAG_RANGE = 30

export const alphaByKey = (key: string) => ALPHAS.find((a) => a.key === key)
