import { PING_KINDS, PING_LABELS, type PingKind } from '@office-fps/shared'

/** Mouse travel (px) before a slice of the wheel is picked; less = the middle ("go here"). */
const PICK = 28
/** The wheel only appears when the key is held this long (ms); a quick tap pings "go here". */
const SHOW_AFTER = 160

/** A ping's mark: a small blocky glyph, the same on the wheel and in the world. */
export const PING_ICONS: Record<PingKind, string> = {
  go: '▼',
  zombie: '☠',
  loot: '▣',
  help: '✚',
  infected: '☣',
}

export const PING_COLORS: Record<PingKind, string> = {
  go: '#d9d4c4',
  zombie: '#d9583b',
  loot: '#e0b84a',
  help: '#6cc6d8',
  infected: '#8fbf3a',
}

/**
 * The ping wheel: hold the ping key, push the mouse towards a slice, let go. The look is frozen
 * while it's up (the mouse picks instead). Released in the middle, or tapped: "go here".
 */
export class PingWheel {
  private readonly root: HTMLDivElement
  private readonly slices: HTMLDivElement[] = []
  private readonly center: HTMLDivElement
  private dx = 0
  private dy = 0
  private heldSince = 0
  private holding = false

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div')
    this.root.className = 'hud-pingwheel'
    this.root.hidden = true
    PING_KINDS.forEach((kind, i) => {
      const a = this.angleOf(i)
      const slice = document.createElement('div')
      slice.className = 'slice'
      slice.style.left = `${Math.sin(a) * 110}px`
      slice.style.top = `${-Math.cos(a) * 110}px`
      slice.style.setProperty('--ping', PING_COLORS[kind])
      const icon = document.createElement('b')
      icon.textContent = PING_ICONS[kind]
      slice.append(icon, PING_LABELS[kind])
      this.slices.push(slice)
      this.root.append(slice)
    })
    this.center = document.createElement('div')
    this.center.className = 'center'
    this.root.append(this.center)
    parent.append(this.root)
    document.addEventListener('mousemove', (e) => {
      if (!this.holding) return
      this.dx += e.movementX
      this.dy += e.movementY
      // Keep the pointer inside a ring so a big swipe still picks the slice it points at.
      const r = Math.hypot(this.dx, this.dy)
      if (r > 90) {
        this.dx *= 90 / r
        this.dy *= 90 / r
      }
      this.highlight()
    })
  }

  /** Up (or waiting to come up): the look should stay still. */
  get active(): boolean {
    return this.holding
  }

  press(nowMs: number): void {
    this.holding = true
    this.heldSince = nowMs
    this.dx = 0
    this.dy = 0
    this.highlight()
  }

  /** Shows the wheel once the key has been held long enough. */
  update(nowMs: number): void {
    this.root.hidden = !this.holding || nowMs - this.heldSince < SHOW_AFTER
  }

  /** Let go: the ping chosen (null if the wheel wasn't up). */
  release(): PingKind | null {
    if (!this.holding) return null
    this.holding = false
    this.root.hidden = true
    return this.picked() ?? 'go'
  }

  cancel(): void {
    this.holding = false
    this.root.hidden = true
  }

  /** Slice `i`'s direction (radians clockwise from straight up). */
  private angleOf(i: number): number {
    return (i / PING_KINDS.length) * Math.PI * 2
  }

  private picked(): PingKind | null {
    if (Math.hypot(this.dx, this.dy) < PICK) return null
    const a = Math.atan2(this.dx, -this.dy)
    const step = (Math.PI * 2) / PING_KINDS.length
    const i = Math.round((a < 0 ? a + Math.PI * 2 : a) / step) % PING_KINDS.length
    return PING_KINDS[i] ?? null
  }

  private highlight(): void {
    const kind = this.picked()
    PING_KINDS.forEach((k, i) => {
      this.slices[i]?.classList.toggle('on', k === kind)
    })
    this.center.textContent = kind ? '' : PING_LABELS.go
  }
}
