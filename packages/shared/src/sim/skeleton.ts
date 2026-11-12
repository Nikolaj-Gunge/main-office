/**
 * The animated body every player has: the same boxes are drawn on screen and used as hitboxes,
 * so what you see is exactly what you can hit — swinging legs, arms holding the gun, the head
 * tilting with the aim, knees bending in a crouch. Pure math, identical on server and client.
 *
 * Model space: feet at the origin, facing -Z, +Y up, metres at body size 1 (office worker
 * proportions). World = translate(pos) · rotateY(yaw) · scale(size) · model.
 */

export interface V3 {
  x: number
  y: number
  z: number
}

/** Unit quaternion. */
export interface Quat {
  x: number
  y: number
  z: number
  w: number
}

/** What decides a body's pose (all replicated, so server and client agree). */
export interface BodyPose {
  x: number
  y: number
  z: number
  yaw: number
  /** Aim pitch (radians, up positive). */
  pitch?: number
  /** 0 = standing, 1 = crouched. */
  crouch: number
  /** Walk cycle, 0–1 (one full cycle = two steps). */
  stride?: number
  /** Horizontal speed (m/s): how big the steps are. */
  speed?: number
  /** False in the air: legs tucked. */
  grounded?: boolean
  /** Body size (game rules: tiny people); 1 when omitted. */
  scale?: number
}

export type PartName =
  | 'head'
  | 'chest'
  | 'stomach'
  | 'armL'
  | 'armR'
  | 'thighL'
  | 'shinL'
  | 'thighR'
  | 'shinR'
  | 'gun'

export interface BodyPart {
  name: PartName
  /** World-space box: centre, half extents along its own axes, orientation. */
  center: V3
  half: V3
  rotation: Quat
}

/** Model-space sizes (half extents) of every part. */
export const PART_SIZES: Record<PartName, V3> = {
  head: { x: 0.15, y: 0.16, z: 0.15 },
  chest: { x: 0.23, y: 0.16, z: 0.13 },
  stomach: { x: 0.21, y: 0.15, z: 0.12 },
  // Arms and leg segments are along their local Y; their length is computed (arms reach the gun).
  armL: { x: 0.06, y: 0.28, z: 0.07 },
  armR: { x: 0.06, y: 0.28, z: 0.07 },
  thighL: { x: 0.085, y: 0.21, z: 0.095 },
  shinL: { x: 0.08, y: 0.21, z: 0.09 },
  thighR: { x: 0.085, y: 0.21, z: 0.095 },
  shinR: { x: 0.08, y: 0.21, z: 0.09 },
  gun: { x: 0.03, y: 0.05, z: 0.3 },
}

const HIP_Y = 0.86
const HIP_X = 0.11
const SEGMENT = 0.42 // thigh = shin length
const SHOULDER_X = 0.24
const NECK = 0.04 // gap between chest top and head bottom
/** How far the hips drop when fully crouched (body 1.8 → 1.2 m). */
const CROUCH_DROP = 0.55
const MAX_SWING = 0.55 // radians at full run
const RUN_SPEED = 6.5

// --- Tiny vector/quaternion helpers (no dependencies: this runs on the server too) -----------

const v = (x: number, y: number, z: number): V3 => ({ x, y, z })
const add = (a: V3, b: V3): V3 => v(a.x + b.x, a.y + b.y, a.z + b.z)
const sub = (a: V3, b: V3): V3 => v(a.x - b.x, a.y - b.y, a.z - b.z)
const scale = (a: V3, s: number): V3 => v(a.x * s, a.y * s, a.z * s)
const length = (a: V3) => Math.hypot(a.x, a.y, a.z)
const lerpV = (a: V3, b: V3, t: number) => add(a, scale(sub(b, a), t))

function qAxisAngle(axis: V3, angle: number): Quat {
  const s = Math.sin(angle / 2)
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(angle / 2) }
}

export function qMul(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  }
}

