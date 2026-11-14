import * as THREE from 'three'
import { uniform } from 'three/tsl'
import { NodeMaterial, QuadMesh, RenderTarget, WebGPURenderer } from 'three/webgpu'
import { COLOR_MODES, type Settings } from '../../settings.ts'
import type { GameRenderer } from '../game-renderer.ts'
import { MAX_PALETTE_SIZE, PALETTES } from '../palettes.ts'
import { outlineFar } from '../pixel-renderer.ts'
import { shadowEdgesFaded } from '../shadow-fade.ts'
import { fadedShadowFilter } from '../shadow-fade.tsl.ts'
import { installNodeVariants } from './node-variants.ts'
import { blurNode, brightNode, createPostUniforms, fxaaNode, postNode } from './post-nodes.ts'

type ShadowCaster = THREE.Light & { shadow?: THREE.LightShadow }

function quadMaterial(node: NodeMaterial['fragmentNode']): NodeMaterial {
  const material = new NodeMaterial()
  material.fragmentNode = node
  material.depthTest = false
  material.depthWrite = false
  return material
}

/**
 * The WebGPU twin of PixelRenderer: the same targets, passes and settings, drawn by
 * WebGPURenderer with the post chain in TSL (post-nodes.ts). Also runs on WebGPURenderer's
 * WebGL 2 backend (`?renderer=webgpu-gl`), which is how it can be checked without WebGPU.
 */
export class GpuPixelRenderer implements GameRenderer {
  readonly backend: 'webgpu' | 'webgpu-gl'
  readonly target: RenderTarget
  readonly overlayTarget: RenderTarget
  readonly size = new THREE.Vector2(1, 1)
  scale = 1
  /**
   * Same switches as WebGLRenderer.shadowMap; WebGPU keeps them per light, so they are copied
   * onto every shadow-casting light before a frame (see syncShadows).
   */
  readonly shadows = { autoUpdate: true, needsUpdate: false }

  private targetHeight = 270
  private bias = 0
  private smooth = false
  private bloomEnabled = true
  private readonly bloomA: RenderTarget
  private readonly bloomB: RenderTarget
  private readonly postTarget: RenderTarget
  private readonly quad: QuadMesh
  private readonly uniforms = createPostUniforms()
  private readonly palette = Array.from({ length: MAX_PALETTE_SIZE }, () => new THREE.Vector3())
  private readonly texel = uniform(new THREE.Vector2())
  private readonly blurSteps = [
    { from: 'a', to: 'b', dir: uniform(new THREE.Vector2()) },
    { from: 'b', to: 'a', dir: uniform(new THREE.Vector2()) },
    { from: 'a', to: 'b', dir: uniform(new THREE.Vector2()) },
    { from: 'b', to: 'a', dir: uniform(new THREE.Vector2()) },
  ] as const
  private readonly brightMaterial: NodeMaterial
  private readonly blurMaterials: NodeMaterial[]
  private readonly postMaterial: NodeMaterial
  private readonly fxaaMaterial: NodeMaterial
  private shadowCasters: ShadowCaster[] = []

