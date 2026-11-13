import * as THREE from 'three'

/** Margin (px) the marker keeps from the screen edge when the goal is off screen. */
const EDGE = 40

/**
 * Co-op waypoint: a diamond with a label and distance over the current goal, pinned to the
 * screen edge when the goal is behind you or off to the side.
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
    let x = this.projected.x
    let y = this.projected.y
    if (behind) {
      // Behind you: mirror it and push it to the bottom edge.
      x = -x
      y = -1
    }
    const sx = Math.min(width - EDGE, Math.max(EDGE, ((x + 1) / 2) * width))
    const sy = Math.min(height - EDGE, Math.max(EDGE, ((1 - y) / 2) * height))
    this.root.style.left = `${sx}px`
    this.root.style.top = `${sy}px`
    this.label.textContent = `${text} · ${Math.round(distance)} m`
  }
}
