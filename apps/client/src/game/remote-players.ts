import {
  type HitPose,
  InterpolationBuffer,
  PLAYER_COLORS,
  type RemotePlayerState,
  remotePose,
  ServerClock,
  type SkinId,
  TICK_RATE,
  ZombieKind,
  zombieScale,
} from '@office-fps/shared'
import * as THREE from 'three'
import { Avatar, type BodyLook } from '../render/avatar.ts'

interface Remote {
  name: string
  color: number
  /** 0 = a person or bot; a ZombieKind for zombies (they keep their own look). */
  kind: number
  avatar: Avatar
  buffer: InterpolationBuffer
  /** Last interpolated state drawn on screen. */
  shown: RemotePlayerState | null
  /** Distance walked since the last footstep (m). */
  stride: number
  /** How fast they were moving as drawn (m/s), for their ragdoll when they die. */
  velocity: THREE.Vector3
  wasGrounded: boolean
}

/** Same stride as your own footsteps (CameraFeel) so everyone sounds alike. */
const STRIDE = 1.9
/** Below this speed (crouch-walking is 2.4 m/s) you move silently — sneaking is a tactic. */
const SILENT_SPEED = 2.8

/** Everyone else: roster, snapshot buffers and avatars drawn slightly in the past. */
export class RemotePlayers {
  readonly clock = new ServerClock(TICK_RATE)
  /** How far behind the server we draw others (ms). Must exceed the snapshot interval + jitter. */
  interpDelayMs = 100
  /**
   * Server tick the remote players on screen correspond to. Sent with every input so the server
   * can rewind to exactly what you were looking at when you fired.
   */
  renderTick = 0
  private readonly players = new Map<number, Remote>()
  private readonly scene: THREE.Scene
  private lastUpdateMs = 0
  private readonly poses = new Map<number, HitPose>()
  /** Game rules: what everyone looks like and how big they are. */
  private skin: SkinId = 'worker'
  private scale = 1
  /** Someone else's footstep (derived from their movement, no network traffic needed). */
  onFootstep?: (at: THREE.Vector3, sprinting: boolean) => void
  onLand?: (at: THREE.Vector3) => void
  /** Someone else started a slide, a climb, or lay down / got up (seen in their state). */
  onMove?: (sound: 'slide' | 'mantle' | 'prone', at: THREE.Vector3) => void
  /** Someone just died on screen: drop a ragdoll in the pose they were last drawn in. */
  onDeath?: (
    id: number,
    pose: RemotePlayerState,
    velocity: THREE.Vector3,
    colorIndex: number,
    skin: BodyLook,
    scale: number,
  ) => void
  /** A zombie within earshot, now and then (they groan). */
  onGroan?: (at: THREE.Vector3) => void

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  get count(): number {
    return this.players.size
  }

  add(id: number, name: string, color: number, kind = 0): void {
    this.remove(id)
    const avatar = new Avatar(name, color, lookOf(kind, this.skin))
    avatar.root.visible = false // until the first snapshot places it
    this.scene.add(avatar.root)
    this.players.set(id, {
      name,
      color,
      kind,
      avatar,
      buffer: new InterpolationBuffer(),
      shown: null,
      stride: 0,
      velocity: new THREE.Vector3(),
      wasGrounded: true,
    })
  }

  remove(id: number): void {
    const p = this.players.get(id)
    if (!p) return
    this.scene.remove(p.avatar.root)
    p.avatar.dispose()
    this.players.delete(id)
  }

  /** Applies the server's skin and body size; rebuilds the models if the skin changed. */
  setLook(skin: SkinId, scale: number): void {
    this.scale = scale
    if (skin === this.skin) return
    this.skin = skin
    for (const [id, p] of [...this.players]) {
      if (p.kind !== 0) continue // zombies look like zombies whatever the skin
      const visible = p.avatar.root.visible
      this.scene.remove(p.avatar.root)
      p.avatar.dispose()
      p.avatar = new Avatar(p.name, p.color, skin)
      p.avatar.root.visible = visible
      this.scene.add(p.avatar.root)
      this.players.set(id, p)
    }
  }

  /** Colors players by team (team modes), or back to their own colors. */
  setTeams(teamColor: (id: number) => number | null): void {
    for (const [id, p] of this.players) {
      p.avatar.setTint(teamColor(id), PLAYER_COLORS[p.color % PLAYER_COLORS.length] ?? 0xffffff)
    }
  }

  clear(): void {
    for (const id of [...this.players.keys()]) this.remove(id)
  }

  onSnapshot(tick: number, states: RemotePlayerState[], nowMs: number): void {
    this.clock.onSnapshot(tick, nowMs)
    for (const s of states) this.players.get(s.id)?.buffer.push(tick, s)
  }

