import {
  type Appearance,
  BEARDS,
  EYE_COLORS,
  HAIR_COLORS,
  HAIR_STYLES,
  type RemotePlayerState,
  randomAppearance,
  remotePose,
  SKIN_TONES,
  WeaponId,
} from '@office-fps/shared'
import * as THREE from 'three'
import { Avatar } from '../render/avatar.ts'

/**
 * The character creator (menu → CHARACTER): build, skin, hair and its colour, eyes and beard,
 * with a slowly turning, lit 3D preview of the body. Purely visual — hitboxes stay the same.
 * In survival everyone starts in a tank top and joggers, barefoot; clothes are found out there.
 */

const EYE_NAMES = ['Dark brown', 'Brown', 'Green', 'Blue', 'Grey', 'Hazel']
const SKIN_NAMES = ['Porcelain', 'Fair', 'Light', 'Medium', 'Tan', 'Brown', 'Dark', 'Deep']
const HAIR_COLOR_NAMES = [
  'Black',
  'Dark brown',
  'Brown',
  'Auburn',
  'Blonde',
  'Platinum',
  'Grey',
  'White',
  'Red dye',
  'Blue dye',
]

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  node.append(...children)
  return node
}

/** The standing body the preview shows (empty hands, the starting outfit). */
const PREVIEW_STATE: RemotePlayerState = {
  id: 1,
  x: 0,
  y: 0,
  z: 0,
  yaw: 0,
  pitch: -0.05,
  crouch: 0,
  grounded: true,
  alive: true,
  protected: false,
  weapon: WeaponId.Claws,
  aiming: false,
  stride: 0,
  speed: 0,
  moveDir: 0,
  vy: 0,
  land: 0,
  ads: 0,
  shotAge: 1,
  prone: 0,
  slide: 0,
  mantle: 0,
  ledge: 0,
}

/** A small, separate WebGL view of one Avatar turning on the spot under studio lights. */
class Preview {
  readonly canvas = el('canvas', 'creator-canvas')
  private renderer: THREE.WebGLRenderer | null = null
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(26, 3 / 4, 0.1, 20)
  private avatar: Avatar | null = null
  private frame = 0
  private yaw = Math.PI * 0.85
  private last = 0
  /** Dragging turns the body by hand; it starts turning by itself again after a moment. */
  private dragX: number | null = null
  private idleUntil = 0

  constructor() {
    this.camera.position.set(0, 1.12, 4.6)
    this.camera.lookAt(0, 0.92, 0)
    this.scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x2a2018, 1.4))
    const key = new THREE.DirectionalLight(0xfff1dc, 2.6)
    key.position.set(2.5, 3.5, 3)
    const rim = new THREE.DirectionalLight(0xff8a5c, 1.6)
    rim.position.set(-3, 2, -2.5)
    const fill = new THREE.DirectionalLight(0x8fb2ff, 0.7)
    fill.position.set(-3, 1, 3)
    this.scene.add(key, rim, fill)
    // A soft round shadow to stand on.
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 40),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = 0.002
    this.scene.add(floor)

    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragX = e.clientX
      this.canvas.setPointerCapture(e.pointerId)
    })
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.dragX === null) return
      this.yaw += (e.clientX - this.dragX) * 0.015
      this.dragX = e.clientX
      this.idleUntil = performance.now() + 2500
    })
    const release = () => {
      this.dragX = null
    }
    this.canvas.addEventListener('pointerup', release)
    this.canvas.addEventListener('pointercancel', release)
  }

  show(appearance: Appearance): void {
    if (this.avatar) {
      this.scene.remove(this.avatar.root)
      this.avatar.dispose()
    }
    this.avatar = new Avatar('preview', 0, 'worker', appearance)
    this.scene.add(this.avatar.root)
  }

  /** Runs the turntable while the creator is on screen (and stops it when it isn't). */
  setActive(active: boolean): void {
    if (!active) {
      cancelAnimationFrame(this.frame)
      this.frame = 0
      return
    }
    if (this.frame) return
    if (!this.renderer) {
      try {
        this.renderer = new THREE.WebGLRenderer({
          canvas: this.canvas,
          alpha: true,
          antialias: true,
        })
      } catch {
        return // no WebGL for a second canvas: the creator still works, just without a preview
      }
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
      this.renderer.outputColorSpace = THREE.SRGBColorSpace
    }
    this.last = performance.now()
    const tick = (now: number) => {
      this.frame = requestAnimationFrame(tick)
      this.render(now)
    }
    this.frame = requestAnimationFrame(tick)
  }

  private render(now: number): void {
    const renderer = this.renderer
    if (!renderer || !this.avatar) return
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    if (w === 0 || h === 0) return
    const size = renderer.getSize(new THREE.Vector2())
    if (size.x !== w || size.y !== h) {
      renderer.setSize(w, h, false)
      this.camera.aspect = w / h
      this.camera.updateProjectionMatrix()
    }
    const dt = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    if (this.dragX === null && now > this.idleUntil) this.yaw += dt * 0.6
    const state = { ...PREVIEW_STATE, yaw: this.yaw }
    this.avatar.update(state, remotePose(state, { time: now / 1000 }), now)
    renderer.render(this.scene, this.camera)
  }
}

