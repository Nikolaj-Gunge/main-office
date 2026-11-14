import { type BodyPart, PART_SIZES } from '@office-fps/shared'
import * as THREE from 'three'

/**
 * The bones every body mesh is skinned to: one per skeleton part (placed exactly where that
 * part's hitbox is, every frame), plus a hand on the end of each arm that doesn't stretch with
 * it. Meshes are modelled around a rest pose (standing, arms down and a little forward);
 * vertices near a joint are weighted to both bones, so knees, hips, the waist, the neck and the
 * shoulders bend smoothly instead of showing the gaps and overlaps of separate boxes.
 */

export type RigBone =
  | 'head'
  | 'chest'
  | 'stomach'
  | 'armL'
  | 'armR'
  | 'thighL'
  | 'shinL'
  | 'thighR'
  | 'shinR'
  | 'handL'
  | 'handR'
/** Where a piece is modelled: on a bone (its own space), or in rest model space across bones. */
export type Place = RigBone | 'torso' | 'legL' | 'legR'

export const BONES: readonly RigBone[] = [
  'head',
  'chest',
  'stomach',
  'armL',
  'armR',
  'thighL',
  'shinL',
  'thighR',
  'shinR',
  'handL',
  'handR',
]
export const BONE_INDEX = Object.fromEntries(BONES.map((b, i) => [b, i])) as Record<RigBone, number>

const ARM = PART_SIZES.armR.y * 2
const HIP_Y = 0.86
const WAIST_Y = HIP_Y + PART_SIZES.stomach.y * 2
const NECK_Y = WAIST_Y + PART_SIZES.chest.y * 2 + 0.04
const KNEE_Y = 0.44
const SHOULDER_Y = WAIST_Y + PART_SIZES.chest.y * 2 - 0.04
const SHOULDER_X = 0.24
const HIP_X = 0.11

/** Rest direction of each arm (shoulder → hand): down, a little forward and out. */
export const ARM_REST_DIR = {
  armL: new THREE.Vector3(-0.16, -0.82, -0.5).normalize(),
  armR: new THREE.Vector3(0.16, -0.82, -0.5).normalize(),
}
const UP = new THREE.Vector3(0, 1, 0)
/** Rest rotation of each arm (relative to an upright chest). */
export const ARM_REST_ROT = {
  armL: new THREE.Quaternion().setFromUnitVectors(UP, ARM_REST_DIR.armL),
  armR: new THREE.Quaternion().setFromUnitVectors(UP, ARM_REST_DIR.armR),
}
const shoulderOf = (s: -1 | 1) => new THREE.Vector3(s * SHOULDER_X, SHOULDER_Y, 0)

/** Rest pose: every bone's model-space matrix (scale 1). */
export const REST: Record<RigBone, THREE.Matrix4> = (() => {
  const at = (x: number, y: number, z: number, q = new THREE.Quaternion()) =>
    new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1))
  const arm = (s: -1 | 1) => {
    const name = s < 0 ? 'armL' : 'armR'
    const c = shoulderOf(s).addScaledVector(ARM_REST_DIR[name], ARM / 2)
    return at(c.x, c.y, c.z, ARM_REST_ROT[name])
  }
  const hand = (s: -1 | 1) => arm(s).multiply(new THREE.Matrix4().makeTranslation(0, ARM / 2, 0))
  return {
    head: at(0, NECK_Y + PART_SIZES.head.y, -0.01),
    chest: at(0, WAIST_Y + PART_SIZES.chest.y, 0),
    stomach: at(0, HIP_Y + PART_SIZES.stomach.y, 0),
    armL: arm(-1),
    armR: arm(1),
    thighL: at(-HIP_X, (HIP_Y + KNEE_Y) / 2, 0),
    shinL: at(-HIP_X, KNEE_Y / 2, 0),
    thighR: at(HIP_X, (HIP_Y + KNEE_Y) / 2, 0),
    shinR: at(HIP_X, KNEE_Y / 2, 0),
    handL: hand(-1),
    handR: hand(1),
  }
})()
export const REST_INVERSE = BONES.map((b) => REST[b].clone().invert())

/** Model-space heights of the joints (for modelling across them). */
export const JOINTS = {
  hip: HIP_Y,
  waist: WAIST_Y,
  neck: NECK_Y,
  knee: KNEE_Y,
  shoulder: SHOULDER_Y,
}

const smooth = (t: number) => {
  const x = Math.max(0, Math.min(1, t))
  return x * x * (3 - 2 * x)
}

interface Joint {
  parent: RigBone
  child: RigBone
  at: THREE.Vector3
  /** Unit axis pointing into the child. */
  axis: THREE.Vector3
  /** Half-width of the blend. */
  r: number
  /** How much a parent vertex may follow the child (0–1), e.g. only on the near side. */
  gate?: (v: THREE.Vector3) => number
}

