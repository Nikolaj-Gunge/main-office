/** Presses of E that wrench you free (the server's grabs.ts MASH_PRESSES). */
const MASH_PRESSES = 9

/**
 * Grabbed! (the server's grabs.ts): while a walker has hold of you, a struggle prompt with how
 * far your mashing has got, and the screen's edges go red. The server counts the presses that
 * matter; the bar here only counts yours, for the feel of it.
 */
export class GrabbedView {
  private readonly box: HTMLDivElement
  private readonly fill: HTMLDivElement
  private by: number | null = null
  private presses = 0

  /** `isUse`: whether a key is bound to Use; `useKey`: its label (E unless rebound). */
  constructor(
    parent: HTMLElement,
    private readonly isUse: (code: string) => boolean = (code) => code === 'KeyE',
    private readonly useKey: () => string = () => 'E',
  ) {
    this.box = document.createElement('div')
    this.box.className = 'grabbed-prompt'
    this.box.hidden = true
    this.box.innerHTML =
      '<div class="grabbed-title">GRABBED! Mash <b class="grabbed-key">E</b></div>' +
      '<div class="grabbed-bar"><div class="grabbed-fill"></div></div>' +
      '<div class="grabbed-hint">or a friend pulls you free</div>'
    this.fill = this.box.querySelector('.grabbed-fill') as HTMLDivElement
    parent.append(this.box)
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (this.by === null || e.repeat || !this.isUse(e.code)) return
      this.presses++
      this.fill.style.width = `${Math.min(100, (this.presses / MASH_PRESSES) * 100)}%`
    })
  }

  /** Once a frame. Returns true on the frame a grab starts (for a jolt of the camera). */
  update(by: number | undefined, alive: boolean): boolean {
    const next = alive && by !== undefined ? by : null
    if (next === this.by) return false
    const started = next !== null && this.by === null
    this.by = next
    this.presses = 0
    this.fill.style.width = '0%'
    this.box.hidden = next === null
    const key = this.box.querySelector('.grabbed-key')
    if (started && key) key.textContent = this.useKey()
    document.body.classList.toggle('grabbed', next !== null)
    return started
  }
}
