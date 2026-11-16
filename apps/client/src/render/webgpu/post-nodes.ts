import { type Texture, Vector2, Vector3 } from 'three'
import {
  abs,
  Break,
  clamp,
  cos,
  cross,
  dot,
  Fn,
  float,
  floor,
  If,
  Loop,
  length,
  max,
  min,
  mix,
  mod,
  normalize,
  perspectiveDepthToViewZ,
  pow,
  screenCoordinate,
  select,
  sin,
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
    outlineFar: uniform(420),
    contrast: uniform(0.6),
    saturation: uniform(1.25),
    vignette: uniform(0.4),
    paletteSize: uniform(0, 'int'),
    // Survival: the bite taking hold (game/infection.ts). 0 = clean … 1 = turning.
    infection: uniform(0),
    infectPulse: uniform(0),
    infectTime: uniform(0),
    infectMotion: uniform(1),
    // Convex edge highlights (setEdgeHighlights): 0 = off, else how much brighter.
    edgeLight: uniform(0),
    edgeLightDir: uniform(new Vector3(0, 1, 0)), // view space, towards the sun or moon
    edgeTint: uniform(new Vector3(1, 1, 1)), // the light's colour, brightest channel 1
    edgeProj: uniform(new Vector2(1, 1)), // tan(fov/2) × aspect, tan(fov/2)
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

  // The world, gun and glow at one point (linear, before tone mapping).
  const sceneAt = (p: N<'vec2'>) => {
    const o = texture(i.overlay, p)
    return texture(i.color, p)
      .rgb.mul(o.a.oneMinus())
      .add(o.rgb)
      .add(texture(i.bloom, p).rgb.mul(u.bloomStrength))
  }

  // uv() runs top-down here, bottom-up in GLSL: offsets have their y turned over.
  const UP = vec2(1, -1)

  // Late in the turn: the picture sways, softens and doubles (a ghost drifting to one side).
  const infectedScene = (color: N<'vec3'>) => {
    const late = smoothstep(0.45, 1, u.infection)
    const t = u.infectTime
    const sway = vec2(
      sin(t.mul(0.9)).add(sin(t.mul(2.3)).mul(0.5)),
      cos(t.mul(0.7)).add(sin(t.mul(1.7)).mul(0.4)),
    ).mul(u.infectMotion.mul(late).mul(0.006).mul(UP))
    const p = uv().add(sway)
    color.assign(sceneAt(p))
    If(late.greaterThan(0), () => {
      const r = vec2(1).div(resolution).mul(late.mul(2.2).add(0.8))
      const soft = sceneAt(p.add(vec2(r.x, r.y)))
        .add(sceneAt(p.sub(vec2(r.x, r.y))))
        .add(sceneAt(p.add(vec2(r.x, r.y.negate()))))
        .add(sceneAt(p.sub(vec2(r.x, r.y.negate()))))
        .mul(0.25)
      color.assign(mix(color, soft, late.mul(0.4).add(0.35)))
      const drift = mix(0.7, sin(t.mul(0.5)).mul(0.4).add(0.6), u.infectMotion)
      const ghost = vec2(u.infectPulse.mul(0.004).add(0.006), 0.0015).mul(late).mul(drift).mul(UP)
      color.assign(mix(color, sceneAt(p.add(ghost)), late.mul(0.3)))
    })
  }

  return Fn(() => {
    const vUv = uv()
    const overlay = texture(i.overlay)
    const color = sceneAt(vUv).toVar()
    If(u.infection.greaterThan(0), () => infectedScene(color))
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

    // The bite: colour drains out, the edges throb red with the heart, the last minute goes red.
    If(u.infection.greaterThan(0), () => {
      const grey = dot(color, LUMA_601)
      color.assign(mix(color, vec3(grey), smoothstep(0, 0.45, u.infection).mul(0.8)))
      const edge = smoothstep(0.1, 0.85, dot(fromCentre, fromCentre).mul(2))
      const throb = edge.mul(min(1, u.infection.mul(2.5))).mul(u.infectPulse.mul(0.5).add(0.5))
      color.assign(mix(color, vec3(0.38, 0, 0.02), throb.mul(0.8)))
      const last = smoothstep(0.8, 1, u.infection).mul(u.infectPulse.mul(0.2).add(0.8))
      color.assign(
        mix(color, color.mul(vec3(1.3, 0.4, 0.35)).add(vec3(0.07, 0, 0)), last.mul(0.75)),
      )
    })

    // Convex edge highlights (post.frag.glsl's edgeHighlight, line for line). Behind a uniform
    // switch, so the taps are only made when it is on.
    If(u.edgeLight.greaterThan(0), () => {
      const e = edgeHighlight(i, u, viewDepth, resolution).mul(step(overlay.a, 0.5))
      color.addAssign(e.mul(u.edgeLight).mul(color.add(0.03)).mul(u.edgeTint))
    })

    // 1 px outline where this pixel sits in front of a much farther neighbour. Sampled always
    // (WGSL wants texture reads in uniform control flow), applied only where it should be.
    const texel = vec2(1).div(resolution)
    const d = viewDepth(vUv)
    const far = max(
      max(viewDepth(vUv.add(vec2(texel.x, 0))), viewDepth(vUv.sub(vec2(texel.x, 0)))),
      max(viewDepth(vUv.add(vec2(0, texel.y))), viewDepth(vUv.sub(vec2(0, texel.y)))),
    )
    // None far off, where the fog has softened every edge (or a far forest gets a pen line).
    const fade = float(1).sub(smoothstep(u.outlineFar.mul(0.6), u.outlineFar, d))
    const edge = step(d.mul(0.12).add(0.15), far.sub(d)).mul(fade)
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

/**
 * The t3ssel8r look: a 1 px lighter line along convex edges on the face that catches more of the
 * light (see post.frag.glsl). Depth taps by pixel offset (x right, y up, as in GLSL), each made
 * once; view-space positions from depth like the GLSL viewPos.
 */
function edgeHighlight(
  i: PostInputs,
  u: PostUniforms,
  viewDepth: (p: N<'vec2'>) => N<'float'>,
  resolution: N<'vec2'>,
): N<'float'> {
  const vUv = uv()
  const texel = vec2(1).div(resolution)
  const taps = new Map<string, N<'vec3'>>()
  const at = (x: number, y: number): N<'vec3'> => {
    const key = `${x},${y}`
    const have = taps.get(key)
    if (have) return have
    // uv() runs top-down: the depth is read with y turned over, the position made bottom-up.
    const d = viewDepth(vUv.add(vec2(x, -y).mul(texel)))
    const glUv = vec2(vUv.x, vUv.y.oneMinus()).add(vec2(x, y).mul(texel))
    const p = vec3(glUv.mul(2).sub(1).mul(u.edgeProj).mul(d), d.negate()).toVar()
    taps.set(key, p)
    return p
  }
  const normalAt = (x: number, y: number) => {
    const p = at(x, y)
    const r1 = at(x + 1, y)
    const l1 = at(x - 1, y)
    const u1 = at(x, y + 1)
    const d1 = at(x, y - 1)
    const bend = (a: N<'vec3'>, b: N<'vec3'>) => abs(a.z.mul(2).sub(b.z).sub(p.z))
    const across = select(
      bend(r1, at(x + 2, y)).lessThan(bend(l1, at(x - 2, y))),
      r1.sub(p),
      p.sub(l1),
    )
    const along = select(
      bend(u1, at(x, y + 2)).lessThan(bend(d1, at(x, y - 2))),
      u1.sub(p),
      p.sub(d1),
    )
    return normalize(cross(across, along))
  }
  const EDGE_FAR = 70
  const p = at(0, 0)
  const d = p.z.negate()
  const n = normalAt(0, 0)
  const lit = dot(n, u.edgeLightDir)
  const hit = float(0).toVar()
  for (const [x, y] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const q = at(x, y)
    const v = q.sub(p)
    const near = step(q.z.negate().sub(d), d.mul(0.12).add(0.15))
    const turns = step(dot(n, v), length(v).mul(-0.3))
    const brighter = step(dot(normalAt(x, y), u.edgeLightDir), lit)
    hit.assign(max(hit, near.mul(turns).mul(brighter)))
  }
  const sky = step(1, texture(i.depth, vUv).x)
  return hit
    .mul(sky.oneMinus())
    .mul(step(d, EDGE_FAR))
    .mul(step(0.15, lit))
    .mul(smoothstep(0.15, 0.45, lit))
    .mul(float(1).sub(smoothstep(EDGE_FAR * 0.6, EDGE_FAR, d)))
}
