/**
 * The title screen's camera: before PLAY, a slow drift round the start cabin and its campfire
 * in the moonlit woods, using the world already built behind the menu (no server needed). Low
 * tier and reduced motion get one still shot instead.
 */

/** One full circle takes this long (s): slow enough to read as a held shot. */
const ORBIT_S = 200
const RADIUS = 17
/** How far the circle breathes in and out (m), and the camera bobs up and down (m). */
const SWAY = 4
const BOB = 1.4
/** Eye height above the ground (m) at the middle of its bob. */
const HEIGHT = 3.6

export interface TitlePose {
  x: number
  y: number
  z: number
  /** The point looked at. */
  lx: number
  ly: number
  lz: number
}

/**
 * Where the camera is `t` s into the title screen, circling `centre` (on the ground, `ground`
 * gives its height anywhere). `still`: always the opening shot.
 */
export function titlePose(
  t: number,
  centre: { x: number; z: number },
  ground: (x: number, z: number) => number,
  still: boolean,
  /** Puts the middle this far right of centre (a share of the distance; the menu is left). */
  aside = 0,
): TitlePose {
  const s = still ? 0 : t
  // Starts south-east of the cabin, looking back at the fire and the door.
  const a = 0.6 + (s / ORBIT_S) * Math.PI * 2
  const r = RADIUS + SWAY * Math.sin(s * 0.045)
  const x = centre.x + Math.cos(a) * r
  const z = centre.z + Math.sin(a) * r
  const y = Math.max(ground(x, z), ground(centre.x, centre.z)) + HEIGHT + BOB * Math.sin(s * 0.07)
  // The gaze wanders a little round the middle, so it never looks locked to a pivot.
  // Looking a little left of the middle puts it right of centre, clear of the menu.
  const dx = centre.x - x
  const dz = centre.z - z
  const lx = centre.x + Math.sin(s * 0.031) * 2.5 + dz * aside
  const lz = centre.z + Math.cos(s * 0.027) * 2.5 - dx * aside
  return { x, y, z, lx, ly: ground(centre.x, centre.z) + 1.4, lz }
}

/** How long PLAY's camera move from the title shot down to your own eyes takes (s). */
export const EXIT_S = 0.5

/** Eases 0..1 to 0..1, fast then settling (cubic out). */
export function exitEase(k: number): number {
  const t = Math.min(1, Math.max(0, k))
  return 1 - (1 - t) ** 3
}

/** Position and facing, as plain numbers (a quaternion for the facing). */
export interface CameraPose {
  x: number
  y: number
  z: number
  qx: number
  qy: number
  qz: number
  qw: number
}

/**
 * PLAY's short move: the last title-shot pose is held, and for EXIT_S after joining the camera
 * glides from it to where the player's camera already is. It only changes what is drawn (input
 * and the game run from the first frame), so it never delays play. Low tier and reduced motion
 * skip it (hold nothing).
 */
export class TitleExit {
  private from: CameraPose | null = null
  private started = -1

  /** The title shot is on screen: remember where it is (or forget it, `skip`). */
  hold(pose: CameraPose, skip: boolean): void {
    this.from = skip ? null : { ...pose }
    this.started = -1
  }

  /**
   * Joined: blends `to` (the player's camera this frame) from the held pose, `now` in ms. Returns
   * the blended pose, or null once the move is over (or there was none).
   */
  blend(to: CameraPose, now: number): CameraPose | null {
    const from = this.from
    if (!from) return null
    if (this.started < 0) this.started = now
    const k = (now - this.started) / 1000 / EXIT_S
    if (k >= 1) {
      this.from = null
      return null
    }
    const e = exitEase(k)
    // Quaternion nlerp along the short way round: plenty for half a second.
    const sign = from.qx * to.qx + from.qy * to.qy + from.qz * to.qz + from.qw * to.qw < 0 ? -1 : 1
    const qx = from.qx + (to.qx * sign - from.qx) * e
    const qy = from.qy + (to.qy * sign - from.qy) * e
    const qz = from.qz + (to.qz * sign - from.qz) * e
    const qw = from.qw + (to.qw * sign - from.qw) * e
    const n = Math.hypot(qx, qy, qz, qw) || 1
    return {
      x: from.x + (to.x - from.x) * e,
      y: from.y + (to.y - from.y) * e,
      z: from.z + (to.z - from.z) * e,
      qx: qx / n,
      qy: qy / n,
      qz: qz / n,
      qw: qw / n,
    }
  }
}
