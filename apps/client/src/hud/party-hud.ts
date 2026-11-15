import type { PartyInfo } from '@office-fps/shared'
import * as THREE from 'three'
import { bearingTo, turnBetween } from './survival-hud.ts'

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  parent?: HTMLElement,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  parent?.append(node)
  return node
}

interface Mark {
  tag: HTMLDivElement
  text: HTMLSpanElement
  needle: HTMLElement
}

/**
 * Your camp-mates on the HUD: their name and distance over them wherever they are (through
 * walls and trees), and a mark on the survival compass pointing their way.
 */
export class CampMarkers {
  private readonly root: HTMLDivElement
  private readonly marks = new Map<number, Mark>()
  private readonly at = new THREE.Vector3()
  private readonly toward = new THREE.Vector3()
  private readonly forward = new THREE.Vector3()

  constructor(parent: HTMLElement) {
    this.root = el('div', 'camp-tags', parent)
  }

  /**
   * @param mates  everyone in the camp but you
   * @param headOf where a mate's head is drawn right now (null: not in sight, use `mates`)
   */
  update(
    camera: THREE.Camera,
    mates: PartyInfo['members'],
    headOf: (id: number) => THREE.Vector3 | null,
    show: boolean,
  ): void {
    const compass = document.querySelector<HTMLElement>('.sv-compass')
    const ids = new Set(mates.map((m) => m.id))
    for (const [id, mark] of this.marks) {
      if (ids.has(id) && show) continue
      mark.tag.remove()
      mark.needle.remove()
      this.marks.delete(id)
    }
    if (!show) return
    const width = this.root.clientWidth || window.innerWidth
    const height = this.root.clientHeight || window.innerHeight
    camera.getWorldDirection(this.forward)
    // Which way the view faces, as the compass reads it (degrees clockwise from north).
    const heading = bearingTo({ x: 0, z: 0 }, { x: this.forward.x, z: this.forward.z })
    for (const m of mates) {
      let mark = this.marks.get(m.id)
      if (!mark) {
        const tag = el('div', 'camp-tag', this.root)
        el('b', '', tag, '◆')
        const text = el('span', '', tag)
        const needle = el('b', 'sv-compass-mate', compass ?? undefined, m.name.slice(0, 1))
        mark = { tag, text, needle }
        this.marks.set(m.id, mark)
      }
      if (compass && mark.needle.parentElement !== compass) compass.append(mark.needle)
      const head = headOf(m.id)
      if (head) this.at.copy(head)
      else this.at.set(m.x, m.y + 1.9, m.z)
      this.at.y += 0.45
      this.toward.copy(this.at).sub(camera.position)
      const d = Math.round(Math.hypot(this.toward.x, this.toward.z))
      const ahead = this.forward.dot(this.toward) > 0
      mark.tag.hidden = !ahead || d < 3
      if (!mark.tag.hidden) {
        this.at.project(camera)
        mark.tag.style.left = `${((this.at.x + 1) / 2) * width}px`
        mark.tag.style.top = `${((1 - this.at.y) / 2) * height}px`
        const text = `${m.name}${m.alive ? '' : ' (down)'} · ${d} m`
        if (mark.text.textContent !== text) mark.text.textContent = text
        mark.tag.classList.toggle('down', !m.alive)
      }
      // On the compass: clamped to its edge when they're behind you.
      const cw = compass?.clientWidth || 360
      const where = head ?? { x: m.x, z: m.z }
      const t = Math.max(-88, Math.min(88, turnBetween(bearingTo(camera.position, where), heading)))
      mark.needle.style.left = `${(0.5 + t / 180) * cw}px`
      mark.needle.title = m.name
    }
  }
}

/**
 * Your camp in the pause menu: the invite link with a copy button, who's in it, and a way out.
 */
export class CampPanel {
  readonly root: HTMLElement
  private readonly link: HTMLInputElement
  private readonly copy: HTMLButtonElement
  private readonly list: HTMLUListElement
  private readonly leave: HTMLButtonElement
  onLeave: () => void = () => {}

  constructor() {
    this.root = el('section', 'camp-panel')
    this.root.hidden = true
    el('h3', '', this.root, 'YOUR CAMP')
    el(
      'p',
      'camp-blurb',
      this.root,
      'Up to four. Camp-mates wake beside each other, see each other through the trees, share pings and quest hand-ins.',
    )
    const row = el('div', 'camp-link', this.root)
    this.link = el('input', '', row)
    this.link.readOnly = true
    this.link.addEventListener('focus', () => this.link.select())
    this.copy = el('button', '', row, 'COPY LINK')
    this.copy.type = 'button'
    this.copy.addEventListener('click', () => void this.copyLink())
    this.list = el('ul', 'camp-members', this.root)
    this.leave = el('button', 'camp-leave', this.root, 'LEAVE CAMP')
    this.leave.type = 'button'
    this.leave.addEventListener('click', () => this.onLeave())
  }

  show(visible: boolean): void {
    this.root.hidden = !visible
  }

  set(party: PartyInfo | null, link: string, me: number): void {
    if (this.link.value !== link) this.link.value = link
    const members = party?.members ?? []
    this.list.replaceChildren(
      ...members.map((m) => {
        const li = el('li', m.alive ? '' : 'down')
        el(
          'span',
          '',
          li,
          `${m.id === party?.leader ? '★ ' : ''}${m.name}${m.id === me ? ' (you)' : ''}`,
        )
        if (!m.alive) el('em', '', li, 'down')
        return li
      }),
    )
    this.leave.hidden = members.length < 2
  }

  private async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.link.value)
      this.copy.textContent = 'COPIED'
    } catch {
      this.link.select()
      this.copy.textContent = 'CTRL+C'
    }
    setTimeout(() => {
      this.copy.textContent = 'COPY LINK'
    }, 1500)
  }
}
