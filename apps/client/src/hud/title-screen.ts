import type { WorldsReply } from '@office-fps/shared'

/** The share card's colours (share-card.ts): ember on the night, a dark red drop shadow. */
const EMBER = '#d88a3a'
/** The letters' lower rows, a shade darker: a little weight at the bottom. */
const EMBER_LOW = '#b0642a'
const SHADOW = '#5a1c14'

/** DEADWOOD's letters, 5×7 blocks each ('#' is ink), drawn by hand so every block is square. */
const GLYPHS: Record<string, string[]> = {
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
}

/**
 * The title screen (survival): until PLAY, the menu stands on the left over a live shot of the
 * woods (render/title-cam.ts), with DEADWOOD in big pixel letters and how many survivors are out
 * tonight. Joining puts the menu back as the pause menu it always was.
 */
export class TitleScreen {
  private readonly count = document.createElement('p')
  private on = false

  constructor(
    private readonly menu: HTMLElement,
    heading: HTMLElement,
  ) {
    const logo = document.createElement('canvas')
    logo.className = 'title-logo'
    logo.setAttribute('role', 'img')
    logo.setAttribute('aria-label', 'Deadwood')
    drawLogo(logo)
    heading.replaceChildren(logo)
    heading.classList.add('title-heading')
    this.count.className = 'title-count'
    heading.after(this.count)
  }

  /** Shown while nobody has joined (the live shot is behind it). */
  set(on: boolean): void {
    if (on === this.on) return
    this.on = on
    this.menu.classList.toggle('menu-title', on)
  }

  /** The head count from /worlds (world-picker.ts), across every public world. */
  setWorlds(reply: WorldsReply): void {
    const total = reply.worlds.reduce((n, w) => n + w.players, 0)
    const busy = reply.worlds.filter((w) => w.players > 0).length
    this.count.textContent =
      total === 0
        ? 'Nobody out tonight. Be the first.'
        : `${total} ${total === 1 ? 'survivor' : 'survivors'} out tonight` +
          (busy > 1 ? ` in ${busy} worlds` : '')
  }
}

/** CSS pixels per logo block for this window: whole numbers only, so blocks stay square. */
function logoScale(): number {
  const w = window.innerWidth
  return w >= 1700 ? 10 : w >= 1200 ? 8 : w >= 700 ? 6 : 5
}

/** DEADWOOD in hard-edged pixel letters with a one-block drop shadow. */
function drawLogo(canvas: HTMLCanvasElement): void {
  const word = 'DEADWOOD'
  canvas.width = word.length * 6 // 5 wide + a gap; the last gap holds the shadow
  canvas.height = 8
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  for (const [pass, dx] of [
    ['shadow', 1],
    ['ink', 0],
  ] as const) {
    for (const [i, letter] of [...word].entries()) {
      for (const [row, line] of (GLYPHS[letter] ?? []).entries()) {
        ctx.fillStyle = pass === 'shadow' ? SHADOW : row >= 5 ? EMBER_LOW : EMBER
        for (const [col, c] of [...line].entries()) {
          if (c === '#') ctx.fillRect(i * 6 + col + dx, row + dx, 1, 1)
        }
      }
    }
  }
  const size = () => {
    const scale = logoScale()
    canvas.style.width = `${canvas.width * scale}px`
    canvas.style.height = `${canvas.height * scale}px`
  }
  size()
  window.addEventListener('resize', size)
}
