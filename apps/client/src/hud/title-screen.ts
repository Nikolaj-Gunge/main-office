import type { WorldsReply } from '@office-fps/shared'
import { pixelText } from './share-card.ts'

/** The share card's colours (share-card.ts): ember on the night, a dark red drop shadow. */
const EMBER = '#d88a3a'
const SHADOW = '#5a1c14'
/** CSS pixels per logo pixel. */
const LOGO_SCALE = 7

/**
 * The title screen (survival): until PLAY, the menu steps aside to the left over a live shot of
 * the woods (render/title-cam.ts), with DEADWOOD in the share card's pixel letters and how many
 * survivors are out tonight. Joining puts the menu back as the pause menu it always was.
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

/** DEADWOOD in hard-edged pixel letters, the way the share card writes it. */
function drawLogo(canvas: HTMLCanvasElement): void {
  // Drawn one font pixel to a canvas pixel, then scaled up by a whole number in CSS (pixelated),
  // so every block stays square.
  const px = 1
  const scratch = document.createElement('canvas').getContext('2d')
  if (!scratch) return
  scratch.font = 'bold 8px monospace'
  canvas.width = Math.ceil(scratch.measureText('DEADWOOD').width) + px
  canvas.height = 10 + px
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  pixelText(ctx, 'DEADWOOD', px, px, px, SHADOW)
  pixelText(ctx, 'DEADWOOD', 0, 0, px, EMBER)
  canvas.style.width = `${canvas.width * LOGO_SCALE}px`
  canvas.style.height = `${canvas.height * LOGO_SCALE}px`
}