  /** @param viewer your eye position (for directional effects like the scope glint) */
  update(nowMs: number, viewer?: THREE.Vector3): void {
    if (!this.clock.isSynced) return
    this.renderTick = this.clock.tick(nowMs) - (this.interpDelayMs * TICK_RATE) / 1000
    const dt = Math.min(0.1, (nowMs - this.lastUpdateMs) / 1000)
    this.lastUpdateMs = nowMs
    for (const [id, p] of this.players) {
      const before = p.shown
      p.shown = p.buffer.sample(this.renderTick)
      p.avatar.root.visible = p.shown?.alive ?? false
      const size = this.scale * zombieScale(p.kind)
      if (p.shown) p.avatar.update(p.shown, this.poseOf(id, p.shown), nowMs, viewer)
      if (before && p.shown && dt > 0) {
        if (before.alive && p.shown.alive) {
          p.velocity.set(p.shown.x - before.x, p.shown.y - before.y, p.shown.z - before.z)
          p.velocity.divideScalar(dt)
          // A respawn teleport isn't a velocity.
          if (p.velocity.length() > 20) p.velocity.set(0, 0, 0)
        }
        if (before.alive && !p.shown.alive) {
          this.onDeath?.(id, before, p.velocity, p.color, lookOf(p.kind, this.skin), size)
        }
        this.detectSteps(p, before, p.shown, dt)
        if (p.kind !== 0 && p.shown.alive && Math.random() < dt / 6) {
          this.onGroan?.(new THREE.Vector3(p.shown.x, p.shown.y + 1.6, p.shown.z))
        }
      }
    }
    this.poses.clear()
    for (const [id, p] of this.players) {
      const s = p.shown
      if (s?.alive) this.poses.set(id, this.poseOf(id, s))
    }
  }

  private detectSteps(p: Remote, a: RemotePlayerState, b: RemotePlayerState, dt: number): void {
    const moved = Math.hypot(b.x - a.x, b.z - a.z)
    const at = () => new THREE.Vector3(b.x, b.y + 0.05, b.z)
    if (!b.alive || moved > 3) {
      // Dead, or a respawn teleport: not a step.
      p.stride = 0
      p.wasGrounded = b.grounded
      return
    }
    if (b.grounded && !p.wasGrounded && b.mantle === 0) this.onLand?.(at())
    if (b.slide > a.slide + 0.3) this.onMove?.('slide', at())
    if (b.mantle > 0 && a.mantle === 0) this.onMove?.('mantle', at())
    if ((b.prone > 0.02 && a.prone <= 0.02) || (b.prone < 0.98 && a.prone >= 0.98))
      this.onMove?.('prone', at())
    p.wasGrounded = b.grounded
    const speed = moved / dt
    if (!b.grounded || speed < SILENT_SPEED) return
    p.stride += moved
    if (p.stride >= STRIDE) {
      p.stride -= STRIDE
      this.onFootstep?.(at(), speed > 6)
    }
  }

  /**
   * Player `id`'s full body pose for state `s` at the moment on screen: what their avatar is drawn
   * in and what their hitboxes are (the server rewinds to the same pose when you shoot).
   */
  poseOf(id: number, s: RemotePlayerState): HitPose {
    const kind = this.kindOf(id)
    return remotePose(s, {
      gait: kind,
      scale: this.scale * zombieScale(kind),
      time: this.renderTick / TICK_RATE,
    })
  }

  /**
   * Hit poses of every living player as currently drawn (for local tracer ends, crosshair names
   * and F4 debug). Rebuilt once per frame in update().
   */
  visiblePoses(): Map<number, HitPose> {
    return this.poses
  }

  /** Where player `id`'s gun is on screen, or null if unknown. */
  muzzleOf(id: number): THREE.Vector3 | null {
    const p = this.players.get(id)
    return p?.shown ? p.avatar.muzzleWorld(new THREE.Vector3()) : null
  }

  /** 0 for people and bots, a ZombieKind for zombies. */
  kindOf(id: number): number {
    return this.players.get(id)?.kind ?? 0
  }

  /** People (not zombies) whose torch is on, as drawn: where they stand and where they look. */
  torches(): { x: number; y: number; z: number; yaw: number; pitch: number }[] {
    const out: { x: number; y: number; z: number; yaw: number; pitch: number }[] = []
    for (const p of this.players.values()) {
      const s = p.shown
      if (s?.alive && s.light)
        out.push({ x: s.x, y: s.y + 1.5, z: s.z, yaw: s.yaw, pitch: s.pitch })
    }
    return out
  }

  nameOf(id: number): string | undefined {
    return this.players.get(id)?.name
  }

  colorOf(id: number): number | undefined {
    return this.players.get(id)?.color
  }
}

function lookOf(kind: number, skin: SkinId): BodyLook {
  if (kind === 0) return skin
  if (kind === ZombieKind.Runner) return 'runner'
  if (kind === ZombieKind.Brute) return 'brute'
  if (kind === ZombieKind.Screamer) return 'screamer'
  if (kind === ZombieKind.Stalker) return 'stalker'
  return 'zombie'
}
