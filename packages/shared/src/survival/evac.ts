import type { Stack } from './protocol.ts'
import type { SurvivalDef } from './types.ts'

/**
 * Evacuation: retiring a character on purpose. Far from Haven, on the radio tower's hill, is a
 * helipad and a field radio. Bring the three rare things the radio needs (a charged military
 * battery, a flare gun, signed evacuation papers), call it in, and hold the pad while every one of
 * the dead in earshot comes for the noise. Then a helicopter comes down, you get on, and that
 * character's story is over: they live at Haven from then on, with their name, and the account's
 * next characters start with a little of what they left behind.
 *
 * The rules and timings live here so the server, the client and the tests agree.
 */

/** The helipad's middle on the radio tower's site, in the site's own coordinates (x, z). */
export const EVAC_PAD: [number, number] = [13.5, 7.5]
/** The field radio, in the pad's own coordinates. */
export const EVAC_RADIO: [number, number] = [-6.3, 4.2]
/** The title of the card you get on getting out (Notice.title; the client shows its own card). */
export const EVAC_TITLE = 'Evacuated'
/** The radio's Interactable key. */
export const EVAC_RADIO_KEY = 'evac_radio'

/**
 * Where the helipad is in the world (its middle, on the concrete), worked out from the radio
 * tower and the field radio so it follows however the site is turned. Null on maps without one.
 */
export function evacPad(def: SurvivalDef): { x: number; y: number; z: number } | null {
  const poi = def.pois.find((p) => p.kind === 'radio')
  const radio = def.interactables.find((i) => i.key === EVAC_RADIO_KEY)
  if (!poi || !radio) return null
  // The radio's offset from the site's origin, unturned, and as built: the angle between them.
  const lx = EVAC_PAD[0] + EVAC_RADIO[0]
  const lz = EVAC_PAD[1] + EVAC_RADIO[1]
  const turn = Math.atan2(radio.pos[2] - poi.z, radio.pos[0] - poi.x) - Math.atan2(lz, lx)
  const c = Math.cos(turn)
  const s = Math.sin(turn)
  return {
    x: poi.x + EVAC_PAD[0] * c - EVAC_PAD[1] * s,
    y: poi.y + 0.12,
    z: poi.z + EVAC_PAD[0] * s + EVAC_PAD[1] * c,
  }
}

/** What the radio needs. The battery and the flare are used calling it in; the papers boarding. */
export const EVAC_ITEMS = ['evacbattery', 'flaregun', 'evacpapers'] as const
/** Used up when the call goes out (the rest is handed to the pilot). */
export const EVAC_CALL_USES = ['evacbattery', 'flaregun'] as const

/** Seconds to hold the pad after calling it in. */
export const EVAC_HOLD = 150
/** Seconds the helicopter takes to come in and set down once the hold is over. */
export const EVAC_INBOUND = 22
/** Seconds it waits on the pad before the pilot gives up and leaves. */
export const EVAC_WAIT = 30
/** Seconds it takes to lift off and fly out of sight. */
export const EVAC_OUTBOUND = 20
/** From the call until the helicopter is gone. */
export const EVAC_TOTAL = EVAC_HOLD + EVAC_INBOUND + EVAC_WAIT + EVAC_OUTBOUND
/** The caller must stay this close to the pad while holding (m), or the pilot won't come. */
export const EVAC_LEASH = 70
/** Within this of the pad's middle once it has landed, you're aboard (m). */
export const EVAC_BOARD_RANGE = 7
/** How high the helicopter flies in (m above the pad), and from how far off it starts. */
export const EVAC_ALT = 90
export const EVAC_APPROACH = 900

export type EvacPhase = 'hold' | 'inbound' | 'landed' | 'outbound' | 'gone'

/** Where an evacuation is, `age` seconds after it was called in. */
export function evacPhase(age: number): EvacPhase {
  if (age < EVAC_HOLD) return 'hold'
  if (age < EVAC_HOLD + EVAC_INBOUND) return 'inbound'
  if (age < EVAC_HOLD + EVAC_INBOUND + EVAC_WAIT) return 'landed'
  if (age < EVAC_TOTAL) return 'outbound'
  return 'gone'
}

