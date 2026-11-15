import {
  ACHIEVEMENTS,
  type Cosmetic,
  cosmeticById,
  type FieldNotes,
  isoWeek,
  weekNotes,
} from '@office-fps/shared'

/**
 * The Survival Journal's share card: a 1200×630 picture (the size link previews use) of who you
 * played, what you've lived through and the journal entries you've earned, in the game's blocky
 * look. Text is drawn small and blown up without smoothing, so it comes out in chunky pixels.
 */

export const CARD_W = 1200
export const CARD_H = 630

const INK = '#e8dcc0'
const DIM = '#9a8e76'
const EMBER = '#d88a3a'
const PAPER = '#16130f'

export interface CardInfo {
  /** Who they play this time (the character's name), and the player's own. */
  who: string
  player: string
  notes: FieldNotes
  now: number
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`

/** Pixel text: drawn at 1/`px` size on a scratch canvas, then scaled up with no smoothing. */
function pixelText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  px: number,
  color: string,
  size = 8,
): number {
  const scratch = document.createElement('canvas')
  const s = scratch.getContext('2d')
  if (!s) return 0
  const font = `bold ${size}px monospace`
  s.font = font
  const w = Math.max(1, Math.ceil(s.measureText(text).width))
  scratch.width = w
  scratch.height = size + 2
  s.font = font
  s.textBaseline = 'top'
  s.fillStyle = color
  s.fillText(text, 0, 1)
  // Hard edges: every pixel either ink or nothing.
  const img = s.getImageData(0, 0, scratch.width, scratch.height)
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = (img.data[i] as number) > 110 ? 255 : 0
  s.putImageData(img, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(scratch, x, y, scratch.width * px, scratch.height * px)
  return scratch.width * px
}

/** A camp banner on its pole, in blocks (`size`: one block's width in px). */
export function drawBanner(
  ctx: CanvasRenderingContext2D,
  banner: Cosmetic | undefined,
  x: number,
  y: number,
  size: number,
): void {
  const cloth = hex(banner?.tint ?? 0x3a3428)
  const ink = hex(banner?.ink ?? 0x6a604e)
  const b = (bx: number, by: number, w: number, h: number, c: string) => {
    ctx.fillStyle = c
    ctx.fillRect(x + bx * size, y + by * size, w * size, h * size)
  }
  b(0, 0, 1, 22, '#5a4028') // pole
  b(-1, -1, 3, 1, '#7a5a38')
  b(1, 1, 10, 14, cloth)
  // A ragged bottom edge.
  for (let i = 0; i < 10; i += 2) b(1 + i, 15, 1, 1 + (i % 4 === 0 ? 1 : 0), cloth)
  b(1, 1, 10, 1, 'rgba(0,0,0,0.25)')
  switch (banner?.mark) {
    case 'crow':
      b(4, 6, 4, 2, ink)
      b(3, 5, 2, 1, ink)
      b(7, 5, 2, 2, ink)
      b(8, 4, 2, 1, ink)
      b(5, 8, 2, 2, ink)
      break
    case 'antler':
      for (const s of [0, 1]) {
        const ox = s === 0 ? 3 : 7
        b(ox, 4, 1, 7, ink)
        b(ox + (s === 0 ? -1 : 1), 5, 1, 1, ink)
        b(ox + (s === 0 ? -1 : 1), 8, 1, 1, ink)
      }
      b(4, 10, 3, 1, ink)
      break
    case 'lantern':
      b(5, 3, 2, 1, ink)
      b(4, 4, 4, 1, ink)
      b(4, 5, 4, 5, ink)
      b(5, 6, 2, 3, cloth)
      b(4, 10, 4, 1, ink)
      break
    case 'hand':
      b(4, 7, 4, 4, ink)
      for (let f = 0; f < 4; f++)
        b(4 + f, 4 - (f % 3 === 0 ? 0 : 1), 1, 3 + (f % 3 === 0 ? 0 : 1), ink)
      b(8, 8, 1, 2, ink)
      break
    case 'pine':
      b(5, 3, 2, 1, ink)
      b(4, 5, 4, 1, ink)
      b(3, 7, 6, 1, ink)
      b(2, 9, 8, 1, ink)
      b(5, 10, 2, 2, ink)
      break
    default:
      b(4, 6, 4, 4, ink)
  }
}

/** Draws the card into `canvas` (sized 1200×630). */
export function drawShareCard(canvas: HTMLCanvasElement, info: CardInfo): void {
  canvas.width = CARD_W
  canvas.height = CARD_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { notes } = info
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, CARD_W, CARD_H)
  // Blocky noise: dark squares like the forest floor, the same each time.
  let seed = 7
  const rnd = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  for (let i = 0; i < 140; i++) {
    ctx.fillStyle = rnd() < 0.5 ? '#1c1813' : '#120f0c'
    const s = 12 + Math.floor(rnd() * 3) * 12
    ctx.fillRect(Math.floor(rnd() * 100) * 12, Math.floor(rnd() * 53) * 12, s, s)
  }
  // A frame of blocks.
  ctx.fillStyle = '#3a3226'
  for (let x = 0; x < CARD_W; x += 24) {
    ctx.fillRect(x, 0, 18, 12)
    ctx.fillRect(x + 6, CARD_H - 12, 18, 12)
  }
  for (let y = 0; y < CARD_H; y += 24) {
    ctx.fillRect(0, y, 12, 18)
    ctx.fillRect(CARD_W - 12, y + 6, 12, 18)
  }

  pixelText(ctx, 'SURVIVAL JOURNAL', 48, 40, 6, EMBER)
  pixelText(ctx, 'DEADWOOD', 48, 104, 3, DIM)
  pixelText(ctx, info.who.toUpperCase(), 48, 150, 5, INK)
  if (info.player && info.player !== info.who)
    pixelText(ctx, `played by ${info.player}`, 48, 206, 3, DIM)

  // What they've lived through, in big numbers.
  const st = notes.stats
  const stats: [string, string][] = [
    [String(st.dawn ?? 0), 'SUNRISES SEEN'],
    [String(st.kill ?? 0), 'DEAD PUT DOWN'],
    [(Math.round((st.drive_m ?? 0) / 100) / 10).toString(), 'KM DRIVEN'],
    [String(st.rescue ?? 0), 'BROUGHT HOME'],
  ]
  stats.forEach(([n, label], i) => {
    const x = 48 + i * 200
    ctx.fillStyle = '#221d17'
    ctx.fillRect(x, 260, 184, 110)
    ctx.fillStyle = EMBER
    ctx.fillRect(x, 260, 184, 6)
    pixelText(ctx, n, x + 14, 280, 6, INK)
    pixelText(ctx, label, x + 14, 344, 2, DIM)
  })

  // The journal entries earned (newest first).
  const got = [...notes.got].sort((a, b) => b[1] - a[1])
  const titles = got
    .map(([id]) => ACHIEVEMENTS.find((a) => a.id === id)?.title)
    .filter((t): t is string => !!t)
  pixelText(ctx, `JOURNAL  ${got.length}/${ACHIEVEMENTS.length}`, 48, 396, 3, EMBER)
  if (titles.length === 0) pixelText(ctx, 'Nothing written yet.', 48, 440, 3, DIM)
  titles.slice(0, 6).forEach((t, i) => {
    const x = 48 + (i % 2) * 400
    const y = 440 + Math.floor(i / 2) * 44
    ctx.fillStyle = EMBER
    ctx.fillRect(x, y + 10, 12, 12)
    pixelText(ctx, t, x + 24, y, 3, INK)
  })

  // Their banner, and this week's Field Notes.
  const banner = cosmeticById(notes.wear.banner)
  drawBanner(ctx, banner, 940, 70, 16)
  pixelText(ctx, banner?.name.toUpperCase() ?? 'NO BANNER', 900, 440, 2, DIM)
  const { week, year } = isoWeek(info.now)
  const total = weekNotes(notes.week).length
  pixelText(ctx, `FIELD NOTES W${week}`, 900, 476, 2, DIM)
  pixelText(ctx, `${notes.done.length}/${total}`, 900, 500, 5, INK)
  pixelText(ctx, `${notes.owned.length} KEPT  ${year}`, 900, 560, 2, DIM)
}

/** Saves the card as a PNG. */
export function downloadCard(canvas: HTMLCanvasElement, name: string): void {
  const a = document.createElement('a')
  a.href = canvas.toDataURL('image/png')
  a.download = `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'survivor'}-journal.png`
  a.click()
}
