import { describe, expect, test } from 'bun:test'
import { ZombieKind } from '../modes.ts'
import { type HitPose, HitZone, poseBounds, poseHitboxes, raycastPose } from './hitboxes.ts'
import {
  type BodyPart,
  type BodyPose,
  blendProgress,
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

describe('lying, sliding, climbing', () => {
  const prone: BodyPose = { ...base, crouch: 1, prone: 1 }

  test('prone: flat on the ground, head up, a body length front to back', () => {
    const boxes = bodyParts(prone).filter((p) => p.name !== 'gun')
    for (const p of boxes) expect(p.center.y).toBeLessThan(0.45)
    const zs = boxes.map((p) => p.center.z)
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(1.2)
    expect(part(prone, 'head').center.z).toBeLessThan(-0.3) // head in front
    // The gun points where they look, at eye level just off the floor.
    const gun = part(prone, 'gun')
    expect(gun.center.y).toBeLessThan(0.4)
    expect(qRotate(gun.rotation, { x: 0, y: 0, z: -1 }).z).toBeLessThan(-0.99)
  })

  test('prone hitboxes lie down too: a chest-high shot misses, a low one hits', () => {
    const facing = { ...prone, z: -10, yaw: Math.PI }
    const at = (y: number) =>
      raycastPose({ x: 0, y, z: 0 }, { x: 0, y: 0, z: -1 }, 100, facing)?.zone ?? HitZone.None
    expect(at(1.3)).toBe(HitZone.None)
    expect(at(0.95)).toBe(HitZone.None)
    expect(at(0.3)).toBe(HitZone.Head) // looking at you over the sights
    expect(at(0.15)).not.toBe(HitZone.None)
  })

  test('crawling draws a knee up to the side; getting down blends from the crouch', () => {
    const knee = (stride: number) => ends(part({ ...prone, speed: 1, stride }, 'thighL')).bottom
    expect(knee(0.25).x).toBeLessThan(knee(0.75).x - 0.15)
    expect(knee(0.25).y).toBeGreaterThan(0.05) // along the floor, not through it
    const head = (amount: number) => part({ ...prone, prone: amount }, 'head').center.y
    expect(head(0.5)).toBeLessThan(head(0) - 0.2)
    expect(head(0.5)).toBeGreaterThan(head(1) + 0.2)
  })

  test('slide: hips low, leaning back, the leading leg out, a hand on the floor', () => {
    const sliding = { ...base, crouch: 1, speed: 7, slide: 0.5 }
    expect(part(sliding, 'stomach').center.y).toBeLessThan(0.65)
    expect(part(sliding, 'chest').center.z).toBeGreaterThan(part(sliding, 'stomach').center.z)
    expect(foot(sliding, 'L').z).toBeLessThan(-0.6)
    expect(foot(sliding, 'L').y).toBeLessThan(0.1)
    expect(ends(part(sliding, 'armL')).top.y).toBeLessThan(0.15)
    // It drops in quickly and rises as it runs out.
    const lead = (slide: number) => foot({ ...sliding, slide }, 'L').z
    expect(lead(0.99)).toBeGreaterThan(lead(0.5) + 0.3)
    expect(lead(0.01)).toBeGreaterThan(lead(0.5) + 0.3)
  })

  test('climb: both hands on the ledge, whatever its height and the body size', () => {
    for (const [ledge, scale] of [
      [1.2, 1],
      [0.4, 1],
      [1.6, 1.38],
    ] as const) {
      const climbing = { ...base, grounded: false, vy: 2, mantle: 0.3, ledge, scale }
      for (const arm of ['armL', 'armR'] as const) {
        const hand = ends(part(climbing, arm)).top
        expect(hand.y).toBeCloseTo(ledge, 2)
        expect(hand.z).toBeLessThan(-0.3 * scale)
      }
    }
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
      { prone: 1, crouch: 1, speed: 1.1, stride: 0.3, pitch: 0.6 },
      { prone: 1, crouch: 1, weapon: WeaponId.Claws, speed: 1, stride: 0.7 },
      { prone: 0.5, crouch: 1, weapon: WeaponId.Sledge },
      { slide: 0.6, crouch: 1, speed: 8, pitch: -1 },
      { slide: 0.6, crouch: 1, speed: 8, weapon: WeaponId.Handgun, ads: 1 },
      { mantle: 0.2, ledge: 2, grounded: false, vy: 4 },
      { mantle: 0.7, ledge: 0.1, grounded: false, vy: 0.5, crouch: 1 },
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

  test('slides and climbs blend one way; a new one (or the end) snaps past halfway', () => {
    expect(blendProgress(0.8, 0.6, 0.5, -1)).toBeCloseTo(0.7) // a slide running out
    expect(blendProgress(0.1, 1, 0.4, -1)).toBe(0.1) // a new slide…
    expect(blendProgress(0.1, 1, 0.6, -1)).toBe(1) // …starts past halfway
    expect(blendProgress(0.95, 0, 0.3, 1)).toBe(0.95) // a climb ending doesn't play back
  })

  test('the shot clock blends forward, and snaps to a new shot past halfway', () => {
    expect(blendShotAge(0.2, 0.4, 0.5)).toBeCloseTo(0.3)
    expect(blendShotAge(0.8, 0.01, 0.4)).toBe(0.8)
    expect(blendShotAge(0.8, 0.01, 0.6)).toBe(0.01)
  })
})
