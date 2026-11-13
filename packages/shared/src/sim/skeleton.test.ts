import { describe, expect, test } from 'bun:test'
import { ZombieKind } from '../modes.ts'
import { type HitPose, poseBounds, poseHitboxes } from './hitboxes.ts'
import {
  type BodyPart,
  type BodyPose,
  blendShotAge,
  bodyParts,
  moveDirection,
  type PartName,
  qRotate,
  strideLength,
} from './skeleton.ts'
import { WeaponId } from './weapons.ts'

const base: BodyPose = { x: 0, y: 0, z: 0, yaw: 0, crouch: 0 }
const part = (pose: BodyPose, name: PartName): BodyPart => {
  const found = bodyParts(pose).find((p) => p.name === name)
  if (!found) throw new Error(`no ${name}`)
  return found
}
/** The ends of a limb along its local Y (for legs: hip/knee, knee/foot). */
const ends = (p: BodyPart) => {
  const axis = qRotate(p.rotation, { x: 0, y: p.half.y, z: 0 })
  return {
    top: { x: p.center.x + axis.x, y: p.center.y + axis.y, z: p.center.z + axis.z },
    bottom: { x: p.center.x - axis.x, y: p.center.y - axis.y, z: p.center.z - axis.z },
  }
}
const foot = (pose: BodyPose, side: 'L' | 'R') => ends(part(pose, `shin${side}`)).bottom

describe('aiming', () => {
  test('aiming raises a rifle from the chest to the eye, the head tilting onto the stock', () => {
    const head = part(base, 'head').center
    const hip = part(base, 'gun').center
    const aimed = part({ ...base, ads: 1 }, 'gun').center
    expect(head.y - hip.y).toBeGreaterThan(0.3)
    expect(Math.abs(head.y - aimed.y)).toBeLessThan(0.08)
    expect(part({ ...base, ads: 1 }, 'head').rotation).not.toEqual(part(base, 'head').rotation)
  })

  test('a pistol is held out one-handed at the hip and two-handed at the eye', () => {
    const pistol = { ...base, weapon: WeaponId.Handgun }
    const hand = (pose: BodyPose) => ends(part(pose, 'armL')).top
    const gun = part(pistol, 'gun').center
    // Hip: the free hand hangs by the side, far from the gun.
    expect(Math.hypot(hand(pistol).x - gun.x, hand(pistol).z - gun.z)).toBeGreaterThan(0.3)
    // Aimed: arms out, gun at eye level, both hands on it.
    const aimed = { ...pistol, ads: 1 }
    const aimedGun = part(aimed, 'gun').center
    expect(Math.abs(aimedGun.y - part(aimed, 'head').center.y)).toBeLessThan(0.08)
    expect(aimedGun.z).toBeLessThan(-0.55)
    expect(Math.hypot(hand(aimed).x - aimedGun.x, hand(aimed).z - aimedGun.z)).toBeLessThan(0.2)
  })

  test('the aim blends smoothly between hip and sights', () => {
    const y = (ads: number) => part({ ...base, ads }, 'gun').center.y
    expect(y(0.5)).toBeGreaterThan(y(0) + 0.1)
    expect(y(0.5)).toBeLessThan(y(1) - 0.1)
  })

  test('aiming looks where the gun points', () => {
    const up = part({ ...base, ads: 1, pitch: 0.5 }, 'gun')
    const dir = qRotate(up.rotation, { x: 0, y: 0, z: -1 })
    expect(Math.atan2(dir.y, -dir.z)).toBeCloseTo(0.5, 5)
  })

  test('a shot kicks the gun back and its muzzle up', () => {
    const fired = part({ ...base, shotAge: 0 }, 'gun')
    const rest = part({ ...base, shotAge: 1 }, 'gun')
    expect(fired.center.z).toBeGreaterThan(rest.center.z + 0.02)
    expect(qRotate(fired.rotation, { x: 0, y: 0, z: -1 }).y).toBeGreaterThan(0.05)
  })
})

