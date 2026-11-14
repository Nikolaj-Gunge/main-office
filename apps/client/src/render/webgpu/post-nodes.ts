import type { Texture, Vector2, Vector3 } from 'three'
import {
  abs,
  Break,
  clamp,
  dot,
  Fn,
  float,
  floor,
  If,
  Loop,
  max,
  min,
  mix,
  mod,
  perspectiveDepthToViewZ,
  pow,
  screenCoordinate,
  select,
  smoothstep,
  step,
  texture,
  uniform,
  uniformArray,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import type { Node } from 'three/webgpu'

/*
 * TSL ports of the WebGL post chain (pixel-renderer.ts and shaders/post.frag.glsl), line for
 * line, so the WebGPU path looks the same. Keep them in step with the GLSL.
 */

type N<T extends string> = Node<T>

const LUMA_709 = vec3(0.2126, 0.7152, 0.0722)
const LUMA_601 = vec3(0.299, 0.587, 0.114)

/** Bright-pass: what glows (world with the viewmodel over it, above `threshold`). */
export function brightNode(color: Texture, overlay: Texture, threshold: number): N<'vec4'> {
  return Fn(() => {
    const o = texture(overlay)
    const c = texture(color).rgb.mul(o.a.oneMinus()).add(o.rgb)
    const luma = dot(c, LUMA_709)
    return vec4(c.mul(max(0, luma.sub(threshold))).div(max(luma, 1e-4)), 1)
  })()
}

/** Separable 9-tap gaussian blur; `direction` is the texel step. */
export function blurNode(input: Texture, direction: N<'vec2'>): N<'vec4'> {
  return Fn(() => {
    const at = (offset: number) => texture(input, uv().add(direction.mul(offset))).rgb
    const sum = texture(input)
      .rgb.mul(0.227027)
      .add(at(1.3846).mul(0.316216))
      .add(at(-1.3846).mul(0.316216))
      .add(at(3.2308).mul(0.07027))
      .add(at(-3.2308).mul(0.07027))
    return vec4(sum, 1)
  })()
}

/** FXAA "lite" plus a touch of sharpening, on display (sRGB) colour. */
export function fxaaNode(input: Texture, texel: N<'vec2'>): N<'vec4'> {
  return Fn(() => {
    const at = (p: N<'vec2'>) => texture(input, p).rgb
    const vUv = uv()
    const nw = at(vUv.add(vec2(-1, -1).mul(texel)))
    const ne = at(vUv.add(vec2(1, -1).mul(texel)))
    const sw = at(vUv.add(vec2(-1, 1).mul(texel)))
    const se = at(vUv.add(vec2(1, 1).mul(texel)))
    const m = at(vUv)
    const lNW = dot(nw, LUMA_601)
    const lNE = dot(ne, LUMA_601)
    const lSW = dot(sw, LUMA_601)
    const lSE = dot(se, LUMA_601)
    const lM = dot(m, LUMA_601)
    const lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)))
    const lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)))
    const dir0 = vec2(lNW.add(lNE).sub(lSW.add(lSE)).negate(), lNW.add(lSW).sub(lNE.add(lSE)))
    const reduce = max(
      lNW
        .add(lNE)
        .add(lSW)
        .add(lSE)
        .mul(0.25 / 8),
      1 / 128,
    )
    const rcpMin = float(1).div(min(abs(dir0.x), abs(dir0.y)).add(reduce))
    const dir = clamp(dir0.mul(rcpMin), vec2(-8), vec2(8)).mul(texel)
    const a = at(vUv.add(dir.mul(1 / 3 - 0.5)))
      .add(at(vUv.add(dir.mul(2 / 3 - 0.5))))
      .mul(0.5)
    const b = a.mul(0.5).add(
      at(vUv.sub(dir.mul(0.5)))
        .add(at(vUv.add(dir.mul(0.5))))
        .mul(0.25),
    )
    const lB = dot(b, LUMA_601)
    const c = select(lB.lessThan(lMin).or(lB.greaterThan(lMax)), a, b)
    const sharp = c.add(c.sub(nw.add(ne).add(sw).add(se).mul(0.25)).mul(0.3))
    return vec4(clamp(sharp, 0, 1), 1)
  })()
}

/** Narkowicz ACES fit. */
const acesFilm = (x: N<'vec3'>) =>
  clamp(x.mul(x.mul(2.51).add(0.03)).div(x.mul(x.mul(2.43).add(0.59)).add(0.14)), 0, 1)

const linearToSRGB = (c: N<'vec3'>) =>
  mix(
    c.mul(12.92),
    pow(c, vec3(1 / 2.4))
      .mul(1.055)
      .sub(0.055),
    step(0.0031308, c),
  )

