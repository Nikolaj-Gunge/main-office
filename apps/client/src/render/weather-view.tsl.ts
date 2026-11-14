import * as THREE from 'three'
import {
  abs,
  attribute,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  Discard,
  distance,
  dot,
  Fn,
  fract,
  If,
  length,
  max,
  mix,
  mod,
  modelViewMatrix,
  normalize,
  positionGeometry,
  pow,
  renderGroup,
  select,
  sin,
  smoothstep,
  step,
  texture,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
  viewportSize,
} from 'three/tsl'
import { type Node, NodeMaterial } from 'three/webgpu'
import { FIREFLY_REACH, STREAK_SECONDS, WISP_REACH } from './weather-view.ts'

/*
 * TSL twins of the weather's ShaderMaterials (weather-view.ts) for the WebGPU renderer: rain,
 * splashes, mist and fireflies, line for line. They read the GLSL materials' own uniforms, so
 * WeatherView drives both. WebGPU draws points one pixel big, so splashes and fireflies are drawn
 * as instanced quads instead (one per point, sharing the points' buffers). Keep them in step.
 */

type Uniforms = Record<string, THREE.IUniform>

/** A number the GLSL material's uniform holds (render group: refreshed every frame). */
const num = (u: Uniforms, name: string) =>
  uniform(0)
    .setGroup(renderGroup)
    .onRenderUpdate(() => u[name]?.value as number)
/** A vector the GLSL material's uniform holds (changed in place). */
const vec = (u: Uniforms, name: string) =>
  uniform(u[name]?.value as THREE.Vector3).setGroup(renderGroup)
/** A colour the GLSL material's uniform holds (changed in place). */
const rgb = (u: Uniforms, name: string) =>
  uniform(u[name]?.value as THREE.Color).setGroup(renderGroup)

const OFF_SCREEN = vec4(2, 2, 2, 1)

function twinMaterial(from: THREE.ShaderMaterial): NodeMaterial {
  const m = new NodeMaterial()
  m.transparent = from.transparent
  m.depthWrite = from.depthWrite
  m.blending = from.blending
  m.fog = false
  m.lights = false
  return m
}

function rain(from: THREE.ShaderMaterial): NodeMaterial {
  const u = from.uniforms
  const center = vec(u, 'uCenter')
  const box = vec(u, 'uBox')
  const offset = vec(u, 'uOffset')
  const vel = vec(u, 'uVel')
  const look = vec(u, 'uLook')
  const amount = num(u, 'uAmount')
  const torch = num(u, 'uTorch')
  const color = rgb(u, 'uColor')
  const alpha = num(u, 'uAlpha')

  const rand = attribute<'vec4'>('aRand', 'vec4')
  const end = attribute<'float'>('aEnd', 'float')
  const hidden = rand.w.greaterThan(amount)
  // Each drop falls through the box and comes round again: the box goes where you go.
  const low = center.sub(box.mul(0.5))
  const p = mod(rand.xyz.mul(box).add(offset).sub(low), box)
    .add(low)
    .sub(vel.mul(STREAK_SECONDS).mul(end))
  const to = p.sub(center)
  const d = length(to)
  const fade = smoothstep(1.2, 3.5, d)
    .mul(smoothstep(box.x.mul(0.22), box.x.mul(0.5), d).oneMinus())
    .mul(end.mul(-0.7).add(1))
  // Your torch catches the drops in front of you (not the ones right at your face).
  const lit = torch
    .mul(smoothstep(0.82, 0.97, dot(to.div(max(d, 0.001)), look)))
    .mul(smoothstep(1.5, 4, d))
    .mul(smoothstep(3, 16, d).oneMinus())
  const vFade = varying(select(hidden, 0, fade))
  const vLit = varying(select(hidden, 0, lit))

  const m = twinMaterial(from)
  m.vertexNode = select(
    hidden,
    OFF_SCREEN,
    cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(p, 1)),
  )
  m.fragmentNode = Fn(() => {
    const a = alpha.mul(vFade).add(vLit.mul(0.5))
    If(a.lessThan(0.01), () => Discard())
    return vec4(vec3(0.85, 0.8, 0.68).mul(vLit).add(color), a)
  })()
  return m
}

