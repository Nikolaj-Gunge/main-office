/** Walk within this distance of a weapon with an empty primary slot to pick it up (m). */
export const AUTO_PICKUP_RADIUS = 1.1
/** E swaps with a weapon within this distance (m). */
export const USE_PICKUP_RADIUS = 2.2

/**
 * Can someone standing at `feet` reach a weapon lying at `item`? Horizontal distance within
 * `radius`, from just below the feet up to about chest height (weapons on desks count).
 */
export function canReach(
  feet: { x: number; y: number; z: number },
  item: { x: number; y: number; z: number },
  radius: number,
): boolean {
  const dy = item.y - feet.y
  if (dy < -0.6 || dy > 1.3) return false
  return Math.hypot(item.x - feet.x, item.z - feet.z) <= radius
}
