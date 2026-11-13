import { hash2, type RoadSign } from '@office-fps/shared'
import * as THREE from 'three'

/**
 * The faces of Deadwood's road signs (their posts are map boxes): town names, which way Haven
 * is, speed limits, mile markers, bend warnings and the messages people sprayed on plywood.
 * All of them are painted into one canvas and drawn as one mesh.
 */

/** Pixels per metre of sign face. */
const PX = 96
const CELL_W = 256
const CELL_H = 128
const COLUMNS = 8

const FONT = '"Arial Narrow", Arial, Helvetica, sans-serif'

function arrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  dir: RoadSign['arrow'],
): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(dir === 'left' ? Math.PI : dir === 'up' ? -Math.PI / 2 : 0)
  ctx.beginPath()
  ctx.moveTo(-size, -size * 0.18)
  ctx.lineTo(size * 0.25, -size * 0.18)
  ctx.lineTo(size * 0.25, -size * 0.5)
  ctx.lineTo(size, 0)
  ctx.lineTo(size * 0.25, size * 0.5)
  ctx.lineTo(size * 0.25, size * 0.18)
  ctx.lineTo(-size, size * 0.18)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/** Text squeezed to fit `width`. */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  px: number,
  weight = 'bold',
): void {
  ctx.font = `${weight} ${px}px ${FONT}`
  const w = ctx.measureText(text).width
  ctx.save()
  ctx.translate(x, y)
  if (w > width) ctx.scale(width / w, 1)
  ctx.fillText(text, 0, 0)
  ctx.restore()
}