/** Clip position of a quad corner around `mv` (view space), `size` pixels across. */
const spriteCorner = (mv: Node<'vec4'>, size: Node<'float'>) => {
  const clip = cameraProjectionMatrix.mul(mv)
  return clip.add(vec4(positionGeometry.xy.mul(size).div(viewportSize).mul(clip.w), 0, 0))
}

function splash(from: THREE.ShaderMaterial): NodeMaterial {
  const u = from.uniforms
  const now = num(u, 'uNow')
  const pointScale = num(u, 'uPointScale')
  const color = rgb(u, 'uColor')
  const alpha = num(u, 'uAlpha')

  const centre = attribute<'vec3'>('aCenter', 'vec3')
  const life = attribute<'vec3'>('aLife', 'vec3') // born, lifetime, water (0 ground, 1 water)
  const age = now.sub(life.x).div(life.y)
  const mv = modelViewMatrix.mul(vec4(centre, 1))
  // Rings lie flat: squashed the more, the lower you look across them.
  const squash = clamp(abs(normalize(cameraPosition.sub(centre)).y), 0.18, 1)
  const size = mix(0.16, 0.7, life.z).mul(age.mul(0.75).add(0.45))
  const vAge = varying(age)
  const vWater = varying(life.z)
  const vSquash = varying(squash)
  const q0 = varying(positionGeometry.xy)

  const m = twinMaterial(from)
  m.vertexNode = select(
    age.lessThan(0).or(age.greaterThan(1)),
    OFF_SCREEN,
    spriteCorner(mv, max(1, size.mul(pointScale).div(mv.z.negate()))),
  )
  m.fragmentNode = Fn(() => {
    const q = vec2(q0.x, q0.y.div(vSquash))
    const r = length(q)
    const ring = smoothstep(0, 0.22, abs(r.sub(vAge.mul(0.62).add(0.3)))).oneMinus()
    // A splash on the ground starts as a little burst; a ripple is a ring and nothing else.
    const burst = vWater
      .oneMinus()
      .mul(smoothstep(0, 0.45, r).oneMinus())
      .mul(smoothstep(0, 0.35, vAge).oneMinus())
    const a = ring.add(burst).mul(vAge.oneMinus()).mul(alpha)
    If(a.lessThan(0.03).or(r.greaterThan(1)), () => Discard())
    return vec4(color, a)
  })()
  return m
}

function mist(from: THREE.ShaderMaterial): NodeMaterial {
  const u = from.uniforms
  const opacity = num(u, 'uOpacity')
  const color = rgb(u, 'uColor')
  const map = u.uMap?.value as THREE.Texture

  const wisp = attribute<'vec4'>('aWisp', 'vec4') // centre, width
  const wispAlpha = attribute<'float'>('aAlpha', 'float')
  // The view matrix's first row: the camera's right.
  const right = cameraViewMatrix.transpose().mul(vec4(1, 0, 0, 0)).xyz
  const p = wisp.xyz
    .add(right.mul(positionGeometry.x).mul(wisp.w))
    .add(vec3(0, 1, 0).mul(positionGeometry.y).mul(wisp.w).mul(0.32))
  const d = distance(wisp.xz, cameraPosition.xz)
  const vAlpha = varying(
    wispAlpha
      .mul(opacity)
      .mul(smoothstep(2.5, 9, d))
      .mul(smoothstep(WISP_REACH * 0.6, WISP_REACH, d).oneMinus()),
  )

  const m = twinMaterial(from)
  m.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(p, 1))
  m.fragmentNode = Fn(() => {
    const a = texture(map, uv()).r.mul(vAlpha)
    If(a.lessThan(0.004), () => Discard())
    return vec4(color, a)
  })()
  return m
}

