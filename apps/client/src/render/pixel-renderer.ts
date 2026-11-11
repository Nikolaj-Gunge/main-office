import * as THREE from 'three'
import { COLOR_MODES, type Settings } from '../settings.ts'
import { MAX_PALETTE_SIZE, PALETTES } from './palettes.ts'
import postFragment from './shaders/post.frag.glsl?raw'

const POST_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

function createPostUniforms(
  target: THREE.WebGLRenderTarget,
  overlay: THREE.WebGLRenderTarget,
  size: THREE.Vector2,
) {
  return {
    tColor: { value: target.texture },
    tOverlay: { value: overlay.texture },
    tDepth: { value: target.depthTexture },
    resolution: { value: size },
    cameraNear: { value: 0.1 },
    cameraFar: { value: 1000 },
    exposure: { value: 1 },
    colorMode: { value: 1 },
    levels: { value: 24 },
    dither: { value: 1 },
    outlines: { value: 0.35 },
    palette: { value: Array.from({ length: MAX_PALETTE_SIZE }, () => new THREE.Vector3()) },
    paletteSize: { value: 0 },
  }
}

/**
 * Renders the scene into a low-resolution HDR target, then runs the pixel-art post pass into a
 * canvas of the same size. CSS scales the canvas up by a whole number with nearest-neighbour,
 * so every game pixel is an exact square of screen pixels — no uneven or blurry pixels.
 */
export class PixelRenderer {
  readonly renderer: THREE.WebGLRenderer
  readonly target: THREE.WebGLRenderTarget
  /** Viewmodel layer: own color + depth, transparent where there is no gun. */
  readonly overlayTarget: THREE.WebGLRenderTarget
  /** Internal resolution in game pixels. */
  readonly size = new THREE.Vector2(1, 1)
  /** Screen pixels per game pixel. */
  scale = 1

  private readonly postScene = new THREE.Scene()
  private readonly postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly uniforms: ReturnType<typeof createPostUniforms>
  private targetHeight = 270

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(1)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap

    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
    })

    this.overlayTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    })

    this.uniforms = createPostUniforms(this.target, this.overlayTarget, this.size)
    const material = new THREE.ShaderMaterial({
      vertexShader: POST_VERTEX,
      fragmentShader: postFragment,
      depthTest: false,
      depthWrite: false,
      uniforms: this.uniforms,
    })
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
    quad.frustumCulled = false
    this.postScene.add(quad)
  }

  applySettings(settings: Settings): void {
    const u = this.uniforms
    u.exposure.value = settings.exposure
    u.colorMode.value = COLOR_MODES[settings.colorMode]
    u.levels.value = settings.colorLevels
    u.dither.value = settings.dither
    u.outlines.value = settings.outlines

    const colors = (PALETTES[settings.palette] ?? PALETTES.resurrect64 ?? []).slice(
      0,
      MAX_PALETTE_SIZE,
    )
    colors.forEach((hex, i) => {
      const n = Number.parseInt(hex, 16)
      u.palette.value[i]?.set(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
    })
    u.paletteSize.value = colors.length

    if (settings.pixelHeight !== this.targetHeight) {
      this.targetHeight = settings.pixelHeight
      this.resize()
    }
  }

  /** Picks a whole-number scale closest to the target height and sizes canvas + targets. */
  resize(): void {
    const dpr = window.devicePixelRatio || 1
    const screenW = Math.round(window.innerWidth * dpr)
    const screenH = Math.round(window.innerHeight * dpr)
    this.scale = Math.max(1, Math.round(screenH / this.targetHeight))
    const w = Math.ceil(screenW / this.scale)
    const h = Math.ceil(screenH / this.scale)
    this.size.set(w, h)

    this.renderer.setSize(w, h, false)
    this.target.setSize(w, h)
    this.overlayTarget.setSize(w, h)
    // CSS size may overshoot the window by < 1 game pixel; body has overflow: hidden.
    this.canvas.style.width = `${(w * this.scale) / dpr}px`
    this.canvas.style.height = `${(h * this.scale) / dpr}px`
  }

  /**
   * World into one target, the optional viewmodel into a second (own depth, transparent
   * background), then the post pass composites both and pixelates. Keeping them apart preserves
   * the world's depth buffer for outlines while the gun can never clip into walls.
   */
  render(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    overlay?: { scene: THREE.Scene; camera: THREE.Camera },
  ): void {
    this.uniforms.cameraNear.value = camera.near
    this.uniforms.cameraFar.value = camera.far

    const r = this.renderer
    r.setRenderTarget(this.target)
    r.render(scene, camera)
    r.setRenderTarget(this.overlayTarget)
    r.setClearColor(0x000000, 0)
    r.clear()
    if (overlay) r.render(overlay.scene, overlay.camera)
    r.setClearColor(0x000000, 1)
    r.setRenderTarget(null)
    r.render(this.postScene, this.postCamera)
  }
}
