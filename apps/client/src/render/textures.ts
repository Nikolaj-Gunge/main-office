import type { MaterialId } from '@office-fps/shared'
import * as THREE from 'three'

/** Texel density for world surfaces: 32 texels per metre. A texture covers `meters` × `meters`. */
export const TEXELS_PER_METER = 32

/** Deterministic PRNG so textures look identical on every client. */
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Painter = (ctx: CanvasRenderingContext2D, size: number, rand: () => number) => void

interface SurfaceStyle {
  /** World size covered by one texture repeat (m). */
  meters: number
  paint: Painter
  /** Per-texel brightness jitter applied after painting (0–1). */
  noise: number
  kind?: 'lit' | 'glass' | 'emissive'
  /** For emissive surfaces: HDR brightness (>1 glows through the bloom pass). */
  glow?: number
  /** Surfaces that shouldn't cast shadows (glass, thin glowing panels). */
  noShadow?: boolean
}

const fill =
  (color: string): Painter =>
  (ctx, size) => {
    ctx.fillStyle = color
    ctx.fillRect(0, 0, size, size)
  }

/** Classic dev texture: flat color with a 1 m grid and half-metre ticks (gym). */
const dev =
  (base: string, line: string, hatch = false): Painter =>
  (ctx, size) => {
    ctx.fillStyle = base
    ctx.fillRect(0, 0, size, size)
    ctx.fillStyle = line
    if (hatch) {
      for (let i = -size; i < size; i += 8) {
        for (let t = 0; t < 3; t++) for (let y = 0; y < size; y++) ctx.fillRect(i + y + t, y, 1, 1)
      }
    }
    ctx.fillRect(0, 0, size, 1)
    ctx.fillRect(0, 0, 1, size)
    ctx.fillRect(size / 2, 0, 1, 3)
    ctx.fillRect(0, size / 2, 3, 1)
  }

/** A rectangle that wraps round the tile's edges, so details may cross them seamlessly. */
function wrapRect(
  ctx: CanvasRenderingContext2D,
  size: number,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  for (const ox of [0, -size]) for (const oy of [0, -size]) ctx.fillRect(x + ox, y + oy, w, h)
}

/** A knot in wood: a dark heart in a lighter ring, centred on row `y`. */
function knot(ctx: CanvasRenderingContext2D, size: number, rand: () => number, y: number): void {
  const x = Math.floor(rand() * size)
  ctx.fillStyle = 'rgba(120,80,40,0.45)'
  wrapRect(ctx, size, x, y - 1, 4, 3)
  ctx.fillStyle = 'rgba(45,25,10,0.8)'
  wrapRect(ctx, size, x + 1, y, 2, 1)
}

/** Soft dark blotches: old stains, damp. */
function stains(
  ctx: CanvasRenderingContext2D,
  size: number,
  rand: () => number,
  count: number,
  color: string,
): void {
  ctx.fillStyle = color
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rand() * size)
    const y = Math.floor(rand() * size)
    const w = 6 + Math.floor(rand() * 9)
    const h = 4 + Math.floor(rand() * 7)
    wrapRect(ctx, size, x, y, w, h)
    wrapRect(ctx, size, x + 1, (y + h) % size, w - 2, 1)
  }
}

/** Dirt run down a wall by the rain: thin streaks fading out downwards. */
function streaks(
  ctx: CanvasRenderingContext2D,
  size: number,
  rand: () => number,
  count: number,
  color: string,
): void {
  ctx.fillStyle = color
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rand() * size)
    const y = Math.floor(rand() * size)
    const run = Math.floor(size / 4 + rand() * (size / 2))
    wrapRect(ctx, size, x, y, 1 + Math.floor(rand() * 2), run)
    wrapRect(ctx, size, x, y, 1, Math.floor(run * 1.3))
  }
}

/** A hairline crack wandering across the tile. */
function crack(
  ctx: CanvasRenderingContext2D,
  size: number,
  rand: () => number,
  color: string,
  length: number,
): void {
  ctx.fillStyle = color
  let x = Math.floor(rand() * size)
  let y = Math.floor(rand() * size)
  const steep = rand() < 0.5
  for (let i = 0; i < length; i++) {
    wrapRect(ctx, size, ((x % size) + size) % size, ((y % size) + size) % size, 1, 1)
    if (steep) {
      y++
      if (rand() < 0.4) x += rand() < 0.5 ? -1 : 1
    } else {
      x++
      if (rand() < 0.4) y += rand() < 0.5 ? -1 : 1
    }
  }
}