describe('locomotion', () => {
  test('a planted foot stays put while the body moves over it', () => {
    // Crouch-walking (feet down long enough): the left foot is down for the first half.
    const speed = 2.4
    const cycle = strideLength(speed)
    for (const stride of [0.05, 0.15, 0.25]) {
      const a = foot({ ...base, crouch: 1, speed, stride }, 'L')
      // 0.1 of a cycle later the body has moved 0.1 cycle forward (-Z).
      const b = foot({ ...base, z: -0.1 * cycle, crouch: 1, speed, stride: stride + 0.1 }, 'L')
      expect(Math.abs(b.z - a.z)).toBeLessThan(0.02)
      expect(b.y).toBeLessThan(0.05)
    }
  })

  test('a swinging foot lifts off the ground and moves forward', () => {
    const swing = [0.6, 0.75, 0.9].map((stride) => foot({ ...base, speed: 5, stride }, 'L'))
    expect(Math.max(...swing.map((f) => f.y))).toBeGreaterThan(0.1)
    expect(swing[2]?.z ?? 0).toBeLessThan(swing[0]?.z ?? 0)
  })

  test('legs swing along the movement: forward, backwards or sideways', () => {
    const spread = (moveDir: number, axis: 'x' | 'z') => {
      const at = [0, 0.25, 0.5, 0.75].map((stride) =>
        foot({ ...base, speed: 5, stride, moveDir }, 'L'),
      )
      return Math.max(...at.map((f) => f[axis])) - Math.min(...at.map((f) => f[axis]))
    }
    expect(spread(0, 'z')).toBeGreaterThan(0.3)
    expect(spread(0, 'x')).toBeLessThan(0.1)
    expect(spread(Math.PI / 2, 'x')).toBeGreaterThan(0.15)
    expect(spread(Math.PI / 2, 'z')).toBeLessThan(0.15)
    // Backpedalling: at the same point in the cycle the foot is behind instead of in front.
    const fwd = foot({ ...base, speed: 5, stride: 0 }, 'L')
    const back = foot({ ...base, speed: 5, stride: 0, moveDir: Math.PI }, 'L')
    expect(fwd.z).toBeLessThan(-0.1)
    expect(back.z).toBeGreaterThan(0.1)
  })

  test('running leans into the run; backpedalling leans back', () => {
    const chest = (pose: BodyPose) => part(pose, 'chest').center.z
    expect(chest({ ...base, speed: 7 })).toBeLessThan(chest(base) - 0.05)
    expect(chest({ ...base, speed: 5, moveDir: Math.PI })).toBeGreaterThan(chest(base))
  })

  test('a jump tucks the legs, a landing bends the knees and dips the body', () => {
    const knee = (pose: BodyPose) => ends(part(pose, 'shinL')).top.y
    expect(knee({ ...base, grounded: false, vy: 4 })).toBeGreaterThan(knee(base) + 0.1)
    expect(foot({ ...base, grounded: false, vy: 4 }, 'L').y).toBeGreaterThan(0.3)
    const head = (pose: BodyPose) => part(pose, 'head').center.y
    expect(head({ ...base, land: 1 })).toBeLessThan(head(base) - 0.1)
    expect(foot({ ...base, land: 1 }, 'L').y).toBeLessThan(0.05)
  })

  test('free arms swing against the legs', () => {
    const hand = (stride: number) =>
      ends(part({ ...base, weapon: WeaponId.Knife, speed: 5, stride }, 'armL')).top
    // Left arm forward while the right leg is forward (half a cycle after the left).
    expect(hand(0.5).z).toBeLessThan(hand(0).z - 0.15)
  })

  test('moveDirection is relative to facing', () => {
    expect(moveDirection(0, 0, -3)).toBeCloseTo(0)
    expect(moveDirection(0, 3, 0)).toBeCloseTo(Math.PI / 2)
    expect(Math.abs(moveDirection(0, 0, 3))).toBeCloseTo(Math.PI)
    // Facing +X (yaw −π/2) and moving +X is forward.
    expect(moveDirection(-Math.PI / 2, 3, 0)).toBeCloseTo(0)
  })

  test('bigger bodies and lumbering gaits take longer strides', () => {
    expect(strideLength(5, 1.38)).toBeCloseTo(strideLength(5) * 1.38)
    expect(strideLength(2, 1, ZombieKind.Brute)).toBeGreaterThan(strideLength(2))
    expect(strideLength(2, 1, ZombieKind.Walker)).toBeLessThan(strideLength(2))
  })
})

