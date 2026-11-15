import { type BodyPart, PART_SIZES } from '@office-fps/shared'
import * as THREE from 'three'

/** How long a friendly wave lasts (s). */
export const WAVE_SECONDS = 2.2

const UP = new THREE.Vector3(0, 1, 0)
const SHOULDER = 0.24
const chestRot = new THREE.Quaternion()
const shoulder = new THREE.Vector3()
const hand = new THREE.Vector3()
const span = new THREE.Vector3()
const turn = new THREE.Quaternion()

/**
 * A body (world-space parts, as bodyParts gives them) with its left arm raised and waving side
 * to side: the hand goes up over the shoulder and swings `t` seconds into the wave. The arm
 * rises in the first fifth of a second and comes down in the last. Looks only: hitboxes keep
 * the normal pose.
 */
export function waving(parts: BodyPart[], t: number, size = 1): BodyPart[] {
  const chest = parts.find((p) => p.name === 'chest')
  if (!chest || t < 0 || t > WAVE_SECONDS) return parts
  const lift = Math.min(1, t / 0.2, (WAVE_SECONDS - t) / 0.25)
  chestRot.set(chest.rotation.x, chest.rotation.y, chest.rotation.z, chest.rotation.w)
  shoulder
    .set(-SHOULDER * size, 0.12 * size, 0)
    .applyQuaternion(chestRot)
    .add(chest.center as THREE.Vector3Like)
  // Hanging (down the side) → raised (up and out), and side to side once it's up.
  const swing = Math.sin(t * 10) * 0.14 * lift
  hand
    .set((-0.06 - 0.1 * lift + swing) * size, (-0.54 + 1.04 * lift) * size, -0.06 * size)
    .applyQuaternion(chestRot)
    .add(shoulder)
  span.copy(hand).sub(shoulder)
  const len = Math.max(0.05, span.length())
  turn.setFromUnitVectors(UP, span.divideScalar(len))
  const mid = shoulder.clone().lerp(hand, 0.5)
  return parts.map((p) =>
    p.name === 'armL'
      ? {
          name: 'armL',
          center: { x: mid.x, y: mid.y, z: mid.z },
          half: { ...PART_SIZES.armL, y: len / 2 },
          rotation: { x: turn.x, y: turn.y, z: turn.z, w: turn.w },
        }
      : p,
  )
}

const handR = new THREE.Vector3()
const shoulderR = new THREE.Vector3()
const gunTurn = new THREE.Quaternion()
const POINT_UP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)

/** Places one arm from `from` (shoulder) to `to` (hand), as a box part. */
function armBetween(name: 'armL' | 'armR', from: THREE.Vector3, to: THREE.Vector3): BodyPart {
  span.copy(to).sub(from)
  const len = Math.max(0.05, span.length())
  turn.setFromUnitVectors(UP, span.divideScalar(len))
  const mid = from.clone().lerp(to, 0.5)
  return {
    name,
    center: { x: mid.x, y: mid.y, z: mid.z },
    half: { ...PART_SIZES[name], y: len / 2 },
    rotation: { x: turn.x, y: turn.y, z: turn.z, w: turn.w },
  }
}

/**
 * Hands up ("don't shoot"): both arms straight up beside the head, the gun hanging from the right
 * hand pointing at the sky. Up in a fifth of a second, down in the last quarter of `seconds`.
 * Looks only, like the wave.
 */
export function handsUp(parts: BodyPart[], t: number, seconds: number, size = 1): BodyPart[] {
  const chest = parts.find((p) => p.name === 'chest')
  if (!chest || t < 0 || t > seconds) return parts
  const lift = Math.min(1, t / 0.2, (seconds - t) / 0.25)
  chestRot.set(chest.rotation.x, chest.rotation.y, chest.rotation.z, chest.rotation.w)
  const arms = new Map<string, BodyPart>()
  for (const side of [-1, 1] as const) {
    const at = side < 0 ? shoulder : shoulderR
    const to = side < 0 ? hand : handR
    at.set(side * SHOULDER * size, 0.12 * size, 0)
      .applyQuaternion(chestRot)
      .add(chest.center as THREE.Vector3Like)
    // Hanging → straight up, a little out to the side and a touch forward (palms shown).
    to.set(side * (0.06 + 0.12 * lift) * size, (-0.54 + 1.1 * lift) * size, -0.08 * lift * size)
      .applyQuaternion(chestRot)
      .add(at)
    const name = side < 0 ? 'armL' : 'armR'
    arms.set(name, armBetween(name, at, to))
  }
  // The gun follows the right hand, muzzle to the sky.
  gunTurn.copy(chestRot).multiply(POINT_UP)
  return parts.map((p) => {
    const arm = arms.get(p.name)
    if (arm) return arm
    if (p.name === 'gun' && lift > 0.5)
      return {
        ...p,
        center: { x: handR.x, y: handR.y + 0.12 * size, z: handR.z },
        rotation: { x: gunTurn.x, y: gunTurn.y, z: gunTurn.z, w: gunTurn.w },
      }
    return p
  })
}
