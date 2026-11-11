import { Button, hasButton } from './input.ts'
import { WEAPONS, type WeaponId } from './weapons.ts'

/** Predicted weapon state. Part of PlayerState so client and server replay it identically. */
export interface WeaponState {
  id: WeaponId
  ammo: number
  reserve: number
  /** Seconds until the next shot is allowed (also the sniper's bolt cycle). */
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
  /** Seconds spent aiming, capped at the weapon's adsTime (0 = hip fire). */
  aimTime: number
  /** Clock for scope sway while aiming (seconds). */
  swayTime: number
  /** Seconds of held breath left (scoped weapons). */
  breath: number
  /** Currently holding breath (sway damped). */
  steady: boolean
}

export interface WeaponContext {
  sprinting: boolean
  grounded: boolean
  crouched: boolean
  /** Horizontal speed relative to walk speed (1 = walking). */
  speedFactor: number
  /** Server rules (admin page); defaults to normal play. */
  rules?: WeaponRules
}

/** The weapon side of the game rules that the shared simulation needs (client and server). */
export interface WeaponRules {
  /** Multiplies every spread cone: 0 = perfectly accurate. */
  spreadScale: number
  /** Reloading never uses up spare ammo. */
  infiniteAmmo: boolean
}

export const DEFAULT_WEAPON_RULES: WeaponRules = { spreadScale: 1, infiniteAmmo: false }

export interface WeaponEvents {
  /** Set when a shot was fired this tick: the offsets to apply to the view direction. */
  shot: {
    yawOffset: number
    pitchOffset: number
    shotIndex: number
    /** Pellet cone radius (radians) for multi-pellet weapons, else 0. */
    pelletSpread: number
  } | null
  reloadStarted: boolean
  reloaded: boolean
  dryFire: boolean
}

const FIRE_BUFFER = 0.1
const EPS = 1e-6
/** Hold breath up to this long, then it gives out until you breathe again. */
export const MAX_BREATH = 3
const BREATH_REGEN = 0.6
const STEADY_SWAY = 0.15
/** Seconds after the scope is fully in before sway reaches full size (quick-scopes stay on target). */
const SWAY_RAMP = 0.6

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
    aimTime: 0,
    swayTime: 0,
    breath: MAX_BREATH,
    steady: false,
  }
}

/** 0 = hip, 1 = fully aimed (accuracy and zoom blend between them). */
export function aimProgress(w: WeaponState): number {
  const ads = WEAPONS[w.id].adsTime
  return ads > 0 ? Math.min(1, w.aimTime / ads) : 0
}

/**
 * Current spread cone radius (degrees) for the given situation. Accuracy improves only a little
 * while the sights come up, then snaps to full aimed accuracy the moment you're fully aimed —
 * so a fast, complete scope-in ("quick-scope") is rewarded and a half scope is not.
 */
export function currentSpread(w: WeaponState, ctx: WeaponContext): number {
  const def = WEAPONS[w.id]
  const t = aimProgress(w)
  const blend = t >= 1 ? 1 : t * t * 0.6
  let spread = def.hipSpread + (def.aimSpread - def.hipSpread) * blend
  spread += def.moveSpread * Math.min(ctx.speedFactor, 1.5)
  if (!ctx.grounded) spread += def.airSpread
  if (ctx.crouched) spread *= 0.8
  return spread * (ctx.rules?.spreadScale ?? 1)
}

/**
 * Scope drift (radians) — a slow figure-of-eight that grows as you aim and shrinks while holding
 * breath. It moves where the bullet goes, and the client draws the camera with the same offset,
 * so what you see in the scope is exactly where you'll hit.
 */
export function weaponSway(w: WeaponState): { yaw: number; pitch: number } {
  const def = WEAPONS[w.id]
  if (def.scopeSway === 0) return { yaw: 0, pitch: 0 }
  // Sway grows in over SWAY_RAMP seconds after the scope is fully in.
  const ramp = Math.max(0, Math.min(1, (w.swayTime - def.adsTime) / SWAY_RAMP))
  const a = ((def.scopeSway * Math.PI) / 180) * ramp * (w.steady ? STEADY_SWAY : 1)
  const t = w.swayTime
  return {
    yaw: a * (Math.sin(t * 0.9) * 0.7 + Math.sin(t * 2.1 + 1) * 0.3),
    pitch: a * 0.8 * (Math.sin(t * 1.3 + 0.5) * 0.6 + Math.sin(t * 0.7) * 0.4),
  }
}

/** 32-bit integer hash → [0, 1). Same on every JS engine. */
/**
 * Ray directions for every pellet of a shot: the first straight down `dir`, the rest spread
 * evenly over the cone (`spread` radians), seeded so client and server get the same pattern.
 */
