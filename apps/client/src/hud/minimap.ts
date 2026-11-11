import type { MapDef, MaterialId } from '@office-fps/shared'

/** Minimap pixels per metre and visible radius. */
const SCALE = 2
const SIZE = 128
const PING_SECONDS = 2.5

const COLORS: Record<MaterialId, string> = {
  floor: '#3a3d42',
  wall: '#c9c5bb',
  cover: '#d0742f',
  platform: '#4f73a8',
  marker: '#8f7b2b',
  target: '#b9362f',
  ramp: '#5d9a4a',
}

interface Ping {
  x: number
  z: number
  life: number
}

/**
 * Top-left minimap, rotating with you (forward is always up). The level is drawn once into an
 * image; enemies only show up as red pings for a moment when they fire — no wallhack.
 */
export class Minimap {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly image: HTMLCanvasElement
  private readonly origin: { x: number; z: number }
  private readonly pings: Ping[] = []

  constructor(parent: HTMLElement, map: MapDef) {
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'hud-minimap'
    this.canvas.width = this.canvas.height = SIZE
    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas unavailable')
    this.ctx = ctx
    parent.append(this.canvas)

    // Bounds of everything, then paint boxes lowest-first so tops of tall things win.
    let minX = Number.POSITIVE_INFINITY
    let minZ = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxZ = Number.NEGATIVE_INFINITY
    for (const b of map.boxes) {
      minX = Math.min(minX, b.center[0] - b.size[0] / 2)
      maxX = Math.max(maxX, b.center[0] + b.size[0] / 2)
      minZ = Math.min(minZ, b.center[2] - b.size[2] / 2)
      maxZ = Math.max(maxZ, b.center[2] + b.size[2] / 2)
    }
    this.origin = { x: minX, z: minZ }
    this.image = document.createElement('canvas')
    this.image.width = Math.ceil((maxX - minX) * SCALE)
    this.image.height = Math.ceil((maxZ - minZ) * SCALE)
    const img = this.image.getContext('2d')
    if (!img) throw new Error('2D canvas unavailable')
    const boxes = [...map.boxes].sort(
      (a, b) => a.center[1] + a.size[1] / 2 - (b.center[1] + b.size[1] / 2),
    )
    for (const b of boxes) {
      // Ramps are tilted about X: their footprint along Z shrinks by cos(angle).
      const depth = b.size[2] * Math.abs(Math.cos(b.rotation?.[0] ?? 0))
      const top = b.center[1] + b.size[1] / 2
      img.globalAlpha = b.material === 'floor' ? 1 : Math.min(1, 0.55 + top / 8)
      img.fillStyle = COLORS[b.material]
      img.fillRect(
        Math.round((b.center[0] - b.size[0] / 2 - minX) * SCALE),
        Math.round((b.center[2] - depth / 2 - minZ) * SCALE),
        Math.max(1, Math.round(b.size[0] * SCALE)),
        Math.max(1, Math.round(depth * SCALE)),
      )
    }
  }

  /** Someone fired here: show a red ping briefly. */
  ping(x: number, z: number): void {
    this.pings.push({ x, z, life: PING_SECONDS })
    if (this.pings.length > 32) this.pings.shift()
  }

  setVisible(visible: boolean): void {
    this.canvas.hidden = !visible
  }

  update(dt: number, me: { x: number; z: number }, yaw: number): void {
    const ctx = this.ctx
    const half = SIZE / 2
    ctx.clearRect(0, 0, SIZE, SIZE)
    ctx.save()
    ctx.beginPath()
    ctx.arc(half, half, half - 1, 0, Math.PI * 2)
    ctx.clip()
    ctx.fillStyle = '#15171b'
    ctx.fillRect(0, 0, SIZE, SIZE)

    // World → minimap: centre on me, rotate so my view direction points up.
    ctx.translate(half, half)
    ctx.rotate(yaw)
    ctx.translate(-(me.x - this.origin.x) * SCALE, -(me.z - this.origin.z) * SCALE)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(this.image, 0, 0)

    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i]
      if (!p) continue
      p.life -= dt
      if (p.life <= 0) {
        this.pings.splice(i, 1)
        continue
      }
      ctx.globalAlpha = Math.min(1, p.life / 0.8)
      ctx.fillStyle = '#ff3b3b'
      const px = Math.round((p.x - this.origin.x) * SCALE)
      const pz = Math.round((p.z - this.origin.z) * SCALE)
      ctx.fillRect(px - 2, pz - 2, 4, 4)
    }
    ctx.restore()

    // Me: an arrow in the middle, always pointing up.
    ctx.fillStyle = '#fbb954'
    ctx.beginPath()
    ctx.moveTo(half, half - 5)
    ctx.lineTo(half + 4, half + 4)
    ctx.lineTo(half, half + 2)
    ctx.lineTo(half - 4, half + 4)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'
    ctx.beginPath()
    ctx.arc(half, half, half - 1, 0, Math.PI * 2)
    ctx.stroke()
  }
}
