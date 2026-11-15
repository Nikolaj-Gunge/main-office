import {
  type Bio,
  DAWN_TITLE,
  joinLink,
  type Legacy,
  type Notice,
  type PastLife,
  type SurvivalSelf,
  survivedText,
} from '@office-fps/shared'
import { CARD_H, CARD_W, pixelText } from './share-card.ts'

/**
 * Keepsakes to share: the death postcard (the last frame you saw, with your obituary on it) and
 * the Dawn Report (the night's story, with a paste-anywhere line). Both come up on screen when
 * they happen and stay in the pause menu, where the mouse is free for Save and Copy.
 */

const INK = '#e8dcc0'
const DIM = '#9a8e76'
const EMBER = '#d88a3a'
const BLOOD = '#a8452e'

/** What a postcard says. */
export interface Obituary {
  name: string
  past: string
  /** Seconds alive. */
  alive: number
  kills: number
  cause: string
  /** Bio.body (the build drawn; the card doesn't assume a pronoun from it). */
  body: number
}

/** The postcard's words, top to bottom (kept apart from the drawing so it can be tested). */
export function postcardLines(o: Obituary): {
  headline: string
  name: string
  past: string
  facts: string
} {
  const turned = /turned/i.test(o.cause)
  const kills = o.kills === 1 ? '1 dead put down' : `${o.kills} dead put down`
  return {
    headline: turned ? 'THIS IS HOW THEY TURNED.' : 'THIS IS HOW THEY DIED.',
    name: o.name.toUpperCase(),
    past: o.past ? `${o.past[0]?.toUpperCase()}${o.past.slice(1)}.` : '',
    facts: `Survived ${survivedText(o.alive)} · ${kills} · ${o.cause}`,
  }
}

/** The obituary from the account's newest past life (it arrives just after the death). */
export const obituaryOf = (life: PastLife, body: number): Obituary => ({
  name: life.name,
  past: life.past,
  alive: life.alive,
  kills: life.kills,
  cause: life.cause,
  body,
})

/** Draws the postcard: the frame, darkened at the bottom, the obituary over it in pixel type. */
export function drawPostcard(
  canvas: HTMLCanvasElement,
  frame: CanvasImageSource | null,
  o: Obituary,
): void {
  canvas.width = CARD_W
  canvas.height = CARD_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = '#0d0b09'
  ctx.fillRect(0, 0, CARD_W, CARD_H)
  if (frame) {
    // Cover the card, keeping the frame's shape; hard pixels, no smoothing.
    const fw = (frame as HTMLImageElement).width || CARD_W
    const fh = (frame as HTMLImageElement).height || CARD_H
    const k = Math.max(CARD_W / fw, CARD_H / fh)
    const w = fw * k
    const h = fh * k
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(frame, (CARD_W - w) / 2, (CARD_H - h) / 2, w, h)
  }
  // The bottom in shadow, in bands like the rest of the game's look.
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = `rgba(10,8,6,${0.12 + i * 0.1})`
    ctx.fillRect(0, 330 + i * 18, CARD_W, 18)
  }
  ctx.fillStyle = 'rgba(10,8,6,0.9)'
  ctx.fillRect(0, 474, CARD_W, CARD_H - 474)
  // A frame of blocks.
  ctx.fillStyle = '#2a241b'
  for (let x = 0; x < CARD_W; x += 24) {
    ctx.fillRect(x, 0, 18, 12)
    ctx.fillRect(x + 6, CARD_H - 12, 18, 12)
  }
  for (let y = 0; y < CARD_H; y += 24) {
    ctx.fillRect(0, y, 12, 18)
    ctx.fillRect(CARD_W - 12, y + 6, 12, 18)
  }

  const t = postcardLines(o)
  pixelText(ctx, 'DEADWOOD', 40, 30, 2, EMBER, 12)
  pixelText(ctx, t.headline, 48, 376, 2, BLOOD, 16)
  pixelText(ctx, t.name, 48, 420, 4, INK, 16)
  if (t.past) pixelText(ctx, t.past, 48, 506, 2, DIM, 12)
  pixelText(ctx, t.facts, 48, 552, 2, INK, 12)
}