export function qRotate(q: Quat, p: V3): V3 {
  // p' = q p q*, expanded.
  const ix = q.w * p.x + q.y * p.z - q.z * p.y
  const iy = q.w * p.y + q.z * p.x - q.x * p.z
  const iz = q.w * p.z + q.x * p.y - q.y * p.x
  const iw = -q.x * p.x - q.y * p.y - q.z * p.z
  return v(
    ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  )
}

export function qConjugate(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w }
}

/** Rotation taking +Y onto the unit vector `dir` (for limbs between two joints). */
function qFromUp(dir: V3): Quat {
  const d = dir.y
  if (d > 0.999999) return { x: 0, y: 0, z: 0, w: 1 }
  if (d < -0.999999) return { x: 1, y: 0, z: 0, w: 0 }
  // axis = up × dir
  const axis = v(dir.z, 0, -dir.x)
  const len = Math.hypot(axis.x, axis.z)
  return qAxisAngle(scale(axis, 1 / len), Math.acos(Math.max(-1, Math.min(1, d))))
}

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 }
const X_AXIS = v(1, 0, 0)
const Y_AXIS = v(0, 1, 0)

// --- The pose ---------------------------------------------------------------------------------

/**
 * Every part of a body in this pose, in world space. Order: head first (it wins ties when a
 * shot grazes two parts), the gun last (drawn, never hit).
 */
