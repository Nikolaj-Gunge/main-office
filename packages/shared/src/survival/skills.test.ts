import { describe, expect, test } from 'bun:test'
import { Button } from '../sim/input.ts'
import { DEFAULT_MOVEMENT } from '../sim/movement-config.ts'
import { createWeaponState, stepWeapon, weaponSway } from '../sim/weapon-sim.ts'
import { WEAPONS, WeaponId } from '../sim/weapons.ts'
import { useSeconds } from './crafting.ts'
import { ITEMS, tableItems } from './items.ts'
import { tuneMovement } from './needs.ts'
import {
  cleanSkills,
  freshSkills,
  gainSkill,
  levelFor,
  MANUAL_BOOST,
  MANUAL_READ_SECONDS,
  MANUAL_SECONDS,
  manualSkill,
  readManual,
  SKILL_IDS,
  SKILL_XP,
  SKILLS,
  skillEffects,
  skillLevel,
  skillProgress,
  tickSkills,
} from './skills.ts'

describe('skills: experience and levels', () => {
  test('doing things adds experience and levels come at the thresholds', () => {
    const s = freshSkills()
    expect(skillLevel(s, 'aim')).toBe(0)
    expect(gainSkill(s, 'aim', 59)).toBeNull()
    expect(gainSkill(s, 'aim', 1)).toBe(1)
    expect(skillLevel(s, 'aim')).toBe(1)
    expect(skillLevel(s, 'melee')).toBe(0)
    expect(levelFor(SKILL_XP[5] as number)).toBe(5)
    expect(levelFor(1e9)).toBe(5)
  })

  test('experience stops at level 5', () => {
    const s = freshSkills()
    expect(gainSkill(s, 'fitness', 1e6)).toBe(5)
    expect(s.xp.fitness).toBe(SKILL_XP[5])
    expect(gainSkill(s, 'fitness', 10)).toBeNull()
    expect(skillProgress(s, 'fitness')).toEqual({ level: 5, to: 1 })
  })

  test('progress is how far into the level', () => {
    const s = freshSkills()
    gainSkill(s, 'medic', 120)
    expect(skillProgress(s, 'medic')).toEqual({ level: 1, to: 0.5 })
  })

  test('nothing or less than nothing teaches nothing', () => {
    const s = freshSkills()
    expect(gainSkill(s, 'aim', 0)).toBeNull()
    expect(gainSkill(s, 'aim', -5)).toBeNull()
    expect(gainSkill(s, 'aim', Number.NaN)).toBeNull()
    expect(s.xp.aim).toBeUndefined()
  })

  test('level 5 takes hours of steady work, not minutes', () => {
    // A gun hit every 10 seconds, steadily: an hour gives about 720 xp before the manual.
    const perHour = 360 * 2
    expect((SKILL_XP[5] as number) / perHour).toBeGreaterThan(1.5)
    expect((SKILL_XP[1] as number) / perHour).toBeLessThan(0.2)
  })
})

describe('skills: field manuals', () => {
  test('a manual triples what its skill learns, for half an hour', () => {
    const s = freshSkills()
    readManual(s, 'carpentry')
    gainSkill(s, 'carpentry', 10)
    gainSkill(s, 'aim', 10)
    expect(s.xp.carpentry).toBe(10 * MANUAL_BOOST)
    expect(s.xp.aim).toBe(10)
    expect(tickSkills(s, MANUAL_SECONDS - 1)).toBe(false)
    expect(tickSkills(s, 1)).toBe(true)
    expect(s.read?.carpentry).toBeUndefined()
    gainSkill(s, 'carpentry', 10)
    expect(s.xp.carpentry).toBe(10 * MANUAL_BOOST + 10)
  })

  test('there is one manual per skill, it reads in a few seconds and lies in the right places', () => {
    for (const id of SKILL_IDS) {
      const def = ITEMS[SKILLS[id].manual]
      expect(def?.manual).toBe(id)
      expect(manualSkill(SKILLS[id].manual)).toBe(id)
      if (def) expect(useSeconds(def)).toBe(MANUAL_READ_SECONDS)
    }
    expect(manualSkill('beans')).toBeUndefined()
    const found = new Set([
      ...tableItems('bedroom'),
      ...tableItems('office'),
      ...tableItems('police'),
    ])
    for (const id of SKILL_IDS) expect(found.has(SKILLS[id].manual)).toBe(true)
  })
})

