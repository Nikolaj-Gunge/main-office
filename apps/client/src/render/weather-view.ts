import {
  flashAt,
  heightAt,
  type Lake,
  type PhysicsWorld,
  PLAYER_QUERY_GROUPS,
  RAPIER,
  type Strike,
  type SurvivalDef,
  smoothstep,
  strikesBetween,
  WEATHER_PRESETS,
  type Weather,
  type WeatherKind,
  type WeatherShared,
  weatherAt,
} from '@office-fps/shared'
import * as THREE from 'three'
import type { AmbientLoop, AudioEngine } from '../audio/audio-engine.ts'
import type { SkyWeather } from './night.ts'
import { wind } from './wind.ts'

/** Rain streaks at most (two vertices each, one draw call, moved entirely on the GPU). */
const STREAKS = 6000
/** The box of rain that travels with you (m): wide, tall, deep. */
const RAIN_BOX = new THREE.Vector3(44, 26, 44)
/** How fast it falls (m/s), and how long a streak is (s of its fall). */
const FALL = 11
export const STREAK_SECONDS = 0.05
/** Splashes and ripples alive at once, how far around you, and for how long (s). */
const SPLASHES = 420
const SPLASH_REACH = 13
/** Low fog drifting through the trees, and fireflies. */
const WISPS = 34
export const WISP_REACH = 46
const FIREFLIES = 70
export const FIREFLY_REACH = 24
/** Seconds between looking up for a roof over your head. */
const ROOF_EVERY = 0.3
/** Speed of sound (m/s): thunder comes this much later per metre. */
const SOUND = 343

const smooth = (a: number, b: number, v: number) => smoothstep(a, b, v)

/**
 * Size points in metres: `gl_PointSize = size * uPointScale / -mvPosition.z`. The scale depends
 * on the height of whatever is being drawn into (the pixel pass draws into a small target).
 */
function pointScale(
  material: THREE.ShaderMaterial,
  renderer: THREE.WebGLRenderer,
  camera: THREE.Camera,
) {
  const target = renderer.getRenderTarget()
  const height = target ? target.height : renderer.getDrawingBufferSize(new THREE.Vector2()).y
  const uniform = material.uniforms.uPointScale
  if (uniform)
    uniform.value = (height * (camera as THREE.PerspectiveCamera).projectionMatrix.elements[5]) / 2
}

const RAIN_VERTEX = /* glsl */ `
  attribute vec4 aRand;
  attribute float aEnd;
  uniform vec3 uCenter;
  uniform vec3 uBox;
  uniform vec3 uOffset;
  uniform vec3 uVel;
  uniform float uAmount;
  uniform vec3 uLook;
  uniform float uTorch;
  varying float vFade;
  varying float vLit;
  void main() {
    if (aRand.w > uAmount) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      vFade = 0.0;
      vLit = 0.0;
      return;
    }
    // Each drop falls through the box and comes round again: the box goes where you go.
    vec3 low = uCenter - uBox * 0.5;
    vec3 p = mod(aRand.xyz * uBox + uOffset - low, uBox) + low;
    p -= uVel * ${STREAK_SECONDS.toFixed(3)} * aEnd;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    vec3 to = p - uCenter;
    float d = length(to);
    vFade = smoothstep(1.2, 3.5, d) * (1.0 - smoothstep(uBox.x * 0.22, uBox.x * 0.5, d)) * (1.0 - aEnd * 0.7);
    // Your torch catches the drops in front of you (not the ones right at your face).
    vLit = uTorch * smoothstep(0.82, 0.97, dot(to / max(d, 0.001), uLook)) * smoothstep(1.5, 4.0, d) * (1.0 - smoothstep(3.0, 16.0, d));
  }
`

const RAIN_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  varying float vFade;
  varying float vLit;
  void main() {
    float a = uAlpha * vFade + vLit * 0.5;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor + vec3(0.85, 0.8, 0.68) * vLit, a);
  }
