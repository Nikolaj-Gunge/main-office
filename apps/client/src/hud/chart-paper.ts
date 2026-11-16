import {
  CHART_CELL,
  CHART_GRID,
  chartShare,
  hasCell,
  textToBits,
  WORLD_HALF,
} from '@office-fps/shared'
import type { Bounds } from './map-view.ts'

/** Pixels of pencil per map square (the fog's ragged edge is drawn at this grain). */
const SUB = 3
const N = CHART_GRID * SUB
/** Unmapped paper, the faded old map's wash, and the pencil line round what you've drawn. */
const PAPER: [number, number, number] = [8, 9, 7]
const HATCH: [number, number, number] = [58, 58, 44]
const PENCIL: [number, number, number] = [196, 188, 156]

/** A cheap fixed hash of a grid point, 0–1 (the same wobble every time the map is drawn). */
function wobble(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/**
 * The fog over the survival map (shared/survival/chart.ts), in chunky pencil pixels: squares
 * you've walked are clear, with a graphite line round them; squares only an earlier character saw
 * are hatched over, faded; the rest is blank paper. Edges wobble a little, as if drawn by hand.
 * Returns a CHART_GRID * SUB square canvas, to be drawn scaled up without smoothing.
 */
export function paintFog(seen: Uint8Array, old: Uint8Array | null): HTMLCanvasElement {
  // 2 = drawn by you, 1 = on the old map, 0 = blank: per square, then smoothed per pixel.
  const level = (cx: number, cz: number): number => {
    const x = Math.max(0, Math.min(CHART_GRID - 1, cx))
    const z = Math.max(0, Math.min(CHART_GRID - 1, cz))
    const i = z * CHART_GRID + x
    return hasCell(seen, i) ? 2 : old && hasCell(old, i) ? 1 : 0
  }
  const grid = new Uint8Array(N * N)
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      // Blend the four nearest squares, then nudge by the wobble: a ragged hand-drawn edge.
      const fx = (x + 0.5) / SUB - 0.5
      const fy = (y + 0.5) / SUB - 0.5
      const x0 = Math.floor(fx)
      const y0 = Math.floor(fy)
      const tx = fx - x0
      const ty = fy - y0
      const v =
        level(x0, y0) * (1 - tx) * (1 - ty) +
        level(x0 + 1, y0) * tx * (1 - ty) +
        level(x0, y0 + 1) * (1 - tx) * ty +
        level(x0 + 1, y0 + 1) * tx * ty +
        (wobble(x, y) - 0.5) * 0.7
      grid[y * N + x] = v > 1.35 ? 2 : v > 0.5 ? 1 : 0
    }

  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = N
  const g = canvas.getContext('2d')
  if (!g) return canvas
  const img = g.createImageData(N, N)
  const px = img.data
  const put = (i: number, [r, gr, b]: [number, number, number], a: number) => {
    px[i * 4] = r
    px[i * 4 + 1] = gr
    px[i * 4 + 2] = b
    px[i * 4 + 3] = a
  }
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = y * N + x
      const v = grid[i] ?? 0
      if (v === 2) {
        // Drawn: clear, but a pencil line where it meets what isn't.
        const edge =
          (grid[i - 1] ?? 2) < 2 ||
          (grid[i + 1] ?? 2) < 2 ||
          (grid[i - N] ?? 2) < 2 ||
          (grid[i + N] ?? 2) < 2
        if (edge && x > 0 && x < N - 1 && y > 0 && y < N - 1)
          put(i, PENCIL, wobble(y, x) < 0.8 ? 200 : 90)
        continue
      }
      if (v === 1) {
        // The old map: the land shows through faded, under diagonal pencil hatching.
        const hatch = (x + y) % 4 === 0
        put(i, hatch ? HATCH : PAPER, hatch ? 190 : 150)
        continue
      }
      // Blank paper: a faint ruled grid, and a little grain.
      const ruled = x % 12 === 0 || y % 12 === 0
      const grain = ruled ? 14 : wobble(x * 3, y * 7) < 0.06 ? 8 : 0
      put(i, [PAPER[0] + grain, PAPER[1] + grain, PAPER[2] + grain], 252)
    }
  g.putImageData(img, 0, 0)
  return canvas
}

/** The fog for a chart as sent (base64), cached by what it was drawn from. */
export class ChartPaper {
  private key = ''
  private fog: HTMLCanvasElement | null = null
  private seenBits: Uint8Array | null = null
  share = 0
  /** The world rectangle round every square you've drawn (null: none yet). */
  walked: Bounds | null = null

  /** The fog canvas for these maps (redrawn only when they change). */
  fogFor(seen: string, old: string | undefined): HTMLCanvasElement {
    const key = `${seen}|${old ?? ''}`
    if (this.fog && key === this.key) return this.fog
    this.key = key
    const bits = textToBits(seen)
    this.seenBits = bits
    this.share = chartShare(bits)
    this.walked = walkedBounds(bits)
    this.fog = paintFog(bits, old ? textToBits(old) : null)
    return this.fog
  }

  /** Whether a square is drawn on the current map. */
  drawn(i: number): boolean {
    return !!this.seenBits && hasCell(this.seenBits, i)
  }
}

/** The world rectangle round the drawn squares, or null when there are none. */
function walkedBounds(bits: Uint8Array): Bounds | null {
  let x0 = CHART_GRID
  let x1 = -1
  let z0 = CHART_GRID
  let z1 = -1
  for (let i = 0; i < CHART_GRID * CHART_GRID; i++) {
    if (!hasCell(bits, i)) continue
    const x = i % CHART_GRID
    const z = Math.floor(i / CHART_GRID)
    x0 = Math.min(x0, x)
    x1 = Math.max(x1, x)
    z0 = Math.min(z0, z)
    z1 = Math.max(z1, z)
  }
  if (x1 < 0) return null
  const at = (c: number) => c * CHART_CELL - WORLD_HALF
  return [at(x0), at(x1 + 1), at(z0), at(z1 + 1)]
}
