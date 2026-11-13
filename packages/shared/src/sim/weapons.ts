/** Weapon ids on the wire and in state. */
export const WeaponId = {
  Handgun: 0,
  Rifle: 1,
  Sniper: 2,
  Shotgun: 3,
  /** Everyone always carries one (slot 3). */
  Knife: 4,
  /** MP5 submachine gun: fast, light, short range. */
  Smg: 5,
  /** Zombies' bare hands (zombies mode): they have nothing else. */
  Claws: 6,
  /** Light machine gun: a 100-round belt, heavy. */
  Lmg: 7,
  // --- Survival mode only (found in the world, never handed out elsewhere) ---
  Bat: 8,
  Crowbar: 9,
  Machete: 10,
  Axe: 11,
  Sledge: 12,
  Katana: 13,
  M1911: 14,
  Revolver: 15,
  M9: 16,
  Ruger: 17,
  SawedOff: 18,
  Uzi: 19,
  Ump: 20,
  Mac10: 21,
  Ak47: 22,
  Sks: 23,
  HuntingRifle: 24,
  Carbine22: 25,
  LeverAction: 26,
  DoubleBarrel: 27,
  AutoShotgun: 28,
  Svd: 29,
  Barrett: 30,
  Crossbow: 31,
} as const
export type WeaponId = (typeof WeaponId)[keyof typeof WeaponId]

/** Weapons you can pick as your primary (the handgun is always the secondary). */
export const PRIMARY_WEAPONS = [
  WeaponId.Rifle,
  WeaponId.Sniper,
  WeaponId.Shotgun,
  WeaponId.Smg,
  WeaponId.Lmg,
] as const

/** How big a gun is (co-op hands out bigger ones as you get further): 0 handgun … 3 LMG. */
const TIERS: Partial<Record<WeaponId, number>> = {
  [WeaponId.Handgun]: 0,
  [WeaponId.Knife]: 0,
  [WeaponId.Claws]: 0,
  [WeaponId.Smg]: 1,
  [WeaponId.Shotgun]: 1,
  [WeaponId.Rifle]: 2,
  [WeaponId.Sniper]: 2,
  [WeaponId.Lmg]: 3,
}
/** See TIERS; weapons without an entry (survival's) count as 1. */
export const WEAPON_TIER: Record<WeaponId, number> = new Proxy(TIERS, {
  get: (tiers, id) => tiers[Number(id) as WeaponId] ?? 1,
}) as Record<WeaponId, number>
export type PrimaryWeapon = (typeof PRIMARY_WEAPONS)[number]

export function isPrimary(id: number): id is PrimaryWeapon {
  return (PRIMARY_WEAPONS as readonly number[]).includes(id)
}

/** What a gun is loaded with (survival mode: you find it by the handful). */
export const AMMO_TYPES = [
  '9mm',
  '.45',
  '.357',
  '.22',
  '5.56',
  '7.62',
  '.308',
  '.50',
  '12ga',
  'bolt',
] as const
export type AmmoType = (typeof AMMO_TYPES)[number]

/** Which of the three things you carry a weapon is: 1 main gun, 2 sidearm, 3 melee. */
export type WeaponSlot = 'primary' | 'sidearm' | 'melee'

