import type { MapBox, MapDef, MaterialId } from '@office-fps/shared'

/** Minimap pixels per metre and canvas size (visible radius = SIZE / 2 / SCALE metres). */
const SCALE = 2
const SIZE = 128
const PING_SECONDS = 2.5

/** Walkable surface colors (floors), then obstacle colors (things at body height). */
const FLOOR = '#33363d'
const COLORS: Partial<Record<MaterialId, string>> = {
  floor: '#3a3d42',
  wall: '#c9c5bb',
  cover: '#d0742f',
  platform: '#4f73a8',
  marker: '#8f7b2b',
  target: '#b9362f',
  ramp: '#3f8a55',
  plaster: '#d8d4cc',
  concrete: '#9a9893',
  metal: '#7c818b',
  glass: '#7fb8dc',
  desk: '#8b7f6a',
  fabric: '#2f7d86',
  fabricAlt: '#4a4d57',
  plant: '#3d8a45',
  accent: '#b33831',
  rack: '#4aa8ff',
  screen: '#4a5568',
  whiteboard: '#e0e0dc',
}
/** Never drawn: overhead stuff. */
const SKIP = new Set<MaterialId>(['ceiling', 'lightpanel'])

interface Ping {
  x: number
  z: number
  life: number
}

const bottom = (b: MapBox) => b.center[1] - b.size[1] / 2
const top = (b: MapBox) => b.center[1] + b.size[1] / 2

/**
 * Top-left minimap, rotating with you (forward is always up). Each floor of the map is drawn
 * once into its own image — the one you're standing on is shown. Enemies only show up as red
 * pings for a moment when they fire — no wallhack.
 */
export class Minimap {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  /** One image per floor height, lowest first. */
  private readonly levels: { y: number; image: HTMLCanvasElement }[] = []
  private readonly origin: { x: number; z: number }
  private readonly pings: Ping[] = []
  private items: { x: number; z: number }[] = []

  constructor(parent: HTMLElement, map: MapDef) {
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'hud-minimap'
    this.canvas.width = this.canvas.height = SIZE
    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas unavailable')
    this.ctx = ctx
    parent.append(this.canvas)

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

    // Floors = distinct spawn heights (every playable level has spawns).
    const floors = [...new Set(map.spawns.map((s) => Math.round(s.pos[1] * 10) / 10))].sort(
      (a, b) => a - b,
    )
    for (const y of floors) {
      const image = document.createElement('canvas')
      image.width = Math.ceil((maxX - minX) * SCALE)
      image.height = Math.ceil((maxZ - minZ) * SCALE)
      const img = image.getContext('2d')
      if (!img) throw new Error('2D canvas unavailable')
      const rect = (b: MapBox, color: string) => {
        // Ramps tilt about X: their footprint along Z shrinks by cos(angle).
        const depth = b.size[2] * Math.abs(Math.cos(b.rotation?.[0] ?? 0))
        img.fillStyle = color
        img.fillRect(
          Math.round((b.center[0] - b.size[0] / 2 - minX) * SCALE),
          Math.round((b.center[2] - depth / 2 - minZ) * SCALE),
          Math.max(1, Math.round(b.size[0] * SCALE)),
          Math.max(1, Math.round(depth * SCALE)),
        )
      }
      const visible = map.boxes.filter((b) => b.render !== false && !SKIP.has(b.material))
      // Floor you can stand on at this level…
      for (const b of visible) {
        if (Math.abs(top(b) - y) < 0.06) rect(b, FLOOR)
      }
      // …then anything at body height, lowest first so taller things win.
      const obstacles = visible
        .filter((b) => top(b) > y + 0.3 && bottom(b) < y + 2.2)
        .sort((a, b) => top(a) - top(b))
      for (const b of obstacles) rect(b, COLORS[b.material] ?? '#888888')
      this.levels.push({ y, image })
    }
  }

  /** Someone fired here: show a red ping briefly. */
  ping(x: number, z: number): void {
    this.pings.push({ x, z, life: PING_SECONDS })
    if (this.pings.length > 32) this.pings.shift()
  }

  /** Weapons lying on the floor: small yellow squares (they aren't players, so no wallhack). */
  setItems(items: { x: number; z: number }[]): void {
    this.items = items
  }

  setVisible(visible: boolean): void {
    this.canvas.hidden = !visible
  }

  update(dt: number, me: { x: number; y: number; z: number }, yaw: number): void {
    const ctx = this.ctx
    const half = SIZE / 2
    ctx.clearRect(0, 0, SIZE, SIZE)
    ctx.save()
    ctx.beginPath()
    ctx.arc(half, half, half - 1, 0, Math.PI * 2)
    ctx.clip()
    ctx.fillStyle = '#15171b'
    ctx.fillRect(0, 0, SIZE, SIZE)

    // The floor you're on: the highest level at or below your feet.
    let level = this.levels[0]
    for (const l of this.levels) if (me.y >= l.y - 0.5) level = l

    // World → minimap: centre on me, rotate so my view direction points up.
    ctx.translate(half, half)
    ctx.rotate(yaw)
    ctx.translate(-(me.x - this.origin.x) * SCALE, -(me.z - this.origin.z) * SCALE)
    ctx.imageSmoothingEnabled = false
    if (level) ctx.drawImage(level.image, 0, 0)

    ctx.fillStyle = '#fbb954'
    for (const it of this.items) {
      ctx.fillRect(
        Math.round((it.x - this.origin.x) * SCALE) - 1,
        Math.round((it.z - this.origin.z) * SCALE) - 1,
        3,
        3,
      )
    }

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
