import { MAX_NAME_LENGTH, type ModeId } from '@office-fps/shared'
import { ACTIONS, type ActionId, keyLabel, rebind, withDefaults } from '../input/bindings.ts'
import type { Settings } from '../settings.ts'

const NAME_KEY = 'office-fps:name'

/** Pixel-size presets: lower = chunkier pixels. */
const PIXEL_PRESETS: [string, number][] = [
  ['Chunky', 180],
  ['Classic', 270],
  ['Sharp', 360],
  ['Fine', 540],
  ['Crisp', 720],
  ['Smooth', 900],
  ['Finest', 1080],
]

type Tab = 'play' | 'settings' | 'controls'

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v
    else node.setAttribute(k, v)
  }
  node.append(...children)
  return node
}

/**
 * The game's front door and pause menu (Esc). One screen with three tabs:
 *   PLAY — name, Play/Resume and how to play
 *   SETTINGS — mouse, view, pixel size, sound (applied and saved instantly)
 *   CONTROLS — every action, click to rebind
 * The game keeps running behind it — it's multiplayer, there is no real pause.
 */
const MODE_TIPS: Record<ModeId, string> = {
  ffa: 'Free for all: everyone against everyone.',
  tdm: 'Team deathmatch: Marketing against IT. No friendly fire.',
  lms: 'Last man standing: no respawns until the next round.',
  gungame: 'Gun game: every 2 kills gives you the next gun. A knife kill at the end wins.',
  infection: 'Infection: the infected run faster with knives. Whoever they kill joins them.',
  zombies:
    'Zombies (co-op): fight through the building together. Follow the green marker. If everyone goes down, you retry the stage.',
  survival:
    'Survival: Deadwood at night. Scavenge, eat, drink, stay quiet. E takes and talks, Tab opens your backpack, F is your torch, M the map. Follow the story to get out alive.',
}

export class Menu {
  private readonly modeTip: HTMLLIElement
  /** The tips for the arena modes, and the ones that replace them in survival. */
  private readonly arenaTips: HTMLLIElement[]
  private readonly survivalTips: HTMLLIElement[]
  private readonly root: HTMLDivElement
  private readonly nameInput: HTMLInputElement
  private readonly playButton: HTMLButtonElement
  private readonly status: HTMLParagraphElement
  private readonly tabs = new Map<Tab, { button: HTMLButtonElement; panel: HTMLElement }>()
  private readonly controlsList: HTMLDivElement
  private readonly settings: Settings
  private readonly onSettingsChange: () => void
  private onPlayHandler: ((name: string) => void) | null = null
  /** Action waiting for a key press (rebinding), if any. */
  private capturing: ActionId | null = null
  /** Re-highlighters for choice rows (pixel size), run by refresh(). */
  private readonly choiceRenderers: (() => void)[] = []
  private joined = false