function fireflies(from: THREE.ShaderMaterial): NodeMaterial {
  const u = from.uniforms
  const time = num(u, 'uTime')
  const pointScale = num(u, 'uPointScale')
  const amount = num(u, 'uAmount')

  const centre = attribute<'vec3'>('aCenter', 'vec3')
  const phase = attribute<'float'>('aPhase', 'float')
  const mv = modelViewMatrix.mul(vec4(centre, 1))
  // Each one glows for a moment now and then.
  const beat = sin(time.mul(fract(phase.mul(7.13)).mul(0.9).add(0.7)).add(phase.mul(6.2831)))
  const glow = pow(max(0, beat), 6)
    .mul(amount)
    .mul(step(fract(phase.mul(3.7)), amount.add(0.05)))
    .mul(smoothstep(FIREFLY_REACH * 0.6, FIREFLY_REACH, mv.z.negate()).oneMinus())
  const vGlow = varying(glow)
  const q = varying(positionGeometry.xy)

  const m = twinMaterial(from)
  m.vertexNode = spriteCorner(
    mv,
    select(glow.greaterThan(0.01), max(1.5, pointScale.mul(0.12).div(mv.z.negate())), 0),
  )
  m.fragmentNode = Fn(() => {
    const a = smoothstep(0.2, 1, length(q)).oneMinus().mul(vGlow)
    If(a.lessThan(0.02), () => Discard())
    return vec4(vec3(0.85, 1, 0.35).mul(a.add(0.6)), a)
  })()
  return m
}

/** Points drawn as instanced quads: corners ±1, one instance per point (see sync). */
interface Sprites {
  mesh: THREE.Mesh<THREE.InstancedBufferGeometry, NodeMaterial>
  /** [point attribute, its instanced copy over the same array]. */
  shared: [THREE.BufferAttribute, THREE.InstancedBufferAttribute][]
}

function sprites(points: THREE.Points, material: NodeMaterial): Sprites {
  const geometry = new THREE.InstancedBufferGeometry()
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3),
  )
  const shared: Sprites['shared'] = []
  for (const [name, source] of Object.entries(points.geometry.attributes)) {
    if (!(source instanceof THREE.BufferAttribute)) continue
    const copy = new THREE.InstancedBufferAttribute(source.array, source.itemSize)
    copy.setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute(name === 'position' ? 'aCenter' : name, copy)
    shared.push([source, copy])
  }
  geometry.instanceCount = points.geometry.getAttribute('position').count
  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  return { mesh, shared }
}

/** What to draw in a weather object's place on WebGPU. */
export interface WeatherTwin {
  object: THREE.Object3D
  material: NodeMaterial
  /** Brings the stand-in up to date with the original (call before each draw). */
  sync(): void
}

const twins = new WeakMap<THREE.Object3D, WeatherTwin | null>()

function makeTwin(object: THREE.Object3D, material: THREE.ShaderMaterial): WeatherTwin | null {
  const same = (m: NodeMaterial): WeatherTwin => ({ object, material: m, sync: () => {} })
  if (object.name === 'rain') return same(rain(material))
  if (object.name === 'mist') return same(mist(material))
  const make = object.name === 'splashes' ? splash : object.name === 'fireflies' ? fireflies : null
  if (!make || !(object instanceof THREE.Points)) return null
  const s = sprites(object, make(material))
  return {
    object: s.mesh,
    material: s.mesh.material,
    sync: () => {
      s.mesh.matrixWorld.copy(object.matrixWorld)
      for (const [source, copy] of s.shared) copy.version = source.version
    },
  }
}

/** The WebGPU stand-in for one of WeatherView's objects, or null for anything else. */
export function weatherTwin(
  object: THREE.Object3D,
  material: THREE.ShaderMaterial,
): WeatherTwin | null {
  let twin = twins.get(object)
  if (twin === undefined) {
    twin = makeTwin(object, material)
    twins.set(object, twin)
  }
  return twin
}
