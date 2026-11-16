import type { HitPose, SurvivalAction, TurnedSelfState } from '@office-fps/shared'
import type * as THREE from 'three'

/** Eye height of one of the dead (m, at scale 1): a little stooped. */
const EYE = 1.5

/**
 * Your own turned self, on the client (the server's turned-self.ts runs it). Just turned: a
 * prompt to take the wheel (P) or wake at Haven now (O). Steering: the camera sits in the
 * body's head (the body itself isn't drawn for you), the world goes grey and red, sound comes
 * through thick, the HUD is gone but for how long is left. Your usual input goes to the server
 * as ever; it moves the body there.
 */
export class TurnedSelfView {
  private readonly prompt: HTMLDivElement
  private readonly promptCount: HTMLSpanElement
  private readonly bar: HTMLDivElement
  private readonly barCount: HTMLSpanElement
  /** The last state from the server, and when it came (ms). */
  private state: TurnedSelfState | null = null
  private at = 0
  private steering = false
  /** The state the offer was answered in: its prompt stays down until the server's reply. */
  private answered: TurnedSelfState | null = null

  constructor(
    parent: HTMLElement,
    private readonly send: (action: SurvivalAction) => void,
  ) {
    this.prompt = document.createElement('div')
    this.prompt.className = 'turned-offer'
    this.prompt.hidden = true
    this.prompt.innerHTML =
      '<div class="turned-offer-title">What is left of you is getting up.</div>' +
      '<div class="turned-offer-keys"><button type="button" data-take="1"><b class="turned-key">P</b> Take the wheel for a minute</button>' +
      '<button type="button" data-take="0"><b class="turned-key">O</b> Wake at Haven</button></div>' +
      '<div class="turned-offer-count">Waking at Haven in <span></span> s</div>'
    this.promptCount = this.prompt.querySelector('span') as HTMLSpanElement
    for (const b of this.prompt.querySelectorAll('button')) {
      b.addEventListener('click', () => this.answer(b.dataset.take === '1'))
    }
    this.bar = document.createElement('div')
    this.bar.className = 'turned-bar'
    this.bar.hidden = true
    this.bar.innerHTML =
      '<div>What is left of you · <span></span> s</div>' +
      '<div class="turned-bar-hint">Walk · click to claw · chat comes out as a groan</div>'
    this.barCount = this.bar.querySelector('span') as HTMLSpanElement
    parent.append(this.prompt, this.bar)
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (this.prompt.hidden || e.repeat) return
      if (e.code === 'KeyP') this.answer(true)
      else if (e.code === 'KeyO') this.answer(false)
    })
  }

  /** Steering right now: the body's id, else null. */
  get body(): number | null {
    return this.steering && this.state ? this.state.body : null
  }

  get active(): boolean {
    return this.steering
  }

  /** What the server last said (SurvivalSelf.turned); the same object again is no news. */
  set(state: TurnedSelfState | undefined, nowMs: number): void {
    const next = state ?? null
    if (next === this.state) return
    this.state = next
    this.at = nowMs
  }

  private answer(take: boolean): void {
    if (this.state?.offer === undefined) return
    this.prompt.hidden = true
    this.answered = this.state
    this.send({ a: 'turned', take })
  }

  /**
   * Once a frame (after the usual camera): shows the prompt or the countdown, and while
   * steering puts `camera` in the body's head looking where you look. Returns true while
   * steering (the camera is this view's).
   */
  update(
    nowMs: number,
    alive: boolean,
    pose: HitPose | null,
    look: { yaw: number; pitch: number },
    camera: THREE.PerspectiveCamera,
  ): boolean {
    const st = alive ? null : this.state
    const gone = (nowMs - this.at) / 1000
    const offer = st?.offer !== undefined ? Math.max(0, st.offer - gone) : null
    this.prompt.hidden = offer === null || offer <= 0 || this.state === this.answered
    if (offer !== null) this.promptCount.textContent = String(Math.ceil(offer))
    const left = st?.left !== undefined ? Math.max(0, st.left - gone) : null
    const steering = left !== null && pose !== null
    if (steering !== this.steering) {
      this.steering = steering
      this.bar.hidden = !steering
      document.body.classList.toggle('turned-self', steering)
    }
    if (!steering || !pose) return false
    this.barCount.textContent = String(Math.ceil(left ?? 0))
    const scale = pose.scale ?? 1
    camera.position.set(pose.x, pose.y + EYE * (1 - 0.3 * pose.crouch) * scale, pose.z)
    // A slow sway: it doesn't hold its head quite straight.
    const t = nowMs / 1000
    camera.rotation.set(look.pitch, look.yaw, Math.sin(t * 0.9) * 0.035, 'YXZ')
    return true
  }
}
