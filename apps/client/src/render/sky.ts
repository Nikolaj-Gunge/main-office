import * as THREE from 'three'

/** Gradient sky dome. Big enough to sit past the fog, follows the camera every frame. */
export function createSky(top: THREE.ColorRepresentation, horizon: THREE.ColorRepresentation) {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(top) },
      horizonColor: { value: new THREE.Color(horizon) },
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
      varying vec3 vDir;
      void main() {
        float t = pow(clamp(vDir.y, 0.0, 1.0), 0.6);
        gl_FragColor = vec4(mix(horizonColor, topColor, t), 1.0);
      }
    `,
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 12), material)
  mesh.name = 'sky'
  mesh.frustumCulled = false
  mesh.renderOrder = -1
  return mesh
}

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
