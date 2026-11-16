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
