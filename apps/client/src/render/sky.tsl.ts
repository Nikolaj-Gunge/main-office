import { BackSide, type Color } from 'three'
import {
  cameraProjectionMatrix,
  clamp,
  Fn,
  mix,
  modelViewMatrix,
  positionLocal,
  pow,
  renderGroup,
  uniform,
  vec4,
} from 'three/tsl'
import { MeshBasicNodeMaterial } from 'three/webgpu'

/**
 * TSL twin of the sky dome's ShaderMaterial (sky.ts) for the WebGPU renderer. Reads the very
 * Color objects in the GLSL material's uniforms, so night.ts grading them carries over.
 */
export function skyNodeMaterial(uniforms: {
  topColor: { value: Color }
  horizonColor: { value: Color }
}): MeshBasicNodeMaterial {
  // Render group: night.ts grades these in place, and the dome itself never changes.
  const top = uniform(uniforms.topColor.value).setGroup(renderGroup)
  const horizon = uniform(uniforms.horizonColor.value).setGroup(renderGroup)
  const material = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false, fog: false })
  const dir = positionLocal.normalize().toVarying('vSkyDir')
  material.colorNode = mix(horizon, top, pow(clamp(dir.y, 0, 1), 0.6))
  // Pinned to the far plane.
  material.vertexNode = Fn(() => {
    const clip = cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(positionLocal, 1))
    return vec4(clip.x, clip.y, clip.w, clip.w)
  })()
  return material
}
