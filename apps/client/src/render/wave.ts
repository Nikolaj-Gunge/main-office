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