/** Saves a canvas as a PNG. */
function savePng(canvas: HTMLCanvasElement, name: string): void {
  const a = document.createElement('a')
  a.href = canvas.toDataURL('image/png')
  a.download = `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'survivor'}-postcard.png`
  a.click()
}

/** Copies a canvas as an image (or hands it to the phone's share sheet). */
async function copyPng(canvas: HTMLCanvasElement): Promise<boolean> {
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'))
  if (!blob) return false
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return true
  } catch {
    const file = new File([blob], 'deadwood-postcard.png', { type: 'image/png' })
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] }).catch(() => {})
      return true
    }
    return false
  }
}

const button = (parent: HTMLElement, label: string, click: (b: HTMLButtonElement) => void) => {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = label
  b.addEventListener('click', () => click(b))
  parent.append(b)
  return b
}

/** A button's label for a moment ("COPIED"), then back. */
const flash = (b: HTMLButtonElement, text: string) => {
  const was = b.textContent
  b.textContent = text
  setTimeout(() => {
    b.textContent = was
  }, 1500)
}

/** Seconds a fresh postcard or report stays up on screen. */
const POP_SECONDS = 16

export class Keepsakes {
  /** The pause menu's part (menu.addToPlay). */
  readonly panel: HTMLElement
  private readonly card = document.createElement('canvas')
  private readonly cardBox: HTMLElement
  private readonly dawnBox: HTMLElement
  private readonly dawnText: HTMLElement
  /** On screen when something new comes: the postcard in a corner, or the report's line. */
  private readonly pop: HTMLElement
  private readonly popImg = document.createElement('img')
  private readonly popText: HTMLElement
  private popUntil = 0

  private wasAlive = true
  /** The frame grabbed at the death, as an image once it has loaded. */
  private frame: HTMLImageElement | null = null
  private obituary: Obituary | null = null
  /** The character as last seen alive, and the one before a new one appeared (guests). */
  private lastSelf: { bio: Bio; kills: number; age: number } | null = null
  private prevSelf: typeof this.lastSelf = null
  private bioChangedAt = 0
  private diedAt = 0
  private newestLife = 0
  private legacy: Legacy | undefined
  private share = ''

  constructor(
    hudRoot: HTMLElement,
    private readonly world: () => string | null,
  ) {
    this.panel = document.createElement('section')
    this.panel.className = 'keepsakes-panel'
    this.panel.hidden = true
    const h = document.createElement('h3')
    h.textContent = 'KEEPSAKES'
    this.cardBox = document.createElement('div')
    this.cardBox.className = 'keepsake-card'
    this.cardBox.hidden = true
    this.card.className = 'keepsake-canvas'
    const cardRow = document.createElement('div')
    cardRow.className = 'keepsake-buttons'
    button(cardRow, 'SAVE PNG', () => savePng(this.card, this.obituary?.name ?? 'survivor'))
    button(
      cardRow,
      'COPY',
      (b) => void copyPng(this.card).then((ok) => flash(b, ok ? 'COPIED' : 'NO CLIPBOARD')),
    )
    this.cardBox.append(this.card, cardRow)

    this.dawnBox = document.createElement('div')
    this.dawnBox.className = 'keepsake-dawn'
    this.dawnBox.hidden = true
    this.dawnText = document.createElement('pre')
    const dawnRow = document.createElement('div')
    dawnRow.className = 'keepsake-buttons'
    button(
      dawnRow,
      'COPY',
      (b) => void this.copyDawn().then((ok) => flash(b, ok ? 'COPIED' : 'NO CLIPBOARD')),
    )
    this.dawnBox.append(this.dawnText, dawnRow)
    this.panel.append(h, this.cardBox, this.dawnBox)

    this.pop = document.createElement('div')
    this.pop.className = 'keepsake-pop'
    this.pop.hidden = true
    this.popText = document.createElement('div')
    this.popText.className = 'keepsake-pop-text'
    this.pop.append(this.popImg, this.popText)
    hudRoot.append(this.pop)
  }

