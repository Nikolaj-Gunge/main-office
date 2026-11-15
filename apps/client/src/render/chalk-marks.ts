import { type ChalkMark, chalkFade, chalkText } from '@office-fps/shared'
import * as THREE from 'three'

/**
 * Chalk marks (chalk.ts) drawn where they were chalked: a pixel-chunky white symbol with its
 * words under it, flat on the wall, tree or road, lit like anything else (the torch finds them
 * at night), fading as they wear off.
 */

/** Marks are drawn this close (m). */
const SHOW = 90
/** Canvas size (px) and the size it is on the wall (m). */
const W = 96
const H = 40
const SIZE_W = 1.5
const SIZE_H = (SIZE_W * H) / W
const CHALK = '#e8e4da'

/** A 2-px chalk line from (x0, y0) to (x1, y1) on a canvas (Bresenham, so it stays pixelly). */
function line(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  const dx = Math.abs(x1 - x0)
  const dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx - dy
  let x = x0
  let y = y0
  for (let i = 0; i < 200; i++) {
    g.fillRect(x, y, 2, 2)
    if (x === x1 && y === y1) break
    const e2 = err * 2
    if (e2 > -dy) {
      err -= dy
      x += sx
    }
    if (e2 < dx) {
      err += dx
      y += sy
    }
  }
}

/** A ring of radius r round (cx, cy), from angle a0 to a1 (radians). */
function ring(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, a0 = 0, a1 = 7) {
  for (let a = a0; a < a1; a += 0.12)
    g.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 2, 2)
}

/** Draws symbol `sym` in the 24×24 box at (x, y). */
export function drawChalkSymbol(g: CanvasRenderingContext2D, sym: number, x: number, y: number) {
  const L = (a: number, b: number, c: number, d: number) => line(g, x + a, y + b, x + c, y + d)
  switch (sym) {
    case 0: // arrow
      L(2, 12, 21, 12)
      L(21, 12, 14, 5)
      L(21, 12, 14, 19)
      break
    case 1: // cross
      L(3, 3, 20, 20)
      L(20, 3, 3, 20)
      break
    case 2: // circle
      ring(g, x + 11, y + 11, 9)
      break
    case 3: // skull
      ring(g, x + 11, y + 9, 8, Math.PI * 0.85, Math.PI * 2.15)
      L(4, 12, 6, 17)
      L(18, 12, 16, 17)
      L(6, 17, 16, 17)
      g.fillRect(x + 6, y + 8, 4, 4)
      g.fillRect(x + 13, y + 8, 4, 4)
      for (const tx of [8, 11, 14]) L(tx, 17, tx, 21)
      break
    case 4: // tick
      L(3, 12, 9, 19)
      L(9, 19, 21, 4)
      break
    case 5: // eye
      ring(g, x + 11, y + 22, 13, Math.PI * 1.22, Math.PI * 1.78)
      ring(g, x + 11, y + 0, 13, Math.PI * 0.22, Math.PI * 0.78)
      g.fillRect(x + 9, y + 9, 5, 5)
      break
    case 6: // house
      L(4, 11, 4, 21)
      L(19, 11, 19, 21)
      L(4, 21, 19, 21)
      L(2, 12, 11, 3)
      L(11, 3, 21, 12)
      L(10, 21, 10, 15)
      L(14, 21, 14, 15)
      L(10, 15, 14, 15)
      break
    default: // question
      ring(g, x + 11, y + 8, 6, Math.PI, Math.PI * 2.45)
      L(13, 13, 11, 16)
      L(11, 16, 11, 17)
      g.fillRect(x + 10, y + 20, 3, 3)
  }
}

/** The mark's picture: the symbol, the words under it, edges left hard (no blur). */
function texture(mark: ChalkMark): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const g = canvas.getContext('2d') as CanvasRenderingContext2D
  g.fillStyle = CHALK
  const words = chalkText(mark.a, mark.b)
  drawChalkSymbol(g, mark.sym, (W - 24) / 2, words ? 1 : 8)
  if (words) {
    g.font = 'bold 11px monospace'
    g.textAlign = 'center'
    g.textBaseline = 'top'
    g.fillText(words.toUpperCase(), W / 2, 27, W - 2)
  }
  // Hard edges and a chalky grain: every pixel is all there or not at all, some rubbed off.
  const img = g.getImageData(0, 0, W, H)
  let seed = mark.id * 2654435761
  for (let i = 3; i < img.data.length; i += 4) {
    seed = (seed * 1103515245 + 12345) >>> 0
    const worn = (seed >>> 16) % 100 < 14
    img.data[i] = (img.data[i] ?? 0) > 110 && !worn ? 255 : 0
  }
  g.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

const plane = new THREE.PlaneGeometry(SIZE_W, SIZE_H)

export class ChalkMarks {
  readonly root = new THREE.Group()
  private readonly shown = new Map<number, { mark: ChalkMark; mesh: THREE.Mesh }>()

  constructor() {
    this.root.name = 'chalk-marks'
  }

  /** The world's marks, as the server last sent them. */
  set(marks: readonly ChalkMark[]): void {
    const keep = new Set<number>()
    for (const m of marks) {
      keep.add(m.id)
      if (this.shown.has(m.id)) continue
      const material = new THREE.MeshLambertMaterial({
        map: texture(m),
        transparent: true,
        alphaTest: 0.5,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
      const mesh = new THREE.Mesh(plane, material)
      const n = new THREE.Vector3(m.nx, m.ny, m.nz).normalize()
      mesh.position.set(m.x + n.x * 0.02, m.y + n.y * 0.02, m.z + n.z * 0.02)
      // On the ground it reads from the south; on a wall or a trunk, upright.
      if (Math.abs(n.y) > 0.8) mesh.up.set(0, 0, -1)
      mesh.lookAt(mesh.position.clone().add(n))
      mesh.renderOrder = 2
      this.root.add(mesh)
      this.shown.set(m.id, { mark: m, mesh })
    }
    for (const [id, s] of this.shown) {
      if (keep.has(id)) continue
      this.root.remove(s.mesh)
      const material = s.mesh.material as THREE.MeshLambertMaterial
      material.map?.dispose()
      material.dispose()
      this.shown.delete(id)
    }
  }

  /** Every now and then: only the near ones are drawn, faded with age. */
  update(eye: THREE.Vector3): void {
    const now = Date.now()
    for (const { mark, mesh } of this.shown.values()) {
      const near = Math.hypot(mark.x - eye.x, mark.z - eye.z) < SHOW
      const fade = chalkFade(mark.at, now)
      mesh.visible = near && fade > 0
      if (mesh.visible) (mesh.material as THREE.MeshLambertMaterial).opacity = 0.35 + 0.55 * fade
    }
  }
}
