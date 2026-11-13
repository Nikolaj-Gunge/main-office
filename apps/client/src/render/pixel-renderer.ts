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

/** Bright-pass: what glows (light panels, screens, muzzle flashes). */
const BRIGHT_FRAGMENT = /* glsl */ `
  uniform sampler2D tColor;
  uniform sampler2D tOverlay;
  uniform float threshold;
  varying vec2 vUv;
  void main() {
    vec4 o = texture2D(tOverlay, vUv);
    vec3 c = texture2D(tColor, vUv).rgb * (1.0 - o.a) + o.rgb;
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    gl_FragColor = vec4(c * max(0.0, luma - threshold) / max(luma, 1e-4), 1.0);
  }
`

/**
 * FXAA (the classic "lite" version): finds edges by luma and blends along them, so smooth mode
 * has no stair-stepped edges, then sharpens a little. Reads and writes display colour (sRGB).
 */
const FXAA_FRAGMENT = /* glsl */ `
  uniform sampler2D tInput;
  uniform vec2 texel;
  varying vec2 vUv;
  void main() {
    const vec3 LUMA = vec3(0.299, 0.587, 0.114);
    vec3 nw = texture2D(tInput, vUv + vec2(-1.0, -1.0) * texel).rgb;
    vec3 ne = texture2D(tInput, vUv + vec2(1.0, -1.0) * texel).rgb;
    vec3 sw = texture2D(tInput, vUv + vec2(-1.0, 1.0) * texel).rgb;
    vec3 se = texture2D(tInput, vUv + vec2(1.0, 1.0) * texel).rgb;
    vec3 m = texture2D(tInput, vUv).rgb;
    float lNW = dot(nw, LUMA);
    float lNE = dot(ne, LUMA);
    float lSW = dot(sw, LUMA);
    float lSE = dot(se, LUMA);
    float lM = dot(m, LUMA);
    float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
    float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
    vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
    float reduce = max((lNW + lNE + lSW + lSE) * (0.25 / 8.0), 1.0 / 128.0);
    float rcpMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
    dir = clamp(dir * rcpMin, vec2(-8.0), vec2(8.0)) * texel;
    vec3 a = 0.5 * (texture2D(tInput, vUv + dir * (1.0 / 3.0 - 0.5)).rgb +
                    texture2D(tInput, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
    vec3 b = a * 0.5 + 0.25 * (texture2D(tInput, vUv - dir * 0.5).rgb +
                               texture2D(tInput, vUv + dir * 0.5).rgb);
    float lB = dot(b, LUMA);
    vec3 c = (lB < lMin || lB > lMax) ? a : b;
    // A touch of sharpening against the softness of the upscale.
    c += (c - (nw + ne + sw + se) * 0.25) * 0.3;
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
  }
`

/** Separable 9-tap gaussian blur. */
const BLUR_FRAGMENT = /* glsl */ `
  uniform sampler2D tInput;
  uniform vec2 direction; // texel step
  varying vec2 vUv;
  void main() {
    vec3 sum = texture2D(tInput, vUv).rgb * 0.227027;
    sum += texture2D(tInput, vUv + direction * 1.3846).rgb * 0.316216;
    sum += texture2D(tInput, vUv - direction * 1.3846).rgb * 0.316216;
    sum += texture2D(tInput, vUv + direction * 3.2308).rgb * 0.070270;
    sum += texture2D(tInput, vUv - direction * 3.2308).rgb * 0.070270;
    gl_FragColor = vec4(sum, 1.0);
  }
`