describe('skills: saved and sent', () => {
  test('a save comes back the same', () => {
    const s = freshSkills()
    gainSkill(s, 'stealth', 200)
    readManual(s, 'stealth')
    const back = cleanSkills(JSON.parse(JSON.stringify(s)))
    expect(back).toEqual(s)
  })

  test('junk in a save is dropped', () => {
    expect(cleanSkills(undefined)).toEqual(freshSkills())
    expect(cleanSkills('nonsense')).toEqual(freshSkills())
    const back = cleanSkills({
      xp: { aim: 100, juggling: 50, melee: -3, medic: 'lots', fitness: 1e9 },
      read: { aim: 1e9, stealth: -1 },
    })
    expect(back.xp).toEqual({ aim: 100, fitness: SKILL_XP[5] as number })
    expect(back.read).toEqual({ aim: MANUAL_SECONDS })
  })
})

describe('skills: what the levels change', () => {
  test('a fresh character is unchanged', () => {
    const fx = skillEffects(undefined)
    for (const v of [fx.aimSpeed, fx.sway, fx.recoil, fx.swingTime, fx.meleeDamage, fx.sprint])
      expect(v).toBe(1)
    expect(fx.hidden).toBe(0)
  })

  test('each level helps a little (3–6%), level 5 noticeably', () => {
    const s = freshSkills()
    for (const id of SKILL_IDS) gainSkill(s, id, SKILL_XP[1] as number)
    const one = skillEffects(s)
    for (const v of [one.aimSpeed, one.meleeDamage, one.medHeal, one.sprint]) {
      expect(v - 1).toBeGreaterThanOrEqual(0.03)
      expect(v - 1).toBeLessThanOrEqual(0.0601)
    }
    for (const v of [one.sway, one.swingTime, one.stepNoise, one.medTime, one.fixTime]) {
      expect(1 - v).toBeGreaterThanOrEqual(0.03)
      expect(1 - v).toBeLessThanOrEqual(0.0601)
    }
    for (const id of SKILL_IDS) gainSkill(s, id, 1e6)
    const five = skillEffects(s)
    expect(five.meleeDamage).toBeCloseTo(1.25)
    expect(five.buildTime).toBeCloseTo(0.7)
    expect(five.boardDamage).toBeCloseTo(0.75)
  })

  test('Fitness gives more breath', () => {
    const s = freshSkills()
    gainSkill(s, 'fitness', 1e6)
    const tuned = tuneMovement(DEFAULT_MOVEMENT, [], skillEffects(s).sprint)
    expect(tuned.sprintSeconds).toBeCloseTo(DEFAULT_MOVEMENT.sprintSeconds * 1.25)
  })

  test('Aim brings the sights up faster and steadies the scope', () => {
    expect(aimTimeAfter(1.25)).toBeGreaterThan(aimTimeAfter(1))
    const w = createWeaponState(WeaponId.Sniper)
    w.swayTime = WEAPONS[WeaponId.Sniper].adsTime + 2
    const full = weaponSway(w)
    const steady = weaponSway(w, 0.75)
    expect(Math.abs(steady.yaw)).toBeCloseTo(Math.abs(full.yaw) * 0.75)
  })

  test('Melee swings come quicker', () => {
    const w = createWeaponState(WeaponId.Bat)
    w.draw = 0
    const ctx = { speedFactor: 0, grounded: true, crouched: false, sprinting: false }
    stepWeapon(w, FIRE, FIRE, 1 / 60, {
      ...ctx,
      rules: { spreadScale: 1, infiniteAmmo: false, swingTime: 0.8 },
    })
    expect(w.cooldown).toBeCloseTo(WEAPONS[WeaponId.Bat].fireInterval * 0.8)
  })
})

const FIRE = Button.Fire
function aimTimeAfter(aimSpeed: number): number {
  const w = createWeaponState(WeaponId.Sniper)
  w.draw = 0
  stepWeapon(w, Button.Aim, 0, 0.05, {
    speedFactor: 0,
    grounded: true,
    crouched: false,
    sprinting: false,
    rules: { spreadScale: 1, infiniteAmmo: false, aimSpeed },
  })
  return w.aimTime
}
