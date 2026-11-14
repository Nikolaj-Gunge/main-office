import {
  type BodyPart,
  bodyParts,
  CAMP_FOLK,
  DAY_SECONDS,
  type FolkState,
  folkAt,
  gearLooks,
  PART_SIZES,
  planFolk,
  randomAppearance,
  type SurvivalDef,
  seeded,
  strideLength,
  WeaponId,
} from '@office-fps/shared'
import * as THREE from 'three'
import type { AudioEngine } from '../audio/audio-engine.ts'
import { Avatar } from './avatar.ts'

/**
 * Haven's townsfolk on screen (where they are comes from shared/survival/camp-folk.ts and the
 * time of day). Each is an ordinary avatar; the walking, guarding, chopping and hammering poses
 * are the players' own (skeleton.ts), and sitting, sawing, cooking, hanging washing and carrying
 * are built here from the same boxes. Only drawn near Haven; far ones are posed a few times a
 * second.
 */

/** Drawn within this of the camp's middle (m). */
const SHOW = 150
/** Posed every frame within this (m); beyond, four times a second. */
const ANIMATE = 60
/** How close you may stand before somebody walking steps round you (m). */
const ROOM = 0.7

const X = new THREE.Vector3(1, 0, 0)
const Y = new THREE.Vector3(0, 1, 0)
const UP = new THREE.Vector3(0, 1, 0)
const SHOULDER = 0.24

const quat = (q: THREE.Quaternion) => ({ x: q.x, y: q.y, z: q.z, w: q.w })
const toThree = (q: BodyPart['rotation']) => new THREE.Quaternion(q.x, q.y, q.z, q.w)
const vec = (p: BodyPart['center']) => new THREE.Vector3(p.x, p.y, p.z)