  /**
   * Once a frame, right after the frame is drawn (the canvas still holds it): a death grabs it
   * for the postcard. `self` is the survival character as the client knows it.
   */
  afterRender(
    canvas: HTMLCanvasElement,
    alive: boolean,
    self: SurvivalSelf | null,
    now: number,
  ): void {
    if (self?.bio) {
      const snap = { bio: self.bio, kills: self.life?.kills ?? 0, age: self.age ?? 0 }
      if (this.lastSelf && this.lastSelf.bio.seed !== self.bio.seed) {
        this.prevSelf = this.lastSelf
        this.bioChangedAt = now
      }
      if (alive || this.lastSelf?.bio.seed !== self.bio.seed) this.lastSelf = snap
    }
    if (alive === this.wasAlive) {
      if (this.pop.hidden === false && now > this.popUntil) this.pop.hidden = true
      return
    }
    this.wasAlive = alive
    if (alive || !self) return
    this.diedAt = now
    let url = ''
    try {
      url = canvas.toDataURL('image/jpeg', 0.92)
    } catch {
      // A tainted or lost canvas: the postcard goes without a picture.
    }
    // The character who died: if a new one already arrived, the one before it.
    const was = now - this.bioChangedAt < 3000 && this.prevSelf ? this.prevSelf : this.lastSelf
    this.obituary = was
      ? {
          name: was.bio.name,
          past: was.bio.past,
          alive: was.age,
          kills: was.kills,
          cause: 'Died',
          body: was.bio.body,
        }
      : null
    const img = new Image()
    img.onload = () => {
      this.frame = img
      this.redraw(true)
    }
    if (url.startsWith('data:image')) img.src = url
    else this.redraw(true)
  }

  /** The account's legacy came: its newest life is the one that just died (the true cause). */
  setLegacy(legacy: Legacy | undefined): void {
    if (legacy === this.legacy) return
    this.legacy = legacy
    const life = legacy?.lives[0]
    if (!life || life.at <= this.newestLife) return
    const fresh = this.newestLife > 0 || Date.now() - life.at < 15_000
    this.newestLife = life.at
    if (!fresh || performance.now() - this.diedAt > 15_000) return
    this.obituary = obituaryOf(life, this.obituary?.body ?? 0)
    this.redraw(false)
  }

  /** Survival notices: the Dawn Report is kept here too. Returns nothing; the HUD shows it. */
  onNotice(n: Notice): void {
    // Without an account there is no legacy to say how: the story card says if they turned.
    if (n.kind === 'story' && this.obituary && n.text.startsWith(`${this.obituary.name} turned.`)) {
      this.obituary.cause = 'Turned'
      this.redraw(false)
    }
    if (n.kind !== 'note' || n.title !== DAWN_TITLE) return
    const world = this.world()
    const link = world ? joinLink(location.origin, { world }) : location.origin
    this.share = `${n.share ?? n.text.split('\n')[0]}\n${link}`
    this.dawnText.textContent = `${n.text}\n\n${this.share}`
    this.dawnBox.hidden = false
    this.panel.hidden = false
  }

  private async copyDawn(): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(this.share)
      return true
    } catch {
      return false
    }
  }

  private redraw(popUp: boolean): void {
    if (!this.obituary) return
    drawPostcard(this.card, this.frame, this.obituary)
    this.cardBox.hidden = false
    this.panel.hidden = false
    this.popImg.src = this.card.toDataURL('image/jpeg', 0.85)
    if (popUp) {
      this.popText.textContent = 'Esc: save or copy your postcard'
      this.pop.hidden = false
      this.popUntil = performance.now() + POP_SECONDS * 1000
    }
  }
}
