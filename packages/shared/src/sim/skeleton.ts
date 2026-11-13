/**
 * The animated body every player has: the same boxes are drawn on screen and used as hitboxes,
 * so what you see is exactly what you can hit — planted feet and swinging legs, arms holding the
 * gun (raised to the eye when aiming), the head tilting with the aim, knees bending in a crouch,
 * and each kind of zombie moving its own way. Pure math, identical on server and client.
 *
 * Model space: feet at the origin, facing -Z, +Y up, metres at body size 1 (office worker
 * proportions). World = translate(pos) · rotateY(yaw) · scale(size) · model.
 *
 * Every input is replicated state (or server time), never client-side smoothing: aim blends in
 * and out because the server eases `ads` itself, a landing dips because the server keeps a
 * fading `land`, a melee swing plays from `shotAge`, idle breathing runs on the server clock.
 * So the pose the server rewinds to for a hit test is the pose that was on the shooter's screen.
 */

import { ZombieKind } from '../modes.ts'
import { DEFAULT_MOVEMENT } from './movement-config.ts'
import { WEAPONS, WeaponId } from './weapons.ts'

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
  /** Walk cycle, 0–1 (one full cycle = two steps; see strideLength). */
  stride?: number
  /** Horizontal speed (m/s): how big the steps are. */
  speed?: number
  /** False in the air: legs tucked. */
  grounded?: boolean
  /** Body size (game rules: tiny people); 1 when omitted. */
  scale?: number
  /** Which way they move, relative to where they face (radians: 0 forward, +π/2 right). */
  moveDir?: number
  /** Vertical speed (m/s, up positive): a jump tucks the legs, a fall reaches them down. */
  vy?: number
  /** Landing impact 0–1: knees give and the body dips, fading out after touchdown. */
  land?: number
  /** Aiming down sights: 0 = hip … 1 = sights at the eye (the server eases it in and out). */
  ads?: number
  /** What's in their hands decides the hold (a rifle when omitted). */
  weapon?: WeaponId
  /** Seconds since they last fired or swung: recoil kick, melee swing, zombie claw swipe. */
  shotAge?: number
  /** How they move: 0 = a person, otherwise their ZombieKind. */
  gait?: number
  /** Server time (s): idle breathing and swaying, the same on every machine. */
  time?: number
  /** Per-body offset for that idle motion (the player id), so a horde doesn't sway in step. */
  seed?: number
  /** Lying down: 0 = up … 1 = flat on the ground. */
  prone?: number
  /** A slide: 1 just started … 0 over (0 = not sliding). */
  slide?: number
  /** Climbing onto a ledge: progress 0–1 (0 = not climbing), the ledge's height above the feet. */
  mantle?: number
  ledge?: number
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
const RUN_SPEED = 6.5
/** A hanging arm, shoulder to hand. */
const ARM = PART_SIZES.armR.y * 2
/** How far the hips turn towards a diagonal run while the shoulders stay on the aim. */
const HIP_TWIST = 0.5

// --- Tiny vector/quaternion helpers (no dependencies: this runs on the server too) -----------

const v = (x: number, y: number, z: number): V3 => ({ x, y, z })
const add = (a: V3, b: V3): V3 => v(a.x + b.x, a.y + b.y, a.z + b.z)
const sub = (a: V3, b: V3): V3 => v(a.x - b.x, a.y - b.y, a.z - b.z)
const scale = (a: V3, s: number): V3 => v(a.x * s, a.y * s, a.z * s)
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z
const length = (a: V3) => Math.hypot(a.x, a.y, a.z)
const lerpV = (a: V3, b: V3, t: number) => add(a, scale(sub(b, a), t))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
const clamp01 = (x: number) => clamp(x, 0, 1)
const smooth = (t: number) => t * t * (3 - 2 * t)
const TAU = Math.PI * 2

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

/** Normalized lerp between two rotations (short way round): plenty for blending holds. */
function qBlend(a: Quat, b: Quat, t: number): Quat {
  if (t <= 0) return a
  if (t >= 1) return b
  const s = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w < 0 ? -1 : 1
  const q = {
    x: lerp(a.x, b.x * s, t),
    y: lerp(a.y, b.y * s, t),
    z: lerp(a.z, b.z * s, t),
    w: lerp(a.w, b.w * s, t),
  }
  const n = Math.hypot(q.x, q.y, q.z, q.w)
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n }
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
const Z_AXIS = v(0, 0, 1)
/** Pitch (+ tips the front up), yaw (+ turns left) and roll (+ tips the top left). */
const rx = (a: number) => qAxisAngle(X_AXIS, a)
const ry = (a: number) => qAxisAngle(Y_AXIS, a)
const rz = (a: number) => qAxisAngle(Z_AXIS, a)