`

const SPLASH_VERTEX = /* glsl */ `
  attribute vec3 aLife; // born, lifetime, water (0 ground, 1 water)
  uniform float uNow;
  uniform float uPointScale;
  varying float vAge;
  varying float vWater;
  varying float vSquash;
  void main() {
    float age = (uNow - aLife.x) / aLife.y;
    vAge = age;
    vWater = aLife.z;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    if (age < 0.0 || age > 1.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    // Rings lie flat: squashed the more, the lower you look across them.
    vSquash = clamp(abs(normalize(cameraPosition - position).y), 0.18, 1.0);
    float size = mix(0.16, 0.7, aLife.z) * (0.45 + age * 0.75);
    gl_PointSize = max(1.0, size * uPointScale / -mv.z);
  }
`

const SPLASH_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  varying float vAge;
  varying float vWater;
  varying float vSquash;
  void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    q.y /= vSquash;
    float r = length(q);
    float ring = 1.0 - smoothstep(0.0, 0.22, abs(r - (0.3 + 0.62 * vAge)));
    // A splash on the ground starts as a little burst; a ripple is a ring and nothing else.
    float burst = (1.0 - vWater) * (1.0 - smoothstep(0.0, 0.45, r)) * (1.0 - smoothstep(0.0, 0.35, vAge));
    float a = (ring + burst) * (1.0 - vAge) * uAlpha;
    if (a < 0.03 || r > 1.0) discard;
    gl_FragColor = vec4(uColor, a);
  }
`

const WISP_VERTEX = /* glsl */ `
  attribute vec4 aWisp; // centre, width
  attribute float aAlpha;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 p = aWisp.xyz + right * position.x * aWisp.w + vec3(0.0, 1.0, 0.0) * position.y * aWisp.w * 0.32;
    vUv = uv;
    float d = distance(aWisp.xz, cameraPosition.xz);
    vAlpha = aAlpha * uOpacity * smoothstep(2.5, 9.0, d) * (1.0 - smoothstep(${(WISP_REACH * 0.6).toFixed(1)}, ${WISP_REACH.toFixed(1)}, d));
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`

const WISP_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    float a = texture2D(uMap, vUv).r * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor, a);
  }
`

const FIREFLY_VERTEX = /* glsl */ `
  attribute float aPhase;
  uniform float uTime;
  uniform float uPointScale;
  uniform float uAmount;
  varying float vGlow;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // Each one glows for a moment now and then.
    float beat = sin(uTime * (0.7 + fract(aPhase * 7.13) * 0.9) + aPhase * 6.2831);
    vGlow = pow(max(0.0, beat), 6.0) * uAmount * step(fract(aPhase * 3.7), uAmount + 0.05);
    vGlow *= 1.0 - smoothstep(${(FIREFLY_REACH * 0.6).toFixed(1)}, ${FIREFLY_REACH.toFixed(1)}, -mv.z);
    gl_PointSize = vGlow > 0.01 ? max(1.5, 0.12 * uPointScale / -mv.z) : 0.0;
  }
`

const FIREFLY_FRAGMENT = /* glsl */ `
  varying float vGlow;
  void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float a = (1.0 - smoothstep(0.2, 1.0, length(q))) * vGlow;
    if (a < 0.02) discard;
    gl_FragColor = vec4(vec3(0.85, 1.0, 0.35) * (0.6 + a), a);
  }
