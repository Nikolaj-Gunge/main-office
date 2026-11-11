import * as THREE from 'three'

/** Height of one text pixel in meters. Label glyphs are drawn at 8 px tall; 0.06 keeps them legible at ~15 m. */
const WORLD_PER_PIXEL = 0.06

/** Small pixel-font text sprite that always faces the camera. */
export function createLabel(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')

  const font = 'bold 8px monospace'
  ctx.font = font
  const width = Math.ceil(ctx.measureText(text).width) + 4
  const height = 12
  canvas.width = width
  canvas.height = height

  ctx.font = font
  ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(text, 2, height / 2 + 1)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.generateMipmaps = false

  const material = new THREE.SpriteMaterial({ map: texture, fog: false, depthWrite: false })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(width * WORLD_PER_PIXEL, height * WORLD_PER_PIXEL, 1)
  sprite.name = `label:${text}`
  return sprite
}