export interface WeaponDef {
  id: WeaponId
  name: string
  slot: WeaponSlot
  /** What it fires (melee: nothing). */
  ammoType?: AmmoType
  /** How far away the dead hear it (m, survival mode). */
  noise: number
  /**
   * The weapon it looks, sounds and handles like on screen: one of the eight originals, which
   * have their own models and sounds (their `look` is themselves).
   */
  look: WeaponId
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

/** Ids of the eight original weapons (the ones with their own models and sounds). */
export type BaseWeaponId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7
type BaseId = BaseWeaponId

/** The eight originals. Values mirror PLAN.md §5. */
const BASE: Record<BaseId, WeaponDef> = {
  [WeaponId.Handgun]: {
    id: WeaponId.Handgun,
    slot: 'sidearm',
    ammoType: '9mm',
    noise: 55,
    look: WeaponId.Handgun,
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
    slot: 'primary',
    ammoType: '5.56',
    noise: 90,
    look: WeaponId.Rifle,
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
    slot: 'primary',
    ammoType: '.308',
    noise: 120,
    look: WeaponId.Sniper,
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
    slot: 'primary',
    ammoType: '12ga',
    noise: 100,
    look: WeaponId.Shotgun,
    name: 'Shotgun',
    fireMode: 'pump',
    fireInterval: 0.8,
    magSize: 6,
    reserve: 24,
    reloadTime: 2.6,
    emptyReloadTime: 3.1,
    drawTime: 0.6,
    // Per pellet: 8 × 20 = 160 up close, so a body shot is a one-shot kill out to ~5 m even
    // if a few pellets miss or land on a limb; from there it fades slowly: ~15 a pellet at
    // 15 m, 8 at 35 m and beyond (the spreading cone means fewer pellets land, too).
    damage: 20,
    falloffStart: 5,
    falloffEnd: 35,
    minDamage: 8,
    range: 90,
    // The pellet cone (degrees): aiming tightens it a little, it never becomes a rifle.
    hipSpread: 3.8,
    aimSpread: 2.8,
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
    slot: 'melee',
    noise: 3,
    look: WeaponId.Knife,
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
  [WeaponId.Smg]: {
    id: WeaponId.Smg,
    slot: 'primary',
    ammoType: '9mm',
    noise: 65,
    look: WeaponId.Smg,
    name: 'MP5',
    fireMode: 'auto',
    // ~800 rounds a minute: 5 body hits up close, falls off past 12 m.
    fireInterval: 0.075,
    magSize: 30,
    reserve: 120,
    reloadTime: 1.9,
    emptyReloadTime: 2.4,
    drawTime: 0.45,
    damage: 22,
    falloffStart: 12,
    falloffEnd: 30,
    minDamage: 14,
    range: 200,
    hipSpread: 1.4,
    aimSpread: 0.45,
    moveSpread: 1.2,
    airSpread: 4,
    sprintToFire: 0.12,
    adsTime: 0.16,
    aimZoom: 1.12,
    scoped: false,
    scopeSway: 0,
    // Light: you run as fast as with the handgun.
    moveSpeedFactor: 1.07,
    kickPitch: 0.35,
    kickYaw: 0.2,
    recoverTime: 0.2,
    // Gentle climb for ~8 shots, then a small side to side wobble (~4° total).
    recoilPattern: [
      [0.4, 0],
      [0.45, 0.04],
      [0.5, 0.08],
      [0.5, 0.06],
      [0.45, -0.02],
      [0.4, -0.1],
      [0.35, -0.16],
      [0.3, -0.18],
      [0.15, -0.12],
      [0.12, 0.05],
      [0.12, 0.2],
      [0.12, 0.25],
      [0.1, 0.12],
      [0.1, -0.08],
      [0.1, -0.22],
      [0.1, -0.25],
      [0.1, -0.1],
      [0.1, 0.1],
      [0.1, 0.22],
      [0.1, 0.15],
    ],
  },
  [WeaponId.Claws]: {
    id: WeaponId.Claws,
    slot: 'melee',
    noise: 0,
    look: WeaponId.Claws,
    name: 'Zombie',
    fireMode: 'melee',
    fireInterval: 0.9,
    magSize: 0,
    reserve: 0,
    reloadTime: 0,
    emptyReloadTime: 0,
    drawTime: 0.2,
    // The server scales this with the bot difficulty (zombies.ts).
    damage: 20,
    falloffStart: 100,
    falloffEnd: 101,
    minDamage: 20,
    range: 1.7,
    hipSpread: 0,
    aimSpread: 0,
    moveSpread: 0,
    airSpread: 0,
    sprintToFire: 0,
    adsTime: 0,
    aimZoom: 1,
    scoped: false,
    scopeSway: 0,
    moveSpeedFactor: 1,
    kickPitch: 0,
    kickYaw: 0,
    recoverTime: 0.2,
  },
  [WeaponId.Lmg]: {
    id: WeaponId.Lmg,
    slot: 'primary',
    ammoType: '5.56',
    noise: 100,
    look: WeaponId.Lmg,
    name: 'LMG',
    fireMode: 'auto',
    // ~670 rounds a minute off a 100-round belt; hits like the rifle, carries further.
    fireInterval: 0.09,
    magSize: 100,
    reserve: 200,
    reloadTime: 4.2,
    emptyReloadTime: 4.8,
    drawTime: 0.9,
    damage: 32,
    falloffStart: 30,
    falloffEnd: 60,
    minDamage: 25,
    range: 300,
    hipSpread: 2.6,
    aimSpread: 0.45,
    moveSpread: 3.2,
    airSpread: 8,
    sprintToFire: 0.35,
    adsTime: 0.32,
    aimZoom: 1.15,
    scoped: false,
    scopeSway: 0,
    // Heavy: you walk slower carrying it.
    moveSpeedFactor: 0.86,
    kickPitch: 0.4,
    kickYaw: 0.3,
    recoverTime: 0.3,
    // A steady climb that levels off, then a slow wander (it's a belt-fed hose).
    recoilPattern: [
      [0.5, 0],
      [0.55, 0.05],
      [0.55, 0.1],
      [0.5, 0.05],
      [0.45, -0.05],
      [0.4, -0.12],
      [0.3, -0.15],
      [0.22, -0.1],
      [0.18, 0.05],
      [0.15, 0.18],
      [0.15, 0.22],
      [0.15, 0.1],
      [0.15, -0.1],
      [0.15, -0.22],
      [0.15, -0.18],
      [0.15, 0],
    ],
  },
}

/** A survival weapon: one of the originals with its own numbers. */
function variant(
  base: BaseId,
  id: WeaponId,
  name: string,
  changes: Partial<Omit<WeaponDef, 'id' | 'name' | 'look' | 'recoilPattern'>> & {
    /** `null`: no fixed spray (single shots kick by kickPitch/kickYaw). */
    recoilPattern?: WeaponDef['recoilPattern'] | null
  },
): WeaponDef {
  const { recoilPattern, ...rest } = changes
  const def: WeaponDef = { ...BASE[base], reserve: 0, ...rest, id, name, look: base }
  if (recoilPattern === null) delete def.recoilPattern
  else if (recoilPattern) def.recoilPattern = recoilPattern
  return def
}

/** A climbing spray: `up` degrees a shot at first, easing off, wandering `side` degrees. */
function spray(up: number, side: number): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < 20; i++) {
    const climb = i < 8 ? up * (0.7 + 0.04 * i) : up * 0.3
    // A fixed zig-zag (no randomness: sprays can be learned).
    const sway = side * ([0, 0.2, 0.5, 0.3, -0.2, -0.6, -0.8, -0.4, 0.3, 0.9][i % 10] ?? 0)
    out.push([climb, sway])
  }
  return out
}

