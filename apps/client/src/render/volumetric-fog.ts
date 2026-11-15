import * as THREE from 'three'
import type { FogFrame, FogMode } from './fog-atmosphere.ts'
import fogFragment from './shaders/volumetric-fog.frag.glsl?raw'

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

/** Lamps a halo each at most (night.ts lights no more than this). */
const MAX_LAMPS = 9
/** Lamps' halos fade out towards this far from you (m): about where night.ts turns them off. */
const HALO_RANGE = 75
/** A lamp's halo at its brightest, per unit of its intensity. */
const HALO = 0.004
/** The torch's beam in the mist, per unit of its intensity. */
const TORCH_BEAM = 0.0016
/** Moonlight in the mist, per unit of the moon's intensity. */
const MOON_SHAFT = 0.025

const pos = new THREE.Vector3()
const aim = new THREE.Vector3()

/**
 * Draws the mist (fog-atmosphere.ts) into its own coarse target after the world: the post pass
 * dims the scene by its alpha and adds its light (pixel-renderer.ts). WebGL only.
 */
export class VolumetricFog {
  readonly target: THREE.WebGLRenderTarget
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly material: THREE.ShaderMaterial
  private mode: FogMode | null = null
  private readonly u = {
    tDepth: { value: null as THREE.Texture | null },
    tShadow: { value: null as THREE.Texture | null },
    shadowMatrix: { value: new THREE.Matrix4() },
    shafts: { value: 0 },
    projInv: { value: new THREE.Matrix4() },
    camWorld: { value: new THREE.Matrix4() },
    camPos: { value: new THREE.Vector3() },
    density: { value: 0 },
    mistBase: { value: 0 },
    mistHeight: { value: 5 },
    far: { value: 120 },
    time: { value: 0 },
    mistColor: { value: new THREE.Color() },
    lakeGlow: { value: new THREE.Color() },
    lakes: { value: [new THREE.Vector4(), new THREE.Vector4()] },
    moonDir: { value: new THREE.Vector3(0, 1, 0) },
    moonLight: { value: new THREE.Color() },
    torchPos: { value: new THREE.Vector3() },
    torchDir: { value: new THREE.Vector3(0, 0, -1) },
    torchCos: { value: 0.9 },
    torchLight: { value: new THREE.Color() },
    lampCount: { value: 0 },
    lampPos: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector4()) },
    lampLight: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Color()) },
  }

  constructor() {
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
    })
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: fogFragment,
      depthTest: false,
      depthWrite: false,
      uniforms: this.u,
    })
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material)
    quad.frustumCulled = false
    this.scene.add(quad)
  }

  /** Marches the mist for `camera`'s view of the world whose depth is `depth` (`size`: game px). */
  render(
    r: THREE.WebGLRenderer,
    depth: THREE.Texture,
    camera: THREE.PerspectiveCamera,
    size: THREE.Vector2,
    f: FogFrame,
  ): void {
    const t = f.tier
    if (this.mode !== t.mode) {
      this.mode = t.mode
      this.material.defines = { STEPS: t.steps, ...(t.shafts ? { SHAFTS: '' } : {}) }
      this.material.needsUpdate = true
    }
    const w = Math.max(1, Math.ceil(size.x / t.scale))
    const h = Math.max(1, Math.ceil(size.y / t.scale))
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h)

    const u = this.u
    u.tDepth.value = depth
    u.projInv.value.copy(camera.projectionMatrixInverse)
    u.camWorld.value.copy(camera.matrixWorld)
    camera.getWorldPosition(u.camPos.value)
    u.density.value = f.density
    u.mistBase.value = f.base
    u.mistHeight.value = f.height
    u.far.value = f.far
    u.time.value = f.time
    u.mistColor.value.copy(f.color)
    u.lakeGlow.value.copy(f.lakeGlow)
    u.lakes.value.forEach((v, i) => {
      const l = f.lakes[i]
      if (l) v.set(l.x, l.z, l.r, l.y)
      else v.set(0, 0, 0, 0)
    })

    const moon = f.moon
    const map = moon?.shadow.map?.depthTexture ?? null
    u.shafts.value = t.shafts && moon && map ? 1 : 0
    if (moon) {
      u.moonDir.value.copy(moon.position).sub(moon.target.position).normalize()
      u.moonLight.value.copy(moon.color).multiplyScalar(moon.intensity * MOON_SHAFT * f.moonLevel)
      u.shadowMatrix.value.copy(moon.shadow.matrix)
    }
    u.tShadow.value = u.shafts.value ? map : null

    const torch = f.torch
    if (torch) {
      torch.getWorldPosition(u.torchPos.value)
      torch.target.getWorldPosition(aim)
      u.torchDir.value.copy(aim).sub(u.torchPos.value).normalize()
      u.torchCos.value = Math.cos(torch.angle)
      u.torchLight.value.copy(torch.color).multiplyScalar(torch.intensity * TORCH_BEAM)
    } else u.torchLight.value.setRGB(0, 0, 0)

    let n = 0
    for (const lamp of f.lamps) {
      if (n >= MAX_LAMPS) break
      if (!lamp.visible || lamp.intensity <= 0.01) continue
      lamp.getWorldPosition(pos)
      u.lampPos.value[n]?.set(pos.x, pos.y, pos.z, HALO_RANGE)
      u.lampLight.value[n]?.copy(lamp.color).multiplyScalar(lamp.intensity * HALO)
      n++
    }
    u.lampCount.value = n

    r.setRenderTarget(this.target)
    r.render(this.scene, this.camera)
  }

  dispose(): void {
    this.target.dispose()
    this.material.dispose()
  }
}