const STYLES: Record<MaterialId, SurfaceStyle> = {
  // ── Gym ──
  floor: { meters: 1, noise: 0.06, paint: dev('#6f7275', '#55585b') },
  wall: { meters: 1, noise: 0.04, paint: dev('#b9b6ad', '#9c998f') },
  cover: { meters: 1, noise: 0.05, paint: dev('#d0742f', '#a65a22') },
  platform: { meters: 1, noise: 0.05, paint: dev('#4f73a8', '#3b5a87') },
  marker: { meters: 1, noise: 0.05, paint: dev('#dcbc3c', '#ad922a') },
  target: { meters: 1, noise: 0.04, paint: dev('#b9362f', '#f1e6d2', true) },
  ramp: {
    meters: 1,
    noise: 0.05,
    paint: (ctx, size) => {
      // Green felt (gym ramps, ping-pong and pool tables) with a white edge line.
      ctx.fillStyle = '#2f7d4a'
      ctx.fillRect(0, 0, size, size)
      ctx.fillStyle = '#e8efe6'
      ctx.fillRect(0, 0, size, 1)
    },
  },

  // ── Office ──
  carpet: {
    meters: 1,
    noise: 0.1,
    paint: (ctx, size, rand) => {
      // 50 cm carpet tiles laid in alternating directions.
      for (let ty = 0; ty < 2; ty++) {
        for (let tx = 0; tx < 2; tx++) {
          ctx.fillStyle = (tx + ty) % 2 ? '#4b5466' : '#465062'
          ctx.fillRect((tx * size) / 2, (ty * size) / 2, size / 2, size / 2)
        }
      }
      ctx.fillStyle = 'rgba(30,34,44,0.6)'
      for (let i = 0; i < 70; i++)
        ctx.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), 1, 1)
      ctx.fillStyle = 'rgba(25,28,36,0.5)'
      ctx.fillRect(0, 0, size, 1)
      ctx.fillRect(0, size / 2, size, 1)
      ctx.fillRect(0, 0, 1, size)
      ctx.fillRect(size / 2, 0, 1, size)
    },
  },
  wood: {
    meters: 2,
    noise: 0.05,
    paint: (ctx, size, rand) => {
      // Oak planks: 8 rows (25 cm), staggered butt joints nailed either side, long grain, the
      // odd knot, a bevel of light along each plank's top edge and a few old stains.
      const rows = 8
      const h = size / rows
      for (let r = 0; r < rows; r++) {
        const tone = 150 + Math.floor(rand() * 26)
        ctx.fillStyle = `rgb(${tone + 30},${tone - 8},${tone - 52})`
        ctx.fillRect(0, r * h, size, h)
        for (let g = 0; g < 9; g++) {
          ctx.fillStyle = rand() < 0.75 ? 'rgba(90,55,25,0.35)' : 'rgba(235,200,150,0.18)'
          const y = r * h + 2 + Math.floor(rand() * (h - 3))
          wrapRect(ctx, size, Math.floor(rand() * size), y, 8 + Math.floor(rand() * 24), 1)
        }
        if (rand() < 0.45) knot(ctx, size, rand, r * h + 3 + Math.floor(rand() * (h - 5)))
        ctx.fillStyle = 'rgba(255,230,190,0.13)'
        ctx.fillRect(0, r * h + 1, size, 1)
        ctx.fillStyle = 'rgba(60,35,15,0.7)'
        ctx.fillRect(0, r * h, size, 1)
        const seam = Math.floor(((r * 0.37) % 1) * size)
        ctx.fillRect(seam, r * h, 1, h)
        ctx.fillStyle = '#2a1c10'
        for (const nx of [seam - 2, seam + 2]) {
          wrapRect(ctx, size, (nx + size) % size, r * h + 2, 1, 1)
          wrapRect(ctx, size, (nx + size) % size, r * h + h - 3, 1, 1)
        }
      }
      stains(ctx, size, rand, 3, 'rgba(50,30,15,0.12)')
    },
  },
  tile: {
    meters: 1,
    noise: 0.04,
    paint: (ctx, size) => {
      ctx.fillStyle = '#d9d6cf'
      ctx.fillRect(0, 0, size, size)
      ctx.fillStyle = '#aaa59b'
      for (let i = 0; i < size; i += size / 2) {
        ctx.fillRect(i, 0, 1, size)
        ctx.fillRect(0, i, size, 1)
      }
    },
  },
  concrete: {
    meters: 2,
    noise: 0.07,
    paint: (ctx, size, rand) => {
      // Poured concrete: blotchy, with the form panels' seams and tie holes, a hairline
      // crack and water stains running down.
      ctx.fillStyle = '#a2a19c'
      ctx.fillRect(0, 0, size, size)
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = rand() < 0.5 ? 'rgba(120,118,112,0.35)' : 'rgba(190,188,182,0.35)'
        const s = 2 + Math.floor(rand() * 8)
        ctx.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), s, s)
      }
      ctx.fillStyle = 'rgba(80,78,74,0.2)'
      ctx.fillRect(0, size / 2, size, 1)
      ctx.fillRect(size / 2, 0, 1, size)
      for (let y = size / 8; y < size; y += size / 4) {
        for (let x = size / 8; x < size; x += size / 4) {
          ctx.fillStyle = 'rgba(70,68,64,0.6)'
          ctx.fillRect(x, y, 2, 2)
          ctx.fillStyle = 'rgba(200,198,190,0.3)'
          ctx.fillRect(x, y + 2, 2, 1)
        }
      }
      streaks(ctx, size, rand, 4, 'rgba(70,68,62,0.16)')
      crack(ctx, size, rand, 'rgba(60,58,54,0.6)', 18 + Math.floor(rand() * 16))
      ctx.fillStyle = 'rgba(80,78,74,0.35)'
      ctx.fillRect(0, 0, size, 1)
      ctx.fillRect(0, 0, 1, size)
    },
  },
  plaster: {
    meters: 1,
    noise: 0.03,
    paint: (ctx, size, rand) => {
      // Stucco: fine speckle, a faint stain and now and then a hairline crack.
      ctx.fillStyle = '#e7e4de'
      ctx.fillRect(0, 0, size, size)
      for (let i = 0; i < 70; i++) {
        ctx.fillStyle = rand() < 0.5 ? 'rgba(150,145,135,0.2)' : 'rgba(255,255,250,0.25)'
        ctx.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), 1, 1)
      }
      stains(ctx, size, rand, 1, 'rgba(150,140,120,0.1)')
      if (rand() < 0.7)
        crack(ctx, size, rand, 'rgba(120,115,105,0.4)', 10 + Math.floor(rand() * 10))
    },
  },
  ceiling: {
    meters: 1.2,
    noise: 0.03,
    paint: (ctx, size, rand) => {
      ctx.fillStyle = '#eceae6'
      ctx.fillRect(0, 0, size, size)
      ctx.fillStyle = 'rgba(160,158,150,0.6)'
      for (let i = 0; i < 60; i++)
        ctx.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), 1, 1)
      ctx.fillStyle = '#c3c1bb'
      ctx.fillRect(0, 0, size, 1)
      ctx.fillRect(0, 0, 1, size)
      ctx.fillRect(0, size / 2, size, 1)
      ctx.fillRect(size / 2, 0, 1, size)
    },
  },
  glass: {
    meters: 1,
    noise: 0,
    kind: 'glass',
    noShadow: true,
    paint: (ctx, size) => {
      ctx.fillStyle = '#bfe0f5'
      ctx.fillRect(0, 0, size, size)
      // A couple of diagonal reflection streaks.
      ctx.fillStyle = 'rgba(255,255,255,0.8)'
      for (let i = 0; i < size; i++) {
        ctx.fillRect((i + 6) % size, i, 2, 1)
        ctx.fillRect((i + 14) % size, i, 1, 1)
      }
    },
  },
  desk: {
    meters: 1,
    noise: 0.03,
    paint: (ctx, size, rand) => {
      ctx.fillStyle = '#e4dccd'
      ctx.fillRect(0, 0, size, size)
      ctx.fillStyle = 'rgba(170,150,120,0.35)'
      for (let i = 0; i < 18; i++) ctx.fillRect(0, Math.floor(rand() * size), size, 1)
    },
  },
  metal: {
    meters: 1,
    noise: 0.04,
    paint: (ctx, size, rand) => {
      // Brushed sheet with a riveted seam along its edges, scratches and a few rust spots
      // weeping downwards.
      ctx.fillStyle = '#3c4048'
      ctx.fillRect(0, 0, size, size)
      ctx.fillStyle = 'rgba(120,126,136,0.35)'
      for (let i = 0; i < 24; i++) ctx.fillRect(0, Math.floor(rand() * size), size, 1)
      ctx.fillStyle = 'rgba(15,17,20,0.6)'
      ctx.fillRect(0, 0, size, 1)
      ctx.fillRect(0, 0, 1, size)
      for (let i = 4; i < size; i += 6) {
        ctx.fillStyle = 'rgba(150,156,166,0.7)'
        ctx.fillRect(i, 2, 1, 1)
        ctx.fillRect(2, i, 1, 1)
        ctx.fillStyle = 'rgba(10,12,15,0.6)'
        ctx.fillRect(i, 3, 1, 1)
        ctx.fillRect(2, i + 1, 1, 1)
      }
      ctx.fillStyle = 'rgba(160,166,176,0.3)'
      for (let i = 0; i < 4; i++) {
        const x = Math.floor(rand() * size)
        const y = Math.floor(rand() * size)
        const run = 3 + Math.floor(rand() * 3)
        for (let k = 0; k < run; k++) wrapRect(ctx, size, (x + k) % size, y, 1, 1)
      }
      for (let i = 0; i < 3; i++) {
        const x = Math.floor(rand() * size)
        const y = Math.floor(rand() * size)
        ctx.fillStyle = 'rgba(120,60,25,0.55)'
        wrapRect(ctx, size, x, y, 2, 1)
        ctx.fillStyle = 'rgba(110,55,22,0.3)'
        wrapRect(ctx, size, x, (y + 1) % size, 1, 2 + Math.floor(rand() * 4))
      }
    },
  },
  fabric: {
    meters: 0.5,
    noise: 0.08,
    paint: (ctx, size) => {
      ctx.fillStyle = '#2f7d86'
      ctx.fillRect(0, 0, size, size)
      ctx.fillStyle = 'rgba(15,60,66,0.5)'
      for (let i = 0; i < size; i += 2) ctx.fillRect(i, 0, 1, size)
    },
  },
  fabricAlt: {
    meters: 0.5,
    noise: 0.08,
    paint: (ctx, size) => {
      ctx.fillStyle = '#3b3e49'
      ctx.fillRect(0, 0, size, size)
      ctx.fillStyle = 'rgba(20,22,30,0.5)'
      for (let i = 0; i < size; i += 2) ctx.fillRect(0, i, size, 1)
    },
  },
  screen: {
    meters: 0.5,
    noise: 0,
    kind: 'emissive',
    glow: 1.3,
    paint: (ctx, size, rand) => {
      // Dark editor with coloured "code" lines.
      ctx.fillStyle = '#101624'
      ctx.fillRect(0, 0, size, size)
      const colors = ['#7aa2f7', '#9ece6a', '#e0af68', '#bb9af7', '#c0caf5']
      for (let y = 2; y < size - 1; y += 2) {
        let x = 1 + Math.floor(rand() * 4)
        while (x < size - 2 && rand() < 0.8) {
          const w = 2 + Math.floor(rand() * 6)
          ctx.fillStyle = colors[Math.floor(rand() * colors.length)] ?? '#fff'
          ctx.fillRect(x, y, Math.min(w, size - 1 - x), 1)
          x += w + 1
        }
      }
    },
  },
  plant: {
    meters: 0.5,
    noise: 0.12,
    paint: (ctx, size, rand) => {
      ctx.fillStyle = '#24562c'
      ctx.fillRect(0, 0, size, size)
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle =
          ['#3d8a45', '#2f7239', '#58a85a', '#1d4523'][Math.floor(rand() * 4)] ?? '#3d8a45'
        const x = Math.floor(rand() * size)
        const y = Math.floor(rand() * size)
        ctx.fillRect(x, y, 2 + Math.floor(rand() * 3), 1 + Math.floor(rand() * 3))
      }
    },
  },
  accent: { meters: 1, noise: 0.04, paint: fill('#b33831') },
  lightpanel: {
    meters: 0.6,
    noise: 0,
    kind: 'emissive',
    glow: 3,
    noShadow: true,
    paint: (ctx, size) => {
      ctx.fillStyle = '#fffaf0'
      ctx.fillRect(0, 0, size, size)
      ctx.fillStyle = '#d8d3c8'
      ctx.fillRect(0, 0, size, 1)
      ctx.fillRect(0, 0, 1, size)
    },
  },
  rack: {
    meters: 1,
    noise: 0.03,
    kind: 'emissive',
    glow: 1,
    paint: (ctx, size, rand) => {
      // Black rack units with blinking-light rows.
      ctx.fillStyle = '#121418'
      ctx.fillRect(0, 0, size, size)
      for (let y = 0; y < size; y += 4) {
        ctx.fillStyle = '#23262d'
        ctx.fillRect(0, y, size, 1)
        for (let x = 2; x < size; x += 3) {
          if (rand() < 0.35) {
            ctx.fillStyle = rand() < 0.7 ? '#39ff8a' : '#4aa8ff'
            ctx.fillRect(x, y + 2, 1, 1)
          }
        }
      }
    },
  },
  whiteboard: {
    meters: 1,
    noise: 0.02,
    paint: (ctx, size, rand) => {
      ctx.fillStyle = '#f4f4f1'
      ctx.fillRect(0, 0, size, size)
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = rand() < 0.5 ? '#2b6cb0' : '#c53030'
        const y = 4 + Math.floor(rand() * (size - 8))
        ctx.fillRect(3, y, 6 + Math.floor(rand() * 18), 1)
      }
    },
  },
  // ── Farm ──
  dirt: {
    meters: 2,
    noise: 0.1,
    paint: (ctx, size, rand) => {
      ctx.fillStyle = '#4a3a2a'
      ctx.fillRect(0, 0, size, size)
      for (let i = 0; i < 260; i++) {
        ctx.fillStyle = ['#5a4733', '#3b2e21', '#665139', '#2f251b'][Math.floor(rand() * 4)] ?? ''
        ctx.fillRect(
          Math.floor(rand() * size),
          Math.floor(rand() * size),
          1 + Math.floor(rand() * 3),
          1,
        )
      }
    },
  },
  grass: {
    meters: 2,
    noise: 0.12,
    paint: (ctx, size, rand) => {
      ctx.fillStyle = '#2c3d22'
      ctx.fillRect(0, 0, size, size)
      for (let i = 0; i < 400; i++) {
        ctx.fillStyle = ['#3a5129', '#24331c', '#46602f', '#33452a'][Math.floor(rand() * 4)] ?? ''
        ctx.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), 1, 2)
      }
    },
  },
  corn: {
    meters: 1,
    noise: 0.12,
    paint: (ctx, size, rand) => {
      ctx.fillStyle = '#3f5a26'
      ctx.fillRect(0, 0, size, size)
      for (let i = 0; i < 60; i++) {
        ctx.fillStyle = ['#56742f', '#6d7d34', '#2e4419', '#8a8a3c'][Math.floor(rand() * 4)] ?? ''
        ctx.fillRect(
          Math.floor(rand() * size),
          Math.floor(rand() * size),
          1,
          3 + Math.floor(rand() * 6),
        )
      }
    },
  },
  hay: {
    meters: 1,
    noise: 0.1,
    paint: (ctx, size, rand) => {
      ctx.fillStyle = '#b8964a'
      ctx.fillRect(0, 0, size, size)
      for (let i = 0; i < 120; i++) {
        ctx.fillStyle = ['#d4b062', '#9c7c38', '#c9a556', '#8a6a2e'][Math.floor(rand() * 4)] ?? ''
        ctx.fillRect(
          Math.floor(rand() * size),
          Math.floor(rand() * size),
          2 + Math.floor(rand() * 5),
          1,
        )
      }
    },
  },
  barn: {
    meters: 2,
    noise: 0.06,
    paint: (ctx, size, rand) => {
      // Weathered red vertical boards with dark seams, nailed top and bottom, the paint
      // flaking to grey wood here and there.
      ctx.fillStyle = '#7d2a22'
      ctx.fillRect(0, 0, size, size)
      for (let x = 0; x < size; x += 8) {
        ctx.fillStyle = ['#8a3027', '#712620', '#83342a'][Math.floor(rand() * 3)] ?? ''
        ctx.fillRect(x + 1, 0, 7, size)
        ctx.fillStyle = 'rgba(255,200,180,0.08)'
        ctx.fillRect(x + 1, 0, 1, size)
        ctx.fillStyle = '#3a1410'
        ctx.fillRect(x, 0, 1, size)
        for (let i = 0; i < 6; i++) {
          ctx.fillStyle = '#a65a4a'
          ctx.fillRect(x + 1 + Math.floor(rand() * 6), Math.floor(rand() * size), 1, 2)
        }
        ctx.fillStyle = '#24100c'
        for (const y of [4, size / 2 + 4]) {
          ctx.fillRect(x + 2, y, 1, 1)
          ctx.fillRect(x + 6, y, 1, 1)
        }
      }
      for (let i = 0; i < 9; i++) {
        const x = Math.floor(rand() * size)
        const y = Math.floor(rand() * size)
        ctx.fillStyle = '#6e6258'
        wrapRect(ctx, size, x, y, 1 + Math.floor(rand() * 3), 2 + Math.floor(rand() * 5))
      }
      streaks(ctx, size, rand, 3, 'rgba(30,10,8,0.18)')
    },
  },
  // ── Survival (Deadwood) ──
  asphalt: {
    meters: 2,
    noise: 0.1,
    paint: (ctx, size, rand) => {
      ctx.fillStyle = '#2b2c2f'
      ctx.fillRect(0, 0, size, size)
      for (let i = 0; i < 160; i++) {
        ctx.fillStyle = ['#34363a', '#222326', '#3d3f43'][Math.floor(rand() * 3)] ?? ''
        ctx.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), 1, 1)
      }
      // A crack or two.
      ctx.fillStyle = '#18191b'
      let x = Math.floor(rand() * size)
      for (let y = 0; y < size; y++) {
        if (rand() < 0.4) x += rand() < 0.5 ? -1 : 1
        ctx.fillRect(((x % size) + size) % size, y, 1, 1)
      }
    },
  },
  log: {
    meters: 1,
    noise: 0.09,
    paint: (ctx, size, rand) => {
      // Stacked logs: dark gaps between rounded, grainy rows, bark knots and checks.
      const rows = 4
      const h = size / rows
      for (let r = 0; r < rows; r++) {
        ctx.fillStyle = ['#5a4028', '#634731', '#523a24'][r % 3] ?? ''
        ctx.fillRect(0, r * h, size, h)
        ctx.fillStyle = '#7a5a3c'
        ctx.fillRect(0, r * h + 1, size, 1)
        ctx.fillStyle = 'rgba(30,20,10,0.3)'
        ctx.fillRect(0, (r + 1) * h - 2, size, 1)
        ctx.fillStyle = '#2a1d12'
        ctx.fillRect(0, (r + 1) * h - 1, size, 1)
        for (let i = 0; i < 10; i++) {
          ctx.fillStyle = 'rgba(30,20,10,0.35)'
          ctx.fillRect(
            Math.floor(rand() * size),
            r * h + 2 + Math.floor(rand() * (h - 4)),
            3 + Math.floor(rand() * 6),
            1,
          )
        }
        ctx.fillStyle = 'rgba(25,16,8,0.5)'
        for (let i = 0; i < 2; i++) {
          wrapRect(ctx, size, Math.floor(rand() * size), r * h + 2 + Math.floor(rand() * 3), 1, 2)
        }
        if (rand() < 0.5) knot(ctx, size, rand, r * h + 3 + Math.floor(rand() * (h - 5)))
      }
    },
  },
  shingle: {
    meters: 1,
    noise: 0.08,
    paint: (ctx, size, rand) => {
      // Rows of tabs, each with a lit top edge and a shadow under it; a few missing, moss
      // creeping over the rest.
      ctx.fillStyle = '#2e2a28'
      ctx.fillRect(0, 0, size, size)
      for (let y = 0; y < size; y += 4) {
        for (let x = (y / 4) % 2 === 0 ? 0 : -3; x < size; x += 6) {
          if (rand() < 0.04) continue
          ctx.fillStyle = ['#3a3532', '#33302d', '#413b37', '#2a2624'][Math.floor(rand() * 4)] ?? ''
          ctx.fillRect(x, y, 5, 3)
          ctx.fillStyle = 'rgba(255,240,220,0.07)'
          ctx.fillRect(x, y, 5, 1)
          ctx.fillStyle = 'rgba(0,0,0,0.3)'
          ctx.fillRect(x, y + 2, 5, 1)
        }
      }
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = rand() < 0.5 ? 'rgba(70,90,45,0.35)' : 'rgba(90,100,55,0.25)'
        wrapRect(
          ctx,
          size,
          Math.floor(rand() * size),
          Math.floor(rand() * size),
          2 + Math.floor(rand() * 4),
          1 + Math.floor(rand() * 3),
        )
      }
    },
  },
  brick: {
    meters: 1,
    noise: 0.08,
    paint: (ctx, size, rand) => {
      // Running bond: each brick lit along its top and shaded along its bottom, some burnt
      // dark, some chipped, soot streaks running down.
      ctx.fillStyle = '#8f8a80'
      ctx.fillRect(0, 0, size, size)
      ctx.fillStyle = 'rgba(60,58,52,0.35)'
      for (let i = 0; i < 30; i++) {
        ctx.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), 1, 1)
      }
      for (let y = 0; y < size; y += 4) {
        for (let x = (y / 4) % 2 === 0 ? 0 : -4; x < size; x += 8) {
          ctx.fillStyle =
            rand() < 0.1
              ? '#5a2a20'
              : (['#7d3a2c', '#8a4332', '#6f3326', '#93503b'][Math.floor(rand() * 4)] ?? '')
          ctx.fillRect(x, y, 7, 3)
          ctx.fillStyle = 'rgba(255,215,190,0.12)'
          ctx.fillRect(x, y, 7, 1)
          ctx.fillStyle = 'rgba(20,8,4,0.25)'
          ctx.fillRect(x, y + 2, 7, 1)
          if (rand() < 0.12) {
            ctx.fillStyle = '#8f8a80'
            ctx.fillRect(rand() < 0.5 ? x : x + 6, y + (rand() < 0.5 ? 0 : 2), 1, 1)
          }
        }
      }
      streaks(ctx, size, rand, 2, 'rgba(30,25,20,0.18)')
    },
  },
  rust: {
    meters: 1,
    noise: 0.1,
    paint: (ctx, size, rand) => {
      // Corrugated sheet going to rust: lit ridges, two rows of bolts, rust weeping down
      // from them and patches eaten through the paint.
      for (let x = 0; x < size; x++) {
        ctx.fillStyle = x % 4 === 0 ? '#76797b' : x % 4 < 2 ? '#6b6e70' : '#56595b'
        ctx.fillRect(x, 0, 1, size)
      }
      for (let i = 0; i < 18; i++) {
        ctx.fillStyle =
          ['rgba(138,70,30,0.7)', 'rgba(110,52,22,0.7)', 'rgba(160,92,40,0.5)'][
            Math.floor(rand() * 3)
          ] ?? ''
        const x = Math.floor(rand() * size)
        const y = Math.floor(rand() * size)
        ctx.fillRect(x, y, 2 + Math.floor(rand() * 5), 3 + Math.floor(rand() * 9))
      }
      for (const by of [2, size / 2 + 2]) {
        for (let x = 1; x < size; x += 8) {
          ctx.fillStyle = '#2a2b2c'
          ctx.fillRect(x, by, 1, 1)
          if (rand() < 0.6) {
            const run = 3 + Math.floor(rand() * 10)
            for (let k = 1; k <= run; k++) {
              ctx.fillStyle = `rgba(130,62,24,${(0.6 * (1 - k / (run + 1))).toFixed(2)})`
              ctx.fillRect(x, by + k, 1, 1)
            }
          }
        }
      }
    },
  },
  canvas: {
    meters: 1,
    noise: 0.07,
    paint: (ctx, size, rand) => {
      // Woven canvas with a stitched seam across it and a sewn-on patch.
      ctx.fillStyle = '#5d6248'
      ctx.fillRect(0, 0, size, size)
      for (let y = 0; y < size; y += 2) {
        ctx.fillStyle = 'rgba(40,44,30,0.25)'
        ctx.fillRect(0, y, size, 1)
      }
      for (let x = 1; x < size; x += 3) {
        ctx.fillStyle = 'rgba(40,44,30,0.12)'
        ctx.fillRect(x, 0, 1, size)
      }
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = 'rgba(30,32,22,0.4)'
        ctx.fillRect(
          Math.floor(rand() * size),
          Math.floor(rand() * size),
          3 + Math.floor(rand() * 5),
          2,
        )
      }
      ctx.fillStyle = 'rgba(25,27,18,0.55)'
      ctx.fillRect(0, size / 2, size, 1)
      ctx.fillStyle = 'rgba(190,190,160,0.35)'
      for (let x = 0; x < size; x += 3) ctx.fillRect(x, size / 2 + 1, 1, 1)
      if (rand() < 0.7) {
        const px = Math.floor(rand() * (size - 10))
        const py = 2 + Math.floor(rand() * (size / 2 - 10))
        ctx.fillStyle = '#545a3f'
        ctx.fillRect(px, py, 8, 6)
        ctx.fillStyle = 'rgba(190,190,160,0.35)'
        for (let k = 0; k < 8; k += 2) {
          ctx.fillRect(px + k, py, 1, 1)
          ctx.fillRect(px + k, py + 5, 1, 1)
        }
      }
    },
  },
  sandbag: {
    meters: 1,
    noise: 0.09,
    paint: (ctx, size, rand) => {
      // Bags laid in bond: a seam along each, tied at one end, shadow under each row.
      ctx.fillStyle = '#4a4434'
      ctx.fillRect(0, 0, size, size)
      for (let y = 0; y < size; y += 8) {
        for (let x = (y / 8) % 2 === 0 ? 0 : -8; x < size; x += 16) {
          ctx.fillStyle = ['#8c8062', '#7d7257', '#968a6b'][Math.floor(rand() * 3)] ?? ''
          ctx.fillRect(x + 1, y + 1, 14, 6)
          ctx.fillStyle = 'rgba(255,255,255,0.08)'
          ctx.fillRect(x + 2, y + 1, 12, 1)
          ctx.fillStyle = 'rgba(0,0,0,0.2)'
          ctx.fillRect(x + 1, y + 6, 14, 1)
          ctx.fillStyle = 'rgba(60,54,40,0.6)'
          for (let k = 3; k < 13; k += 2) ctx.fillRect(x + k, y + 4, 1, 1)
          ctx.fillStyle = 'rgba(50,44,32,0.7)'
          ctx.fillRect(x + 13, y + 2, 1, 4)
          ctx.fillStyle = 'rgba(180,170,140,0.5)'
          ctx.fillRect(x + 14, y + 3, 1, 2)
        }
      }
    },
  },
  warnlight: {
    meters: 0.4,
    noise: 0,
    kind: 'emissive',
    glow: 4,
    noShadow: true,
    paint: (ctx, size) => {
      ctx.fillStyle = '#ff2a1a'
      ctx.fillRect(0, 0, size, size)
      ctx.fillStyle = '#ff8a70'
      ctx.fillRect(1, 1, Math.max(1, size - 2), Math.max(1, size - 2))
    },
  },
  lantern: {
    meters: 0.2,
    noise: 0,
    kind: 'emissive',
    glow: 3,
    noShadow: true,
    paint: (ctx, size) => {
      // Sooty glass round a warm flame.
      ctx.fillStyle = '#c86a1c'
      ctx.fillRect(0, 0, size, size)
      ctx.fillStyle = '#ffc060'
      ctx.fillRect(size * 0.25, size * 0.2, size * 0.5, size * 0.65)
      ctx.fillStyle = '#fff0b0'
      ctx.fillRect(size * 0.4, size * 0.4, size * 0.2, size * 0.35)
    },
  },
  trim: {
    meters: 1,
    noise: 0.06,
    paint: (ctx, size, rand) => {
      // Painted trim gone grey: board joints, grime in the grain, paint flaking off to the
      // dark wood under it.
      ctx.fillStyle = '#6e6a62'
      ctx.fillRect(0, 0, size, size)
      ctx.fillStyle = 'rgba(60,55,48,0.25)'
      for (let i = 0; i < size; i += size / 4) {
        ctx.fillRect(0, i, size, 1)
        ctx.fillRect(i, 0, 1, size)
      }
      ctx.fillStyle = 'rgba(40,36,30,0.3)'
      for (let i = 0; i < 40; i++) {
        ctx.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), 1, 1)
      }
      for (let i = 0; i < 12; i++) {
        const x = Math.floor(rand() * size)
        const y = Math.floor(rand() * size)
        const w = 1 + Math.floor(rand() * 4)
        ctx.fillStyle = '#3e3022'
        wrapRect(ctx, size, x, y, w, 1 + Math.floor(rand() * 2))
        ctx.fillStyle = 'rgba(160,155,144,0.45)'
        wrapRect(ctx, size, x, (y + size - 1) % size, w, 1)
      }
    },
  },
}

