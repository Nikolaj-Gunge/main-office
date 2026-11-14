import {
  attribute,
  cameraPosition,
  distance,
  Fn,
  float,
  mix,
  normalViewGeometry,
  positionLocal,
  smoothstep,
} from 'three/tsl'
import type { Node } from 'three/webgpu'
import { DETAIL_FADE } from './ground-detail.ts'
import { swayed } from './wind.tsl.ts'

/*
 * TSL twin of patchDetail (ground-detail.ts) for the WebGPU renderer: optional wind sway, then
 * shrink towards the `anchor` attribute far from the camera.
 */
export const detailPosition = (sway: boolean): Node<'vec3'> =>
  Fn(() => {
    const anchor = attribute<'vec3'>('anchor', 'vec3')
    const p = sway ? swayed(positionLocal) : positionLocal
    const fade = float(1).sub(
      smoothstep(DETAIL_FADE[0], DETAIL_FADE[1], distance(anchor.xz, cameraPosition.xz)),
    )
    return mix(anchor, p, fade)
  })()

/** Both faces lit as the front one (thin blades): the geometry normal, never flipped. */
export const detailNormal = (): Node<'vec3'> => normalViewGeometry