/** Which of the radio's things somebody hasn't got (count: how many of an item they carry). */
export function evacMissing(count: (item: string) => number): string[] {
  return EVAC_ITEMS.filter((item) => count(item) < 1)
}

/** An evacuation as everybody sees it (SurvivalShared.evac). */
export interface EvacShared {
  /** The name of whoever called it in. */
  by: string
  /** Seconds since the call. */
  age: number
  /** The pad's middle, on the ground. */
  x: number
  y: number
  z: number
  /** The way the helicopter comes in from (radians: its heading towards the pad, x/z plane). */
  heading: number
  /** Got on board (while the helicopter is outbound). */
  boarded?: boolean
}

const smooth = (k: number) => k * k * (3 - 2 * k)

/**
 * Where the evacuation helicopter is `age` seconds after the call: out of sight during the hold,
 * then in from `heading` and down onto the pad, sitting there with the rotors turning, and up
 * and away the way it came. Null while there is none.
 */
export function evacHeliPos(
  e: Pick<EvacShared, 'x' | 'y' | 'z' | 'heading'>,
  age: number,
): { x: number; y: number; z: number } | null {
  const phase = evacPhase(age)
  if (phase === 'hold' || phase === 'gone') return null
  // Distance back along the heading from the pad, and height above it.
  let back: number
  let up: number
  if (phase === 'inbound') {
    const k = (age - EVAC_HOLD) / EVAC_INBOUND
    // Most of the way fast and high, then slowing and settling.
    back = EVAC_APPROACH * (1 - smooth(Math.min(1, k * 1.15)))
    up = EVAC_ALT * (1 - smooth(Math.max(0, (k - 0.35) / 0.65)))
  } else if (phase === 'landed') {
    back = 0
    up = 0
  } else {
    const k = (age - EVAC_HOLD - EVAC_INBOUND - EVAC_WAIT) / EVAC_OUTBOUND
    up = EVAC_ALT * smooth(Math.min(1, k * 2.5))
    back = -EVAC_APPROACH * k * k
  }
  // Coming in along the heading means starting `back` metres before the pad.
  return {
    x: e.x - Math.cos(e.heading) * back,
    y: e.y + up,
    z: e.z - Math.sin(e.heading) * back,
  }
}

// --- The retired --------------------------------------------------------------------------------

/** One character who got out: lives at Haven from then on (WorldSave.retired). */
export interface Retired {
  name: string
  /** The day they left (survival days since the world began), for what they say. */
  day: number
}

/** Haven keeps this many of the retired standing about (the latest). */
export const RETIRED_SHOWN = 6

/**
 * Where the retired stand at Haven, in its own coordinates (x east, z south from the middle;
 * the camp is built unturned) with their facing (game yaw): round the open ground west and east
 * of the fire, clear of the huts.
 */
export const RETIRED_SPOTS: [x: number, z: number, yaw: number][] = [
  [-9.5, 7.5, -1.2],
  [7.5, 8.6, 1.4],
  [-11, 9.6, -0.9],
  [9.2, 10.4, 1.1],
  [-8.2, 10.6, -1.6],
  [6.4, 11.2, 1.7],
]

/** An account's record of its retired characters (the `evac` part of the account record). */
export interface EvacAccount {
  /** Names of the characters this account got out, oldest first. */
  retired: string[]
}

/** The bonus counts at most this many of an account's retired. */
export const LEGACY_CAP = 3
/** Dollars per retired character a new one starts with. */
export const LEGACY_MONEY = 40

/**
 * What a new character of an account starts with on top of the usual, for having got
 * `retired` characters out before: a bundle they left at Haven — the more, the better.
 */
export function legacyKit(retired: number): { money: number; items: Stack[] } {
  const n = Math.max(0, Math.min(LEGACY_CAP, Math.floor(retired)))
  if (n === 0) return { money: 0, items: [] }
  const items: Stack[] = [
    { item: 'bandage', n: 1 + n },
    { item: 'beans', n: 1 },
  ]
  if (n >= 2) items.push({ item: 'painkillers', n: 1 })
  if (n >= 3) items.push({ item: 'batteries', n: 1 })
  return { money: LEGACY_MONEY * n, items }
}
