/** Weapon ids on the wire and in state. */
export const WeaponId = {
  Handgun: 0,
  Rifle: 1,
  Sniper: 2,
} as const
export type WeaponId = (typeof WeaponId)[keyof typeof WeaponId]

export interface WeaponDef {
  id: WeaponId
  name: string
  /** semi: one shot per click · auto: hold to fire · bolt: one shot, then cycle. */
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
}

/** Values mirror PLAN.md §5. Rifle and sniper are filled in during phase 6. */
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
  },
}

/** Damage before hit-zone multipliers, after distance falloff. */
export function damageAtDistance(def: WeaponDef, distance: number): number {
  if (distance <= def.falloffStart) return def.damage
  if (distance >= def.falloffEnd) return def.minDamage
  const t = (distance - def.falloffStart) / (def.falloffEnd - def.falloffStart)
  return def.damage + (def.minDamage - def.damage) * t
}
