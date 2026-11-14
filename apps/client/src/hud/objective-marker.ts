import * as THREE from 'three'

/** Margin (px) the marker keeps from the screen edge when the goal is off screen. */
const EDGE = 40
/** Room (px) kept clear at the bottom for the HUD (health, money, weapon, hotbar). */
const BOTTOM = 170

/**
 * Where an edge-pinned marker goes on a `width` x `height` screen (CSS px), from where its target
 * projects to (`x`, `y` px; a point behind you projects mirrored). In front of you it sits over
 * the target, kept inside the edges and above the bottom HUD; behind you it is pinned to the left
 * or right edge (whichever way is the shorter turn), halfway up, so it never lands on the health
 * bar or money. `off`: not over the target itself (pointing the way).
 */
export function markerSpot(
  x: number,
  y: number,
  behind: boolean,
  width: number,
  height: number,
): { x: number; y: number; off: boolean } {
  if (behind) {
    x = width - x < width / 2 ? 0 : width
    y = height / 2
  }
  const off = behind || x < EDGE || x > width - EDGE || y < EDGE || y > height - BOTTOM
  return {
    x: Math.min(width - EDGE, Math.max(EDGE, x)),
    y: Math.min(height - BOTTOM, Math.max(EDGE, y)),
    off,
  }
}

/**
 * Co-op waypoint: a diamond with a label and distance over the current goal, pinned to the
 * screen edge when the goal is behind you or off to the side (never over the bottom HUD).
 */
export class ObjectiveMarker {
  private readonly root: HTMLDivElement
  private readonly label: HTMLDivElement
  private readonly projected = new THREE.Vector3()
  private readonly toGoal = new THREE.Vector3()
  private readonly forward = new THREE.Vector3()

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div')
    this.root.className = 'hud-waypoint'
    const diamond = document.createElement('div')
    diamond.className = 'diamond'
    this.label = document.createElement('div')
    this.root.append(diamond, this.label)
    this.root.hidden = true
    parent.append(this.root)
  }

  /** Points at `goal` (world) as seen through `camera`; null hides it. */
  update(camera: THREE.Camera, goal: THREE.Vector3 | null, text: string): void {
    this.root.hidden = goal === null
    if (!goal) return
    const width = this.root.parentElement?.clientWidth ?? window.innerWidth
    const height = this.root.parentElement?.clientHeight ?? window.innerHeight
    this.toGoal.copy(goal).sub(camera.position)
    const distance = this.toGoal.length()
    camera.getWorldDirection(this.forward)
    const behind = this.forward.dot(this.toGoal) < 0
    this.projected.copy(goal).project(camera)
    const px = ((this.projected.x + 1) / 2) * width
    const py = ((1 - this.projected.y) / 2) * height
    const spot = markerSpot(px, py, behind, width, height)
    this.root.style.left = `${spot.x}px`
    this.root.style.top = `${spot.y}px`
    this.label.textContent = `${text} · ${Math.round(distance)} m`
  }
}
