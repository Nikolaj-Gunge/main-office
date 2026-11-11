/** Weapon ids on the wire and in state. */
export const WeaponId = {
  Handgun: 0,
  Rifle: 1,
  Sniper: 2,
} as const
export type WeaponId = (typeof WeaponId)[keyof typeof WeaponId]

/** Weapons you can pick as your primary (the handgun is always the secondary). */
export const PRIMARY_WEAPONS = [WeaponId.Rifle, WeaponId.Sniper] as const
export type PrimaryWeapon = (typeof PRIMARY_WEAPONS)[number]

export function isPrimary(id: number): id is PrimaryWeapon {
  return (PRIMARY_WEAPONS as readonly number[]).includes(id)
}

export interface WeaponDef {
  id: WeaponId
  name: string
  /** semi: one shot per click · auto: hold to fire · bolt: one shot, then cycle the bolt. */
  fireMode: 'semi' | 'auto' | 'bolt'
  /** Seconds between shots. */
  fireInterval: number
  magSize: number
  reserve: number
  /** Reload with rounds left / from empty (seconds). */
  reloadTime: number
  emptyReloadTime: number
  drawTime: number
  /** Chest damage at close range. */
  damage: number
  /** Damage drops linearly from `damage` at `falloffStart` to `minDamage` at `falloffEnd` (m). */
  falloffStart: number
  falloffEnd: number
  minDamage: number
  range: number
  /** Spread cone radius in degrees. */
  hipSpread: number
  aimSpread: number
  /** Added spread at full walk speed, and while airborne. */
  moveSpread: number
  airSpread: number
  /** Seconds after sprinting before you can shoot. */
  sprintToFire: number
  /** Seconds of aiming before you get the full aimed accuracy. */
  adsTime: number
  /** Field-of-view zoom while aiming down sights (1 = none). */
  aimZoom: number
  /** Scope: hides the gun and shows a scope overlay while aiming. */
  scoped: boolean
  /** Aimed scope drift (degrees). Hold breath (Shift) to steady it. */
  scopeSway: number
  /** Walk speed multiplier while holding this weapon (heavier = slower). */
  moveSpeedFactor: number
  /**
   * View kick per shot (degrees): up, and random left/right up to `kickYaw`. It moves your actual
   * aim and springs back over `recoverTime` seconds — the client applies it to the look angles.
   */
  kickPitch: number
  kickYaw: number
  recoverTime: number
  /**
   * Fixed spray pattern for automatic weapons: kick [up, right] in degrees for shot 1, 2, 3…
   * of a spray (the last entry repeats). Fixed, so it can be learned and pulled against.
   */
  recoilPattern?: readonly (readonly [number, number])[]
}

/** Values mirror PLAN.md §5. */
export const WEAPONS: Record<WeaponId, WeaponDef> = {
  [WeaponId.Handgun]: {
    id: WeaponId.Handgun,
    name: 'Handgun',
    fireMode: 'semi',
    fireInterval: 0.15,
    magSize: 12,
    reserve: 48,
    reloadTime: 1.5,
    emptyReloadTime: 1.9,
    drawTime: 0.35,
    damage: 26,
    falloffStart: 15,
    falloffEnd: 30,
    minDamage: 18,
    range: 200,
    hipSpread: 1.2,
    aimSpread: 0.4,
    moveSpread: 1.5,
    airSpread: 4,
    sprintToFire: 0.15,
    adsTime: 0.15,
    aimZoom: 1.15,
    scoped: false,
    scopeSway: 0,
    moveSpeedFactor: 1.08,
    kickPitch: 1.1,
    kickYaw: 0.35,
    recoverTime: 0.18,
  },
  [WeaponId.Rifle]: {
    id: WeaponId.Rifle,
    name: 'Rifle',
    fireMode: 'auto',
    fireInterval: 0.1,
    magSize: 30,
    reserve: 90,
    reloadTime: 2.2,
    emptyReloadTime: 2.8,
    drawTime: 0.6,
    damage: 30,
    falloffStart: 25,
    falloffEnd: 50,
    minDamage: 24,
    range: 300,
    hipSpread: 2,
    aimSpread: 0.25,
    moveSpread: 2.5,
    airSpread: 6,
    sprintToFire: 0.2,
    adsTime: 0.22,
    aimZoom: 1.25,
    scoped: false,
    scopeSway: 0,
    moveSpeedFactor: 1,
    kickPitch: 0.55,
    kickYaw: 0.25,
    recoverTime: 0.25,
    // Climbs for ~10 shots (drifting right, then left), then sways side to side.
    recoilPattern: [
      [0.55, 0],
      [0.65, 0.05],
      [0.75, 0.1],
      [0.8, 0.12],
      [0.8, 0.06],
      [0.75, -0.06],
      [0.7, -0.15],
      [0.6, -0.22],
      [0.5, -0.26],
      [0.4, -0.28],
      [0.25, -0.3],
      [0.22, -0.25],
      [0.2, 0.05],
      [0.2, 0.3],
      [0.18, 0.4],
      [0.16, 0.4],
      [0.15, 0.25],
      [0.15, -0.1],
      [0.15, -0.35],
      [0.15, -0.4],
      [0.15, -0.3],
      [0.15, 0.05],
      [0.15, 0.3],
      [0.15, 0.4],
      [0.15, 0.3],
    ],
  },
  [WeaponId.Sniper]: {
    id: WeaponId.Sniper,
    name: 'Sniper',
    fireMode: 'bolt',
    fireInterval: 1.4,
    magSize: 5,
    reserve: 20,
    reloadTime: 2.8,
    emptyReloadTime: 3.4,
    drawTime: 0.9,
    damage: 115,
    falloffStart: 1000,
    falloffEnd: 1001,
    minDamage: 115,
    range: 500,
    hipSpread: 8,
    aimSpread: 0,
    moveSpread: 6,
    airSpread: 10,
    sprintToFire: 0.3,
    adsTime: 0.35,
    aimZoom: 4,
    scoped: true,
    scopeSway: 0.45,
    moveSpeedFactor: 0.9,
    kickPitch: 3,
    kickYaw: 0.6,
    recoverTime: 0.45,
  },
}

/** Damage before hit-zone multipliers, after distance falloff. */
export function damageAtDistance(def: WeaponDef, distance: number): number {
  if (distance <= def.falloffStart) return def.damage
  if (distance >= def.falloffEnd) return def.minDamage
  const t = (distance - def.falloffStart) / (def.falloffEnd - def.falloffStart)
  return def.damage + (def.minDamage - def.damage) * t
}