  /** Creates and starts the renderer; throws when the device can't be had. */
  static async create(canvas: HTMLCanvasElement, forceWebGL: boolean): Promise<GpuPixelRenderer> {
    const renderer = new WebGPURenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      forceWebGL,
    })
    await renderer.init()
    const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true
    // WebGPURenderer quietly drops to its WebGL 2 backend when WebGPU fails; then the
    // tried-and-tested WebGL path is the better choice.
    if (!forceWebGL && !isWebGPU) {
      renderer.dispose()
      throw new Error('WebGPU backend unavailable')
    }
    return new GpuPixelRenderer(renderer, canvas, isWebGPU ? 'webgpu' : 'webgpu-gl')
  }

  private constructor(
    readonly renderer: WebGPURenderer,
    readonly canvas: HTMLCanvasElement,
    backend: 'webgpu' | 'webgpu-gl',
  ) {
    this.backend = backend
    renderer.setPixelRatio(1)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    // The post pass does its own tone mapping and sRGB, like the GLSL one: no output transform.
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    renderer.toneMapping = THREE.NoToneMapping
    installNodeVariants(renderer)

    this.target = new RenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
    })
    this.overlayTarget = new RenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    })
    const bloomOptions = {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    }
    this.bloomA = new RenderTarget(1, 1, bloomOptions)
    this.bloomB = new RenderTarget(1, 1, bloomOptions)
    this.postTarget = new RenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    })

    this.brightMaterial = quadMaterial(
      brightNode(this.target.texture, this.overlayTarget.texture, 0.95),
    )
    this.blurMaterials = this.blurSteps.map((step) =>
      quadMaterial(blurNode((step.from === 'a' ? this.bloomA : this.bloomB).texture, step.dir)),
    )
    this.postMaterial = quadMaterial(
      postNode(
        {
          color: this.target.texture,
          overlay: this.overlayTarget.texture,
          bloom: this.bloomA.texture,
          depth: this.target.depthTexture as THREE.DepthTexture,
          resolution: this.size,
          palette: this.palette,
        },
        this.uniforms,
      ),
    )
    this.fxaaMaterial = quadMaterial(fxaaNode(this.postTarget.texture, this.texel))
    this.quad = new QuadMesh(this.postMaterial)
  }

  applySettings(settings: Settings): void {
    const u = this.uniforms
    u.exposure.value = settings.exposure
    u.colorMode.value = COLOR_MODES[settings.colorMode]
    u.levels.value = settings.colorLevels
    u.dither.value = settings.dither
    u.outlines.value = settings.outlines
    u.contrast.value = settings.contrast
    u.saturation.value = settings.saturation
    u.vignette.value = settings.vignette
    u.bloomStrength.value = settings.bloom
    this.bloomEnabled = settings.bloom > 0

    const colors = (PALETTES[settings.palette] ?? PALETTES.resurrect64 ?? []).slice(
      0,
      MAX_PALETTE_SIZE,
    )
    colors.forEach((hex, i) => {
      const n = Number.parseInt(hex, 16)
      this.palette[i]?.set(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
    })
    u.paletteSize.value = colors.length

    if (settings.pixelHeight !== this.targetHeight || settings.smoothPixels !== this.smooth) {
      this.targetHeight = settings.pixelHeight
      this.smooth = settings.smoothPixels
      this.canvas.style.imageRendering = this.smooth ? 'auto' : 'pixelated'
      this.resize()
    }
  }

  setBias(bias: number): void {
    if (bias === this.bias) return
    this.bias = bias
    this.resize()
  }

  /** As PixelRenderer.resize. */
  resize(): void {
    const dpr = window.devicePixelRatio || 1
    const screenW = Math.round(window.innerWidth * dpr)
    const screenH = Math.round(window.innerHeight * dpr)
    this.scale = this.smooth
      ? Math.max(1, screenH / this.targetHeight) * (1 + this.bias / 3)
      : Math.max(1, Math.round(screenH / this.targetHeight)) + this.bias
    const w = Math.ceil(screenW / this.scale)
    const h = Math.ceil(screenH / this.scale)
    this.size.set(w, h)

    this.renderer.setSize(w, h, false)
    this.target.setSize(w, h)
    this.overlayTarget.setSize(w, h)
    const bw = Math.max(1, Math.ceil(w / 2))
    const bh = Math.max(1, Math.ceil(h / 2))
    this.bloomA.setSize(bw, bh)
    this.bloomB.setSize(bw, bh)
    this.postTarget.setSize(w, h)
    this.texel.value.set(1 / w, 1 / h)
    // Two blur rounds (H+V each) for a wider, softer glow.
    this.blurSteps.forEach((step, i) => {
      const spread = i < 2 ? 1 : 2
      if (i % 2 === 0) step.dir.value.set(spread / bw, 0)
      else step.dir.value.set(0, spread / bh)
    })
    this.canvas.style.width = `${(w * this.scale) / dpr}px`
    this.canvas.style.height = `${(h * this.scale) / dpr}px`
  }

  maxAnisotropy(): number {
    return this.renderer.getMaxAnisotropy()
  }

  compile(scene: THREE.Scene, camera: THREE.Camera): void {
    // A real draw into the scene target (same formats, so the same pipelines), not
    // compileAsync: the caller hides and disposes its stand-ins right after, which races the
    // async pipeline builds ("Binding doesn't exist" errors).
    const r = this.renderer
    r.setRenderTarget(this.target)
    r.render(scene, camera)
    r.setRenderTarget(null)
  }

  /** Survival's bite on screen (see game/infection.ts); null: none. */
  setInfection(fx: { level: number; pulse: number; time: number; motion: number } | null): void {
    const u = this.uniforms
    u.infection.value = fx?.level ?? 0
    u.infectPulse.value = fx?.pulse ?? 0
    u.infectTime.value = fx?.time ?? 0
    u.infectMotion.value = fx?.motion ?? 1
  }

  setAnimationLoop(callback: (() => void) | null): void {
    void this.renderer.setAnimationLoop(callback)
  }

  render(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    overlay?: { scene: THREE.Scene; camera: THREE.Camera },
  ): void {
    this.uniforms.cameraNear.value = camera.near
    this.uniforms.cameraFar.value = camera.far
    this.uniforms.outlineFar.value = outlineFar(scene)
    this.syncShadows(scene)

    const r = this.renderer
    r.setRenderTarget(this.target)
    r.render(scene, camera)
    r.setRenderTarget(this.overlayTarget)
    r.setClearColor(0x000000, 0)
    r.clear()
    if (overlay) r.render(overlay.scene, overlay.camera)
    r.setClearColor(0x000000, 1)
    if (this.bloomEnabled) this.renderBloom()
    if (!this.smooth) {
      this.drawQuad(this.postMaterial, null)
      return
    }
    this.drawQuad(this.postMaterial, this.postTarget)
    this.drawQuad(this.fxaaMaterial, null)
  }

  private drawQuad(material: NodeMaterial, target: RenderTarget | null): void {
    this.renderer.setRenderTarget(target)
    this.quad.material = material
    this.quad.render(this.renderer)
  }

  private renderBloom(): void {
    this.drawQuad(this.brightMaterial, this.bloomA)
    this.blurSteps.forEach((step, i) => {
      const material = this.blurMaterials[i]
      if (material) this.drawQuad(material, step.to === 'a' ? this.bloomA : this.bloomB)
    })
  }

  /**
   * WebGLRenderer.shadowMap's autoUpdate/needsUpdate, done the WebGPU way (per light). Only
   * the scene's direct children are checked each frame (where the game puts its lights); a
   * requested redraw looks through the whole scene.
   */
  private syncShadows(scene: THREE.Scene): void {
    const s = this.shadows
    if (s.needsUpdate) {
      this.shadowCasters = []
      scene.traverse((o) => {
        if ((o as THREE.Light).isLight && o.castShadow) this.shadowCasters.push(o as ShadowCaster)
      })
    } else {
      for (const o of scene.children) {
        const light = o as ShadowCaster
        if (light.isLight && light.castShadow && !this.shadowCasters.includes(light))
          this.shadowCasters.push(light)
      }
    }
    const fade = shadowEdgesFaded()
    for (const light of this.shadowCasters) {
      if (!light.shadow) continue
      // shadow-fade.ts's patch, for directional shadows (only takes on lights not yet drawn).
      if (fade && (light as THREE.DirectionalLight).isDirectionalLight)
        (light.shadow as THREE.LightShadow & { filterNode?: unknown }).filterNode =
          fadedShadowFilter
      light.shadow.autoUpdate = s.autoUpdate
      if (s.needsUpdate) light.shadow.needsUpdate = true
    }
    s.needsUpdate = false
  }
}