/** Integer hash → 0–1. */
function hash01(n: number): number {
  let h = Math.imul(n | 0, 0x9e3779b1) ^ 0x5bd1e995
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** A limb box between two joints: its +Y runs from `from` towards `to`. */
function limb(name: BodyPart['name'], from: THREE.Vector3, to: THREE.Vector3): BodyPart {
  const span = to.clone().sub(from)
  const len = Math.max(0.05, span.length())
  const q = new THREE.Quaternion().setFromUnitVectors(UP, span.divideScalar(len))
  const mid = from.clone().lerp(to, 0.5)
  return {
    name,
    center: { x: mid.x, y: mid.y, z: mid.z },
    half:
      name === 'armL' || name === 'armR' ? { ...PART_SIZES[name], y: len / 2 } : PART_SIZES[name],
    rotation: quat(q),
  }
}

/** Replaces the arms with ones reaching for these hands (model space). */
function reach(parts: BodyPart[], left: THREE.Vector3, right: THREE.Vector3): BodyPart[] {
  const chest = parts.find((p) => p.name === 'chest')
  if (!chest) return parts
  const rot = toThree(chest.rotation)
  const shoulder = (s: number) =>
    vec(chest.center).add(new THREE.Vector3(s * SHOULDER, 0.12, 0).applyQuaternion(rot))
  return parts.map((p) =>
    p.name === 'armL'
      ? limb('armL', shoulder(-1), left)
      : p.name === 'armR'
        ? limb('armR', shoulder(1), right)
        : p,
  )
}

/** Turns the head (radians, + left) on the neck. */
function turnHead(parts: BodyPart[], look: number): BodyPart[] {
  if (look === 0) return parts
  const turn = new THREE.Quaternion().setFromAxisAngle(Y, look)
  return parts.map((p) =>
    p.name === 'head' ? { ...p, rotation: quat(turn.multiply(toThree(p.rotation))) } : p,
  )
}

/**
 * Sitting on a seat `seat` m high, leaning in by `lean`: the standing body lowered onto the seat,
 * thighs out level, shins down to the ground. Arms are left for the caller.
 */
function sitting(stand: BodyPart[], seat: number, lean: number): BodyPart[] {
  const hipY = seat + 0.09
  const hip0 = new THREE.Vector3(0, 0.86, 0)
  const hip = new THREE.Vector3(0, hipY, 0.05)
  const tip = new THREE.Quaternion().setFromAxisAngle(X, -lean)
  const out: BodyPart[] = []
  for (const p of stand) {
    if (p.name.startsWith('thigh') || p.name.startsWith('shin')) continue
    const c = vec(p.center).sub(hip0).applyQuaternion(tip).add(hip)
    out.push({
      ...p,
      center: { x: c.x, y: c.y, z: c.z },
      rotation: quat(tip.clone().multiply(toThree(p.rotation))),
    })
  }
  const kneeY = Math.min(hipY + 0.04, 0.5)
  for (const s of [-1, 1] as const) {
    const L = s < 0 ? 'L' : 'R'
    const h = new THREE.Vector3(s * 0.11, hipY, 0.05)
    const knee = h.clone().add(new THREE.Vector3(s * 0.04, kneeY - hipY, -0.4).setLength(0.42))
    const down = Math.min(1, Math.max(0, (knee.y - 0.04) / 0.42))
    const foot = knee
      .clone()
      .add(new THREE.Vector3(s * 0.02, -0.42 * down, -0.42 * Math.sqrt(1 - down * down)))
    // Thighs and shins point their +Y up the leg (as the skeleton's do).
    out.push(limb(`thigh${L}`, knee, h), limb(`shin${L}`, foot, knee))
  }
  return out
}

/** A body's parts in model space (feet at the origin, facing −Z), and what's in its hands. */
function modelPose(
  st: FolkState,
  rifle: boolean,
  t: number,
  seed: number,
  night: boolean,
  look: number,
): { parts: BodyPart[]; weapon: WeaponId } {
  const base = {
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    crouch: 0,
    time: t,
    seed,
  }
  const still = (weapon: WeaponId, pitch = 0, shotAge = 1) =>
    bodyParts({ ...base, weapon, pitch, shotAge })
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
  const wave = (rate: number) => Math.sin(t * rate + seed)
  switch (st.doing) {
    case 'walk': {
      const walking = bodyParts({
        ...base,
        weapon: rifle ? WeaponId.Rifle : WeaponId.Claws,
        pitch: rifle ? -0.35 : 0,
        speed: st.speed,
        stride: st.walked / strideLength(st.speed),
      })
      if (!st.carrying) return { parts: walking, weapon: rifle ? WeaponId.Rifle : WeaponId.Claws }
      return {
        parts: reach(walking, v(-0.2, 1.0, -0.3), v(0.2, 1.0, -0.3)),
        weapon: WeaponId.Claws,
      }
    }
    case 'guard':
      return { parts: turnHead(still(WeaponId.Rifle, -0.35), look), weapon: WeaponId.Rifle }
    case 'chop':
      // The axe comes down on the block every second and a half.
      return { parts: still(WeaponId.Axe, -0.5, (t + seed) % 1.5), weapon: WeaponId.Axe }
    case 'hammer':
      return { parts: still(WeaponId.Crowbar, -0.7, (t + seed) % 0.8), weapon: WeaponId.Crowbar }
    case 'saw': {
      const stroke = 0.12 * Math.sin(t * 7 + seed)
      return {
        parts: reach(
          still(WeaponId.Claws, -0.6),
          v(-0.22, 0.95, -0.42),
          v(0.14, 0.98, -0.45 + stroke),
        ),
        weapon: WeaponId.Claws,
      }
    }
    case 'cook': {
      // Stirring the pot, round and round.
      const a = t * 2.5 + seed
      return {
        parts: reach(
          still(WeaponId.Claws, -0.5),
          v(-0.2, 0.98, -0.38),
          v(0.12 + 0.07 * Math.cos(a), 1.02, -0.45 + 0.07 * Math.sin(a)),
        ),
        weapon: WeaponId.Claws,
      }
    }
    case 'laundry': {
      // Reaching up to the line, a hand at a time.
      const up = wave(1.6)
      return {
        parts: reach(
          still(WeaponId.Claws, 0.4),
          v(-0.22, 1.62 + 0.14 * up, -0.38),
          v(0.22, 1.62 - 0.14 * up, -0.38),
        ),
        weapon: WeaponId.Claws,
      }
    }
    case 'sit': {
      // Chatting, now and then talking with a hand; at night mostly warming their hands.
      const beat = Math.floor((t + seed * 3) / 6)
      const talking = hash01(beat * 31 + seed) < 0.3
      const warming = night && !talking && hash01(Math.floor((t + seed) / 15) + seed * 7) < 0.7
      const lean = warming ? 0.3 : 0.12
      const seated = sitting(still(WeaponId.Claws), st.seat, lean)
      const hipY = st.seat + 0.09
      let left = v(-0.16, hipY + 0.12, -0.3)
      let right = v(0.16, hipY + 0.12, -0.3)
      if (warming) {
        const rub = 0.03 * wave(5)
        left = v(-0.08 + rub, hipY + 0.32, -0.55)
        right = v(0.08 + rub, hipY + 0.32, -0.55)
      }
      if (talking) right = v(0.24, hipY + 0.42 + 0.06 * wave(4), -0.38 + 0.05 * wave(2.3))
      return { parts: turnHead(reach(seated, left, right), look), weapon: WeaponId.Claws }
    }
    default:
      return {
        parts: turnHead(still(rifle ? WeaponId.Rifle : WeaponId.Claws, rifle ? -0.35 : 0), look),
        weapon: rifle ? WeaponId.Rifle : WeaponId.Claws,
      }
  }
}

/** Model space → the world: turned by `yaw`, stood at `at`. */
function placed(parts: BodyPart[], at: THREE.Vector3, yaw: number): BodyPart[] {
  const turn = new THREE.Quaternion().setFromAxisAngle(Y, yaw)
  return parts.map((p) => {
    const c = vec(p.center).applyQuaternion(turn).add(at)
    return {
      ...p,
      center: { x: c.x, y: c.y, z: c.z },
      rotation: quat(turn.clone().multiply(toThree(p.rotation))),
    }
  })
}

interface Person {
  plan: ReturnType<typeof planFolk>
  avatar: Avatar
  gear: number
  rifle: boolean
  seed: number
  crate: THREE.Mesh
  /** Drawn facing (eased), and when last posed (ms). */
  yaw: number | null
  posedAt: number
  /** The last swing heard (chopping, hammering). */
  swing: number
}

const crateGeometry = new THREE.BoxGeometry(0.5, 0.36, 0.4)
const crateMaterial = new THREE.MeshLambertMaterial({ color: 0x7a5a36 })

export class CampFolk {
  readonly root = new THREE.Group()
  private readonly people: Person[]
  private readonly origin: THREE.Vector3
  private readonly audio: AudioEngine

  constructor(def: SurvivalDef, audio: AudioEngine) {
    this.audio = audio
    const haven = def.pois.find((p) => p.key === 'haven')
    this.origin = new THREE.Vector3(haven?.x ?? 0, haven?.y ?? 0, haven?.z ?? 0)
    this.root.name = 'camp-folk'
    this.root.visible = false
    this.people = CAMP_FOLK.map((f, i) => {
      // A face and shirt of their own, the same on every machine.
      const look = randomAppearance(seeded(0xca4f + i * 104729))
      const avatar = new Avatar(f.name, i * 5 + 3, 'worker', look)
      const crate = new THREE.Mesh(crateGeometry, crateMaterial)
      crate.visible = false
      this.root.add(avatar.root, crate)
      return {
        plan: planFolk(f),
        avatar,
        gear: gearLooks(f.gear),
        rifle: f.rifle === true,
        seed: i * 3.7,
        crate,
        yaw: null,
        posedAt: 0,
        swing: 0,
      }
    })
  }

  /**
   * Every frame.
   * @param time  the time of day (0–1)
   * @param you   where you stand (walkers step round you)
   */
  update(dt: number, time: number, eye: THREE.Vector3, you: { x: number; z: number }): void {
    const o = this.origin
    const near = Math.hypot(eye.x - o.x, eye.z - o.z) < SHOW
    this.root.visible = near
    if (!near) return
    const now = performance.now()
    const t = now / 1000
    const night = time < 0.42 || time > 0.92
    for (const p of this.people) {
      const st = folkAt(p.plan, time * DAY_SECONDS)
      p.avatar.root.visible = !st.hidden
      p.crate.visible = false
      if (st.hidden) {
        p.yaw = null
        continue
      }
      const at = new THREE.Vector3(o.x + st.x, o.y + st.y, o.z + st.z)
      // Walking into you: they step round (nothing else here bumps into anybody).
      if (st.doing === 'walk') {
        const dx = at.x - you.x
        const dz = at.z - you.z
        const d = Math.hypot(dx, dz)
        if (d < ROOM && d > 1e-3)
          at.add(new THREE.Vector3((dx / d) * (ROOM - d), 0, (dz / d) * (ROOM - d)))
      }
      // Turning takes a moment (corners on a walk, sitting down).
      if (p.yaw === null) p.yaw = st.yaw
      let turn = (st.yaw - p.yaw) % (Math.PI * 2)
      if (turn > Math.PI) turn -= Math.PI * 2
      if (turn < -Math.PI) turn += Math.PI * 2
      p.yaw += turn * Math.min(1, dt * 6)

      const far = Math.hypot(eye.x - at.x, eye.z - at.z)
      if (far > ANIMATE && now - p.posedAt < 250) continue
      p.posedAt = now
      // Heads: they look about, and at you when you come close.
      let look = 0.45 * Math.sin(t * 0.37 + p.seed * 3) + 0.2 * Math.sin(t * 1.1 + p.seed)
      if (far < 5) {
        const want = Math.atan2(-(eye.x - at.x), -(eye.z - at.z))
        const rel = Math.atan2(Math.sin(want - p.yaw), Math.cos(want - p.yaw))
        if (Math.abs(rel) < 1.6) look = Math.max(-1, Math.min(1, rel))
      }
      const { parts, weapon } = modelPose(st, p.rifle, t, p.seed, night, look)
      p.avatar.pose(placed(parts, at, p.yaw), weapon, p.gear)
      if (st.carrying) {
        p.crate.visible = true
        p.crate.position.set(0, 1.05, -0.38).applyAxisAngle(Y, p.yaw).add(at)
        p.crate.rotation.set(0, p.yaw, 0)
      }
      this.sounds(p, st, t, at, far)
    }
  }

  /** The axe hitting the block, the hammer on the nail. */
  private sounds(p: Person, st: FolkState, t: number, at: THREE.Vector3, far: number): void {
    const period = st.doing === 'chop' ? 1.5 : st.doing === 'hammer' ? 0.8 : 0
    if (period === 0 || far > 35) return
    // The blow lands a fifth of the way into the swing.
    const swing = Math.floor((t + p.seed) / period - 0.2)
    if (swing === p.swing) return
    p.swing = swing
    if (st.doing === 'chop') this.audio.playNear('bang', at, 0.35, 35, 4, 1.3)
    else this.audio.playNear('hammer', at, 0.25, 30, 4)
  }
}