describe('melee and zombies', () => {
  test('a melee swing cocks the weapon back, then strikes across', () => {
    const knife = { ...base, weapon: WeaponId.Knife }
    const at = (shotAge: number) => part({ ...knife, shotAge }, 'gun').center
    expect(at(0.04).y).toBeGreaterThan(at(1).y + 0.15) // raised
    expect(at(0.12).x).toBeLessThan(at(1).x - 0.1) // swept across
    expect(at(1)).toEqual(part(knife, 'gun').center) // back at rest
  })

  test('every kind of zombie moves its own way', () => {
    const kinds = [0, ...Object.values(ZombieKind)]
    for (const pose of [
      { ...base, weapon: WeaponId.Claws }, // standing
      { ...base, weapon: WeaponId.Claws, speed: 4, stride: 0.3 }, // on the move
    ]) {
      const shapes = kinds.map((gait) =>
        JSON.stringify(bodyParts({ ...pose, gait }).map((p) => p.center)),
      )
      expect(new Set(shapes).size).toBe(kinds.length)
    }
    const head = (gait: number) => part({ ...base, gait, weapon: WeaponId.Claws }, 'head').center
    expect(head(ZombieKind.Stalker).y).toBeLessThan(head(0).y - 0.25) // crouch-stalking
    expect(head(ZombieKind.Walker).z).toBeLessThan(head(0).z - 0.1) // stooped forward
    const width = (gait: number) => {
      const p = { ...base, gait, weapon: WeaponId.Claws }
      return foot(p, 'R').x - foot(p, 'L').x
    }
    expect(width(ZombieKind.Brute)).toBeGreaterThan(width(0) + 0.1) // wide stance
  })

  test('walkers reach out ahead; a claw swipe rakes forward', () => {
    const walker = { ...base, gait: ZombieKind.Walker, weapon: WeaponId.Claws }
    const hand = (pose: BodyPose) => ends(part(pose, 'armR')).top
    expect(hand(walker).z).toBeLessThan(-0.45)
    expect(hand({ ...walker, shotAge: 0.22 }).z).toBeLessThan(hand(walker).z - 0.05)
  })

  test('the dead sway on their own clocks; people breathe, barely', () => {
    const walker = { ...base, gait: ZombieKind.Walker, weapon: WeaponId.Claws, seed: 1 }
    const head = (pose: BodyPose) => part(pose, 'head').center
    const swayed = Math.hypot(
      head({ ...walker, time: 2 }).x - head({ ...walker, time: 4 }).x,
      head({ ...walker, time: 2 }).z - head({ ...walker, time: 4 }).z,
    )
    expect(swayed).toBeGreaterThan(0.02)
    expect(head({ ...walker, time: 2 })).not.toEqual(head({ ...walker, time: 2, seed: 2 }))
    const person = Math.abs(head({ ...base, time: 2 }).y - head({ ...base, time: 4 }).y)
    expect(person).toBeLessThan(0.02)
  })
})

describe('the pose is a pure function', () => {
  test('the same inputs give exactly the same boxes', () => {
    const pose: BodyPose = {
      ...base,
      x: 3,
      yaw: 1,
      speed: 6,
      stride: 0.37,
      moveDir: 0.8,
      ads: 0.4,
      shotAge: 0.05,
      gait: ZombieKind.Screamer,
      weapon: WeaponId.Claws,
      time: 123.456,
      seed: 7,
    }
    expect(bodyParts(pose)).toEqual(bodyParts({ ...pose }))
  })

  test('every hitbox stays inside the bounding sphere the hit test checks first', () => {
    const variants: Partial<HitPose>[] = []
    for (const gait of [0, ...Object.values(ZombieKind)])
      for (const weapon of [WeaponId.Rifle, WeaponId.Handgun, WeaponId.Sledge, WeaponId.Claws])
        for (const speed of [0, 3, 7.5])
          for (const stride of [0, 0.3, 0.6, 0.85])
            variants.push({ gait, weapon, speed, stride, moveDir: stride * 7, ads: stride })
    variants.push(
      { grounded: false, vy: 5, crouch: 1 },
      { grounded: false, vy: -10 },
      { land: 1, crouch: 1 },
      { shotAge: 0.1, weapon: WeaponId.Sledge, pitch: -1.2 },
      { shotAge: 0.1, weapon: WeaponId.Claws, gait: ZombieKind.Runner, speed: 8 },
      { pitch: 1.4, ads: 1, scale: 1.38 },
    )
    for (const v of variants) {
      const pose: HitPose = { ...base, crouch: 0, time: 3.3, seed: 5, ...v }
      const bounds = poseBounds(pose)
      for (const box of poseHitboxes(pose)) {
        for (const corner of [-1, 1].flatMap((x) =>
          [-1, 1].flatMap((y) => [-1, 1].map((z) => ({ x, y, z }))),
        )) {
          const c = qRotate(box.rotation, {
            x: corner.x * box.half.x,
            y: corner.y * box.half.y,
            z: corner.z * box.half.z,
          })
          const d = Math.hypot(
            box.center.x + c.x - bounds.center.x,
            box.center.y + c.y - bounds.center.y,
            box.center.z + c.z - bounds.center.z,
          )
          expect(d).toBeLessThan(bounds.radius)
          expect(Number.isFinite(d)).toBe(true)
        }
      }
    }
  })

  test('the shot clock blends forward, and snaps to a new shot past halfway', () => {
    expect(blendShotAge(0.2, 0.4, 0.5)).toBeCloseTo(0.3)
    expect(blendShotAge(0.8, 0.01, 0.4)).toBe(0.8)
    expect(blendShotAge(0.8, 0.01, 0.6)).toBe(0.01)
  })
})
