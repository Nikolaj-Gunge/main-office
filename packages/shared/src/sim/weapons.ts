/** Weapon ids on the wire and in state. */
export const WeaponId = {
  Handgun: 0,
  Rifle: 1,
  Sniper: 2,
  Shotgun: 3,
  /** Everyone always carries one (slot 3). */
  Knife: 4,
} as const
export type WeaponId = (typeof WeaponId)[keyof typeof WeaponId]

/** Weapons you can pick as your primary (the handgun is always the secondary). */
export const PRIMARY_WEAPONS = [WeaponId.Rifle, WeaponId.Sniper, WeaponId.Shotgun] as const
export type PrimaryWeapon = (typeof PRIMARY_WEAPONS)[number]

export function isPrimary(id: number): id is PrimaryWeapon {
  return (PRIMARY_WEAPONS as readonly number[]).includes(id)
}

export interface WeaponDef {
  id: WeaponId
  name: string
  /**
   * semi: one shot per click · auto: hold to fire · bolt: one shot, then cycle the bolt ·
   * pump: one shot, then rack the pump · melee: a swing (no ammo, short reach).
   */
  fireMode: 'semi' | 'auto' | 'bolt' | 'pump' | 'melee'
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
  /**
   * Pellets per shot (shotgun). Each pellet is its own ray inside the spread cone and does
   * `damage` (with falloff) on its own. Default 1.
   */
  pellets?: number
  /**
   * Damage multiplier for a pellet that hits the head. Only for multi-pellet weapons: one stray
   * pellet shouldn't be an instant kill like a headshot with any other gun.
   */
  pelletHeadMultiplier?: number
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
    kickPitch: 2.3,
    kickYaw: 0.6,
    recoverTime: 0.24,
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
    // Red-dot sight: a light zoom, so you still see around your target.
    aimZoom: 1.15,
    scoped: false,
    scopeSway: 0,
    moveSpeedFactor: 1,
    kickPitch: 0.55,
    kickYaw: 0.25,
    recoverTime: 0.25,
    // Climbs for ~10 shots (drifting right, then left), then sways side to side (~8.5° total climb).
    recoilPattern: [
      [0.688, 0],
      [0.812, 0.062],
      [0.938, 0.125],
      [1, 0.15],
      [1, 0.075],
      [0.938, -0.075],
      [0.875, -0.188],
      [0.75, -0.275],
      [0.625, -0.325],
      [0.5, -0.35],
      [0.312, -0.375],
      [0.275, -0.312],
      [0.25, 0.062],
      [0.25, 0.375],
      [0.225, 0.5],
      [0.2, 0.5],
      [0.188, 0.312],
      [0.188, -0.125],
      [0.188, -0.438],
      [0.188, -0.5],
      [0.188, -0.375],
      [0.188, 0.062],
      [0.188, 0.375],
      [0.188, 0.5],
      [0.188, 0.375],
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
    adsTime: 0.275,
    aimZoom: 4,
    scoped: true,
    scopeSway: 0.45,
    moveSpeedFactor: 0.9,
    kickPitch: 4,
    kickYaw: 0.8,
    recoverTime: 0.5,
  },
  [WeaponId.Shotgun]: {
    id: WeaponId.Shotgun,
    name: 'Shotgun',
    fireMode: 'pump',
    fireInterval: 0.8,
    magSize: 6,
    reserve: 24,
    reloadTime: 2.6,
    emptyReloadTime: 3.1,
    drawTime: 0.6,
    // Per pellet: 8 × 14 = 112 if every pellet lands in the chest up close — one shot at
    // point blank, a few at mid range, useless far away.
    damage: 14,
    falloffStart: 6,
    falloffEnd: 20,
    minDamage: 3,
    range: 80,
    // The pellet cone (degrees): aiming tightens it a little, it never becomes a rifle.
    hipSpread: 4.5,
    aimSpread: 3.2,
    moveSpread: 0.8,
    airSpread: 1.5,
    sprintToFire: 0.25,
    adsTime: 0.2,
    aimZoom: 1.1,
    scoped: false,
    scopeSway: 0,
    moveSpeedFactor: 0.95,
    kickPitch: 5,
    kickYaw: 1.2,
    recoverTime: 0.35,
    pellets: 8,
    pelletHeadMultiplier: 2.5,
  },
  [WeaponId.Knife]: {
    id: WeaponId.Knife,
    name: 'Knife',
    fireMode: 'melee',
    fireInterval: 0.5,
    magSize: 0,
    reserve: 0,
    reloadTime: 0,
    emptyReloadTime: 0,
    drawTime: 0.3,
    // Two slashes from the front; from behind (a backstab) it's one.
    damage: 55,
    falloffStart: 100,
    falloffEnd: 101,
    minDamage: 55,
    range: 2.1,
    hipSpread: 0,
    aimSpread: 0,
    moveSpread: 0,
    airSpread: 0,
    sprintToFire: 0,
    adsTime: 0,
    aimZoom: 1,
    scoped: false,
    scopeSway: 0,
    // Knife out = you run a little faster.
    moveSpeedFactor: 1.1,
    kickPitch: 0.6,
    kickYaw: 0.4,
    recoverTime: 0.2,
  },
}

/** Is this a melee weapon (no ammo, short reach, swings)? */
export function isMelee(id: WeaponId): boolean {
  return WEAPONS[id].fireMode === 'melee'
}

/** Damage before hit-zone multipliers, after distance falloff. */
export function damageAtDistance(def: WeaponDef, distance: number): number {
  if (distance <= def.falloffStart) return def.damage
  if (distance >= def.falloffEnd) return def.minDamage
  const t = (distance - def.falloffStart) / (def.falloffEnd - def.falloffStart)
  return def.damage + (def.minDamage - def.damage) * t
}