/** Integer hash → 0–1 (no Math.sin: bit-identical on every JS engine). */
function hash01(n: number): number {
  let h = Math.imul(n | 0, 0x9e3779b1) ^ 0x5bd1e995
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** -1…1 that holds still, then snaps to a new value `rate` times a second: a twitch. */
function twitch(time: number, rate: number, seed: number): number {
  const x = time * rate + seed * 7.31
  const i = Math.floor(x)
  const snap = smooth(clamp01((x - i) * 5)) // the jerk takes a fifth of the hold
  return lerp(hash01(i - 1 + seed * 131), hash01(i + seed * 131), snap) * 2 - 1
}

/** Two-bone IK: the knee (or elbow) for a hip → foot reach, bending towards `pole`. */
function solveLimb(root: V3, target: V3, pole: V3): { mid: V3; end: V3 } {
  let d = sub(target, root)
  let dist = length(d)
  const reach = 2 * SEGMENT * 0.999
  if (dist > reach) {
    d = scale(d, reach / dist)
    dist = reach
  }
  dist = Math.max(dist, 0.05)
  const dir = scale(d, 1 / length(d))
  let perp = sub(pole, scale(dir, dot(pole, dir)))
  const pl = length(perp)
  perp = pl < 1e-6 ? v(0, 0, -1) : scale(perp, 1 / pl)
  const a = Math.acos(clamp(dist / (2 * SEGMENT), -1, 1))
  const mid = add(root, scale(add(scale(dir, Math.cos(a)), scale(perp, Math.sin(a))), SEGMENT))
  return { mid, end: add(root, scale(dir, dist)) }
}

// --- Gaits and holds ---------------------------------------------------------------------------

/** How a kind of body moves (people, and each kind of the dead). */
interface Gait {
  /** Forward stoop of the whole upper body (radians). */
  lean: number
  /** Knees always this bent (0–1, like crouching). */
  crouch: number
  /** Extra half-width of the stance (m). */
  width: number
  /** Foot lift on the swing (× a person's). */
  lift: number
  /** One leg drags (0–1): late, low steps and a dip onto it. */
  limp: number
  /** Up-and-down bob per step (× a person's). */
  bob: number
  /** Shoulders roll side to side over the standing leg (radians). */
  roll: number
  /** Hips swing round with each step (× a person's). */
  twist: number
  /** Ground covered per walk cycle (× a person's): short shuffles to big lumbering strides. */
  step: number
  /** Swaying while standing (radians). */
  sway: number
  /** Sudden jerks of the head and arms (0–1). */
  twitch: number
  /** Head rolling loose on the neck (radians); `droop` hangs (−) or throws back (+) the head. */
  loll: number
  droop: number
  /** Head pushed forward of the shoulders (m). */
  jut: number
  /** What the arms do with nothing in the hands. */
  arms: 'swing' | 'reach' | 'flail' | 'heavy' | 'twitch' | 'stalk'
}

const PERSON: Gait = {
  lean: 0,
  crouch: 0,
  width: 0,
  lift: 1,
  limp: 0,
  bob: 1,
  roll: 0,
  twist: 1,
  step: 1,
  sway: 0,
  twitch: 0,
  loll: 0,
  droop: 0,
  jut: 0,
  arms: 'swing',
}

const GAITS: Record<number, Gait> = {
  0: PERSON,
  // A shamble: stooped, one leg dragging, arms reaching out ahead, head lolling.
  [ZombieKind.Walker]: {
    ...PERSON,
    lean: 0.22,
    crouch: 0.06,
    width: 0.03,
    lift: 0.45,
    limp: 0.8,
    bob: 1.4,
    roll: 0.07,
    twist: 0.6,
    step: 0.8,
    sway: 0.07,
    loll: 0.3,
    droop: -0.25,
    jut: 0.05,
    arms: 'reach',
  },
  // A frantic sprint: pitched forward, knees high, arms flailing.
  [ZombieKind.Runner]: {
    ...PERSON,
    lean: 0.38,
    crouch: 0.1,
    width: 0.02,
    lift: 1.3,
    bob: 1.2,
    roll: 0.05,
    twist: 1.3,
    sway: 0.04,
    twitch: 0.3,
    loll: 0.12,
    droop: -0.1,
    jut: 0.06,
    arms: 'flail',
  },
  // A heavy lumber: wide, slow, long steps; shoulders rolling; arms hanging like weights.
  [ZombieKind.Brute]: {
    ...PERSON,
    lean: 0.15,
    crouch: 0.12,
    width: 0.09,
    lift: 0.6,
    bob: 1.8,
    roll: 0.16,
    twist: 0.5,
    step: 1.25,
    sway: 0.05,
    loll: 0.1,
    droop: -0.15,
    jut: 0.04,
    arms: 'heavy',
  },
  // Never still: jerking head and arms, head thrown back to scream.
  [ZombieKind.Screamer]: {
    ...PERSON,
    lean: 0.05,
    lift: 0.8,
    limp: 0.2,
    roll: 0.06,
    step: 0.9,
    sway: 0.06,
    twitch: 1,
    loll: 0.15,
    droop: 0.15,
    arms: 'twitch',
  },
  // A predator's crouch-stalk: low, bent double, head up, hands out ahead.
  [ZombieKind.Stalker]: {
    ...PERSON,
    lean: 0.45,
    crouch: 0.45,
    width: 0.05,
    lift: 0.7,
    bob: 0.5,
    roll: 0.04,
    twist: 0.7,
    step: 0.85,
    sway: 0.03,
    twitch: 0.1,
    loll: 0.05,
    arms: 'stalk',
  },
}

const gaitOf = (gait: number | undefined): Gait => GAITS[gait ?? 0] ?? PERSON

/**
 * Metres one full walk cycle (two steps) covers at `speed`: longer strides the faster you go,
 * bigger bodies and lumbering gaits take bigger ones. The server advances `stride` by this, and
 * the pose sizes its steps by it, so feet stay planted on the ground while they're down.
 */
export function strideLength(speed: number, size = 1, gait = 0): number {
  return clamp(1.4 + 0.12 * speed, 1.5, 2.3) * size * gaitOf(gait).step
}

/** Movement direction relative to facing (radians, 0 = forward, +π/2 = right) from a velocity. */
export function moveDirection(yaw: number, vx: number, vz: number): number {
  // Into model space (rotate by -yaw), then the angle from -Z towards +X.
  const mx = vx * Math.cos(yaw) - vz * Math.sin(yaw)
  const mz = vx * Math.sin(yaw) + vz * Math.cos(yaw)
  return Math.abs(mx) + Math.abs(mz) < 1e-6 ? 0 : Math.atan2(mx, -mz)
}

/**
 * Seconds since the last shot between two samples: grows steadily, then snaps back to 0 when a
 * new shot lands between them (take the new one only once we're past halfway, like a flag).
 */
export function blendShotAge(a: number, b: number, t: number): number {
  return b >= a ? a + (b - a) * t : t < 0.5 ? a : b
}

type Hold = 'rifle' | 'pistol' | 'melee' | 'melee2' | 'hands'
/** Long melee weapons are swung with both hands. */
const TWO_HANDED: ReadonlySet<number> = new Set([
  WeaponId.Bat,
  WeaponId.Axe,
  WeaponId.Sledge,
  WeaponId.Katana,
])

function holdOf(weapon: WeaponId | undefined): Hold {
  const def = weapon === undefined ? undefined : WEAPONS[weapon]
  if (!def) return 'rifle'
  if (def.look === WeaponId.Claws) return 'hands'
  if (def.slot === 'melee') return TWO_HANDED.has(def.id) ? 'melee2' : 'melee'
  return def.look === WeaponId.Handgun ? 'pistol' : 'rifle'
}

/** A key pose of a swing: hand offset from the gun pivot, and which way the blade points. */
interface SwingKey {
  at: V3
  rot: Quat
  /** Shoulders turned into the swing (radians). */
  turn: number
}

const MELEE_KEYS: Record<'melee' | 'melee2', [rest: SwingKey, windup: SwingKey, strike: SwingKey]> =
  {
    // One hand: blade forward at the hip; a quick backhand cocked over the shoulder, slashed across.
    melee: [
      { at: v(0.2, -0.28, -0.25), rot: rx(0.5), turn: 0 },
      { at: v(0.3, 0.12, 0.02), rot: qMul(ry(-0.4), rx(1.9)), turn: -0.35 },
      { at: v(-0.12, -0.2, -0.5), rot: qMul(ry(0.7), rx(-0.4)), turn: 0.4 },
    ],
    // Both hands: held up across the chest; raised back over the shoulder, brought down hard.
    melee2: [
      { at: v(0.12, -0.3, -0.25), rot: qMul(ry(0.35), rx(1.05)), turn: 0 },
      { at: v(0.22, 0.1, 0.05), rot: qMul(ry(-0.5), rx(2.4)), turn: -0.45 },
      { at: v(-0.05, -0.25, -0.48), rot: qMul(ry(0.5), rx(-0.3)), turn: 0.5 },
    ],
  }

/** Where a swing is `u` (0–1) of the way through: snap up, strike, slow recovery. */
function swingAt(keys: [SwingKey, SwingKey, SwingKey], u: number): SwingKey {
  const [rest, windup, strike] = keys
  const mix = (a: SwingKey, b: SwingKey, t: number): SwingKey => ({
    at: lerpV(a.at, b.at, t),
    rot: qBlend(a.rot, b.rot, t),
    turn: lerp(a.turn, b.turn, t),
  })
  if (u >= 1) return rest
  if (u < 0.12) return mix(rest, windup, smooth(u / 0.12))
  if (u < 0.35) return mix(windup, strike, smooth((u - 0.12) / 0.23))
  return mix(strike, rest, smooth((u - 0.35) / 0.65))
}

// --- The pose ---------------------------------------------------------------------------------

/**
 * A 0–1 progress that only runs one way (`dir` +1 up, −1 down) between two samples: running the
 * other way means one ended or a new one began, so snap past halfway instead of playing it back.
 */
export function blendProgress(a: number, b: number, t: number, dir: 1 | -1): number {
  return (b - a) * dir >= 0 ? a + (b - a) * t : t < 0.5 ? a : b
}

/** How deep into a slide's pose (0–1): drops in quickly, rises as the slide runs out. */
const slideWeightOf = (slide: number) =>
  slide > 0 ? clamp01(Math.min((1 - slide) * 7, slide * 4.5)) : 0

type ModelPart = { name: PartName; center: V3; half: V3; rotation: Quat }

/**
 * Every part of a body in this pose, in world space. Order: head first (it wins ties when a
 * shot grazes two parts), the gun among the rest (drawn, never hit).
 */
export function bodyParts(pose: BodyPose): BodyPart[] {
  let model = upright(pose)
  // Lying down: blend each part from the (crouched) upright pose to flat on the ground.
  const flat = smooth(clamp01(pose.prone ?? 0))
  if (flat > 0) {
    const lying = new Map(proneModel(pose).map((p) => [p.name, p]))
    model = model.map((p) => {
      const q = lying.get(p.name)
      if (!q) return p
      return {
        name: p.name,
        center: lerpV(p.center, q.center, flat),
        half: lerpV(p.half, q.half, flat),
        rotation: qBlend(p.rotation, q.rotation, flat),
      }
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

/** The pose on your feet (standing, running, crouching, jumping, sliding, climbing). */
function upright(pose: BodyPose): ModelPart[] {
  const g = gaitOf(pose.gait)
  const person = g === PERSON
  const hold = holdOf(pose.weapon)
  const gun = hold === 'rifle' || hold === 'pistol'
  const crouchIn = clamp01(pose.crouch)
  const crouch = Math.min(1, crouchIn + g.crouch)
  const pitch = pose.pitch ?? 0
  const speed = pose.speed ?? 0
  const grounded = pose.grounded ?? true
  const air = grounded ? 0 : 1
  const vy = pose.vy ?? 0
  const land = clamp01(pose.land ?? 0)
  const ads = gun ? clamp01(pose.ads ?? 0) : 0
  const shotAge = Math.max(0, pose.shotAge ?? 1)
  const md = pose.moveDir ?? 0
  const fwd = Math.cos(md)
  const side = Math.sin(md)
  const phase = (((pose.stride ?? 0) % 1) + 1) % 1
  const time = pose.time ?? 0
  const seed = pose.seed ?? 0
  const model: ModelPart[] = []
  // Sliding: low, leaning back, the leading leg out and a hand on the floor. Climbing: hands on
  // the ledge, leaning over them (the legs tuck as in a jump: they're off the ground).
  const slid = slideWeightOf(pose.slide ?? 0)
  const climb = clamp01(pose.mantle ?? 0)
  const climbing = climb > 0 ? clamp01(Math.min(climb * 10, (1 - climb) * 4)) : 0
  const ledge = (pose.ledge ?? 0) / (pose.scale ?? 1) // model space

  // How much of each motion: the step cycle (fades in from a standstill), a run's style (longer
  // flight, higher knees), a sprint's gun carry, and idling.
  const move = grounded ? clamp01(speed / 1.5) : 0
  const run = clamp01((speed - 3) / (RUN_SPEED - 3))
  const idle = 1 - move
  const walkSpeed =
    DEFAULT_MOVEMENT.walkSpeed * (WEAPONS[pose.weapon ?? WeaponId.Rifle]?.moveSpeedFactor ?? 1)
  const sprint =
    gun && person
      ? clamp01((speed / walkSpeed - 1.1) / 0.15) * (1 - ads) * (1 - air) * (1 - slid)
      : 0
  const breath = Math.sin((time * TAU) / 3.8 + seed)
  const jerk = g.twitch

  // --- Legs: each foot is placed, then the knee solved (IK) -----------------------------------
  // A foot is down for the first `stanceShare` of its cycle, sliding back under the hips exactly
  // as fast as the body moves (it stays planted), then lifts and swings forward. Walking feet are
  // down most of the time; running ones mostly in the air. The legs swing along the movement
  // direction: forward, backpedalling, sidestepping; on diagonals the hips turn into the run.
  const stanceShare = clamp(0.62 - 0.045 * speed, 0.32, 0.62)
  let hipY =
    HIP_Y -
    CROUCH_DROP * crouch -
    move * (0.04 + 0.03 * run) * (1 - crouch) -
    0.18 * land +
    // Walking rises over the standing leg; running sinks into it and floats between steps.
    -move * (0.018 + 0.03 * run) * g.bob * Math.cos(2 * TAU * (phase - (run * stanceShare) / 2))
  const legPhase = (s: -1 | 1) => (phase + (s < 0 ? 0 : 0.5)) % 1
  // The dragging (right) leg: the body dips onto it.
  const rightStance =
    legPhase(1) < stanceShare ? Math.sin((Math.PI * legPhase(1)) / stanceShare) : 0
  hipY -= g.limp * 0.04 * move * rightStance
  hipY = lerp(hipY, 0.42, slid)
  const reach = 2 * SEGMENT * 0.995
  const maxStep = Math.sqrt(Math.max(0.0025, reach * reach - hipY * hipY)) * 1.1
  const halfStep =
    Math.min(maxStep, (stanceShare * strideLength(speed, 1, pose.gait ?? 0)) / 2) * move
  const twist = HIP_TWIST * Math.sin(2 * md) * move // diagonals: hips turn into the run
  const hipSwing = -0.13 * g.twist * move * Math.cos(TAU * phase) // hip forward with its foot
  const pelvisYaw = twist + hipSwing
  // Weight over the standing foot, and idle weight shifts.
  const shift =
    -0.025 * move * (1 + g.roll * 4) * Math.sin(TAU * phase) +
    idle * (person ? 0.012 : g.sway * 0.25) * Math.sin((time * TAU) / 7.5 + seed * 2.1)
  const pelvis = v(shift, hipY, 0)
  const pelvisRot = ry(pelvisYaw)
  const rise = clamp01((vy + 1.5) / 4) // jumping up 1 … falling 0
  /** How far forward each foot is (−1 back … 1 front), smoothed for the opposite arm's swing. */
  const forwardness: Record<'L' | 'R', number> = { L: 0, R: 0 }

  for (const s of [-1, 1] as const) {
    const L = s < 0 ? 'L' : 'R'
    const lp = legPhase(s)
    const drag = s > 0 ? g.limp : 0
    let along: number // −1 behind … 1 ahead, along the movement
    let lift = 0
    if (lp < stanceShare) {
      along = 1 - (2 * lp) / stanceShare
      forwardness[L] = Math.cos((Math.PI * lp) / stanceShare)
    } else {
      const u = (lp - stanceShare) / (1 - stanceShare)
      along = -1 + 2 * smooth(u ** (1 + drag)) // a dragged leg lags, then catches up
      // Running feet kick up behind first; walking feet lift mid-swing.
      lift = Math.sin(Math.PI * u ** (1 / (1 + 0.6 * run))) * (0.09 + 0.17 * run) * g.lift
      lift *= 1 - 0.8 * drag
      forwardness[L] = -Math.cos(Math.PI * u)
    }
    const step = along * halfStep
    const lane = qRotate(
      ry(twist),
      v(s * (HIP_X + 0.01 + g.width), 0, (s < 0 ? -0.1 : 0.12) * crouchIn * idle),
    )
    let foot = v(lane.x + side * step * 0.8, 0.02 + lift * move, lane.z - fwd * step)
    if (s * foot.x < 0.05) foot.x = s * 0.05 // sidestepping feet don't cross
    if (!grounded) {
      // Jumping: one knee up, the other trailing; falling: both reach down for the floor.
      const up = s < 0 ? v(0, 0.42, 0.02) : v(0, 0.16, 0.2)
      const down = s < 0 ? v(0, 0.1, -0.12) : v(0, 0.16, 0.08)
      const tuck = lerpV(down, up, rise)
      foot = v(lane.x, tuck.y + 0.2 * crouchIn, tuck.z)
      foot.y = Math.min(foot.y, hipY - 0.2)
    }
    let pole = qRotate(ry(twist), v(s * (0.12 + g.width * 4), 0, -1))
    if (slid > 0) {
      // Left leg out ahead (knee soft, bending up), right folded under (knee forward).
      foot = lerpV(foot, s < 0 ? v(-0.12, 0.06, -0.72) : v(0.17, 0.05, 0.22), slid)
      pole = lerpV(pole, s < 0 ? v(0, 1, 0) : v(0.3, -0.3, -1), slid)
    }
    const hip = add(pelvis, qRotate(pelvisRot, v(s * HIP_X, 0, 0)))
    const { mid: knee, end } = solveLimb(hip, foot, pole)
    model.push({
      name: `thigh${L}`,
      center: lerpV(hip, knee, 0.5),
      half: PART_SIZES[`thigh${L}`],
      rotation: qFromUp(scale(sub(hip, knee), 1 / SEGMENT)),
    })
    model.push({
      name: `shin${L}`,
      center: lerpV(knee, end, 0.5),
      half: PART_SIZES[`shin${L}`],
      rotation: qFromUp(scale(sub(knee, end), 1 / Math.max(1e-6, length(sub(knee, end))))),
    })
  }

  // --- Melee swings and claw swipes (from the replicated time since the last swing) ----------
  const def = WEAPONS[pose.weapon ?? WeaponId.Rifle]
  const swingTime = Math.min(0.5, (def?.fireInterval ?? 0.5) * 0.8)
  const swingU = hold === 'hands' ? shotAge / 0.55 : shotAge / swingTime
  const swinging = hold !== 'rifle' && hold !== 'pistol' && swingU < 1
  const swing =
    hold === 'melee' || hold === 'melee2'
      ? swingAt(MELEE_KEYS[hold], swingU)
      : { at: v(0, 0, 0), rot: IDENTITY, turn: 0 }
  // Claws: how far into the strike (0 → 1 → 0), for the lunge.
  const strike =
    hold === 'hands' && swinging ? Math.sin(Math.PI * clamp01((swingU - 0.05) / 0.6)) : 0
  const recoil = gun && shotAge < 0.14 ? (1 - shotAge / 0.14) ** 2 : 0
  const kick = clamp(0.5 + (def?.kickPitch ?? 1) * 0.15, 0.5, 1.5) * recoil

  // --- Upper body ----------------------------------------------------------------------------
  // Stomach on the hips, chest above. Leans: into the crouch and the aim (looking down bends you
  // over a bit), into the run (back when backpedalling), into a landing, into the sights; banks
  // into a sidestep; the dead stoop, sway and lunge.
  const zombieSway = (1 - 0.5 * move) * g.sway
  const lean =
    0.25 * crouchIn +
    clamp(-pitch * 0.2, -0.15, 0.2) +
    g.lean +
    move * fwd * (0.03 + 0.12 * run) +
    0.28 * land +
    0.05 * ads * (hold === 'rifle' ? 1 : 0.4) +
    0.06 * sprint +
    air * clamp(-vy * 0.02, -0.06, 0.08) +
    0.6 * zombieSway * Math.sin(time * 0.53 + seed * 1.7) +
    0.22 * strike -
    0.04 * kick -
    0.55 * slid +
    0.45 * climbing * Math.sin(Math.PI * climb)
  const roll =
    0.15 * slid +
    -side * move * (0.02 + 0.06 * run) +
    g.roll * move * Math.sin(TAU * phase) -
    g.limp * 0.08 * move * rightStance +
    zombieSway * Math.sin(time * 0.8 + seed) +
    0.05 * jerk * twitch(time, 2.5, seed + 3)
  const torso = qMul(rx(-lean), rz(roll)) // negative X rotation tips the top forward (-Z)
  const armsFree = hold === 'rifle' || hold === 'melee2' ? 0.3 : 1
  const stomachYaw = 0.5 * pelvisYaw
  const chestYaw =
    -0.6 * hipSwing * armsFree + // shoulders swing against the hips
    -0.22 * ads * (hold === 'rifle' ? 1 : 0) + // bladed behind a long gun
    swing.turn +
    0.3 * strike
  const stomachRot = qMul(torso, ry(stomachYaw))
  const chestRot = qMul(torso, ry(chestYaw))
  const up = (h: number) => add(pelvis, qRotate(torso, v(0, h, 0)))
  const stomachH = PART_SIZES.stomach.y
  const chestH = PART_SIZES.chest.y
  model.push({
    name: 'stomach',
    center: up(stomachH),
    half: PART_SIZES.stomach,
    rotation: stomachRot,
  })
  model.push({
    name: 'chest',
    center: add(up(2 * stomachH + chestH), qRotate(torso, v(0, 0.006 * breath * idle, 0))),
    half: PART_SIZES.chest,
    rotation: chestRot,
  })

  // Head: stays on the aim (it doesn't stoop with the body); tilts onto the stock when aiming a
  // long gun; the dead loll, hang, twitch and throw it back to scream.
  const scream = g.arms === 'twitch' ? smooth(clamp01(Math.sin(time * 0.5 + seed) * 3 - 2)) : 0
  const neck = add(up(2 * stomachH + 2 * chestH + NECK), qRotate(torso, v(0, 0, -g.jut)))
  const headPitch =
    clamp(pitch + g.droop, -0.75, 0.75) -
    0.07 * ads * (hold === 'rifle' ? 1 : 0.4) -
    0.15 * land +
    0.5 * scream
  const headRoll =
    -0.18 * ads * (hold === 'rifle' ? 1 : 0.25) +
    g.loll * Math.sin(time * 1.1 + seed) +
    0.35 * jerk * twitch(time, 1.7, seed)
  const headYaw =
    0.6 * g.loll * Math.sin(time * 0.63 + seed * 2) + 0.3 * jerk * twitch(time, 1.3, seed + 9)
  const headRot = qMul(ry(headYaw), qMul(rx(headPitch), rz(headRoll)))
  model.unshift({
    name: 'head',
    center: add(neck, qRotate(headRot, v(0, PART_SIZES.head.y, -0.01))),
    half: PART_SIZES.head,
    rotation: headRot,
  })
  const eye = add(neck, v(0, PART_SIZES.head.y + 0.02, 0))

  // --- Hands and what's in them --------------------------------------------------------------
  const shoulderY = 2 * stomachH + 2 * chestH - 0.06
  const pivot = up(shoulderY)
  const shoulder = (s: -1 | 1) => {
    const heave = g.roll * move * Math.sin(TAU * phase) * s * 0.2 // brute: shoulders heave
    return add(
      add(up(shoulderY + 0.02), qRotate(chestRot, v(s * SHOULDER_X, 0, 0))),
      v(0, heave, 0),
    )
  }
  const aim = rx(pitch)

  /**
   * A free arm: swings against the opposite leg along the movement (none when sidestepping),
   * elbow bending as they run; out for balance in the air and on landing; breathing at rest.
   */
  const freeHand = (s: -1 | 1): V3 => {
    const opposite = forwardness[s < 0 ? 'R' : 'L']
    const bend = 0.25 * run * move
    const swingAngle =
      move * fwd * opposite * (0.3 + 0.6 * run) +
      0.06 +
      air * (0.35 + 0.25 * (1 - rise)) +
      0.3 * land +
      0.02 * breath * idle
    const out = 0.07 + 0.3 * air + 0.15 * land
    const dir = qRotate(rx(swingAngle + bend * 0.8), v(s * out, -1, 0))
    return add(shoulder(s), qRotate(chestRot, scale(dir, (ARM * (1 - bend * 0.35)) / length(dir))))
  }

  let grip: V3
  let gunRot: Quat
  let handR: V3
  let handL: V3
  if (hold === 'rifle' || hold === 'pistol') {
    const rifle = hold === 'rifle'
    // Hip: rifle at chest height / pistol held out one-handed. Aimed: sights at the eye.
    // Sprinting: muzzle down across the body / pistol down by the hip.
    const hip = add(pivot, qRotate(aim, rifle ? v(0.1, -0.16, -0.3) : v(0.17, -0.18, -0.36)))
    const sights = add(eye, qRotate(aim, rifle ? v(0.06, -0.1, -0.26) : v(0.02, -0.07, -0.5)))
    const carry = add(pivot, rifle ? v(0.1, -0.24, -0.22) : v(0.2, -0.38, -0.12))
    const carryRot = rifle ? qMul(ry(0.55), rx(-0.6)) : rx(-1.2)
    grip = lerpV(lerpV(hip, carry, sprint), sights, ads)
    gunRot = qBlend(qBlend(aim, carryRot, sprint), aim, ads)
    grip = add(grip, v(0, 0.004 * breath * idle * (1 - ads), 0))
    // Recoil: shoved back into the shoulder, muzzle flips up (less when braced on the sights).
    grip = add(grip, qRotate(gunRot, v(0, 0, 0.05 * kick)))
    gunRot = qMul(gunRot, rx(0.12 * kick * (1 - 0.5 * ads)))
    handR = grip
    // Support hand: on the fore-end of a long gun; a pistol's cups the grip once aimed.
    handL = rifle
      ? add(grip, qRotate(gunRot, v(-0.06, 0.01, -0.26)))
      : lerpV(freeHand(-1), add(grip, qRotate(gunRot, v(-0.035, -0.035, 0.03))), ads)
  } else if (hold === 'melee' || hold === 'melee2') {
    // Swings follow the look a little (a swing at the floor dips).
    const look = rx(pitch * 0.5)
    grip = add(pivot, qRotate(look, swing.at))
    gunRot = qMul(look, swing.rot)
    grip = add(grip, v(0, 0.004 * breath * idle, 0))
    handR = grip
    // Two hands on a long handle: the left below the right.
    handL = hold === 'melee2' ? add(grip, qRotate(gunRot, v(0, 0, 0.1))) : freeHand(-1)
  } else {
    // Empty hands: a person's swing; the dead reach, flail, hang, twitch or stalk.
    const deadHand = (s: -1 | 1): V3 => {
      const sh = shoulder(s)
      const opposite = forwardness[s < 0 ? 'R' : 'L']
      const t = time + seed
      let at: V3
      switch (g.arms) {
        case 'reach': {
          // Out ahead at chest height, one arm hanging lower, both swaying with the steps.
          const droop = s > 0 ? 0.12 : 0
          const sway = 0.05 * move * opposite + 0.03 * Math.sin(t * 1.3 + s)
          at = v(s * -0.04, -0.12 - droop + sway, -0.5)
          break
        }
        case 'flail': {
          // Pumping and thrashing: big arcs with the stride, flung out wide.
          const a = move * 1.3 * opposite * Math.max(0.3, fwd) + 0.45 + 0.3 * twitch(t, 4, s)
          at = qRotate(rx(a), v(s * 0.18, -0.5, 0))
          break
        }
        case 'heavy': {
          // Hanging like weights, swinging slow and wide.
          const a = 0.45 * move * opposite * fwd + 0.15 + 0.05 * Math.sin(t * 0.7 + s)
          at = qRotate(rx(a), v(s * 0.16, -0.6, 0))
          break
        }
        case 'twitch': {
          // Half raised, jerking; flung out and back to scream.
          const j = 0.08 * twitch(t, 3.1, s * 5)
          const ready = v(s * 0.2 + j, -0.32 + j, -0.28)
          at = lerpV(ready, v(s * 0.38, -0.25, 0.12), scream)
          if (move > 0) at = add(at, v(0, 0, -0.12 * move * opposite))
          break
        }
        case 'stalk': {
          // Low and forward, pawing ahead in time with the steps.
          at = v(s * 0.06, -0.42, -0.3 - 0.1 * move * opposite)
          break
        }
        default:
          return freeHand(s)
      }
      // Claws: cocked up and back, then raked forward and down across (the left a beat later).
      if (swinging) {
        const u = clamp01(swingU - (s < 0 ? 0.12 : 0))
        const cocked = v(s * 0.25, 0.25, 0.05)
        const raked = v(-s * 0.15, -0.2, -0.68)
        const blow =
          u < 0.15
            ? lerpV(at, cocked, smooth(u / 0.15))
            : u < 0.4
              ? lerpV(cocked, raked, smooth((u - 0.15) / 0.25))
              : lerpV(raked, at, smooth((u - 0.4) / 0.6))
        at = lerpV(at, blow, s < 0 ? 0.6 : 1)
      }
      return add(sh, qRotate(chestRot, at))
    }
    handR = deadHand(1)
    handL = deadHand(-1)
    grip = handR
    gunRot = chestRot
  }

  if (slid > 0) handL = lerpV(handL, v(-0.38, 0.06, 0.05), slid) // a hand down on the floor
  if (climbing > 0) {
    // Both hands planted on the ledge's edge; the gun hangs from the right.
    handR = lerpV(handR, v(0.22, ledge, -0.42), climbing)
    handL = lerpV(handL, v(-0.22, ledge, -0.42), climbing)
    grip = lerpV(grip, handR, climbing)
    gunRot = qBlend(gunRot, qMul(ry(-0.3), rx(-1.3)), climbing)
  }

  const gunDir = qRotate(gunRot, v(0, 0, -1))
  model.push({
    name: 'gun',
    center: add(grip, add(scale(gunDir, 0.12), qRotate(gunRot, v(0, 0.05, 0)))),
    half: PART_SIZES.gun,
    rotation: gunRot,
  })
  for (const [name, s, hand] of [
    ['armR', 1, handR],
    ['armL', -1, handL],
  ] as const) {
    const from = shoulder(s)
    const span = sub(hand, from)
    const len = Math.max(0.2, length(span))
    model.push({
      name,
      center: lerpV(from, hand, 0.5),
      half: { ...PART_SIZES[name], y: len / 2 },
      rotation: qFromUp(scale(span, 1 / len)),
    })
  }

  return model
}

/**
 * Flat on the ground, propped on the elbows, head up along the aim, legs straight back. Crawling
 * draws one knee up to the side, then the other, the hands (or the gun) inching forward.
 */
function proneModel(pose: BodyPose): ModelPart[] {
  const hold = holdOf(pose.weapon)
  const pitch = clamp(pose.pitch ?? 0, -0.35, 0.6)
  const speed = pose.speed ?? 0
  const move = clamp01(speed / 0.6)
  const phase = (((pose.stride ?? 0) % 1) + 1) % 1
  const shotAge = Math.max(0, pose.shotAge ?? 1)
  const breath = Math.sin(((pose.time ?? 0) * TAU) / 3.8 + (pose.seed ?? 0))
  const crawl = (s: -1 | 1) => move * Math.max(0, Math.sin(TAU * (phase + (s < 0 ? 0 : 0.5))))
  const model: ModelPart[] = []

  const pelvis = v(0, 0.14, 0.3)
  const torso = rx(-(Math.PI / 2 - 0.12)) // chest raised a little on the elbows
  const up = (h: number) => add(pelvis, qRotate(torso, v(0, h, 0)))
  const stomachH = PART_SIZES.stomach.y
  const chestH = PART_SIZES.chest.y

  for (const s of [-1, 1] as const) {
    const L = s < 0 ? 'L' : 'R'
    const k = crawl(s)
    const hip = v(s * HIP_X, pelvis.y, pelvis.z)
    const foot = v(s * (0.2 + 0.2 * k), 0.07, pelvis.z + 0.8 - 0.38 * k)
    const { mid: knee, end } = solveLimb(hip, foot, v(s, 0.15, 0)) // knees out to the side
    model.push({
      name: `thigh${L}`,
      center: lerpV(hip, knee, 0.5),
      half: PART_SIZES[`thigh${L}`],
      rotation: qFromUp(scale(sub(hip, knee), 1 / SEGMENT)),
    })
    model.push({
      name: `shin${L}`,
      center: lerpV(knee, end, 0.5),
      half: PART_SIZES[`shin${L}`],
      rotation: qFromUp(scale(sub(knee, end), 1 / Math.max(1e-6, length(sub(knee, end))))),
    })
  }
  model.push({ name: 'stomach', center: up(stomachH), half: PART_SIZES.stomach, rotation: torso })
  model.push({
    name: 'chest',
    center: add(up(2 * stomachH + chestH), v(0, 0.005 * breath, 0)),
    half: PART_SIZES.chest,
    rotation: torso,
  })
  const neck = up(2 * stomachH + 2 * chestH + NECK)
  const headRot = rx(pitch)
  model.unshift({
    name: 'head',
    center: add(neck, add(v(0, 0.06, -0.06), qRotate(headRot, v(0, 0.06, -0.04)))),
    half: PART_SIZES.head,
    rotation: headRot,
  })

  const shoulderY = 2 * stomachH + 2 * chestH - 0.04
  const shoulder = (s: -1 | 1) => add(up(shoulderY), qRotate(torso, v(s * SHOULDER_X, 0, 0)))
  const aim = rx(pitch)
  const inch = 0.04 * move * Math.sin(TAU * phase * 2) // the gun nudged forward with each pull
  let grip: V3
  let gunRot = aim
  let handR: V3
  let handL: V3
  const hand = (s: -1 | 1) =>
    add(shoulder(s), v(s * 0.1, -0.15, -0.3 - 0.22 * crawl(s < 0 ? 1 : -1)))
  if (hold === 'rifle' || hold === 'pistol') {
    // Rifle: stock in the shoulder, sights at the eye. Pistol: both hands out in front.
    grip = add(
      v(0.07, 0.2, -0.5 + inch),
      qRotate(aim, hold === 'rifle' ? v(0, 0, 0) : v(-0.05, 0.02, -0.2)),
    )
    const recoil = shotAge < 0.14 ? (1 - shotAge / 0.14) ** 2 : 0
    grip = add(grip, qRotate(aim, v(0, 0, 0.04 * recoil)))
    gunRot = qMul(aim, rx(0.08 * recoil))
    handR = grip
    handL =
      hold === 'rifle'
        ? add(grip, qRotate(gunRot, v(-0.06, 0.01, -0.26)))
        : add(grip, qRotate(gunRot, v(-0.035, -0.035, 0.03)))
  } else {
    // Knife or club along the ground in the right hand; otherwise both hands pulling forward.
    handR = hand(1)
    handL = hand(-1)
    grip = handR
    gunRot = hold === 'hands' ? torso : qMul(ry(0.3), rx(-0.1))
  }
  const gunDir = qRotate(gunRot, v(0, 0, -1))
  model.push({
    name: 'gun',
    center: add(grip, add(scale(gunDir, 0.12), qRotate(gunRot, v(0, 0.05, 0)))),
    half: PART_SIZES.gun,
    rotation: gunRot,
  })
  for (const [name, s, at] of [
    ['armR', 1, handR],
    ['armL', -1, handL],
  ] as const) {
    const from = shoulder(s)
    const span = sub(at, from)
    const len = Math.max(0.2, length(span))
    model.push({
      name,
      center: lerpV(from, at, 0.5),
      half: { ...PART_SIZES[name], y: len / 2 },
      rotation: qFromUp(scale(span, 1 / len)),
    })
  }
  return model
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
