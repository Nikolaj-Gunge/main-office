/** Button bitmask carried in every input command. */
export const Button = {
  Forward: 1 << 0,
  Back: 1 << 1,
  Left: 1 << 2,
  Right: 1 << 3,
  Jump: 1 << 4,
  Crouch: 1 << 5,
  Sprint: 1 << 6,
  Fire: 1 << 7,
  Aim: 1 << 8,
  Reload: 1 << 9,
  Use: 1 << 10,
  /** Switch to primary (1) / secondary (2) / the last weapon (Q, mouse wheel). */
  Slot1: 1 << 11,
  Slot2: 1 << 12,
  SwapWeapon: 1 << 13,
  /** Draw the knife (3). */
  Slot3: 1 << 14,
  /** Lie down / get back up (toggle). The last bit of the u16 on the wire. */
  Prone: 1 << 15,
} as const
export type Button = (typeof Button)[keyof typeof Button]

/** One simulation tick worth of player intent. */
export interface PlayerInput {
  buttons: number
  /** Radians. 0 looks down -Z, positive turns left. */
  yaw: number
  /** Radians. Positive looks up. */
  pitch: number
}

export function hasButton(buttons: number, button: Button): boolean {
  return (buttons & button) !== 0
}
