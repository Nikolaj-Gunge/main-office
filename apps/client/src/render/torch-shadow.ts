import * as THREE from 'three'
import type { Tier } from './device-tier.ts'

/**
 * Your torch throws real shadows: on Medium and High the local player's torch (a SpotLight on
 * the camera) gets a small shadow map of its own, so trees, walls and the dead throw hard pixel
 * shadows across whatever the beam falls on. Low stays as it was: no shadow, no extra pass.
 *
 * The map is only redrawn while the torch is lit, and no more often than the tier allows (the
 * camera bobs every frame, so in practice that is the cap). The moon's maps are never touched:
 * each light's shadow is redrawn on its own (WebGLShadowMap skips lights not asking).
 */

/** The torch's shadow map (texels a side) and the shortest gap between redraws (s), per tier. */
export const TORCH_SHADOW: Record<Tier, { map: number; every: number } | null> = {
  low: null,
  medium: { map: 256, every: 1 / 30 },
  high: { map: 512, every: 0 },
}

/** Redrawn when the torch has moved this far (m) or turned this much (rad) since the last … */
const MOVED = 0.02
const TURNED = 0.004
/** … and this often anyway while lit, for the dead moving through the beam (s). */
const REFRESH = 1 / 15

/** Whether the renderer can draw it (WebGPU redraws every caster at once: kept off there). */
let rendererAllows = true

export function allowTorchShadows(ok: boolean): void {
  rendererAllows = ok
}

/**
 * People and the dead don't cast moon shadows (the moon's maps are drawn seldom, and a frozen
 * shadow would stay where somebody once stood). For the torch they should: their meshes cast
 * with this depth material, which draws nothing for a directional light's (orthographic) shadow
 * camera and the usual depth for the torch's (perspective) one.
 */
const torchOnlyDepth = new THREE.MeshDepthMaterial()
torchOnlyDepth.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader.replace(
    '#include <project_vertex>',
    `#include <project_vertex>
  // An orthographic camera (the moon's cascades): put the vertex outside the clip box.
  if ( projectionMatrix[ 2 ][ 3 ] == 0.0 ) gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );`,
  )
}
torchOnlyDepth.customProgramCacheKey = () => 'torch-only-depth'

/** Makes a person's mesh throw a shadow in torchlight only (see torchOnlyDepth). */
export function torchCaster(mesh: THREE.Mesh): void {
  if (!rendererAllows) return
  mesh.castShadow = true
  mesh.customDepthMaterial = torchOnlyDepth
}

const pos = new THREE.Vector3()
const dir = new THREE.Vector3()

export class TorchShadow {
  private settings: { map: number; every: number } | null = null
  private since = Number.POSITIVE_INFINITY
  private readonly at = new THREE.Vector3(1e9, 0, 0)
  private readonly facing = new THREE.Vector3()
  /** Redraws so far (for the frame-time checks). */
  redraws = 0

  constructor(private readonly light: THREE.SpotLight) {
    const s = light.shadow
    s.autoUpdate = false
    s.bias = -0.0006
    s.normalBias = 0.03
    // (Its far plane is the light's range: SpotLightShadow sets it.)
    s.camera.near = 0.3
  }

  /** Turns the shadow on or off for a tier (Low: off). Changing it recompiles shaders once. */
  setTier(tier: Tier): void {
    const next = rendererAllows ? TORCH_SHADOW[tier] : null
    this.settings = next
    this.light.castShadow = next !== null
    const s = this.light.shadow
    if (next && s.mapSize.x !== next.map) {
      s.mapSize.set(next.map, next.map)
      s.map?.dispose()
      s.map = null
    }
    if (!next) {
      s.map?.dispose()
      s.map = null
    }
    this.since = Number.POSITIVE_INFINITY
  }

  /**
   * After the torch has been placed for the frame. True when its map is to be redrawn this frame
   * (the caller asks the renderer for a shadow pass; only this light's map is drawn).
   */
  update(dt: number, lit: boolean): boolean {
    const s = this.settings
    if (!s || !lit) return false
    this.since += dt
    if (this.since < s.every) return false
    this.light.getWorldPosition(pos)
    this.light.target.getWorldPosition(dir).sub(pos).normalize()
    const moved = pos.distanceTo(this.at) > MOVED || dir.angleTo(this.facing) > TURNED
    if (!moved && this.since < REFRESH) return false
    this.since = 0
    this.at.copy(pos)
    this.facing.copy(dir)
    this.light.shadow.needsUpdate = true
    this.redraws++
    return true
  }
}
