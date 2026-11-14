import {
  abs,
  dot,
  length,
  materialColor,
  max,
  mix,
  normalGeometry,
  positionGeometry,
  select,
  step,
  texture,
  vec2,
  vec4,
  vertexColor,
} from 'three/tsl'
import type { NodeMaterial } from 'three/webgpu'
import { GRAIN_LOW, GRAIN_PALE, GRAIN_PX, GRAIN_RANGE, GRAIN_SIZE, grainMap } from './grain.ts'

/*
 * TSL twin of makeGrained's patch (grain.ts) for the WebGPU renderer: the same texture, picked
 * up the same way, scaling the vertex colour. Keep the two in step.
 */

/** Material patched with makeGrained: vertex colour × the grain on the face's own plane. */
export function grain(m: NodeMaterial): void {
  const n = normalGeometry
  const p = positionGeometry
  const side = vec2(n.z.negate(), n.x)
  const along = side.div(max(length(side), 1e-4))
  const at = select(abs(n.y).greaterThan(0.7), p.xz, vec2(dot(p.xz, along), p.y))
  const texel = texture(grainMap(), at.mul(GRAIN_PX / GRAIN_SIZE))
  const c = vertexColor().rgb
  const leafy = step(max(c.r.mul(1.05), c.b), c.g)
  const stone = leafy.oneMinus().mul(step(c.r, c.b))
  const wood = mix(texel.r, texel.a, step(GRAIN_PALE, c.r))
  const amount = mix(mix(wood, texel.b, stone), texel.g, leafy)
  // Vertex colours are folded in here, before the grain (as color_fragment is).
  m.vertexColors = false
  m.colorNode = vec4(materialColor.rgb.mul(c).mul(amount.mul(GRAIN_RANGE).add(GRAIN_LOW)), 1)
}