/** Paints one sign into (0, 0, w, h) of the context, then weathers it. */
function paint(
  ctx: CanvasRenderingContext2D,
  sign: RoadSign,
  w: number,
  h: number,
  seed: number,
): void {
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const lines = sign.lines
  switch (sign.kind) {
    case 'guide':
    case 'mile': {
      ctx.fillStyle = '#1d5233'
      ctx.fillRect(0, 0, w, h)
      ctx.strokeStyle = '#e8ece4'
      ctx.lineWidth = Math.max(2, h * 0.04)
      ctx.strokeRect(h * 0.05, h * 0.05, w - h * 0.1, h - h * 0.1)
      ctx.fillStyle = '#eef0ea'
      const rows = lines.length + (sign.arrow ? 1 : 0)
      const row = (h * 0.84) / rows
      lines.forEach((line, i) => {
        fitText(
          ctx,
          line,
          w / 2,
          h * 0.08 + row * (i + 0.55),
          w * 0.84,
          row * (i === 0 ? 0.82 : 0.66),
        )
      })
      if (sign.arrow) arrow(ctx, w / 2, h * 0.08 + row * (rows - 0.5), row * 0.42, sign.arrow)
      break
    }
    case 'speed': {
      ctx.fillStyle = '#e8e6de'
      ctx.fillRect(0, 0, w, h)
      ctx.strokeStyle = '#151515'
      ctx.lineWidth = Math.max(2, w * 0.04)
      ctx.strokeRect(w * 0.06, w * 0.06, w - w * 0.12, h - w * 0.12)
      ctx.fillStyle = '#151515'
      fitText(ctx, lines[0] ?? '', w / 2, h * 0.2, w * 0.8, h * 0.15)
      fitText(ctx, lines[1] ?? '', w / 2, h * 0.37, w * 0.8, h * 0.15)
      fitText(ctx, lines[2] ?? '', w / 2, h * 0.68, w * 0.8, h * 0.36)
      break
    }
    case 'warn': {
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = '#d8a51c'
      ctx.strokeStyle = '#141414'
      ctx.lineWidth = Math.max(2, w * 0.04)
      ctx.beginPath()
      ctx.moveTo(w / 2, 1)
      ctx.lineTo(w - 1, h / 2)
      ctx.lineTo(w / 2, h - 1)
      ctx.lineTo(1, h / 2)
      ctx.closePath()
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(w / 2, w * 0.08)
      ctx.lineTo(w - w * 0.08, h / 2)
      ctx.lineTo(w / 2, h - w * 0.08)
      ctx.lineTo(w * 0.08, h / 2)
      ctx.closePath()
      ctx.stroke()
      ctx.fillStyle = '#141414'
      arrow(ctx, w / 2, h / 2, w * 0.24, sign.arrow ?? 'right')
      break
    }
    case 'graffiti': {
      // Plywood, sprayed in a hurry.
      ctx.fillStyle = '#7a6040'
      ctx.fillRect(0, 0, w, h)
      for (let i = 0; i < 14; i++) {
        ctx.fillStyle = hash2(i, seed, 3) < 0.5 ? '#6c5436' : '#86693f'
        ctx.fillRect(0, Math.floor(hash2(i, seed, 4) * h), w, 1 + Math.floor(hash2(i, seed, 5) * 2))
      }
      ctx.fillStyle = hash2(seed, 1, 6) < 0.6 ? '#a8161a' : '#e8e4dc'
      const row = (h * 0.8) / lines.length
      lines.forEach((line, i) => {
        ctx.save()
        ctx.translate(w / 2, h * 0.1 + row * (i + 0.5))
        ctx.rotate((hash2(i, seed, 7) - 0.5) * 0.12)
        fitText(ctx, line, 0, 0, w * 0.86, row * 0.8, '900')
        ctx.restore()
      })
      break
    }
  }
  // Weather: rust and dirt specks, and on some, bullet holes.
  const holes = hash2(seed, 2, 8) < 0.45 ? 2 + Math.floor(hash2(seed, 3, 8) * 7) : 0
  for (let i = 0; i < 40; i++) {
    const x = hash2(i, seed, 9) * w
    const y = hash2(i, seed, 10) * h
    if (sign.kind === 'warn' && Math.abs(x - w / 2) / w + Math.abs(y - h / 2) / h > 0.48) continue
    ctx.fillStyle = hash2(i, seed, 11) < 0.5 ? 'rgba(90,50,20,0.45)' : 'rgba(20,20,20,0.3)'
    ctx.fillRect(x, y, 1 + hash2(i, seed, 12) * 3, 1 + hash2(i, seed, 13) * 3)
  }
  for (let i = 0; i < holes; i++) {
    const x = (0.15 + hash2(i, seed, 14) * 0.7) * w
    const y = (0.15 + hash2(i, seed, 15) * 0.7) * h
    ctx.fillStyle = '#c8c8c0'
    ctx.beginPath()
    ctx.arc(x, y, 3.2, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#111'
    ctx.beginPath()
    ctx.arc(x, y, 1.8, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** One mesh with every sign's face (front painted, back plain dark metal). */
export function buildSigns(signs: readonly RoadSign[]): THREE.Mesh {
  const rows = Math.max(1, Math.ceil(signs.length / COLUMNS))
  const canvas = document.createElement('canvas')
  canvas.width = CELL_W * COLUMNS
  canvas.height = THREE.MathUtils.ceilPowerOfTwo(CELL_H * rows)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  const position: number[] = []
  const normal: number[] = []
  const uv: number[] = []
  const color: number[] = []
  signs.forEach((sign, n) => {
    const cx = (n % COLUMNS) * CELL_W
    const cy = Math.floor(n / COLUMNS) * CELL_H
    // Paint at the sign's own aspect, as big as the cell allows.
    const scale = Math.min(CELL_W / sign.w, CELL_H / sign.h, PX * 2)
    const w = Math.floor(sign.w * scale)
    const h = Math.floor(sign.h * scale)
    ctx.save()
    ctx.translate(cx, cy)
    ctx.beginPath()
    ctx.rect(0, 0, w, h)
    ctx.clip()
    paint(ctx, sign, w, h, n * 17 + 3)
    ctx.restore()
    const u0 = cx / canvas.width
    const u1 = (cx + w) / canvas.width
    const v1 = 1 - cy / canvas.height
    const v0 = 1 - (cy + h) / canvas.height

    const [fx, fz] = sign.facing
    // The viewer's right as they face the sign.
    const rx = fz
    const rz = -fx
    const roll = sign.askew ?? 0
    const cr = Math.cos(roll)
    const sr = Math.sin(roll)
    const corner = (a: number, b: number): number[] => {
      const along = (a * cr - b * sr) * (sign.w / 2)
      const up = (a * sr + b * cr) * (sign.h / 2)
      return [sign.pos[0] + rx * along, sign.pos[1] + up, sign.pos[2] + rz * along]
    }
    const quad = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]
    const uvs = [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ]
    const face = (order: number[], nx: number, nz: number, shade: number, offset: number) => {
      for (const i of order) {
        const p = quad[i] as number[]
        position.push(
          (p[0] as number) + nx * offset,
          p[1] as number,
          (p[2] as number) + nz * offset,
        )
        normal.push(nx, 0, nz)
        uv.push(...(uvs[i] as number[]))
        color.push(shade, shade, shade)
      }
    }
    face([0, 1, 2, 0, 2, 3], fx, fz, 1, 0)
    // The back: the same outline, dark (the texture's alpha keeps a diamond a diamond).
    face([0, 2, 1, 0, 3, 2], -fx, -fz, 0.12, 0.02)
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3))
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshLambertMaterial({ map: texture, vertexColors: true, alphaTest: 0.5 }),
  )
  mesh.name = 'road-signs'
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}
