import { BackSide, type Color, type Matrix3, type Vector3 } from 'three'
import {
  cameraProjectionMatrix,
  clamp,
  cos,
  cross,
  dot,
  Fn,
  floor,
  fract,
  If,
  length,
  mix,
  modelViewMatrix,
  normalize,
  positionLocal,
  pow,
  renderGroup,
  select,
  smoothstep,
  sqrt,
  step,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu'

/** As sky.ts: moon cells across its radius, and its radius (rad). */
const MOON_CELLS = 5
const MOON_RADIUS = 0.045

/** The night half of the dome's uniforms (sky-night.ts); absent on older domes. */
interface NightUniforms {
  moonDir?: { value: Vector3 }
  moonPhase?: { value: number }
  moonAlpha?: { value: number }
  moonColor?: { value: Color }
  starAlpha?: { value: number }
  starTurn?: { value: Matrix3 }
}

/** sky.ts's skyHash: a number 0–1 from a cell. */
const skyHash = (q: Node<'vec3'>): Node<'float'> => {
  const a = fract(q.mul(vec3(0.1031, 0.103, 0.0973)))
  const p = a.add(dot(a, a.yxz.add(33.33)))
  return fract(p.x.add(p.y).mul(p.z))
}

/**
 * TSL twin of the sky dome's ShaderMaterial (sky.ts) for the WebGPU renderer. Reads the very
 * Color objects in the GLSL material's uniforms, so night.ts grading them carries over; the moon
 * and stars follow sky.ts's GLSL line for line.
 */
export function skyNodeMaterial(
  uniforms: {
    topColor: { value: Color }
    horizonColor: { value: Color }
  } & NightUniforms,
): MeshBasicNodeMaterial {
  // Render group: night.ts grades these in place, and the dome itself never changes.
  const top = uniform(uniforms.topColor.value).setGroup(renderGroup)
  const horizon = uniform(uniforms.horizonColor.value).setGroup(renderGroup)
  const material = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false, fog: false })
  const dir = positionLocal.normalize().toVarying('vSkyDir')
  const gradient = mix(horizon, top, pow(clamp(dir.y, 0, 1), 0.6))
  const u = uniforms
  if (
    u.moonDir &&
    u.moonPhase &&
    u.moonAlpha &&
    u.moonColor &&
    u.starAlpha &&
    u.starTurn !== undefined
  ) {
    const moonDir = uniform(u.moonDir.value).setGroup(renderGroup)
    const moonColor = uniform(u.moonColor.value).setGroup(renderGroup)
    const starTurn = uniform(u.starTurn.value).setGroup(renderGroup)
    // Plain numbers are copied into the uniform before each frame.
    const moonPhase = uniform(0).onRenderUpdate(() => u.moonPhase?.value ?? 0)
    const moonAlpha = uniform(0).onRenderUpdate(() => u.moonAlpha?.value ?? 0)
    const starAlpha = uniform(0).onRenderUpdate(() => u.starAlpha?.value ?? 0)
    material.colorNode = Fn(() => {
      const d = normalize(dir)
      const color = vec3(gradient).toVar()
      If(starAlpha.greaterThan(0).and(d.y.greaterThan(0)), () => {
        const s = starTurn.mul(d) as unknown as Node<'vec3'>
        const cell = floor(s.mul(70))
        const h = skyHash(cell)
        If(h.greaterThan(0.986), () => {
          const jitter = vec3(
            skyHash(cell.add(1.7)),
            skyHash(cell.add(3.1)),
            skyHash(cell.add(5.3)),
          ).sub(0.5)
          const c = normalize(cell.add(0.5).add(jitter.mul(0.5)))
          const r = length(s.sub(c)).mul(70)
          const big = step(0.997, h)
          const on = step(r, mix(0.18, 0.3, big))
          const b = mix(0.22, 0.6, skyHash(cell.add(9))).add(big.mul(0.35))
          color.addAssign(
            vec3(0.9, 0.88, 0.8)
              .mul(on)
              .mul(b)
              .mul(starAlpha)
              .mul(smoothstep(0.04, 0.3, d.y)),
          )
        })
      })
      If(moonAlpha.greaterThan(0).and(dot(d, moonDir).greaterThan(0.9)), () => {
        const right = normalize(cross(vec3(0, 1, 0), moonDir))
        const up = cross(moonDir, right)
        const q = vec2(dot(d, right), dot(d, up)).div(MOON_RADIUS)
        const grid = floor(q.mul(MOON_CELLS))
        const cellQ = grid.add(0.5).div(MOON_CELLS)
        const r2 = dot(cellQ, cellQ)
        const full = cos(moonPhase.mul(6.28318)).mul(-0.5).add(0.5)
        If(r2.lessThan(1), () => {
          const n = vec3(cellQ, sqrt(r2.oneMinus()))
          const a = moonPhase.mul(6.28318)
          const lit = step(0, dot(n, vec3(a.sin(), 0, a.cos().negate())))
          const sea = select(skyHash(vec3(grid.x, grid.y, 7)).greaterThan(0.72), 0.8, 1)
          const dark = color.mul(0.85).add(moonColor.mul(0.04))
          color.assign(mix(color, mix(dark, moonColor.mul(sea), lit), moonAlpha))
        }).Else(() => {
          const ring = clamp(length(cellQ).sub(1).div(1.6).oneMinus(), 0, 1)
          const glow = floor(ring.mul(3))
            .div(3)
            .mul(0.035)
            .mul(moonAlpha)
            .mul(full.mul(0.7).add(0.3))
          color.addAssign(moonColor.mul(glow))
        })
      })
      return color
    })()
  } else material.colorNode = gradient
  // Pinned to the far plane.
  material.vertexNode = Fn(() => {
    const clip = cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(positionLocal, 1))
    return vec4(clip.x, clip.y, clip.w, clip.w)
  })()
  return material
}