/** The creator panel. Every change is applied at once (and saved by the menu via onChange). */
export class CharacterCreator {
  readonly element: HTMLElement
  /** The PLAY (before joining) or DONE (after) button under the options. */
  readonly confirm: HTMLButtonElement
  private look: Appearance
  private readonly preview = new Preview()
  private readonly renderers: (() => void)[] = []
  private readonly intro: HTMLParagraphElement
  private readonly note: HTMLParagraphElement
  private readonly onChange: (look: Appearance) => void

  constructor(initial: Appearance, onChange: (look: Appearance) => void) {
    this.look = { ...initial }
    this.onChange = onChange

    const options = el(
      'div',
      'creator-options',
      this.segmented('Build', 'body', ['Masculine', 'Feminine']),
      this.swatches('Skin', 'skin', SKIN_TONES, SKIN_NAMES, true),
      this.stepper(
        'Hair',
        'hair',
        HAIR_STYLES.map((s) => (s === 'bald' ? 'Bald' : title(s))),
      ),
      this.swatches('Hair colour', 'hairColor', HAIR_COLORS, HAIR_COLOR_NAMES),
      this.swatches('Eyes', 'eyes', EYE_COLORS, EYE_NAMES, true),
      this.stepper(
        'Beard',
        'beard',
        BEARDS.map((b) => (b === 'none' ? 'Clean-shaven' : title(b))),
      ),
    )

    const randomise = el('button', 'creator-random', '⟳ RANDOMISE')
    randomise.type = 'button'
    randomise.addEventListener('click', () => this.set(randomAppearance()))
    this.confirm = el('button', 'menu-play creator-confirm', 'PLAY')
    this.confirm.type = 'button'

    this.intro = el(
      'p',
      'creator-intro',
      'Make your survivor. Everyone starts with a tank top and joggers on — anything more, you find out there.',
    )
    this.note = el('p', 'menu-label creator-note')

    const stage = el(
      'div',
      'creator-stage',
      this.preview.canvas,
      el('span', 'creator-hint', 'drag to turn'),
    )
    this.element = el(
      'section',
      'menu-panel creator',
      this.intro,
      el('div', 'creator-body', stage, options),
      this.note,
      el('div', 'creator-actions', randomise, this.confirm),
    )
    this.refresh()
  }

  get appearance(): Appearance {
    return { ...this.look }
  }

  /** Shown while the tab is open: the preview only renders then. */
  setActive(active: boolean): void {
    this.preview.setActive(active)
  }

  /** Before the first game the creator asks you to make someone; later it says when it applies. */
  setMode(firstTime: boolean, joined: boolean): void {
    this.intro.hidden = !firstTime
    this.confirm.textContent = joined ? 'DONE' : 'PLAY'
    this.note.textContent = joined
      ? 'Saved. Your new look shows the next time you join.'
      : 'Only looks: every build moves and gets hit the same.'
  }

  private set(look: Appearance): void {
    this.look = { ...look }
    this.refresh()
    this.onChange(this.appearance)
  }

  private refresh(): void {
    for (const render of this.renderers) render()
    this.preview.show(this.look)
  }

  private row(label: string, control: HTMLElement): HTMLElement {
    return el('div', 'creator-row', el('span', 'creator-label', label), control)
  }

  private segmented(label: string, key: keyof Appearance, names: string[]): HTMLElement {
    const group = el('div', 'menu-choice creator-segmented')
    const buttons = names.map((name, i) => {
      const b = el('button', '', name)
      b.type = 'button'
      b.addEventListener('click', () => this.set({ ...this.look, [key]: i }))
      group.append(b)
      return b
    })
    this.renderers.push(() => {
      buttons.forEach((b, i) => {
        b.classList.toggle('chosen', this.look[key] === i)
      })
    })
    return this.row(label, group)
  }

  private swatches(
    label: string,
    key: keyof Appearance,
    colors: readonly number[],
    names: string[],
    round = false,
  ): HTMLElement {
    const group = el('div', round ? 'creator-swatches round' : 'creator-swatches')
    const buttons = colors.map((color, i) => {
      const b = el('button', 'creator-swatch')
      b.type = 'button'
      b.style.setProperty('--swatch', hex(color))
      b.title = names[i] ?? ''
      b.setAttribute('aria-label', `${label}: ${names[i] ?? i + 1}`)
      b.addEventListener('click', () => this.set({ ...this.look, [key]: i }))
      group.append(b)
      return b
    })
    const value = el('span', 'creator-value')
    this.renderers.push(() => {
      buttons.forEach((b, i) => {
        b.classList.toggle('chosen', this.look[key] === i)
      })
      value.textContent = names[this.look[key]] ?? ''
    })
    const head = el('span', 'creator-label', label, value)
    return el('div', 'creator-row', head, group)
  }

  private stepper(label: string, key: keyof Appearance, names: string[]): HTMLElement {
    const value = el('span', 'creator-step-value')
    const step = (by: number) => {
      const n = names.length
      this.set({ ...this.look, [key]: (((this.look[key] + by) % n) + n) % n })
    }
    const prev = el('button', 'creator-arrow', '◂')
    const next = el('button', 'creator-arrow', '▸')
    for (const [b, by, name] of [
      [prev, -1, 'Previous'],
      [next, 1, 'Next'],
    ] as const) {
      b.type = 'button'
      b.setAttribute('aria-label', `${name} ${label.toLowerCase()}`)
      b.addEventListener('click', () => step(by))
    }
    this.renderers.push(() => {
      value.textContent = `${names[this.look[key]] ?? ''}`
    })
    return this.row(label, el('div', 'creator-stepper', prev, value, next))
  }
}
