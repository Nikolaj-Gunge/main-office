import { ALPHA_TAG_RANGE, isAlpha, type Notice } from '@office-fps/shared'
import * as THREE from 'three'
import type { AudioEngine } from '../audio/audio-engine.ts'
import type { RemotePlayers } from './remote-players.ts'

/** Typing speed of the ticker (characters a second), and how long a line stays once typed (s). */
const TYPE_RATE = 36
const HOLD = 7
/** The static and chime play this long before the words start (s). */
const LEAD_IN = 0.7
/** Lines waiting their turn: any more are dropped (the server already spaces them out). */
const BACKLOG = 3

/**
 * Radio Free Deadwood on the client (roadmap 6.6): a small ticker at the bottom of the screen
 * that types out what Wes says after a crackle of static and a chime; and the named alphas'
 * name tags (6.7), over their heads when you're close enough to read them, and their roar.
 */
export class RadioClient {
  private readonly ticker: HTMLElement
  private readonly from: HTMLElement
  private readonly text: HTMLElement
  private readonly queue: Notice[] = []
  private line: { full: string; shown: number; age: number } | null = null
  private readonly tags = new Map<number, HTMLElement>()
  private readonly tagRoot: HTMLElement
  private readonly projected = new THREE.Vector3()
  private readonly toward = new THREE.Vector3()
  private readonly forward = new THREE.Vector3()

  constructor(
    hudRoot: HTMLElement,
    private readonly audio: AudioEngine,
    private readonly camera: THREE.Camera,
  ) {
    this.ticker = document.createElement('div')
    this.ticker.className = 'radio-ticker'
    this.ticker.hidden = true
    this.from = document.createElement('div')
    this.from.className = 'radio-from'
    this.text = document.createElement('div')
    this.text.className = 'radio-text'
    this.ticker.append(this.from, this.text)
    this.tagRoot = document.createElement('div')
    this.tagRoot.className = 'alpha-tags'
    hudRoot.append(this.ticker, this.tagRoot)
  }

  /** A radio line, or an alpha's roar: handled here (true), or not ours (false). */
  onNotice(n: Notice): boolean {
    if (n.kind === 'radio') {
      if (this.queue.length < BACKLOG) this.queue.push(n)
      return true
    }
    if (n.kind === 'sound' && n.sound === 'roar' && n.at) {
      this.audio.playNear('roar', n.at, 1, 90, 10)
      return true
    }
    return false
  }

  /** What the ticker is showing right now (tests and screenshots). */
  get showing(): string {
    return this.text.textContent ?? ''
  }

  update(dt: number, remotes: RemotePlayers): void {
    this.updateTicker(dt)
    this.updateTags(remotes)
  }

  private updateTicker(dt: number): void {
    if (!this.line) {
      const next = this.queue.shift()
      if (!next) return
      this.line = { full: next.text, shown: 0, age: 0 }
      this.from.textContent = `RADIO FREE DEADWOOD · ${next.from ?? 'static'}`
      this.text.textContent = ''
      this.ticker.hidden = false
      this.ticker.classList.remove('fading')
      this.audio.play('radio.on', { volume: 0.55, bus: 'ui' })
    }
    const l = this.line
    l.age += dt
    const typed = Math.min(l.full.length, Math.floor(Math.max(0, l.age - LEAD_IN) * TYPE_RATE))
    if (typed !== l.shown) {
      l.shown = typed
      this.text.textContent = l.full.slice(0, typed) + (typed < l.full.length ? '▌' : '')
    }
    const done = LEAD_IN + l.full.length / TYPE_RATE
    if (l.age > done + HOLD - 0.8) this.ticker.classList.add('fading')
    if (l.age > done + HOLD) {
      this.line = null
      if (this.queue.length === 0) this.ticker.hidden = true
    }
  }

  /** Name tags over the alphas close enough to read, and in front of you. */
  private updateTags(remotes: RemotePlayers): void {
    const eye = this.camera.position
    this.camera.getWorldDirection(this.forward)
    const width = window.innerWidth
    const height = window.innerHeight
    const seen = new Set<number>()
    for (const [id, pose] of remotes.visiblePoses()) {
      if (!isAlpha(remotes.kindOf(id))) continue
      if (Math.hypot(pose.x - eye.x, pose.z - eye.z) > ALPHA_TAG_RANGE) continue
      const head = remotes.headOf(id)
      if (!head) continue
      this.toward.copy(head).sub(eye)
      if (this.forward.dot(this.toward) <= 0) continue
      let tag = this.tags.get(id)
      if (!tag) {
        tag = document.createElement('div')
        tag.className = 'alpha-tag'
        this.tagRoot.append(tag)
        this.tags.set(id, tag)
      }
      tag.textContent = remotes.nameOf(id) ?? ''
      this.projected.copy(head).project(this.camera)
      tag.style.left = `${((this.projected.x + 1) / 2) * width}px`
      tag.style.top = `${((1 - this.projected.y) / 2) * height}px`
      seen.add(id)
    }
    for (const [id, tag] of this.tags) {
      if (seen.has(id)) continue
      tag.remove()
      this.tags.delete(id)
    }
  }

  reset(): void {
    this.queue.length = 0
    this.line = null
    this.ticker.hidden = true
    for (const tag of this.tags.values()) tag.remove()
    this.tags.clear()
  }
}
