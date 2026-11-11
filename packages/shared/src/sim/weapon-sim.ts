import { Button, hasButton } from './input.ts'
import { WEAPONS, type WeaponId } from './weapons.ts'

/** Predicted weapon state. Part of PlayerState so client and server replay it identically. */
export interface WeaponState {
  id: WeaponId
  ammo: number
  reserve: number
  /** Seconds until the next shot is allowed. */
  cooldown: number
  /** Seconds left of the current reload (0 = not reloading). */
  reload: number
  /** Seconds left of drawing the weapon. */
  draw: number
  /** A click shortly before the gun is ready still fires (semi-auto feels unresponsive otherwise). */
  fireBuffer: number
  /** Seconds until firing is allowed after sprinting. */
  sprintRecover: number
  /** Shots fired with this weapon (drives the spread pattern). */
  shotIndex: number
  /** Server-chosen per life, so spread isn't predictable by others. */
  spreadSeed: number
}

export interface WeaponContext {
  sprinting: boolean
  grounded: boolean
  crouched: boolean
  /** Horizontal speed relative to walk speed (1 = walking). */
  speedFactor: number
}

export interface WeaponEvents {
  /** Set when a shot was fired this tick: the spread offsets to apply to the view direction. */
  shot: { yawOffset: number; pitchOffset: number; shotIndex: number } | null
  reloadStarted: boolean
  reloaded: boolean
  dryFire: boolean
}

const FIRE_BUFFER = 0.1
const EPS = 1e-6

export function createWeaponState(id: WeaponId, spreadSeed = 0): WeaponState {
  const def = WEAPONS[id]
  return {
    id,
    ammo: def.magSize,
    reserve: def.reserve,
    cooldown: 0,
    reload: 0,
    draw: def.drawTime,
    fireBuffer: 0,
    sprintRecover: 0,
    shotIndex: 0,
    spreadSeed,
  }
}

/** Current spread cone radius (degrees) for the given situation. */
export function currentSpread(w: WeaponState, aiming: boolean, ctx: WeaponContext): number {
  const def = WEAPONS[w.id]
  let spread = aiming ? def.aimSpread : def.hipSpread
  spread += def.moveSpread * Math.min(ctx.speedFactor, 1.5)
  if (!ctx.grounded) spread += def.airSpread
  if (ctx.crouched) spread *= 0.8
  return spread
}

/** 32-bit integer hash → [0, 1). Same on every JS engine. */
function hash01(seed: number, n: number): number {
  let h = (seed ^ Math.imul(n + 1, 0x9e3779b9)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** Advances the weapon one tick. Mutates `w`. */
export function stepWeapon(
  w: WeaponState,
  buttons: number,
  pressed: number,
  dt: number,
  ctx: WeaponContext,
): WeaponEvents {
  const def = WEAPONS[w.id]
  const events: WeaponEvents = { shot: null, reloadStarted: false, reloaded: false, dryFire: false }

  w.cooldown = Math.max(0, w.cooldown - dt)
  w.draw = Math.max(0, w.draw - dt)
  w.sprintRecover = ctx.sprinting ? def.sprintToFire : Math.max(0, w.sprintRecover - dt)
  w.fireBuffer = hasButton(pressed, Button.Fire) ? FIRE_BUFFER : Math.max(0, w.fireBuffer - dt)

  if (w.reload > 0) {
    w.reload -= dt
    if (w.reload <= EPS) {
      const take = Math.min(def.magSize - w.ammo, w.reserve)
      w.ammo += take
      w.reserve -= take
      w.reload = 0
      events.reloaded = true
    }
  }

  const wantFire = def.fireMode === 'auto' ? hasButton(buttons, Button.Fire) : w.fireBuffer > 0
  const canReload = w.reload === 0 && w.ammo < def.magSize && w.reserve > 0
  if (canReload && (hasButton(pressed, Button.Reload) || (wantFire && w.ammo === 0))) {
    w.reload = w.ammo === 0 ? def.emptyReloadTime : def.reloadTime
    w.fireBuffer = 0
    events.reloadStarted = true
    return events
  }

  if (wantFire && w.ammo === 0 && hasButton(pressed, Button.Fire)) events.dryFire = true

  const ready = w.cooldown <= EPS && w.reload === 0 && w.draw <= EPS && w.sprintRecover <= EPS
  if (wantFire && ready && w.ammo > 0) {
    const spreadRad = (currentSpread(w, hasButton(buttons, Button.Aim), ctx) * Math.PI) / 180
    // Uniform point in a disc: sqrt keeps it from bunching in the middle.
    const r = spreadRad * Math.sqrt(hash01(w.spreadSeed, w.shotIndex * 2))
    const theta = Math.PI * 2 * hash01(w.spreadSeed, w.shotIndex * 2 + 1)
    events.shot = {
      yawOffset: r * Math.cos(theta),
      pitchOffset: r * Math.sin(theta),
      shotIndex: w.shotIndex,
    }
    w.ammo--
    w.shotIndex++
    w.cooldown = def.fireInterval
    w.fireBuffer = 0
  }
  return events
}