`

/** A soft, lumpy smudge of mist: bright in the middle, gone at the edges. */
function mistTexture(): THREE.DataTexture {
  const w = 64
  const h = 32
  const data = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w - 0.5
      const v = (y + 0.5) / h - 0.5
      const edge = Math.max(0, 1 - Math.hypot(u * 2, v * 2.2))
      const lumps =
        0.6 + 0.25 * Math.sin(x * 0.45 + Math.sin(y * 0.6) * 2) + 0.15 * Math.sin(x * 1.3 - y * 0.9)
      const a = Math.round(255 * Math.min(1, edge * edge * lumps * 1.3))
      data.set([a, a, a, 255], (y * w + x) * 4)
    }
  }
  const texture = new THREE.DataTexture(data, w, h)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

/**
 * Survival's weather, as you see and hear it: rain streaks that travel with you and lean in the
 * wind, splashes on the ground and rings on the lakes, wet ground, mist creeping through the
 * trees at night, fireflies on calm nights, lightning and the thunder after it, and the rain's
 * hiss. What the weather *is* comes from the server (a seed and a clock, see weather.ts); all of
 * this is only how it looks.
 */
export class WeatherView {
  readonly root = new THREE.Group()
  /** The weather now. */
  weather: Weather = WEATHER_PRESETS.clear
  /** Lightning lighting things up, 0–1. */
  flash = 0
  /** How soaked the ground is, 0–1 (catches up with the rain over a minute or two). */
  wet = 0
  /** A roof over your head: no rain drawn, and the rain sounds dull. */
  indoors = false
  /** Dev and screenshots: hold the weather at this kind here (not on the server), or null. */
  force: WeatherKind | null = null

  private readonly def: SurvivalDef
  private readonly physics: PhysicsWorld
  private readonly audio: AudioEngine
  private shared: WeatherShared | null = null
  private sharedAt = 0
  private lastClock = -1
  private lastStrike = -1
  private sinceRoof = ROOF_EVERY
  private inside = 0
  private started = false
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })
  /** Top of whatever is under each square metre (ground, roof, car), looked up once. */
  private readonly tops = new Map<number, number>()
  private readonly look = new THREE.Vector3()
  private readonly offset = new THREE.Vector3()
  private readonly start = performance.now() / 1000

  private readonly rain: THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial>
  private readonly splashes: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  private readonly splashLife: Float32Array
  private splashCursor = 0
  private splashOwed = 0
  private readonly wisps: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>
  private readonly wispData: Float32Array
  private readonly wispAlpha: Float32Array
  private readonly fireflies: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  private readonly fireflyHome: Float32Array
  private loops: { light: AmbientLoop; heavy: AmbientLoop } | null = null

  constructor(def: SurvivalDef, physics: PhysicsWorld, audio: AudioEngine) {
    this.def = def
    this.physics = physics
    this.audio = audio
    this.root.name = 'weather'

    // Rain: random spots in a unit box, a head and a tail vertex each.
    const rand = new Float32Array(STREAKS * 2 * 4)
    const end = new Float32Array(STREAKS * 2)
    const position = new Float32Array(STREAKS * 2 * 3)
    for (let i = 0; i < STREAKS; i++) {
      const r = [Math.random(), Math.random(), Math.random(), Math.random()]
      rand.set(r, i * 8)
      rand.set(r, i * 8 + 4)
      end[i * 2 + 1] = 1
    }
    const rainGeometry = new THREE.BufferGeometry()
    rainGeometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
    rainGeometry.setAttribute('aRand', new THREE.BufferAttribute(rand, 4))
    rainGeometry.setAttribute('aEnd', new THREE.BufferAttribute(end, 1))
    this.rain = new THREE.LineSegments(
      rainGeometry,
      new THREE.ShaderMaterial({
        vertexShader: RAIN_VERTEX,
        fragmentShader: RAIN_FRAGMENT,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uCenter: { value: new THREE.Vector3() },
          uBox: { value: RAIN_BOX },
          uOffset: { value: this.offset },
          uVel: { value: new THREE.Vector3(0, -FALL, 0) },
          uAmount: { value: 0 },
          uLook: { value: this.look },
          uTorch: { value: 0 },
          uColor: { value: new THREE.Color() },
          uAlpha: { value: 0.4 },
        },
      }),
    )
    this.rain.frustumCulled = false
    this.rain.name = 'rain'
    this.rain.renderOrder = 2

    // Splashes: points that live a moment where a drop landed.
    const splashGeometry = new THREE.BufferGeometry()
    splashGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(SPLASHES * 3), 3),
    )
    this.splashLife = new Float32Array(SPLASHES * 3).fill(-10)
    splashGeometry.setAttribute('aLife', new THREE.BufferAttribute(this.splashLife, 3))
    this.splashes = new THREE.Points(
      splashGeometry,
      new THREE.ShaderMaterial({
        vertexShader: SPLASH_VERTEX,
        fragmentShader: SPLASH_FRAGMENT,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uNow: { value: 0 },
          uPointScale: { value: 300 },
          uColor: { value: new THREE.Color() },
          uAlpha: { value: 0.5 },
        },
      }),
    )
    this.splashes.frustumCulled = false
    this.splashes.name = 'splashes'
    this.splashes.onBeforeRender = (renderer, _scene, camera) =>
      pointScale(this.splashes.material, renderer, camera)

    // Mist: camera-facing smudges, low over the ground.
    const plane = new THREE.PlaneGeometry(1, 1)
    const wispGeometry = new THREE.InstancedBufferGeometry()
    wispGeometry.index = plane.index
    wispGeometry.setAttribute('position', plane.getAttribute('position'))
    wispGeometry.setAttribute('uv', plane.getAttribute('uv'))
    this.wispData = new Float32Array(WISPS * 4)
    this.wispAlpha = new Float32Array(WISPS)
    wispGeometry.setAttribute('aWisp', new THREE.InstancedBufferAttribute(this.wispData, 4))
    wispGeometry.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(this.wispAlpha, 1))
    wispGeometry.instanceCount = WISPS
    this.wisps = new THREE.Mesh(
      wispGeometry,
      new THREE.ShaderMaterial({
        vertexShader: WISP_VERTEX,
        fragmentShader: WISP_FRAGMENT,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uMap: { value: mistTexture() },
          uColor: { value: new THREE.Color() },
          uOpacity: { value: 0 },
        },
      }),
    )
    this.wisps.frustumCulled = false
    this.wisps.name = 'mist'
    this.wisps.renderOrder = 1

    // Fireflies: a few dozen glints hovering about the undergrowth.
    const fireflyGeometry = new THREE.BufferGeometry()
    this.fireflyHome = new Float32Array(FIREFLIES * 3)
    fireflyGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(FIREFLIES * 3), 3),
    )
    fireflyGeometry.setAttribute(
      'aPhase',
      new THREE.BufferAttribute(
        Float32Array.from({ length: FIREFLIES }, () => Math.random()),
        1,
      ),
    )
    this.fireflies = new THREE.Points(
      fireflyGeometry,
      new THREE.ShaderMaterial({
        vertexShader: FIREFLY_VERTEX,
        fragmentShader: FIREFLY_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uPointScale: { value: 300 }, uAmount: { value: 0 } },
      }),
    )
    this.fireflies.frustumCulled = false
    this.fireflies.name = 'fireflies'
    this.fireflies.onBeforeRender = (renderer, _scene, camera) =>
      pointScale(this.fireflies.material, renderer, camera)

    this.root.add(this.rain, this.splashes, this.wisps, this.fireflies)
  }

  /** The server's word on the weather (once a second). */
  setShared(weather: WeatherShared | undefined): void {
    if (!weather) return
    this.shared = weather
    this.sharedAt = performance.now()
  }

  /** The weather clock now: the server's, run on since it last said. */
  get clock(): number {
    if (!this.shared) return 0
    return this.shared.clock + (performance.now() - this.sharedAt) / 1000
  }

  private get pin(): WeatherKind | undefined {
    return this.force ?? this.shared?.pin
  }

  /**
   * Every frame. Returns what the weather does to the light (for night.ts).
   * @param daylight 0 night … 1 day
   * @param torch    how bright your torch is, 0–1
   */
  update(
    dt: number,
    camera: THREE.Camera,
    daylight: number,
    torch: number,
    fogColor: THREE.Color,
  ): SkyWeather {
    const eye = camera.position
    const clock = this.clock
    const seed = this.shared?.seed ?? 0
    this.weather =
      this.shared || this.force ? weatherAt(seed, clock, this.pin) : WEATHER_PRESETS.clear
    const w = this.weather
    wind.weather = w.wind

    // Lightning, and the thunder that follows (sound takes its time).
    this.flash = this.shared ? flashAt(seed, clock, this.pin) : 0
    if (this.shared && this.lastClock >= 0 && clock > this.lastClock) {
      for (const strike of strikesBetween(seed, this.lastClock, clock, this.pin)) {
        if (strike.at <= this.lastStrike) continue
        this.lastStrike = strike.at
        this.thunder(strike, clock, eye)
      }
    }
    this.lastClock = Math.max(this.lastClock, clock)

    // The ground soaks it up over a minute or so, and dries more slowly.
    const soakTo = Math.min(1, w.rain * 1.6)
    if (!this.started) this.wet = soakTo
    this.wet += (soakTo - this.wet) * Math.min(1, dt / (soakTo > this.wet ? 40 : 160))

    // Under a roof?
    this.sinceRoof += dt
    if (this.sinceRoof >= ROOF_EVERY) {
      this.sinceRoof = 0
      this.indoors = this.roofOver(eye)
    }
    this.inside += ((this.indoors ? 1 : 0) - this.inside) * Math.min(1, dt * 6)
    const outside = 1 - this.inside

    camera.getWorldDirection(this.look)
    const t = performance.now() / 1000 - this.start
    this.updateRain(dt, eye, daylight, torch, outside, fogColor)
    this.updateSplashes(dt, eye, t, daylight, outside)
    this.updateWisps(dt, eye, daylight, fogColor)
    this.updateFireflies(eye, t, daylight, outside)
    this.updateSound(outside)
    this.started = true
    return { cloud: w.cloud, rain: w.rain, fog: w.fog, flash: this.flash }
  }

  private updateRain(
    dt: number,
    eye: THREE.Vector3,
    daylight: number,
    torch: number,
    outside: number,
    fogColor: THREE.Color,
  ): void {
    const w = this.weather
    const u = this.rain.material.uniforms
    const amount = w.rain > 0.01 ? Math.min(1, w.rain ** 0.8) * outside : 0
    this.rain.visible = amount > 0.005
    if (!this.rain.visible) return
    // Blown along by the wind, the more so in a gale.
    const blow = 1 + wind.gust * (2 + w.wind * 5)
    const vel = (u.uVel as THREE.IUniform<THREE.Vector3>).value
    vel.set(wind.dir.x * blow, -FALL * (0.9 + w.rain * 0.2), wind.dir.y * blow)
    this.offset.addScaledVector(vel, dt)
    this.offset.set(
      this.offset.x % RAIN_BOX.x,
      this.offset.y % RAIN_BOX.y,
      this.offset.z % RAIN_BOX.z,
    )
    ;(u.uCenter as THREE.IUniform<THREE.Vector3>).value.copy(eye)
    ;(u.uAmount as { value: number }).value = amount
    ;(u.uTorch as { value: number }).value = torch * (1 - daylight)
    // Grey-white by day, a faint blue glint at night, white in a lightning flash.
    ;(u.uColor as THREE.IUniform<THREE.Color>).value
      .copy(fogColor)
      .multiplyScalar(1.6)
      .addScalar(0.05 + daylight * 0.12 + this.flash * 0.8)
    ;(u.uAlpha as { value: number }).value = 0.16 + w.rain * 0.16 + daylight * 0.14
  }

  private updateSplashes(
    dt: number,
    eye: THREE.Vector3,
    t: number,
    daylight: number,
    outside: number,
  ): void {
    const w = this.weather
    const u = this.splashes.material.uniforms
    ;(u.uNow as { value: number }).value = t
    this.splashes.visible = w.rain > 0.02 && outside > 0.05
    if (!this.splashes.visible) return
    ;(u.uColor as THREE.IUniform<THREE.Color>).value.setScalar(
      // By night only a faint glint: bright specks on black ground look like snow.
      0.18 + daylight * 0.52 + this.flash * 0.6,
    )
    ;(u.uAlpha as { value: number }).value = (0.25 + 0.4 * daylight) * outside
    // As many land per second as the rain is heavy.
    this.splashOwed += dt * w.rain * 1500
    let n = Math.min(SPLASHES, Math.floor(this.splashOwed))
    this.splashOwed -= n
    if (n === 0) return
    const position = this.splashes.geometry.getAttribute('position') as THREE.BufferAttribute
    while (n-- > 0) {
      const i = this.splashCursor
      this.splashCursor = (i + 1) % SPLASHES
      const a = Math.random() * Math.PI * 2
      const r = 0.6 + Math.sqrt(Math.random()) * SPLASH_REACH
      const x = eye.x + Math.cos(a) * r
      const z = eye.z + Math.sin(a) * r
      const lake = this.lakeAt(x, z)
      const y = lake ? lake.y : this.topAt(x, z, eye.y)
      const water = lake ? 1 : 0
      position.setXYZ(i, x, y + 0.03, z)
      this.splashLife[i * 3] = t + Math.random() * 0.05
      this.splashLife[i * 3 + 1] = water ? 0.7 + Math.random() * 0.4 : 0.22 + Math.random() * 0.12
      this.splashLife[i * 3 + 2] = water
    }
    position.needsUpdate = true
    ;(this.splashes.geometry.getAttribute('aLife') as THREE.BufferAttribute).needsUpdate = true
  }

  private updateWisps(
    dt: number,
    eye: THREE.Vector3,
    daylight: number,
    fogColor: THREE.Color,
  ): void {
    const w = this.weather
    const night = 1 - daylight
    // Mist creeps through the woods at night, and lies about all day in fog; rain beats it down.
    const amount = Math.min(
      1,
      (night * (0.35 + 0.65 * w.fog) + daylight * w.fog * 0.6) * (1 - w.rain * 0.8),
    )
    const u = this.wisps.material.uniforms
    // Thicker in fog weather, where it shows against the pale fog beyond.
    ;(u.uOpacity as { value: number }).value = amount * (0.22 + w.fog * night * 0.18)
    this.wisps.visible = amount > 0.02
    if (!this.wisps.visible) return
    ;(u.uColor as THREE.IUniform<THREE.Color>).value
      .copy(fogColor)
      .multiplyScalar(1.5 + night * 0.8)
      .addScalar(0.015 + this.flash * 0.5)
    const drift = 0.25 + wind.gust * 0.6
    for (let i = 0; i < WISPS; i++) {
      const k = i * 4
      let x = this.wispData[k] as number
      let z = this.wispData[k + 2] as number
      const fresh = !this.started || Math.hypot(x - eye.x, z - eye.z) > WISP_REACH
      if (fresh) {
        // Somewhere around you (anywhere at first, then upwind, coming towards you).
        const a = this.started
          ? Math.atan2(-wind.dir.y, -wind.dir.x) + (Math.random() - 0.5) * 2.4
          : Math.random() * Math.PI * 2
        const r = this.started
          ? WISP_REACH * (0.75 + Math.random() * 0.2)
          : 4 + Math.random() * WISP_REACH * 0.9
        x = eye.x + Math.cos(a) * r
        z = eye.z + Math.sin(a) * r
        const ground = heightAt(this.def.terrain, x, z)
        // Not inside a house.
        const indoor = this.topAt(x, z, eye.y) > ground + 0.6
        this.wispAlpha[i] = indoor || this.lakeAt(x, z) ? 0 : 0.5 + Math.random() * 0.5
        this.wispData[k + 3] = 7 + Math.random() * 9
      } else {
        x += wind.dir.x * drift * dt
        z += wind.dir.y * drift * dt
      }
      const ground = heightAt(this.def.terrain, x, z)
      this.wispData[k] = x
      this.wispData[k + 1] = ground + 0.9 + (this.wispData[k + 3] as number) * 0.05
      this.wispData[k + 2] = z
    }
    const g = this.wisps.geometry
    ;(g.getAttribute('aWisp') as THREE.InstancedBufferAttribute).needsUpdate = true
    ;(g.getAttribute('aAlpha') as THREE.InstancedBufferAttribute).needsUpdate = true
  }

  private updateFireflies(eye: THREE.Vector3, t: number, daylight: number, outside: number): void {
    const w = this.weather
    // Only on calm, dry, clear nights.
    const calm =
      (1 - daylight) *
      (1 - smooth(0.01, 0.12, w.rain)) *
      (1 - smooth(0.15, 0.5, w.wind)) *
      (1 - w.fog * 0.6) *
      (1 - w.cloud * 0.4) *
      outside
    const u = this.fireflies.material.uniforms
    ;(u.uAmount as { value: number }).value = calm
    ;(u.uTime as { value: number }).value = t
    this.fireflies.visible = calm > 0.03
    if (!this.fireflies.visible) return
    const position = this.fireflies.geometry.getAttribute('position') as THREE.BufferAttribute
    const home = this.fireflyHome
    for (let i = 0; i < FIREFLIES; i++) {
      const k = i * 3
      let hx = home[k] as number
      let hz = home[k + 2] as number
      if (!this.started || Math.hypot(hx - eye.x, hz - eye.z) > FIREFLY_REACH) {
        const a = Math.random() * Math.PI * 2
        const r = 2 + Math.sqrt(Math.random()) * (FIREFLY_REACH - 3)
        hx = eye.x + Math.cos(a) * r
        hz = eye.z + Math.sin(a) * r
        home[k] = hx
        home[k + 1] = heightAt(this.def.terrain, hx, hz) + 0.4 + Math.random() * 1.8
        home[k + 2] = hz
      }
      // Lazy loops about where it lives.
      const p = i * 1.7
      position.setXYZ(
        i,
        hx + Math.sin(t * 0.31 + p) * 1.3 + Math.sin(t * 0.83 + p * 2) * 0.3,
        (home[k + 1] as number) + Math.sin(t * 0.47 + p * 3) * 0.35,
        hz + Math.cos(t * 0.27 + p) * 1.3 + Math.cos(t * 0.71 + p * 2) * 0.3,
      )
    }
    position.needsUpdate = true
  }

  /** Rain hissing in the trees, drumming on the roof when you're in. */
  private updateSound(outside: number): void {
    if (!this.loops && this.audio.ready) {
      const light = this.audio.loop('rain.light')
      const heavy = this.audio.loop('rain.heavy')
      if (light && heavy) this.loops = { light, heavy }
    }
    if (!this.loops) return
    const rain = this.weather.rain
    const heavy = smooth(0.3, 0.9, rain)
    const level = 0.55 + 0.45 * outside
    const dull = 700 + 19300 * outside ** 2
    this.loops.light.set(smooth(0.01, 0.25, rain) * (1 - heavy * 0.6) * 0.5 * level, dull)
    this.loops.heavy.set(heavy * 0.75 * level, dull)
  }

  /** A bolt somewhere out there: the thunder arrives when the sound gets here. */
  private thunder(strike: Strike, clock: number, eye: THREE.Vector3): void {
    const delay = strike.distance / SOUND - (clock - strike.at)
    if (delay < -1) return
    const near = strike.distance < 700
    const at = {
      x: eye.x + Math.cos(strike.bearing) * 60,
      y: eye.y + 35,
      z: eye.z + Math.sin(strike.bearing) * 60,
    }
    const volume = 0.35 + 0.65 * (1 - smooth(150, 2800, strike.distance))
    this.audio.play(near ? 'thunder.near' : 'thunder.far', {
      at,
      volume: volume * (this.indoors ? 0.7 : 1),
      delay: Math.max(0, delay),
      lowpass: near ? 9000 : 1400 + 2000 * (1 - smooth(700, 2800, strike.distance)),
      rate: 0.9 + Math.random() * 0.15,
    })
  }

  /** Is there a roof (anything solid) above (x, y, z)? */
  private roofOver(eye: THREE.Vector3): boolean {
    this.ray.origin = { x: eye.x, y: eye.y + 0.2, z: eye.z }
    this.ray.dir = { x: 0, y: 1, z: 0 }
    return this.physics.world.castRay(this.ray, 40, true, undefined, PLAYER_QUERY_GROUPS) !== null
  }

  /** The top of whatever is at (x, z): the ground, or a roof, a car, a wall (looked up once). */
  private topAt(x: number, z: number, eyeY: number): number {
    const ix = Math.floor(x)
    const iz = Math.floor(z)
    const key = (ix + 8192) * 16384 + (iz + 8192)
    const known = this.tops.get(key)
    if (known !== undefined) return known
    if (this.tops.size > 40000) this.tops.clear()
    const ground = heightAt(this.def.terrain, ix + 0.5, iz + 0.5)
    const from = Math.max(eyeY, ground) + 30
    this.ray.origin = { x: ix + 0.5, y: from, z: iz + 0.5 }
    this.ray.dir = { x: 0, y: -1, z: 0 }
    const hit = this.physics.world.castRay(
      this.ray,
      from - ground + 1,
      true,
      undefined,
      PLAYER_QUERY_GROUPS,
    )
    const top = hit ? Math.max(ground, from - hit.timeOfImpact) : ground
    this.tops.set(key, top)
    return top
  }

  /** The lake whose water is at (x, z), if any. */
  private lakeAt(x: number, z: number): Lake | null {
    for (const lake of this.def.lakes) {
      if (Math.hypot(x - lake.x, z - lake.z) > lake.r + 28) continue
      if (heightAt(this.def.terrain, x, z) < lake.y) return lake
    }
    return null
  }

  dispose(): void {
    for (const o of [this.rain, this.splashes, this.wisps, this.fireflies]) {
      o.geometry.dispose()
      o.material.dispose()
    }
  }
}
