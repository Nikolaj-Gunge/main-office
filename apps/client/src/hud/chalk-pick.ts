import { CHALK_PLACES, CHALK_SYMBOLS, CHALK_WORDS, type SurvivalAction } from '@office-fps/shared'
import { drawChalkSymbol } from '../render/chalk-marks.ts'

/**
 * L: the chalk picker (chalk.ts). A symbol, then if you like a word and where: the server chalks
 * it on whatever you were looking at. Enter chalks it, Esc (or L) puts the chalk away.
 */
export class ChalkPick {
  private readonly el: HTMLDivElement
  private sym = 0
  private word = -1
  private place = -1
  private readonly rows: HTMLButtonElement[][] = []
  /** The picker opened or closed (it needs the mouse). */
  onModalChange?: (open: boolean) => void

  constructor(
    root: HTMLElement,
    private readonly send: (action: SurvivalAction) => void,
  ) {
    this.el = document.createElement('div')
    this.el.className = 'chalk-pick'
    this.el.hidden = true
    const title = document.createElement('div')
    title.className = 'chalk-title'
    title.textContent = 'Chalk a mark where you look'
    this.el.append(title)
    this.row(
      CHALK_SYMBOLS.map((name, i) => {
        const c = document.createElement('canvas')
        c.width = 24
        c.height = 24
        const g = c.getContext('2d')
        if (g) {
          g.fillStyle = '#e8e4da'
          drawChalkSymbol(g, i, 0, 0)
        }
        c.title = name
        return c
      }),
      (i) => {
        this.sym = i
      },
      false,
    )
    this.row(
      CHALK_WORDS.map((w) => w),
      (i) => {
        this.word = i
      },
      true,
    )
    this.row(
      CHALK_PLACES.map((w) => w),
      (i) => {
        this.place = i
      },
      true,
    )
    const go = document.createElement('div')
    go.className = 'chalk-go'
    const ok = document.createElement('button')
    ok.textContent = 'Chalk it (Enter)'
    ok.addEventListener('click', () => this.chalk())
    const no = document.createElement('button')
    no.textContent = 'Put it away (Esc)'
    no.addEventListener('click', () => this.close())
    go.append(ok, no)
    this.el.append(go)
    root.append(this.el)
    this.refresh()
  }

  get open(): boolean {
    return !this.el.hidden
  }

  toggle(): void {
    if (this.open) this.close()
    else {
      this.el.hidden = false
      this.onModalChange?.(true)
    }
  }

  close(): void {
    if (!this.open) return
    this.el.hidden = true
    this.onModalChange?.(false)
  }

  /** A key while it is open: true if it was the picker's. */
  key(code: string): boolean {
    if (!this.open) return false
    if (code === 'Escape' || code === 'KeyL') this.close()
    else if (code === 'Enter' || code === 'NumpadEnter') this.chalk()
    return true
  }

  private chalk(): void {
    this.send({ a: 'chalk', sym: this.sym, word: this.word, place: this.place })
    this.close()
  }

  /** A row of choices; `optional` rows can be clicked off again (no word). */
  private row(
    items: (string | HTMLCanvasElement)[],
    pick: (i: number) => void,
    optional: boolean,
  ): void {
    const row = document.createElement('div')
    row.className = 'chalk-row'
    const buttons = items.map((item, i) => {
      const b = document.createElement('button')
      b.append(item)
      b.addEventListener('click', () => {
        const on = b.classList.contains('on')
        pick(optional && on ? -1 : i)
        this.refresh()
      })
      return b
    })
    row.append(...buttons)
    this.rows.push(buttons)
    this.el.append(row)
  }

  private refresh(): void {
    const picked = [this.sym, this.word, this.place]
    this.rows.forEach((buttons, r) => {
      buttons.forEach((b, i) => {
        b.classList.toggle('on', picked[r] === i)
      })
    })
  }
}
