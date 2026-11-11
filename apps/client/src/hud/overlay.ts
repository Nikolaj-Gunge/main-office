/** Always-on-top HUD bits that aren't about combat: debug text, toasts, connection banner. */
export class Overlay {
  readonly debug: HTMLDivElement
  private readonly toast: HTMLDivElement
  private readonly banner: HTMLDivElement
  private readonly bannerText: HTMLSpanElement
  private readonly bannerButton: HTMLButtonElement

  constructor(root: HTMLElement) {
    this.debug = document.createElement('div')
    this.debug.className = 'hud-text debug'
    this.toast = document.createElement('div')
    this.toast.className = 'hud-toast'
    this.banner = document.createElement('div')
    this.banner.className = 'hud-banner'
    this.bannerText = document.createElement('span')
    this.bannerButton = document.createElement('button')
    this.bannerButton.textContent = 'Reload'
    this.bannerButton.addEventListener('click', () => location.reload())
    this.banner.append(this.bannerText, this.bannerButton)
    this.banner.hidden = true
    root.append(this.debug, this.toast, this.banner)
  }

  /** Short message in the middle of the screen (e.g. "Sound off"). */
  flash(text: string): void {
    this.toast.textContent = text
    this.toast.classList.remove('show')
    void this.toast.offsetWidth // restart the fade
    this.toast.classList.add('show')
  }

  /** Persistent strip at the top (connection problems). `reload` adds a Reload button. */
  setBanner(text: string | null, reload = false): void {
    this.banner.hidden = text === null
    this.bannerText.textContent = text ?? ''
    this.bannerButton.hidden = !reload
  }

  setDebugVisible(visible: boolean): void {
    this.debug.hidden = !visible
  }
}