const melee = (
  id: WeaponId,
  name: string,
  damage: number,
  fireInterval: number,
  range: number,
  moveSpeedFactor: number,
): WeaponDef =>
  variant(WeaponId.Knife, id, name, {
    damage,
    minDamage: damage,
    fireInterval,
    range,
    moveSpeedFactor,
    drawTime: 0.3 + fireInterval * 0.3,
    kickPitch: 0.6 + damage / 100,
    noise: 4,
  })

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  ...BASE,
  // ── Melee: silent, and they never run dry ──
  [WeaponId.Bat]: melee(WeaponId.Bat, 'Baseball bat', 60, 0.7, 2.4, 1.05),
  [WeaponId.Crowbar]: melee(WeaponId.Crowbar, 'Crowbar', 70, 0.8, 2.3, 1.04),
  [WeaponId.Machete]: melee(WeaponId.Machete, 'Machete', 85, 0.65, 2.3, 1.06),
  [WeaponId.Axe]: melee(WeaponId.Axe, 'Fire axe', 120, 1, 2.4, 1),
  [WeaponId.Sledge]: melee(WeaponId.Sledge, 'Sledgehammer', 200, 1.5, 2.5, 0.92),
  [WeaponId.Katana]: melee(WeaponId.Katana, 'Katana', 130, 0.55, 2.6, 1.08),

  // ── Pistols ──
  [WeaponId.M1911]: variant(WeaponId.Handgun, WeaponId.M1911, 'M1911', {
    ammoType: '.45',
    magSize: 7,
    damage: 38,
    minDamage: 26,
    fireInterval: 0.2,
    kickPitch: 3.1,
    noise: 60,
  }),
  [WeaponId.Revolver]: variant(WeaponId.Handgun, WeaponId.Revolver, '.357 Revolver', {
    ammoType: '.357',
    magSize: 6,
    damage: 70,
    minDamage: 50,
    falloffStart: 25,
    falloffEnd: 50,
    fireInterval: 0.45,
    reloadTime: 2.9,
    emptyReloadTime: 2.9,
    kickPitch: 5.2,
    kickYaw: 1,
    recoverTime: 0.4,
    noise: 80,
  }),
  [WeaponId.M9]: variant(WeaponId.Handgun, WeaponId.M9, 'Beretta M9', {
    magSize: 15,
    damage: 25,
    fireInterval: 0.14,
    kickPitch: 2,
  }),
  [WeaponId.Ruger]: variant(WeaponId.Handgun, WeaponId.Ruger, 'Suppressed .22', {
    ammoType: '.22',
    magSize: 10,
    damage: 15,
    minDamage: 11,
    fireInterval: 0.13,
    kickPitch: 1,
    kickYaw: 0.3,
    hipSpread: 0.9,
    noise: 10,
  }),
  [WeaponId.SawedOff]: variant(WeaponId.Shotgun, WeaponId.SawedOff, 'Sawed-off', {
    slot: 'sidearm',
    fireMode: 'semi',
    magSize: 2,
    damage: 18,
    fireInterval: 0.3,
    reloadTime: 2.2,
    emptyReloadTime: 2.2,
    drawTime: 0.4,
    hipSpread: 6.5,
    aimSpread: 5.5,
    falloffEnd: 22,
    kickPitch: 7,
    moveSpeedFactor: 1.04,
    noise: 105,
  }),

  // ── Submachine guns ──
  [WeaponId.Uzi]: variant(WeaponId.Smg, WeaponId.Uzi, 'Uzi', {
    magSize: 32,
    damage: 20,
    minDamage: 12,
    fireInterval: 0.06,
    hipSpread: 2,
    aimSpread: 0.8,
    recoilPattern: spray(0.5, 0.45),
  }),
  [WeaponId.Ump]: variant(WeaponId.Smg, WeaponId.Ump, 'UMP45', {
    ammoType: '.45',
    magSize: 25,
    damage: 30,
    minDamage: 19,
    fireInterval: 0.1,
    recoilPattern: spray(0.6, 0.25),
    noise: 70,
  }),
  [WeaponId.Mac10]: variant(WeaponId.Smg, WeaponId.Mac10, 'MAC-10', {
    ammoType: '.45',
    magSize: 30,
    damage: 24,
    minDamage: 14,
    fireInterval: 0.055,
    hipSpread: 2.6,
    aimSpread: 1.1,
    recoilPattern: spray(0.75, 0.7),
    noise: 70,
  }),

  // ── Rifles ──
  [WeaponId.Ak47]: variant(WeaponId.Rifle, WeaponId.Ak47, 'AK-47', {
    ammoType: '7.62',
    damage: 37,
    minDamage: 28,
    fireInterval: 0.105,
    hipSpread: 2.4,
    aimSpread: 0.4,
    recoilPattern: spray(1.15, 0.5),
    noise: 100,
  }),
  [WeaponId.Sks]: variant(WeaponId.Rifle, WeaponId.Sks, 'SKS', {
    ammoType: '7.62',
    fireMode: 'semi',
    magSize: 10,
    damage: 46,
    minDamage: 36,
    fireInterval: 0.22,
    kickPitch: 2.2,
    kickYaw: 0.5,
    aimSpread: 0.15,
    recoilPattern: null,
    noise: 100,
  }),
  [WeaponId.HuntingRifle]: variant(WeaponId.Rifle, WeaponId.HuntingRifle, 'Hunting rifle', {
    ammoType: '.308',
    fireMode: 'bolt',
    magSize: 4,
    damage: 105,
    minDamage: 90,
    falloffStart: 60,
    falloffEnd: 150,
    fireInterval: 1.25,
    reloadTime: 2.8,
    emptyReloadTime: 3.2,
    hipSpread: 3,
    aimSpread: 0.05,
    adsTime: 0.3,
    aimZoom: 1.9,
    kickPitch: 4.2,
    kickYaw: 0.8,
    recoverTime: 0.45,
    recoilPattern: null,
    noise: 115,
  }),
  [WeaponId.Carbine22]: variant(WeaponId.Rifle, WeaponId.Carbine22, 'Ruger 10/22', {
    ammoType: '.22',
    fireMode: 'semi',
    magSize: 15,
    damage: 19,
    minDamage: 14,
    fireInterval: 0.14,
    kickPitch: 0.8,
    kickYaw: 0.2,
    aimSpread: 0.12,
    moveSpeedFactor: 1.04,
    recoilPattern: null,
    noise: 14,
  }),
  [WeaponId.LeverAction]: variant(WeaponId.Rifle, WeaponId.LeverAction, 'Lever-action', {
    ammoType: '.357',
    fireMode: 'bolt',
    magSize: 8,
    damage: 78,
    minDamage: 58,
    fireInterval: 0.65,
    reloadTime: 3.2,
    emptyReloadTime: 3.4,
    aimSpread: 0.12,
    kickPitch: 3.4,
    kickYaw: 0.7,
    recoverTime: 0.4,
    recoilPattern: null,
    noise: 95,
  }),

  // ── Shotguns ──
  [WeaponId.DoubleBarrel]: variant(WeaponId.Shotgun, WeaponId.DoubleBarrel, 'Double-barrel', {
    fireMode: 'semi',
    magSize: 2,
    damage: 22,
    pellets: 9,
    fireInterval: 0.25,
    reloadTime: 2.5,
    emptyReloadTime: 2.5,
    kickPitch: 6,
    noise: 110,
  }),
  [WeaponId.AutoShotgun]: variant(WeaponId.Shotgun, WeaponId.AutoShotgun, 'Saiga-12', {
    fireMode: 'semi',
    magSize: 8,
    damage: 17,
    fireInterval: 0.28,
    reloadTime: 2.4,
    emptyReloadTime: 2.9,
    kickPitch: 4,
    noise: 105,
  }),

  // ── Marksman ──
  [WeaponId.Svd]: variant(WeaponId.Sniper, WeaponId.Svd, 'SVD Dragunov', {
    ammoType: '7.62',
    fireMode: 'semi',
    magSize: 10,
    damage: 88,
    minDamage: 88,
    fireInterval: 0.45,
    kickPitch: 3.2,
    scopeSway: 0.55,
    noise: 115,
  }),
  [WeaponId.Barrett]: variant(WeaponId.Sniper, WeaponId.Barrett, 'Barrett .50', {
    ammoType: '.50',
    fireMode: 'semi',
    magSize: 5,
    damage: 450,
    minDamage: 450,
    fireInterval: 1.5,
    reloadTime: 3.6,
    emptyReloadTime: 4.2,
    drawTime: 1.2,
    aimZoom: 6,
    adsTime: 0.4,
    kickPitch: 7,
    kickYaw: 1.5,
    recoverTime: 0.7,
    scopeSway: 0.6,
    moveSpeedFactor: 0.8,
    noise: 220,
  }),
  [WeaponId.Crossbow]: variant(WeaponId.Sniper, WeaponId.Crossbow, 'Crossbow', {
    ammoType: 'bolt',
    fireMode: 'semi',
    magSize: 1,
    damage: 160,
    minDamage: 160,
    fireInterval: 0.3,
    reloadTime: 2.3,
    emptyReloadTime: 2.3,
    drawTime: 0.7,
    range: 90,
    hipSpread: 1.5,
    aimZoom: 2,
    scoped: false,
    scopeSway: 0,
    kickPitch: 1,
    kickYaw: 0.2,
    moveSpeedFactor: 0.97,
    noise: 6,
  }),
}

/** The eight originals: every other weapon is drawn and heard as one of them (`look`). */
export function weaponLook(id: WeaponId): BaseWeaponId {
  return WEAPONS[id].look as BaseWeaponId
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