const joints: Joint[] = [
  {
    parent: 'chest',
    child: 'head',
    at: new THREE.Vector3(0, NECK_Y, 0),
    axis: UP,
    r: 0.045,
    gate: (v) => 1 - smooth((Math.abs(v.x) - 0.08) / 0.05),
  },
  { parent: 'stomach', child: 'chest', at: new THREE.Vector3(0, WAIST_Y, 0), axis: UP, r: 0.07 },
]
for (const s of [-1, 1] as const) {
  const L = s < 0 ? 'L' : 'R'
  const shoulder = shoulderOf(s)
  const dir = ARM_REST_DIR[`arm${L}`]
  joints.push(
    {
      parent: 'stomach',
      child: `thigh${L}`,
      at: new THREE.Vector3(s * HIP_X, HIP_Y, 0),
      axis: new THREE.Vector3(0, -1, 0),
      r: 0.07,
      gate: (v) => smooth((s * v.x) / 0.07),
    },
    {
      parent: `thigh${L}`,
      child: `shin${L}`,
      at: new THREE.Vector3(s * HIP_X, KNEE_Y, 0),
      axis: new THREE.Vector3(0, -1, 0),
      r: 0.05,
    },
    {
      parent: 'chest',
      child: `arm${L}`,
      at: shoulder,
      axis: dir,
      r: 0.06,
      gate: (v) => 1 - smooth((v.distanceTo(shoulder) - 0.06) / 0.07),
    },
    {
      parent: `arm${L}`,
      child: `hand${L}`,
      at: shoulder.clone().addScaledVector(dir, ARM),
      axis: dir,
      r: 0.02,
    },
  )
}
const d = new THREE.Vector3()

/** Which bone a model-space piece's vertex belongs to before joint blending. */
function classify(place: Place, v: THREE.Vector3): RigBone {
  if (place === 'torso') return v.y > WAIST_Y ? 'chest' : 'stomach'
  if (place === 'legL') return v.y > KNEE_Y ? 'thighL' : 'shinL'
  if (place === 'legR') return v.y > KNEE_Y ? 'thighR' : 'shinR'
  return place
}

/** A vertex's two bones and the second one's weight (model-space rest position). */
export function boneWeights(
  place: Place,
  v: THREE.Vector3,
  rigid: boolean,
): readonly [RigBone, RigBone, number] {
  const bone = classify(place, v)
  if (rigid) return [bone, bone, 0]
  let best: RigBone = bone
  let weight = 0
  for (const j of joints) {
    if (j.parent !== bone && j.child !== bone) continue
    const t = d.subVectors(v, j.at).dot(j.axis)
    const child = smooth((t + j.r) / (2 * j.r))
    const w = j.parent === bone ? child * (j.gate?.(v) ?? 1) : 1 - child
    if (w > weight) {
      weight = w
      best = j.parent === bone ? j.child : j.parent
    }
  }
  return [bone, best, weight]
}

/** The bones of one body, flat under nothing (the caller adds the part bones to a parent). */
export function makeBones(): { bones: THREE.Bone[]; byName: Record<RigBone, THREE.Bone> } {
  const byName = {} as Record<RigBone, THREE.Bone>
  const bones = BONES.map((name) => {
    const b = new THREE.Bone()
    b.name = name
    byName[name] = b
    return b
  })
  // Hands ride on the end of their arm (and undo its stretch).
  for (const s of ['L', 'R'] as const) {
    const hand = byName[`hand${s}`]
    hand.position.set(0, ARM / 2, 0)
    byName[`arm${s}`].add(hand)
    byName[`arm${s}`].userData.hand = hand
  }
  return { bones, byName }
}

const qa = new THREE.Quaternion()
const qc = new THREE.Quaternion()
const from = new THREE.Vector3()
const to = new THREE.Vector3()

/**
 * The arms' roll about their own length is arbitrary in the skeleton (it only aims them); the
 * mesh needs it steady (hands, shoulders), so it is taken from the chest instead: the arm is
 * the chest's rest arm swung onto the arm's actual direction. The box is nearly square, so the
 * hitbox is unchanged in all but name. Returns new parts (the input is left alone).
 */
export function steadyArms(parts: readonly BodyPart[]): BodyPart[] {
  const chest = parts.find((p) => p.name === 'chest')
  if (!chest) return [...parts]
  qc.set(chest.rotation.x, chest.rotation.y, chest.rotation.z, chest.rotation.w)
  return parts.map((p) => {
    if (p.name !== 'armL' && p.name !== 'armR') return p
    qa.set(p.rotation.x, p.rotation.y, p.rotation.z, p.rotation.w)
    to.copy(UP).applyQuaternion(qa)
    from.copy(ARM_REST_DIR[p.name]).applyQuaternion(qc)
    const q = new THREE.Quaternion()
      .setFromUnitVectors(from, to)
      .multiply(qc)
      .multiply(ARM_REST_ROT[p.name])
    return { ...p, rotation: { x: q.x, y: q.y, z: q.z, w: q.w } }
  })
}
