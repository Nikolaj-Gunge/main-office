import { PING_LABELS, type PingKind } from '@office-fps/shared'
import * as THREE from 'three'
import { markerSpot } from './objective-marker.ts'
import { PING_COLORS, PING_ICONS } from './ping-wheel.ts'

/** A ping stays this long (ms); a speech bubble this long. */
export const PING_MS = 8000
export const BUBBLE_MS = 4000
/** Bubbles are drawn for people within this (m). */
const BUBBLE_RANGE = 40

interface PingTag {
  el: HTMLDivElement
  label: HTMLSpanElement
  at: THREE.Vector3
  until: number
}

interface Bubble {
  el: HTMLDivElement
  until: number
}

/**
 * Things drawn over the world on the HUD: ping markers (icon, what, who and how far; pinned to
 * the screen edge when off screen, like the co-op waypoint) and speech bubbles over the heads of
 * people talking or waving nearby.
 */
export class SocialTags {
  private readonly root: HTMLDivElement
  private readonly pings: PingTag[] = []
  private readonly bubbles = new Map<number, Bubble>()
  private readonly projected = new THREE.Vector3()
  private readonly toward = new THREE.Vector3()
  private readonly forward = new THREE.Vector3()

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div')
    this.root.className = 'hud-social-tags'
    parent.append(this.root)
  }

  ping(kind: PingKind, at: { x: number; y: number; z: number }, who: string, nowMs: number): void {
    while (this.pings.length >= 8) this.pings.shift()?.el.remove()
    const el = document.createElement('div')
    el.className = 'hud-ping'
    el.style.setProperty('--ping', PING_COLORS[kind])
    const icon = document.createElement('b')
    icon.textContent = PING_ICONS[kind]
    const label = document.createElement('span')
    el.append(icon, label)
    el.dataset.text = `${PING_LABELS[kind]}${who ? ` · ${who}` : ''}`
    this.root.append(el)
    this.pings.push({ el, label, at: new THREE.Vector3(at.x, at.y, at.z), until: nowMs + PING_MS })
  }

  /** A bubble over player `id` (replaces the one they had). */
  say(id: number, text: string, nowMs: number): void {
    this.bubbles.get(id)?.el.remove()
    const el = document.createElement('div')
    el.className = 'hud-bubble'
    el.textContent = text
    el.hidden = true
    this.root.append(el)
    this.bubbles.set(id, { el, until: nowMs + BUBBLE_MS })
  }

  clear(): void {
    for (const p of this.pings) p.el.remove()
    this.pings.length = 0
    for (const b of this.bubbles.values()) b.el.remove()
    this.bubbles.clear()
  }

  /** @param headOf where player `id`'s bubble goes (null: not drawn — dead, far, in a car) */
  update(camera: THREE.Camera, nowMs: number, headOf: (id: number) => THREE.Vector3 | null): void {
    const width = this.root.clientWidth || window.innerWidth
    const height = this.root.clientHeight || window.innerHeight
    camera.getWorldDirection(this.forward)
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i]
      if (!p) continue
      if (nowMs > p.until) {
        p.el.remove()
        this.pings.splice(i, 1)
        continue
      }
      this.toward.copy(p.at).sub(camera.position)
      const behind = this.forward.dot(this.toward) < 0
      this.projected.copy(p.at).project(camera)
      const spot = markerSpot(
        ((this.projected.x + 1) / 2) * width,
        ((1 - this.projected.y) / 2) * height,
        behind,
        width,
        height,
      )
      p.el.style.left = `${spot.x}px`
      p.el.style.top = `${spot.y}px`
      p.el.classList.toggle('off', spot.off)
      p.el.classList.toggle('fading', p.until - nowMs < 1000)
      p.label.textContent = `${p.el.dataset.text} · ${Math.round(this.toward.length())} m`
    }
    for (const [id, b] of this.bubbles) {
      if (nowMs > b.until) {
        b.el.remove()
        this.bubbles.delete(id)
        continue
      }
      const head = headOf(id)
      this.toward.copy(head ?? camera.position).sub(camera.position)
      const shown =
        head !== null && this.forward.dot(this.toward) > 0 && this.toward.length() < BUBBLE_RANGE
      b.el.hidden = !shown
      if (!shown || !head) continue
      this.projected.copy(head).project(camera)
      const x = ((this.projected.x + 1) / 2) * width
      const y = ((1 - this.projected.y) / 2) * height
      b.el.style.left = `${x}px`
      b.el.style.top = `${y}px`
      b.el.classList.toggle('fading', b.until - nowMs < 600)
    }
  }
}
