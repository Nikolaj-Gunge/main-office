import * as THREE from 'three'
import { nightSkyUniforms } from './sky-night.ts'

/**
 * Gradient sky dome. Big enough to sit past the fog, follows the camera every frame. At night it
 * carries a blocky moon and pixel stars (sky-night.ts sets them; nothing shows while their
 * alphas are 0, as on maps without a night).
 */
export function createSky(top: THREE.ColorRepresentation, horizon: THREE.ColorRepresentation) {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(top) },
      horizonColor: { value: new THREE.Color(horizon) },
      ...nightSkyUniforms(),
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w; // pin to far plane
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 moonDir;
      uniform float moonPhase;
      uniform float moonAlpha;
      uniform vec3 moonColor;
      uniform float starAlpha;
      uniform mat3 starTurn;
      varying vec3 vDir;
      ${SKY_NIGHT_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        float t = pow(clamp(d.y, 0.0, 1.0), 0.6);
        vec3 color = mix(horizonColor, topColor, t);
        gl_FragColor = vec4(nightSky(color, d), 1.0);
      }
    `,
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 12), material)
  mesh.name = 'sky'
  mesh.frustumCulled = false
  mesh.renderOrder = -1
  return mesh
}

/** Moon cells across its radius (it is drawn in blocks this coarse), and its radius (rad). */
const MOON_CELLS = 5
const MOON_RADIUS = 0.045

/**
 * The moon and stars over a sky colour (GLSL). Stars: a hashed grid on the turning sphere, one
 * hard dot in a few of its cells. Moon: a disc cut into blocks, lit on one side by its phase,
 * with a few darker blocks (seas) and a faint stepped ring round it.
 */
const SKY_NIGHT_GLSL = /* glsl */ `
  float skyHash(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  vec3 nightSky(vec3 color, vec3 d) {
    if (starAlpha > 0.0 && d.y > 0.0) {
      vec3 s = starTurn * d;
      vec3 cell = floor(s * 70.0);
      float h = skyHash(cell);
      if (h > 0.986) {
        vec3 c = normalize(cell + 0.5 + (vec3(skyHash(cell + 1.7), skyHash(cell + 3.1), skyHash(cell + 5.3)) - 0.5) * 0.5);
        float r = length(s - c) * 70.0;
        float big = step(0.997, h);
        float on = step(r, mix(0.18, 0.3, big));
        float b = mix(0.22, 0.6, skyHash(cell + 9.0)) + big * 0.35;
        color += vec3(0.9, 0.88, 0.8) * on * b * starAlpha * smoothstep(0.04, 0.3, d.y);
      }
    }
    if (moonAlpha > 0.0) {
      float facing = dot(d, moonDir);
      if (facing > 0.9) {
        vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), moonDir));
        vec3 up = cross(moonDir, right);
        vec2 q = vec2(dot(d, right), dot(d, up)) / ${MOON_RADIUS};
        vec2 cellQ = (floor(q * ${MOON_CELLS}.0) + 0.5) / ${MOON_CELLS}.0;
        float r2 = dot(cellQ, cellQ);
        if (r2 < 1.0) {
          vec3 n = vec3(cellQ, sqrt(1.0 - r2));
          float a = moonPhase * 6.28318;
          float lit = step(0.0, dot(n, vec3(sin(a), 0.0, -cos(a))));
          float sea = skyHash(vec3(floor(q * ${MOON_CELLS}.0), 7.0)) > 0.72 ? 0.8 : 1.0;
          // The dark side hides the stars behind it and shows a little earthshine.
          color = mix(color, mix(color * 0.85 + moonColor * 0.04, moonColor * sea, lit), moonAlpha);
        } else {
          // A faint ring of light round it, in hard steps, as bright as the moon is full.
          float ring = clamp(1.0 - (length(cellQ) - 1.0) / 1.6, 0.0, 1.0);
          float glow = floor(ring * 3.0) / 3.0 * 0.035 * moonAlpha * (0.3 + 0.7 * (0.5 - 0.5 * cos(moonPhase * 6.28318)));
          color += moonColor * glow;
        }
      }
    }
    return color;
  }
`

/**
 * A ring of city blocks around the map, seen through the office windows. Pixel-art towers with
 * lit windows, painted once into a texture and wrapped on a cylinder far outside the building.
 */
export function createSkyline(radius = 180): THREE.Mesh {
  const width = 1024
  const height = 96
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  let seed = 1234567
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  // Two layers: hazy far towers, then darker near ones with windows.
  for (const [color, minH, maxH, windows] of [
    ['#9fb0c4', 20, 60, false],
    ['#5f6f84', 12, 80, true],
  ] as const) {
    let x = 0
    while (x < width) {
      const w = 10 + Math.floor(rand() * 26)
      const h = minH + Math.floor(rand() * (maxH - minH))
      ctx.fillStyle = color
      ctx.fillRect(x, height - h, w, h)
      if (windows) {
        for (let wy = height - h + 3; wy < height - 2; wy += 4) {
          for (let wx = x + 2; wx < x + w - 2; wx += 3) {
            if (rand() < 0.35) {
              ctx.fillStyle = rand() < 0.8 ? '#cfd8e3' : '#f6e3a1'
              ctx.fillRect(wx, wy, 1, 2)
            }
          }
        }
      }
      x += w + Math.floor(rand() * 4)
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.wrapS = THREE.RepeatWrapping
  texture.repeat.set(3, 1)
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
  })
  // Cylinder from slightly below ground to well above eye level.
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 70, 48, 1, true), material)
  mesh.position.y = 20
  mesh.renderOrder = -1
  mesh.name = 'skyline'
  return mesh
}
