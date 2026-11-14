import { attribute, Fn, positionLocal, renderGroup, sin, uniform, vec2, vec3 } from 'three/tsl'
import type { Node } from 'three/webgpu'
import { windUniforms } from './wind.ts'

/*
 * TSL twin of SWAY_VERTEX (wind.ts) for the WebGPU renderer. Keep the two in step: the same
 * numbers, the same shared uniforms (main.ts syncs `windUniforms` once a frame).
 */

// In the shared render group: the scene's materials are classic ones without nodes, so three
// treats their objects as unchanging and never refreshes per-object uniforms.
const windTime = uniform(0)
  .setGroup(renderGroup)
  .onRenderUpdate(() => windUniforms.uWindTime.value)
const windGust = uniform(0)
  .setGroup(renderGroup)
  .onRenderUpdate(() => windUniforms.uWindGust.value)
const windDir = uniform(windUniforms.uWindDir.value).setGroup(renderGroup)

/** `p` bent in the wind by the geometry's `sway` attribute (x = how much, y = own phase). */
export const swayed = Fn(([p]: [Node<'vec3'>]) => {
  const sway = attribute<'vec2'>('sway', 'vec2')
  const bend = sway.x.mul(windGust.mul(1.1).add(0.35))
  const wave = sin(windTime.mul(1.7).add(sway.y))
    .mul(0.6)
    .add(sin(windTime.mul(2.9).add(sway.y.mul(1.7))).mul(0.25))
  const lean = windGust.mul(0.9).add(0.25).mul(sway.x)
  const along = windDir.mul(wave.mul(bend).add(lean).mul(0.35))
  const across = vec2(windDir.y.negate(), windDir.x).mul(
    sin(windTime.mul(2.3).add(sway.y.mul(2.1)))
      .mul(bend)
      .mul(0.12),
  )
  const xz = p.xz.add(along).add(across)
  return vec3(xz.x, p.y, xz.y)
})

/** positionNode for materials patched with makeSwaying. */
export const swayingPosition = (): Node<'vec3'> => swayed(positionLocal)
