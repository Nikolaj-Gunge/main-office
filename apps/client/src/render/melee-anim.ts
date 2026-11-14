import { WeaponId } from '@office-fps/shared'

/**
 * First-person melee swings, one per kind of weapon, as offsets added to where the weapon is
 * held (view space: metres and radians about the hand). The server lands the blow the moment
 * you click, so every swing strikes at once; the anticipation is in the ready pose instead (a
 * bat cocked over the shoulder, a sledge already up), and the weight shows in how long the
 * follow-through and recovery take.
 */

export interface MeleeOffset {
  x: number
  y: number
  z: number
  /** Pitch (tip up +), yaw (tip left +), roll (tip left +). */
  rx: number
  ry: number
  rz: number
}

export type SwingKind = 'stab' | 'swing' | 'hook' | 'hack' | 'chop' | 'slam' | 'slash'

/** Which swing each melee weapon makes. */
export const SWING_OF: Partial<Record<WeaponId, SwingKind>> = {
  [WeaponId.Knife]: 'stab',
  [WeaponId.Bat]: 'swing',
  [WeaponId.Crowbar]: 'hook',
  [WeaponId.Machete]: 'hack',
  [WeaponId.Axe]: 'chop',
  [WeaponId.Sledge]: 'slam',
  [WeaponId.Katana]: 'slash',
  [WeaponId.Fists]: 'stab',
}

const o = (x: number, y: number, z: number, rx: number, ry: number, rz: number): MeleeOffset => ({
  x,
  y,
  z,
  rx,
  ry,
  rz,
})

/** Keys: [time 0–1 through the swing, pose]. The first and last are the ready pose. */
type Keys = [number, MeleeOffset][]

export const READY: Record<SwingKind, MeleeOffset> = {
  // Knife low and forward, point up.
  stab: o(0, -0.01, 0, 0.05, 0, 0),
  // Bat held up beside the right shoulder.
  swing: o(0.06, -0.01, 0, 0.1, -0.18, -0.3),
  // Crowbar raised, hooked end back.
  hook: o(0.04, 0, 0, 0.25, -0.15, -0.3),
  // Machete up by the right ear.
  hack: o(0.04, 0, 0, 0.25, -0.2, -0.35),
  // Axe up on the shoulder.
  chop: o(0.04, -0.01, 0.02, 0.2, -0.1, -0.2),
  // Sledge shouldered, the head up where you can see it.
  slam: o(0.03, -0.02, 0.02, 0.15, -0.1, -0.15),
  // Katana up, blade leaning across.
  slash: o(0.04, 0, 0, 0.1, -0.2, -0.45),
}

// Tuned by eye against renders of the first-person view (hand at the bottom right of a 55°
// view): every pose keeps the weapon's business end on screen.
export const KEYS: Record<SwingKind, Keys> = {
  // A fast thrust straight forward and back.
  stab: [
    [0, READY.stab],
    [0.12, o(-0.03, 0.04, -0.24, -0.1, 0.06, 0)],
    [0.3, o(-0.02, 0.02, -0.14, -0.06, 0.03, 0)],
    [1, READY.stab],
  ],
  // A big swing right to left, flat across the view at contact, following through high.
  swing: [
    [0, READY.swing],
    [0.14, o(-0.05, 0.03, -0.05, -0.85, 0.6, 0)],
    [0.3, o(-0.25, 0.01, -0.02, -0.8, 1.3, 0.1)],
    [0.55, o(-0.12, -0.15, 0.03, -0.3, 0.7, 0.05)],
    [1, READY.swing],
  ],
  // An overhead hook down and to the left.
  hook: [
    [0, READY.hook],
    [0.14, o(-0.12, -0.08, -0.08, -0.75, 0.45, 0.25)],
    [0.32, o(-0.15, -0.12, -0.03, -0.55, 0.5, 0.3)],
    [1, READY.hook],
  ],
  // A diagonal hack from top right to bottom left.
  hack: [
    [0, READY.hack],
    [0.12, o(-0.2, -0.1, -0.08, -0.75, 0.6, 0.5)],
    [0.28, o(-0.24, -0.14, -0.03, -0.6, 0.7, 0.55)],
    [1, READY.hack],
  ],
  // Heaved up overhead, chopped straight down, a moment stuck in the wood, hauled back.
  chop: [
    [0, READY.chop],
    [0.06, o(0.02, 0.05, 0.04, 0.55, -0.05, -0.1)],
    [0.18, o(-0.04, -0.08, -0.08, -0.85, 0.1, 0)],
    [0.36, o(-0.04, -0.1, -0.06, -0.85, 0.1, 0)],
    [1, READY.chop],
  ],
  // Slower and bigger: up over the head, slammed down the middle, buried, a long haul back.
  slam: [
    [0, READY.slam],
    [0.08, o(0, 0.06, 0.04, 0.45, -0.05, -0.05)],
    [0.22, o(-0.08, -0.06, -0.08, -0.75, 0.15, 0.05)],
    [0.45, o(-0.08, -0.09, -0.06, -0.8, 0.15, 0.08)],
    [1, READY.slam],
  ],
  // A quick diagonal cut, right to left.
  slash: [
    [0, READY.slash],
    [0.1, o(-0.12, -0.03, -0.06, -0.4, 0.55, 0.45)],
    [0.22, o(-0.17, -0.05, -0.03, -0.32, 0.65, 0.5)],
    [1, READY.slash],
  ],
}

const ease = (t: number) => {
  const c = Math.min(1, Math.max(0, t))
  return c * c * (3 - 2 * c)
}

/** The strike itself snaps (fast out); the rest eases. */
const snap = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/**
 * Where the weapon is at `t` (0 = just clicked … 1 = ready again) of a swing. `mirror` flips it
 * left-right (every other cut of a knife, machete or katana comes back the other way).
 */
export function meleePose(kind: SwingKind, t: number, mirror = false): MeleeOffset {
  const keys = KEYS[kind]
  let out = READY[kind]
  for (let i = 1; i < keys.length; i++) {
    const [t1, b] = keys[i] as [number, MeleeOffset]
    const [t0, a] = keys[i - 1] as [number, MeleeOffset]
    if (t > t1 && i < keys.length - 1) continue
    const k = t1 > t0 ? (t - t0) / (t1 - t0) : 1
    const e = i === 1 ? snap(k) : ease(k)
    out = {
      x: lerp(a.x, b.x, e),
      y: lerp(a.y, b.y, e),
      z: lerp(a.z, b.z, e),
      rx: lerp(a.rx, b.rx, e),
      ry: lerp(a.ry, b.ry, e),
      rz: lerp(a.rz, b.rz, e),
    }
    break
  }
  if (!mirror) return out
  // Mirrored, easing back to the usual ready pose over the recovery so the next swing starts
  // from the same place.
  const last = (keys.at(-2) as [number, MeleeOffset])[0]
  const w = t <= last ? 1 : 1 - ease((t - last) / (1 - last))
  return {
    ...out,
    x: lerp(out.x, -out.x, w),
    ry: lerp(out.ry, -out.ry, w),
    rz: lerp(out.rz, -out.rz, w),
  }
}

/** Swings that come back the other way every other time. */
export const ALTERNATES: ReadonlySet<SwingKind> = new Set(['stab', 'hack', 'slash'])

/** The ready pose (between swings). */
export function meleeReady(kind: SwingKind): MeleeOffset {
  return READY[kind]
}
