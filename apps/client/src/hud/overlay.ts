import { isPrimary, MAX_NAME_LENGTH, type PrimaryWeapon, WeaponId } from '@office-fps/shared'

const NAME_KEY = 'office-fps:name'
const PRIMARY_KEY = 'office-fps:primary'

/** Crosshair, debug text and the join / "click to play" screen. Plain DOM over the canvas. */
export class Overlay {
  readonly debug: HTMLDivElement
  private readonly screen: HTMLDivElement
  private readonly nameInput: HTMLInputElement
  private readonly status: HTMLParagraphElement
  private readonly playButton: HTMLButtonElement
  private readonly loadoutButtons: HTMLButtonElement[]
  /** Chosen primary weapon (remembered between visits). */
  primary: PrimaryWeapon
  constructor(root: HTMLElement) {
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
      <div class="loadout">
        <button type="button" data-weapon="${WeaponId.Rifle}">RIFLE</button>
        <button type="button" data-weapon="${WeaponId.Sniper}">SNIPER</button>
        <span class="loadout-note">+ handgun</span>
      </div>
      <p class="status"></p>
      <p class="hint">WASD move · Space jump · C crouch · Shift sprint / hold breath · LMB shoot · RMB aim · R reload<br>1 / 2 / Q / wheel switch weapon · V noclip · F1 settings · F3 net debug · F4 hitboxes · Esc release mouse</p>
    `
    const form = this.screen.querySelector('form') as HTMLFormElement
    this.nameInput = form.querySelector('input') as HTMLInputElement
    this.playButton = form.querySelector('button') as HTMLButtonElement
    this.status = this.screen.querySelector('.status') as HTMLParagraphElement
    this.nameInput.value = localStorage.getItem(NAME_KEY) ?? ''
    const saved = Number(localStorage.getItem(PRIMARY_KEY))
    this.primary = isPrimary(saved) ? saved : WeaponId.Rifle
    this.loadoutButtons = [...this.screen.querySelectorAll<HTMLButtonElement>('.loadout button')]
    for (const button of this.loadoutButtons) {
      button.addEventListener('click', (e) => {
        e.stopPropagation() // choosing a weapon shouldn't start the game
        this.setPrimary(Number(button.dataset.weapon))
      })
    }
    this.setPrimary(this.primary)

    root.append(this.debug, this.screen)
    form.addEventListener('submit', (e) => e.preventDefault())
  }

  setPrimary(id: number): void {
    if (!isPrimary(id)) return
    this.primary = id
    localStorage.setItem(PRIMARY_KEY, String(id))
    for (const b of this.loadoutButtons)
      b.classList.toggle('chosen', Number(b.dataset.weapon) === id)
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