  constructor(parent: HTMLElement, settings: Settings, onSettingsChange: () => void) {
    this.settings = settings
    this.onSettingsChange = onSettingsChange

    // --- Play tab ---
    this.nameInput = h('input', {
      autocomplete: 'nickname',
      spellcheck: 'false',
      maxlength: String(MAX_NAME_LENGTH),
      placeholder: 'Your name',
    })
    this.nameInput.value = localStorage.getItem(NAME_KEY) ?? ''
    this.playButton = h('button', { class: 'menu-play', type: 'submit' }, 'PLAY')
    const form = h('form', { class: 'menu-join' }, this.nameInput, this.playButton)
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      this.play()
    })

    this.status = h('p', { class: 'menu-status' })
    this.modeTip = h('li', {}, MODE_TIPS.ffa)
    this.arenaTips = [
      h(
        'li',
        {},
        'You spawn with a handgun. Rifles and snipers lie around the office — walk over one to grab it, E to swap.',
      ),
      h('li', {}, 'Headshots kill instantly with every weapon.'),
      h('li', {}, 'Hold Tab for scores · Esc for this menu · M mutes'),
    ]
    this.survivalTips = [
      h(
        'li',
        {},
        'You start with a Glock, 12 rounds and a knife. Ammo is scarce: find it, buy it, or run.',
      ),
      h('li', {}, 'The dead are few and hard to kill. Noise and light draw them. Crouch to sneak.'),
      h('li', {}, 'Haven, the survivor camp, is safe: sleep, trade, take jobs · N mutes'),
    ]
    for (const tip of this.survivalTips) tip.hidden = true
    const play = h(
      'section',
      { class: 'menu-panel' },
      form,
      this.status,
      h('ul', { class: 'menu-tips' }, this.modeTip, ...this.arenaTips, ...this.survivalTips),
    )

    // --- Settings tab ---
    const settingsPanel = h('section', { class: 'menu-panel menu-settings' })
    settingsPanel.append(
      this.slider('Mouse sensitivity', 'sensitivity', 0.2, 8, 0.05, (v) => v.toFixed(2)),
      this.slider('Field of view', 'fov', 70, 110, 1, (v) => `${v}°`),
      this.choice(
        'Pixel size',
        PIXEL_PRESETS.map(([label, value]) => [label, value]),
        () => this.settings.pixelHeight,
        (v) => {
          this.settings.pixelHeight = v
        },
      ),
      this.toggle('Automatic quality (coarser pixels when slow)', 'autoQuality'),
      this.toggle('Smooth pixels (soft edges, filtered textures)', 'smoothPixels'),
      this.slider('Master volume', 'masterVolume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`),
      this.slider('Effects volume', 'sfxVolume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`),
      this.toggle('Show FPS & network info', 'showDebug'),
    )

    // --- Controls tab ---
    this.controlsList = h('div', { class: 'menu-controls' })
    const resetControls = h('button', { type: 'button', class: 'menu-small' }, 'Reset to defaults')
    resetControls.addEventListener('click', () => {
      this.settings.keybinds = withDefaults(undefined)
      this.renderControls()
      this.onSettingsChange()
    })
    const controls = h(
      'section',
      { class: 'menu-panel' },
      this.toggle('Toggle aim (click to scope in / out — good for trackpads)', 'aimToggle'),
      h(
        'p',
        { class: 'menu-label' },
        'Click a key to change it, then press the new key or mouse button. Esc cancels.',
      ),
      this.controlsList,
      resetControls,
    )
    this.renderControls()

    // --- Frame ---
    const tabBar = h('nav', { class: 'menu-tabs' })
    for (const [id, label, panel] of [
      ['play', 'PLAY', play],
      ['settings', 'SETTINGS', settingsPanel],
      ['controls', 'CONTROLS', controls],
    ] as const) {
      const button = h('button', { type: 'button' }, label)
      button.addEventListener('click', () => this.showTab(id))
      tabBar.append(button)
      this.tabs.set(id, { button, panel })
    }
    this.root = h(
      'div',
      { class: 'menu' },
      h(
        'div',
        { class: 'menu-card' },
        h('h1', {}, 'OFFICE FPS'),
        tabBar,
        play,
        settingsPanel,
        controls,
      ),
    )
    parent.append(this.root)
    this.showTab('play')

    // Rebinding listens on the whole window while waiting for a key.
    window.addEventListener('keydown', (e) => this.captureKey(e, e.code), true)
    window.addEventListener('mousedown', (e) => this.captureKey(e, `Mouse${e.button}`), true)
    window.addEventListener('wheel', (e) => this.captureKey(e, 'Wheel'), {
      capture: true,
      passive: false,
    })
  }

  /** The name typed in the join form. */
  get name(): string {
    return this.nameInput.value
  }

  onPlay(handler: (name: string) => void): void {
    this.onPlayHandler = handler
  }

  get visible(): boolean {
    return !this.root.hidden
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible
    if (!visible) this.capturing = null
  }

  /** After joining the name is fixed for the session; the button resumes instead. */
  setJoined(joined: boolean): void {
    this.joined = joined
    this.nameInput.disabled = joined
    this.playButton.textContent = joined ? 'RESUME' : 'PLAY'
  }

  /** The first tip explains the game mode the server runs. */
  setMode(mode: ModeId): void {
    this.modeTip.textContent = MODE_TIPS[mode]
    for (const tip of this.arenaTips) tip.hidden = mode === 'survival'
    for (const tip of this.survivalTips) tip.hidden = mode !== 'survival'
  }

  setStatus(text: string): void {
    this.status.textContent = text
  }

  /** Re-renders values (e.g. after F1 or a hotkey changed a setting). */
  refresh(): void {
    for (const input of this.root.querySelectorAll<HTMLInputElement>('input[data-setting]')) {
      const key = input.dataset.setting as keyof Settings
      if (input.type === 'checkbox') input.checked = Boolean(this.settings[key])
      else input.value = String(this.settings[key])
      input.dispatchEvent(new Event('sync'))
    }
    for (const render of this.choiceRenderers) render()
    this.renderControls()
  }

  private play(): void {
    const name = this.nameInput.value.trim()
    localStorage.setItem(NAME_KEY, name)
    this.onPlayHandler?.(name)
  }

  private showTab(tab: Tab): void {
    for (const [id, { button, panel }] of this.tabs) {
      button.classList.toggle('active', id === tab)
      panel.hidden = id !== tab
    }
    this.capturing = null
    this.renderControls()
  }

  private slider(
    label: string,
    key: 'sensitivity' | 'fov' | 'masterVolume' | 'sfxVolume',
    min: number,
    max: number,
    step: number,
    format: (v: number) => string,
  ): HTMLElement {
    const value = h('span', { class: 'menu-value' })
    const input = h('input', {
      type: 'range',
      min: String(min),
      max: String(max),
      step: String(step),
      'data-setting': key,
    })
    input.value = String(this.settings[key])
    const sync = () => {
      value.textContent = format(Number(input.value))
    }
    input.addEventListener('input', () => {
      this.settings[key] = Number(input.value)
      sync()
      this.onSettingsChange()
    })
    input.addEventListener('sync', sync)
    sync()
    return h('label', { class: 'menu-row' }, h('span', {}, label), input, value)
  }

  private choice(
    label: string,
    options: [string, number][],
    get: () => number,
    set: (v: number) => void,
  ): HTMLElement {
    const group = h('div', { class: 'menu-choice' })
    const render = () => {
      for (const b of group.querySelectorAll('button')) {
        b.classList.toggle('chosen', Number(b.dataset.value) === get())
      }
    }
    for (const [text, value] of options) {
      const b = h('button', { type: 'button' }, text)
      b.dataset.value = String(value)
      b.addEventListener('click', () => {
        set(value)
        render()
        this.onSettingsChange()
      })
      group.append(b)
    }
    render()
    this.choiceRenderers.push(render)
    return h('div', { class: 'menu-row' }, h('span', {}, label), group)
  }

  private toggle(
    label: string,
    key: 'showDebug' | 'aimToggle' | 'autoQuality' | 'smoothPixels',
  ): HTMLElement {
    const input = h('input', { type: 'checkbox', 'data-setting': key })
    input.checked = this.settings[key]
    input.addEventListener('change', () => {
      this.settings[key] = input.checked
      this.onSettingsChange()
    })
    return h('label', { class: 'menu-row menu-toggle' }, h('span', {}, label), input)
  }

  private renderControls(): void {
    this.controlsList.innerHTML = ''
    for (const action of ACTIONS) {
      const codes = this.settings.keybinds[action.id]
      const waiting = this.capturing === action.id
      const button = h(
        'button',
        { type: 'button', class: waiting ? 'menu-key waiting' : 'menu-key' },
        waiting ? 'press a key…' : codes.length ? codes.map(keyLabel).join(' / ') : '—',
      )
      button.addEventListener('click', (e) => {
        e.stopPropagation()
        this.capturing = action.id
        this.renderControls()
      })
      this.controlsList.append(h('div', { class: 'menu-row' }, h('span', {}, action.label), button))
    }
  }

  /** While rebinding, the next key/mouse button/wheel becomes the action's main binding. */
  private captureKey(e: Event, code: string): void {
    const action = this.capturing
    if (!action || !this.visible) return
    // The click that started the capture shouldn't immediately bind Mouse0.
    if (e.type === 'mousedown' && (e.target as HTMLElement).classList.contains('waiting')) return
    e.preventDefault()
    e.stopPropagation()
    this.capturing = null
    if (code !== 'Escape') {
      rebind(this.settings.keybinds, action, code)
      this.onSettingsChange()
    }
    this.renderControls()
  }

  /** Lets the game know the menu is swallowing input (rebinding). */
  get isCapturing(): boolean {
    return this.capturing !== null
  }

  get isJoined(): boolean {
    return this.joined
  }
}