function createPostUniforms(
  target: THREE.WebGLRenderTarget,
  overlay: THREE.WebGLRenderTarget,
  bloom: THREE.WebGLRenderTarget,
  size: THREE.Vector2,
) {
  return {
    tColor: { value: target.texture },
    tOverlay: { value: overlay.texture },
    tBloom: { value: bloom.texture },
    bloomStrength: { value: 0.6 },
    tDepth: { value: target.depthTexture },
    resolution: { value: size },
    cameraNear: { value: 0.1 },
    cameraFar: { value: 1000 },
    exposure: { value: 1 },
    colorMode: { value: 1 },
    levels: { value: 24 },
    dither: { value: 1 },
    outlines: { value: 0.35 },
    contrast: { value: 0.6 },
    saturation: { value: 1.25 },
    vignette: { value: 0.4 },
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
  /** Extra pixel size from automatic quality (see AutoQuality). */
  private bias = 0
  // Bloom: bright-pass and ping-pong blur at half resolution, smooth (linear) on purpose — the
  // glow is then quantized and dithered with everything else in the post pass.
  private readonly bloomA: THREE.WebGLRenderTarget
  private readonly bloomB: THREE.WebGLRenderTarget
  private readonly fxScene = new THREE.Scene()
  private readonly fxQuad: THREE.Mesh
  private readonly brightMaterial: THREE.ShaderMaterial
  private readonly blurMaterial: THREE.ShaderMaterial
  private readonly blurUniforms = {
    tInput: { value: null as THREE.Texture | null },
    direction: { value: new THREE.Vector2() },
  }
  private bloomEnabled = true
  /** Smooth mode: soft upscaling, fractional pixel size, and an FXAA pass after the post pass. */
  private smooth = false
  private readonly postTarget: THREE.WebGLRenderTarget
  private readonly fxaaMaterial: THREE.ShaderMaterial
  private readonly fxaaUniforms = {
    tInput: { value: null as THREE.Texture | null },
    texel: { value: new THREE.Vector2() },
  }

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

    const bloomOptions = {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    }
    this.bloomA = new THREE.WebGLRenderTarget(1, 1, bloomOptions)
    this.bloomB = new THREE.WebGLRenderTarget(1, 1, bloomOptions)
    this.brightMaterial = new THREE.ShaderMaterial({
      vertexShader: POST_VERTEX,
      fragmentShader: BRIGHT_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: this.target.texture },
        tOverlay: { value: this.overlayTarget.texture },
        threshold: { value: 0.95 },
      },
    })
    this.blurMaterial = new THREE.ShaderMaterial({
      vertexShader: POST_VERTEX,
      fragmentShader: BLUR_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: this.blurUniforms,
    })
    this.fxQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.brightMaterial)
    this.fxQuad.frustumCulled = false
    this.fxScene.add(this.fxQuad)

    this.postTarget = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    })
    this.fxaaUniforms.tInput.value = this.postTarget.texture
    this.fxaaMaterial = new THREE.ShaderMaterial({
      vertexShader: POST_VERTEX,
      fragmentShader: FXAA_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: this.fxaaUniforms,
    })

    this.uniforms = createPostUniforms(this.target, this.overlayTarget, this.bloomA, this.size)
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
      u.palette.value[i]?.set(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
    })
    u.paletteSize.value = colors.length

    if (settings.pixelHeight !== this.targetHeight || settings.smoothPixels !== this.smooth) {
      this.targetHeight = settings.pixelHeight
      this.smooth = settings.smoothPixels
      this.canvas.style.imageRendering = this.smooth ? 'auto' : 'pixelated'
      this.resize()
    }
  }

  /** Coarser pixels by `bias` whole steps than the setting asks (automatic quality). */
  setBias(bias: number): void {
    if (bias === this.bias) return
    this.bias = bias
    this.resize()
  }

  /**
   * Sizes canvas and targets for the target height. Crisp mode picks a whole-number scale, so
   * every game pixel is an exact square; smooth mode takes the exact ratio (soft upscaling hides
   * the in-between), and automatic quality's steps are a third coarser each instead of a whole.
   */
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
    this.bloomA.setSize(Math.max(1, Math.ceil(w / 2)), Math.max(1, Math.ceil(h / 2)))
    this.bloomB.setSize(Math.max(1, Math.ceil(w / 2)), Math.max(1, Math.ceil(h / 2)))
    this.postTarget.setSize(w, h)
    this.fxaaUniforms.texel.value.set(1 / w, 1 / h)
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
    if (this.bloomEnabled) this.renderBloom()
    if (!this.smooth) {
      r.setRenderTarget(null)
      r.render(this.postScene, this.postCamera)
      return
    }
    // Smooth: grade into a target, then anti-alias onto the screen.
    r.setRenderTarget(this.postTarget)
    r.render(this.postScene, this.postCamera)
    this.fxQuad.material = this.fxaaMaterial
    r.setRenderTarget(null)
    r.render(this.fxScene, this.postCamera)
  }

  private renderBloom(): void {
    const r = this.renderer
    this.fxQuad.material = this.brightMaterial
    r.setRenderTarget(this.bloomA)
    r.render(this.fxScene, this.postCamera)
    // Two blur rounds (H+V each) for a wider, softer glow.
    const u = this.blurUniforms
    this.fxQuad.material = this.blurMaterial
    for (const spread of [1, 2]) {
      u.tInput.value = this.bloomA.texture
      u.direction.value.set(spread / this.bloomA.width, 0)
      r.setRenderTarget(this.bloomB)
      r.render(this.fxScene, this.postCamera)
      u.tInput.value = this.bloomB.texture
      u.direction.value.set(0, spread / this.bloomB.height)
      r.setRenderTarget(this.bloomA)
      r.render(this.fxScene, this.postCamera)
    }
  }
}