/** 4×4 Bayer threshold, −0.5…0.5, from bottom-left pixel coordinates (as gl_FragCoord). */
const bayer = (frag: N<'vec2'>) => {
  // M4(x, y) = 4·M2(x mod 2, y mod 2) + M2(⌊x/2⌋ mod 2, ⌊y/2⌋ mod 2), M2(a, b) = 2|a − b| + b.
  const p = mod(floor(frag), 4)
  const lo = mod(p, 2)
  const hi = floor(p.div(2))
  const m2 = (q: N<'vec2'>) => abs(q.x.sub(q.y)).mul(2).add(q.y)
  return m2(lo).mul(4).add(m2(hi)).add(0.5).div(16).sub(0.5)
}

export interface PostInputs {
  color: Texture
  overlay: Texture
  bloom: Texture
  depth: Texture
  resolution: Vector2
  palette: Vector3[]
}

/** The post pass's uniforms, set from the settings like the GLSL ones. */
export function createPostUniforms() {
  return {
    bloomStrength: uniform(0.6),
    cameraNear: uniform(0.1),
    cameraFar: uniform(1000),
    exposure: uniform(1),
    colorMode: uniform(1, 'int'),
    levels: uniform(24),
    dither: uniform(1),
    outlines: uniform(0.35),
    contrast: uniform(0.6),
    saturation: uniform(1.25),
    vignette: uniform(0.4),
    paletteSize: uniform(0, 'int'),
  }
}

export type PostUniforms = ReturnType<typeof createPostUniforms>

/** Pixel-art post pass: tone map → sRGB → grade → outlines → ordered dither + quantization. */
export function postNode(i: PostInputs, u: PostUniforms): N<'vec4'> {
  const resolution = uniform(i.resolution)
  const paletteArray = uniformArray(i.palette, 'vec3')
  const palette = (k: N<'int'> | number) => paletteArray.element(k) as unknown as N<'vec3'>
  const viewDepth = (p: N<'vec2'>) =>
    perspectiveDepthToViewZ(texture(i.depth, p).x, u.cameraNear, u.cameraFar).negate()

  const nearestPaletteColor = Fn(([c]: [N<'vec3'>]) => {
    const best = vec3(palette(0)).toVar()
    const bestDist = float(1e9).toVar()
    Loop(64, ({ i: k }) => {
      If(k.greaterThanEqual(u.paletteSize), () => {
        Break()
      })
      const entry = palette(k)
      const d = c.sub(entry)
      // Luma-weighted distance: closer to perceived difference than plain RGB.
      const dist = dot(d.mul(d), LUMA_601)
      If(dist.lessThan(bestDist), () => {
        bestDist.assign(dist)
        best.assign(entry)
      })
    })
    return best
  })

  return Fn(() => {
    const vUv = uv()
    const overlay = texture(i.overlay)
    const color = texture(i.color).rgb.mul(overlay.a.oneMinus()).add(overlay.rgb).toVar()
    color.addAssign(texture(i.bloom).rgb.mul(u.bloomStrength))
    color.assign(linearToSRGB(acesFilm(color.mul(u.exposure))))

    // Grade: richer colours, then an S-curve that sinks the shadows and lifts the lights.
    const luma = dot(color, LUMA_601)
    color.assign(max(vec3(0), mix(vec3(luma), color, u.saturation)))
    const curved = color.mul(color).mul(color.mul(-2).add(3))
    const deep = mix(curved, curved.mul(color), 0.35)
    color.assign(mix(color, mix(deep, curved, smoothstep(0.25, 0.75, color)), u.contrast))
    const fromCentre = vUv.sub(0.5)
    color.mulAssign(
      float(1).sub(u.vignette.mul(smoothstep(0.25, 0.95, dot(fromCentre, fromCentre).mul(2)))),
    )

    // 1 px outline where this pixel sits in front of a much farther neighbour. Sampled always
    // (WGSL wants texture reads in uniform control flow), applied only where it should be.
    const texel = vec2(1).div(resolution)
    const d = viewDepth(vUv)
    const far = max(
      max(viewDepth(vUv.add(vec2(texel.x, 0))), viewDepth(vUv.sub(vec2(texel.x, 0)))),
      max(viewDepth(vUv.add(vec2(0, texel.y))), viewDepth(vUv.sub(vec2(0, texel.y)))),
    )
    const edge = step(d.mul(0.12).add(0.15), far.sub(d))
    const outline = select(u.outlines.greaterThan(0).and(overlay.a.lessThan(0.5)), u.outlines, 0)
    color.mulAssign(float(1).sub(edge.mul(outline)))

    // gl_FragCoord counts from the bottom; WebGPU's screen coordinate from the top.
    const frag = vec2(screenCoordinate.x, resolution.y.sub(screenCoordinate.y))
    const threshold = bayer(frag).mul(u.dither)
    If(u.colorMode.equal(1), () => {
      const steps = u.levels.sub(1)
      color.assign(floor(color.mul(steps).add(0.5).add(threshold)).div(steps))
    }).ElseIf(u.colorMode.equal(2), () => {
      color.assign(nearestPaletteColor(color.add(threshold.mul(0.12))))
    })

    return vec4(clamp(color, 0, 1), 1)
  })()
}