export function pelletDirections(
  dir: { x: number; y: number; z: number },
  spread: number,
  count: number,
  seed: number,
  shotIndex: number,
): { x: number; y: number; z: number }[] {
  if (count <= 1 || spread <= 0) return [{ x: dir.x, y: dir.y, z: dir.z }]
  // Basis around dir: `right` is horizontal, `up` completes it.
  let rx = -dir.z
  let rz = dir.x
  const rl = Math.hypot(rx, rz) || 1
  rx /= rl
  rz /= rl
  const ux = -rz * dir.y
  const uy = rz * dir.x - rx * dir.z
  const uz = rx * dir.y
  const out = [{ x: dir.x, y: dir.y, z: dir.z }]
  for (let i = 1; i < count; i++) {
    const n = 1000 + shotIndex * 64 + i * 2
    // Stratified rings so pellets cover the cone instead of clumping.
    const r = Math.tan(spread * Math.sqrt((i - 1 + hash01(seed, n)) / (count - 1)))
    const theta = Math.PI * 2 * ((i - 1) / (count - 1) + hash01(seed, n + 1) * 0.35)
    const a = r * Math.cos(theta)
    const b = r * Math.sin(theta)
    const x = dir.x + rx * a + ux * b
    const y = dir.y + uy * b
    const z = dir.z + rz * a + uz * b
    const len = Math.hypot(x, y, z)
    out.push({ x: x / len, y: y / len, z: z / len })
  }
  return out
}

function hash01(seed: number, n: number): number {
  let h = (seed ^ Math.imul(n + 1, 0x9e3779b9)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** Advances the active weapon one tick. Mutates `w`. */
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

  // Aiming: accuracy (and zoom) build up over adsTime; you can't aim while drawing or reloading.
  const aiming = hasButton(buttons, Button.Aim) && w.draw <= EPS && w.reload === 0
  // Snap the last float-rounding sliver so "fully aimed" lands exactly on the expected tick.
  w.aimTime = aiming ? Math.min(def.adsTime, w.aimTime + dt + EPS) : 0
  w.swayTime = aiming ? w.swayTime + dt : 0
  const holdBreath = aiming && def.scopeSway > 0 && hasButton(buttons, Button.Sprint)
  w.steady = holdBreath && w.breath > 0
  w.breath = w.steady
    ? Math.max(0, w.breath - dt)
    : holdBreath
      ? 0 // out of breath: must let go of Shift before it recovers
      : Math.min(MAX_BREATH, w.breath + dt * BREATH_REGEN)

  if (w.reload > 0) {
    w.reload -= dt
    if (w.reload <= EPS) {
      const take = Math.min(def.magSize - w.ammo, w.reserve)
      w.ammo += take
      if (!ctx.rules?.infiniteAmmo) w.reserve -= take
      w.reload = 0
      events.reloaded = true
    }
  }

  const wantFire = def.fireMode === 'auto' ? hasButton(buttons, Button.Fire) : w.fireBuffer > 0
  const canReload = w.reload === 0 && w.ammo < def.magSize && w.reserve > 0 && w.draw <= EPS
  if (canReload && (hasButton(pressed, Button.Reload) || (wantFire && w.ammo === 0))) {
    w.reload = w.ammo === 0 ? def.emptyReloadTime : def.reloadTime
    w.fireBuffer = 0
    w.aimTime = 0
    events.reloadStarted = true
    return events
  }

  if (wantFire && w.ammo === 0 && hasButton(pressed, Button.Fire)) events.dryFire = true

  const ready = w.cooldown <= EPS && w.reload === 0 && w.draw <= EPS && w.sprintRecover <= EPS
  if (wantFire && ready && w.ammo > 0) {
    const spreadRad = (currentSpread(w, ctx) * Math.PI) / 180
    const multi = (def.pellets ?? 1) > 1
    // Uniform point in a disc: sqrt keeps it from bunching in the middle. A shotgun aims its
    // cone where you point; the spread decides how wide the pellets fan out (pelletDirections).
    const r = multi ? 0 : spreadRad * Math.sqrt(hash01(w.spreadSeed, w.shotIndex * 2))
    const theta = Math.PI * 2 * hash01(w.spreadSeed, w.shotIndex * 2 + 1)
    const sway = weaponSway(w)
    events.shot = {
      yawOffset: r * Math.cos(theta) + sway.yaw,
      pitchOffset: r * Math.sin(theta) + sway.pitch,
      shotIndex: w.shotIndex,
      pelletSpread: multi ? spreadRad : 0,
    }
    w.ammo--
    w.shotIndex++
    w.cooldown = def.fireInterval
    w.fireBuffer = 0
  }
  return events
}

/**
 * Puts the active weapon away and draws the holstered one. Interrupts reloads (the mag you were
 * loading stays out) and aiming; the drawn weapon must finish its draw time before firing.
 */
export function switchWeapons(
  active: WeaponState,
  holstered: WeaponState,
): [WeaponState, WeaponState] {
  active.reload = 0
  active.aimTime = 0
  active.swayTime = 0
  active.fireBuffer = 0
  holstered.draw = WEAPONS[holstered.id].drawTime
  holstered.fireBuffer = 0
  return [holstered, active]
}
