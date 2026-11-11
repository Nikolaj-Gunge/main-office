import { MAX_NAME_LENGTH } from '@office-fps/shared'

const NAME_KEY = 'office-fps:name'

/** Crosshair, debug text and the join / "click to play" screen. Plain DOM over the canvas. */
export class Overlay {
  readonly debug: HTMLDivElement
  private readonly screen: HTMLDivElement
  private readonly nameInput: HTMLInputElement
  private readonly status: HTMLParagraphElement
  private readonly playButton: HTMLButtonElement

  constructor(root: HTMLElement) {
    const crosshair = document.createElement('div')
    crosshair.className = 'crosshair'
    this.debug = document.createElement('div')
    this.debug.className = 'hud-text debug'

    this.screen = document.createElement('div')
    this.screen.className = 'click-to-play'
    this.screen.innerHTML = `
      <h1>OFFICE FPS</h1>
      <form class="join">
        <input name="name" autocomplete="nickname" spellcheck="false"
               maxlength="${MAX_NAME_LENGTH}" placeholder="Your name" />
        <button type="submit">PLAY</button>
      </form>
      <p class="status"></p>
      <p class="hint">WASD move · Space jump · C crouch · Shift sprint · V noclip · F1 settings · F3 debug · Esc release mouse</p>
    `
    const form = this.screen.querySelector('form') as HTMLFormElement
    this.nameInput = form.querySelector('input') as HTMLInputElement
    this.playButton = form.querySelector('button') as HTMLButtonElement
    this.status = this.screen.querySelector('.status') as HTMLParagraphElement
    this.nameInput.value = localStorage.getItem(NAME_KEY) ?? ''

    root.append(crosshair, this.debug, this.screen)
    form.addEventListener('submit', (e) => e.preventDefault())
  }

  /** Called with the chosen name when the player clicks Play (or anywhere on the screen once joined). */
  onPlay(handler: (name: string) => void): void {
    const play = () => {
      const name = this.nameInput.value.trim()
      localStorage.setItem(NAME_KEY, name)
      handler(name)
    }
    this.playButton.addEventListener('click', play)
    this.screen.addEventListener('click', (e) => {
      // Clicking into the name field shouldn't start the game.
      if (e.target !== this.nameInput && e.target !== this.playButton) play()
    })
  }

  /** After joining the name is fixed for the session; the screen just resumes. */
  setJoined(joined: boolean): void {
    this.nameInput.disabled = joined
    this.playButton.textContent = joined ? 'RESUME' : 'PLAY'
  }

  setStatus(text: string): void {
    this.status.textContent = text
  }

  setLocked(locked: boolean): void {
    this.screen.hidden = locked
  }

  setDebugVisible(visible: boolean): void {
    this.debug.hidden = !visible
  }
}