function makeTexture(style: SurfaceStyle, seed: number): THREE.CanvasTexture {
  const size = Math.max(8, Math.round(style.meters * TEXELS_PER_METER))
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  // Read back for the noise (and later averaged for far tiles): keep it on the CPU side.
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D canvas unavailable')
  const rand = mulberry32(seed)
  style.paint(ctx, size, rand)

  if (style.noise > 0) {
    const img = ctx.getImageData(0, 0, size, size)
    for (let i = 0; i < img.data.length; i += 4) {
      const k = 1 + (rand() * 2 - 1) * style.noise
      img.data[i] = Math.min(255, (img.data[i] ?? 0) * k)
      img.data[i + 1] = Math.min(255, (img.data[i + 1] ?? 0) * k)
      img.data[i + 2] = Math.min(255, (img.data[i + 2] ?? 0) * k)
    }
    ctx.putImageData(img, 0, 0)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  // Crisp or smooth, as the look asks (see setSmoothTextures).
  filterTexture(texture)
  texture.generateMipmaps = true
  // World UVs are in metres; scale so one repeat covers `meters`.
  texture.repeat.set(1 / style.meters, 1 / style.meters)
  return texture
}

const cache = new Map<MaterialId, THREE.Material>()

/** Every world texture made so far, and how they're filtered now. */
const textures = new Set<THREE.Texture>()
let smoothTextures = false
let anisotropy = 1

/**
 * Crisp: nearest texels (blocky up close), nearest mips. Smooth: blended texels, trilinear mips
 * and some anisotropy, so floors and walls stay clean at grazing angles.
 */
export function filterTexture(texture: THREE.Texture): void {
  textures.add(texture)
  texture.magFilter = smoothTextures ? THREE.LinearFilter : THREE.NearestFilter
  texture.minFilter = smoothTextures
    ? THREE.LinearMipmapLinearFilter
    : THREE.NearestMipmapNearestFilter
  texture.anisotropy = smoothTextures ? anisotropy : 1
  texture.needsUpdate = true
}

/** Switches every world texture (made already or later) to smooth or crisp filtering. */
export function setSmoothTextures(on: boolean, maxAnisotropy = 4): void {
  if (on === smoothTextures && maxAnisotropy === anisotropy) return
  smoothTextures = on
  anisotropy = maxAnisotropy
  for (const t of textures) filterTexture(t)
}

/** Whether boxes of this material should cast shadows. */
export function castsShadow(id: MaterialId): boolean {
  return !STYLES[id].noShadow
}

export function isTransparent(id: MaterialId): boolean {
  return STYLES[id].kind === 'glass'
}

export function getSurfaceMaterial(id: MaterialId): THREE.Material {
  let material = cache.get(id)
  if (material) return material
  const style = STYLES[id]
  const seed = [...id].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261)
  const map = makeTexture(style, seed)
  if (style.kind === 'glass') {
    material = new THREE.MeshPhongMaterial({
      map,
      transparent: true,
      opacity: 0.28,
      shininess: 90,
      specular: 0x99aabb,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  } else if (style.kind === 'emissive') {
    material = new THREE.MeshLambertMaterial({
      map,
      emissiveMap: map,
      emissive: 0xffffff,
      emissiveIntensity: style.glow ?? 1,
    })
  } else {
    material = new THREE.MeshLambertMaterial({ map })
  }
  cache.set(id, material)
  return material
}
