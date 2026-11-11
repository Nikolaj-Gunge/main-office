/** Crosshair, debug text and the "click to play" screen. Plain DOM over the canvas. */
export class Overlay {
  readonly debug: HTMLDivElement
  private readonly clickToPlay: HTMLDivElement

  constructor(root: HTMLElement) {
    const crosshair = document.createElement('div')
    crosshair.className = 'crosshair'
    this.debug = document.createElement('div')
    this.debug.className = 'hud-text debug'
    this.clickToPlay = document.createElement('div')
    this.clickToPlay.className = 'click-to-play'
    this.clickToPlay.innerHTML = `
      <h1>OFFICE FPS</h1>
      <p>Click to play</p>
      <p class="hint">WASD move · Space jump · C crouch · Shift sprint · V noclip · F1 settings · F3 debug · Esc release mouse</p>
    `
    root.append(crosshair, this.debug, this.clickToPlay)
  }

  onClickToPlay(handler: () => void): void {
    this.clickToPlay.addEventListener('click', handler)
  }

  setLocked(locked: boolean): void {
    this.clickToPlay.hidden = locked
  }

  setDebugVisible(visible: boolean): void {
    this.debug.hidden = !visible
  }
}
