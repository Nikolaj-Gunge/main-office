import { type Busy, ITEMS, recipeOf } from '@office-fps/shared'

/** What the ring says you're doing. */
function doing(busy: Busy): string {
  if (busy.kind === 'craft') return `Making: ${recipeOf(busy.what)?.name ?? busy.what}`
  const def = ITEMS[busy.what]
  const name = def?.name ?? busy.what
  if (def?.kind === 'food') return `Eating: ${name}`
  if (def?.kind === 'drink') return `Drinking: ${name}`
  if (def?.manual) return `Reading: ${name}`
  return `Using: ${name}`
}

/**
 * The progress ring under the crosshair while you eat, bandage or make something (the server
 * says how long; the ring runs out the time from when it was told).
 */
export class BusyRing {
  private readonly root: HTMLDivElement
  private readonly arc: SVGCircleElement
  private readonly label: HTMLDivElement
  private busy: Busy | null = null
  private ends = 0

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div')
    this.root.className = 'sv-busy'
    this.root.hidden = true
    const ns = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(ns, 'svg')
    svg.setAttribute('viewBox', '0 0 40 40')
    const track = document.createElementNS(ns, 'circle')
    this.arc = document.createElementNS(ns, 'circle')
    for (const c of [track, this.arc]) {
      c.setAttribute('cx', '20')
      c.setAttribute('cy', '20')
      c.setAttribute('r', '16')
      svg.append(c)
    }
    track.setAttribute('class', 'track')
    this.arc.setAttribute('pathLength', '100')
    this.root.append(svg)
    this.label = document.createElement('div')
    this.root.append(this.label)
    parent.append(this.root)
  }

  set(busy: Busy | null): void {
    const same = busy && this.busy && busy.what === this.busy.what && busy.kind === this.busy.kind
    this.busy = busy
    if (!busy) {
      this.root.hidden = true
      return
    }
    if (!same) this.ends = performance.now() + busy.left * 1000
    this.label.textContent = doing(busy)
    this.root.hidden = false
  }

  update(): void {
    const busy = this.busy
    if (!busy) return
    const left = Math.max(0, this.ends - performance.now()) / 1000
    const done = busy.secs > 0 ? 1 - left / busy.secs : 1
    this.arc.setAttribute('stroke-dasharray', `${(done * 100).toFixed(1)} 100`)
  }
}