export function bodyParts(pose: BodyPose): BodyPart[] {
  const crouch = Math.max(0, Math.min(1, pose.crouch))
  const pitch = pose.pitch ?? 0
  const speed = pose.speed ?? 0
  const grounded = pose.grounded ?? true
  const phase = (pose.stride ?? 0) * Math.PI * 2
  const model: { name: PartName; center: V3; half: V3; rotation: Quat }[] = []

  // Legs: crouching drops the hips and bends the knees so the feet stay on the floor; running
  // swings them (and bends the knee of the leg going back); in the air they tuck.
  const hipY = HIP_Y - CROUCH_DROP * crouch
  const kneeBase = Math.acos(Math.min(1, hipY / (2 * SEGMENT)))
  const swingAmp = grounded ? MAX_SWING * Math.min(1, speed / RUN_SPEED) : 0
  for (const side of [-1, 1] as const) {
    const swing = Math.sin(phase + (side < 0 ? 0 : Math.PI)) * swingAmp
    let thigh = kneeBase + swing // forward angle from straight down
    let knee = 2 * kneeBase + Math.max(0, -swing) * 1.3 // extra bend on the back swing
    if (!grounded) {
      thigh = side < 0 ? 0.55 : 0.1
      knee = side < 0 ? 1.1 : 0.5
    }
    const hip = v(side * HIP_X, hipY, 0)
    const dThigh = v(0, -Math.cos(thigh), -Math.sin(thigh))
    const kneeAt = add(hip, scale(dThigh, SEGMENT))
    const shinAngle = thigh - knee
    const dShin = v(0, -Math.cos(shinAngle), -Math.sin(shinAngle))
    const foot = add(kneeAt, scale(dShin, SEGMENT))
    const L = side < 0 ? 'L' : 'R'
    model.push({
      name: `thigh${L}`,
      center: lerpV(hip, kneeAt, 0.5),
      half: PART_SIZES[`thigh${L}`],
      rotation: qFromUp(scale(dThigh, -1)),
    })
    model.push({
      name: `shin${L}`,
      center: lerpV(kneeAt, foot, 0.5),
      half: PART_SIZES[`shin${L}`],
      rotation: qFromUp(scale(dShin, -1)),
    })
  }

  // Upper body: stomach on the hips, chest above, leaning forward a little when crouched and
  // with the aim (looking down bends you over a bit).
  const lean = 0.25 * crouch + Math.max(-0.15, Math.min(0.2, -pitch * 0.2))
  const torso = qAxisAngle(X_AXIS, -lean) // negative X rotation tips the top forward (-Z)
  const pelvis = v(0, hipY, 0)
  const up = (h: number) => add(pelvis, qRotate(torso, v(0, h, 0)))
  const stomachH = PART_SIZES.stomach.y
  const chestH = PART_SIZES.chest.y
  model.push({ name: 'stomach', center: up(stomachH), half: PART_SIZES.stomach, rotation: torso })
  model.push({
    name: 'chest',
    center: up(2 * stomachH + chestH),
    half: PART_SIZES.chest,
    rotation: torso,
  })
  const neck = up(2 * stomachH + 2 * chestH + NECK)
  const headPitch = Math.max(-0.7, Math.min(0.7, pitch))
  const headRot = qMul(torso, qAxisAngle(X_AXIS, headPitch + lean))
  model.unshift({
    name: 'head',
    center: add(neck, qRotate(headRot, v(0, PART_SIZES.head.y, -0.01))),
    half: PART_SIZES.head,
    rotation: headRot,
  })

  // Gun and arms: the gun points where they aim, held at chest height in front; the right hand
  // on the grip, the left on the fore-end. Arms span shoulder → hand.
  const aim = qAxisAngle(X_AXIS, pitch)
  const aimDir = qRotate(aim, v(0, 0, -1))
  const shoulderY = 2 * stomachH + 2 * chestH - 0.06
  const pivot = up(shoulderY)
  const grip = add(pivot, qRotate(aim, v(0.1, -0.16, -0.3)))
  const fore = add(grip, add(scale(aimDir, 0.26), qRotate(aim, v(-0.06, 0.01, 0))))
  model.push({
    name: 'gun',
    center: add(grip, add(scale(aimDir, 0.12), qRotate(aim, v(0, 0.05, 0)))),
    half: PART_SIZES.gun,
    rotation: aim,
  })
  for (const [name, x, hand] of [
    ['armR', SHOULDER_X, grip],
    ['armL', -SHOULDER_X, fore],
  ] as const) {
    const shoulder = up(shoulderY + 0.02)
    const s = add(shoulder, qRotate(torso, v(x, 0, 0)))
    const span = sub(hand, s)
    const len = Math.max(0.2, length(span))
    model.push({
      name,
      center: lerpV(s, hand, 0.5),
      half: { ...PART_SIZES[name], y: len / 2 },
      rotation: qFromUp(scale(span, 1 / len)),
    })
  }

  // Model → world.
  const size = pose.scale ?? 1
  const world = qAxisAngle(Y_AXIS, pose.yaw)
  const origin = v(pose.x, pose.y, pose.z)
  return model.map((p) => ({
    name: p.name,
    center: add(origin, qRotate(world, scale(p.center, size))),
    half: scale(p.half, size),
    rotation: qMul(world, p.rotation),
  }))
}

/** Distance along a normalized ray to an oriented box, or -1 (slab test in box space). */
export function rayOrientedBox(
  ro: V3,
  rd: V3,
  part: { center: V3; half: V3; rotation: Quat },
): number {
  const inv = qConjugate(part.rotation)
  const o = qRotate(inv, sub(ro, part.center))
  const d = qRotate(inv, rd)
  let tMin = Number.NEGATIVE_INFINITY
  let tMax = Number.POSITIVE_INFINITY
  for (const axis of ['x', 'y', 'z'] as const) {
    const h = part.half[axis]
    if (Math.abs(d[axis]) < 1e-12) {
      if (o[axis] < -h || o[axis] > h) return -1
      continue
    }
    let t1 = (-h - o[axis]) / d[axis]
    let t2 = (h - o[axis]) / d[axis]
    if (t1 > t2) [t1, t2] = [t2, t1]
    tMin = Math.max(tMin, t1)
    tMax = Math.min(tMax, t2)
    if (tMin > tMax) return -1
  }
  if (tMax < 0) return -1
  return Math.max(tMin, 0)
}

export { IDENTITY as QUAT_IDENTITY }
