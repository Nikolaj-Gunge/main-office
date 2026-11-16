import { type SurvivalDef, WORLD_HALF, WORLD_SIZE } from '@office-fps/shared'

/** Forest shown round the county's outermost places on the map (m). */
const MARGIN = 160

/**
 * The part of the world the map (M) shows: a square round the county's places (and anywhere
 * else you've been), not the whole forest. The county is drawn in towards Haven (world.ts drawIn),
 * so the full 3 km would leave its places a small huddle in the middle of a mostly empty sheet.
 */
export interface MapView {
  /** Map pixels per metre. */
  s: number
  /** World x / z to map pixels. */
  x: (v: number) => number
  z: (v: number) => number
  /** The world corner (west, north) and side of the square shown, in metres. */
  x0: number
  z0: number
  span: number
}

/** A world rectangle: west, east, north, south edges (m). */
export type Bounds = [number, number, number, number]

/** `also`: more of the world to keep on the sheet (where you've walked, where you stand). */
export function mapView(def: SurvivalDef, size: number, also: readonly Bounds[] = []): MapView {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const p of def.pois) {
    // Hidden ones (treehouses, stands, stashes) are out in the deep forest: only once found.
    if (p.hidden) continue
    minX = Math.min(minX, p.x - p.r)
    maxX = Math.max(maxX, p.x + p.r)
    minZ = Math.min(minZ, p.z - p.r)
    maxZ = Math.max(maxZ, p.z + p.r)
  }
  for (const [w, e, n, so] of also) {
    minX = Math.min(minX, w)
    maxX = Math.max(maxX, e)
    minZ = Math.min(minZ, n)
    maxZ = Math.max(maxZ, so)
  }
  if (!Number.isFinite(minX)) return frame(-WORLD_HALF, -WORLD_HALF, WORLD_SIZE, size)
  const span = Math.min(WORLD_SIZE, Math.max(maxX - minX, maxZ - minZ) + MARGIN * 2)
  const clamp = (v: number) => Math.max(-WORLD_HALF, Math.min(WORLD_HALF - span, v))
  return frame(clamp((minX + maxX) / 2 - span / 2), clamp((minZ + maxZ) / 2 - span / 2), span, size)
}

function frame(x0: number, z0: number, span: number, size: number): MapView {
  const s = size / span
  return { s, x: (v) => (v - x0) * s, z: (v) => (v - z0) * s, x0, z0, span }
}

/** The source square of a whole-world canvas (`px` pixels a side) that the view shows. */
export function viewOf(view: MapView, px: number): [number, number, number, number] {
  const k = px / WORLD_SIZE
  return [(view.x0 + WORLD_HALF) * k, (view.z0 + WORLD_HALF) * k, view.span * k, view.span * k]
}
