import {
  aimProgress,
  currentSpread,
  HitZone,
  MAX_BREATH,
  type PhysicsWorld,
  PLAYER_COLORS,
  PLAYER_QUERY_GROUPS,
  type PlayerState,
  RAPIER,
  raycastPose,
  type ServerMessage,
  ServerMsg,
  type ShotEvent,
  ShotResult,
  WEAPONS,
  type WeaponEvents,
  WeaponId,
  type WeaponState,
} from '@office-fps/shared'
import * as THREE from 'three'
import type { AudioEngine } from '../audio/audio-engine.ts'
import type { CombatHud } from '../hud/combat-hud.ts'
import type { DebugHitboxes } from '../render/debug-hitboxes.ts'
import type { Effects } from '../render/effects.ts'
import type { Viewmodel } from '../render/viewmodel.ts'
import type { Recoil } from './recoil.ts'
import type { RemotePlayers } from './remote-players.ts'
import type { ScreenShake } from './screen-shake.ts'

/** Names show for players under the crosshair up to this far away (m). */
const HOVER_RANGE = 80

/** A bullet passing within this distance of your head makes the supersonic crack. */
const NEAR_MISS_DISTANCE = 1.6

interface CombatDeps {
  camera: THREE.PerspectiveCamera
  physics: PhysicsWorld
  effects: Effects
  hud: CombatHud
  viewmodel: Viewmodel
  remotes: RemotePlayers
  debug: DebugHitboxes
  audio: AudioEngine
  recoil: Recoil
  shake: ScreenShake
  myId: () => number
}

/**
 * Client side of shooting. Your own shots are shown instantly from prediction (flash, recoil,
 * tracer, impact); damage, hit markers and kills only appear when the server confirms them.
 */
export class ClientCombat {
  private readonly d: CombatDeps
  private readonly names = new Map<number, string>()
  private lastDeath: { killer: string | null; weapon: string; headshot: boolean } | null = null
  private wasAlive = true
  private isProtected = false

  constructor(deps: CombatDeps) {
    this.d = deps
  }

  setName(id: number, name: string): void {
    this.names.set(id, name)
  }

  forget(id: number): void {
    this.names.delete(id)
  }

  private name(id: number): string {
    return this.names.get(id) ?? `#${id}`
  }

  /** A shot we just predicted: show it right away. */
  onLocalShot(shot: ShotEvent, weaponId: WeaponId, aiming: boolean): void {
    const { origin, dir } = shot
    const weapon = WEAPONS[weaponId]
    const wall = this.d.physics.world.castRayAndGetNormal(
      new RAPIER.Ray(origin, dir),
      weapon.range,
      true,
      undefined,
      PLAYER_QUERY_GROUPS,
    )
    let distance = wall ? wall.timeOfImpact : weapon.range
    let kind: 'world' | 'player' | 'nothing' = wall ? 'world' : 'nothing'
    // Ends the tracer on whoever we see in the way (the server decides if it actually counts).
    for (const pose of this.d.remotes.visiblePoses().values()) {
      const hit = raycastPose(origin, dir, distance, pose)
      if (hit) {
        distance = hit.distance
        kind = 'player'
      }
    }
    const end = new THREE.Vector3(origin.x, origin.y, origin.z).addScaledVector(
      new THREE.Vector3(dir.x, dir.y, dir.z),
      distance,
    )
    const normal =
      kind === 'world' && wall
        ? new THREE.Vector3(wall.normal.x, wall.normal.y, wall.normal.z)
        : new THREE.Vector3(-dir.x, -dir.y, -dir.z)
    // Scoped, the gun is hidden: the tracer starts just below the eye instead of the muzzle.
    const muzzle = this.d.viewmodel.scoped
      ? new THREE.Vector3(origin.x, origin.y - 0.08, origin.z)
      : this.d.camera.localToWorld(this.d.viewmodel.muzzleView.clone())
    const heavy = weapon.id === WeaponId.Sniper
    this.d.effects.shot(muzzle, end, normal, kind, heavy)
    this.d.viewmodel.onShot()
    this.d.recoil.kick(weapon, aiming)
    this.d.shake.add(heavy ? 0.45 : weapon.fireMode === 'auto' ? 0.1 : 0.18)
    this.d.audio.gunshot(undefined, weapon.id)
    if (weapon.fireMode === 'bolt') this.d.audio.play('bolt', { volume: 0.6, delay: 0.35 })
    this.impactSound(end, kind)
    this.ejectCasing()
  }

  /** Reload and dry-fire sounds from the predicted weapon (so they're instant). */
  onWeaponEvents(events: WeaponEvents, weapon: WeaponState): void {
    const audio = this.d.audio
    if (events.dryFire) audio.play('dryfire', { volume: 0.6 })
    if (events.reloadStarted) {
      const total = weapon.reload
      const empty = weapon.ammo === 0
      audio.play('reload.out', { volume: 0.7, delay: 0.12 })
      audio.play('reload.in', { volume: 0.75, delay: Math.max(0.3, total - (empty ? 0.7 : 0.45)) })
      if (empty) audio.play('reload.slide', { volume: 0.75, delay: Math.max(0.5, total - 0.28) })
    }
  }

  private impactSound(at: THREE.Vector3, kind: 'world' | 'player' | 'nothing'): void {
    if (kind === 'nothing') return
    this.d.audio.playNear(kind === 'world' ? 'impact.world' : 'impact.flesh', at, 0.8, 45)
  }

  private ejectCasing(): void {
    const cam = this.d.camera
    const at = cam.localToWorld(this.d.viewmodel.ejectView.clone())
    // Out to the right, up, slightly back — in view space, then into the world.
    const v = new THREE.Vector3(
      1.6 + Math.random() * 0.6,
      1.4 + Math.random() * 0.6,
      0.4 + Math.random() * 0.3,
    ).applyQuaternion(cam.quaternion)
    this.d.effects.ejectCasing(at, v)
  }

  /** Closest approach of a bullet path to your head: plays the crack if it passed close by. */
  private nearMiss(from: THREE.Vector3, to: THREE.Vector3): void {
    const head = this.d.camera.position
    const seg = to.clone().sub(from)
    const length = seg.length()
    if (length < 0.01) return
    const t = Math.max(0, Math.min(1, head.clone().sub(from).dot(seg) / (length * length)))
    // Bullets that end right at us are hits, not misses (you get the hurt sound instead).
    if (t >= 0.999) return
    const closest = from.clone().addScaledVector(seg, t)
    if (closest.distanceTo(head) < NEAR_MISS_DISTANCE) {
      this.d.audio.play('crack', { at: closest, volume: 0.9 })
    }
  }

  onMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case ServerMsg.ShotFired: {
        const from = this.d.remotes.muzzleOf(msg.shooterId)
        if (!from) break
        const kind =
          msg.result === ShotResult.Player
            ? 'player'
            : msg.result === ShotResult.World
              ? 'world'
              : 'nothing'
        const end = new THREE.Vector3(msg.end.x, msg.end.y, msg.end.z)
        const heavy = msg.weapon === WeaponId.Sniper
        this.d.effects.shot(
          from,
          end,
          new THREE.Vector3(msg.normal.x, msg.normal.y, msg.normal.z),
          kind,
          heavy,
        )
        this.d.audio.gunshot(from, msg.weapon)
        if (heavy) this.d.audio.playNear('bolt', from, 0.6, 25)
        this.impactSound(end, kind)
        this.nearMiss(from, end)
        break
      }
      case ServerMsg.HitConfirm:
        this.d.hud.hitmarker(msg.zone, msg.killed)
        this.d.audio.play(msg.zone === HitZone.Head ? 'hit.head' : 'hit', { bus: 'ui', rate: 1 })
        if (msg.killed) this.d.audio.play('kill', { bus: 'ui', rate: 1, delay: 0.07 })
        break
      case ServerMsg.Damaged:
        this.d.hud.setHealth(msg.health)
        this.d.hud.damageFrom(msg.from)
        this.d.audio.play('hurt', { volume: 0.8 })
        this.d.audio.onHurt(msg.damage)
        this.d.shake.add(Math.min(0.8, 0.25 + msg.damage / 60))
        break
      case ServerMsg.Kill: {
        const me = this.d.myId()
        const weapon = WEAPONS[msg.weapon].name
        this.d.hud.kill(
          this.name(msg.killerId),
          this.name(msg.victimId),
          weapon,
          msg.headshot,
          msg.killerId === me || msg.victimId === me,
        )
        if (msg.victimId === me) {
          this.lastDeath = {
            killer: msg.killerId === me ? null : this.name(msg.killerId),
            weapon,
            headshot: msg.headshot,
          }
        }
        break
      }
      case ServerMsg.Snapshot:
        this.d.audio.setHealth(msg.health, msg.self?.alive ?? true)
        this.d.hud.setHealth(msg.health)
        this.d.hud.setDeathTimer(msg.respawnIn)
        this.isProtected = msg.protected
        break
      case ServerMsg.DebugShot:
        this.d.debug.showServer(msg.origin, msg.dir, msg.poses)
        break
    }
  }

  /** Shows the name of whoever is under the crosshair, if you can actually see them. */
  private updateHover(alive: boolean): void {
    if (!alive) {
      this.d.hud.setHoverName(null, 0)
      return
    }
    const cam = this.d.camera
    const origin = cam.position
    const dir = cam.getWorldDirection(new THREE.Vector3())
    const wall = this.d.physics.world.castRay(
      new RAPIER.Ray(origin, dir),
      HOVER_RANGE,
      true,
      undefined,
      PLAYER_QUERY_GROUPS,
    )
    let best: { id: number; distance: number } | null = null
    for (const [id, pose] of this.d.remotes.visiblePoses()) {
      const hit = raycastPose(
        origin,
        dir,
        best?.distance ?? wall?.timeOfImpact ?? HOVER_RANGE,
        pose,
      )
      if (hit) best = { id, distance: hit.distance }
    }
    const name = best ? this.d.remotes.nameOf(best.id) : undefined
    const color = best ? (this.d.remotes.colorOf(best.id) ?? 0) : 0
    this.d.hud.setHoverName(name ?? null, PLAYER_COLORS[color % PLAYER_COLORS.length] ?? 0xffffff)
  }

  /** Per-frame HUD and viewmodel upkeep. */
  update(
    dt: number,
    state: PlayerState,
    look: { yaw: number; pitch: number; delta: { yaw: number; pitch: number } },
    bob: { phase: number; weight: number },
    walkSpeed: number,
  ): void {
    const w = state.weapon
    this.d.viewmodel.update(dt, look.delta, bob, w, state.alive)
    this.d.hud.setWeapon(w, state.holstered)
    this.d.hud.setSpread(
      currentSpread(w, {
        sprinting: false,
        grounded: state.grounded,
        crouched: state.crouched,
        speedFactor: Math.hypot(state.vel.x, state.vel.z) / walkSpeed,
      }),
      this.d.camera.fov,
      aimProgress(w) > 0.3,
    )
    this.d.hud.setScope(this.d.viewmodel.scoped && state.alive, w.breath / MAX_BREATH, w.steady)
    this.d.hud.update(dt, state.pos, look.yaw)
    this.d.hud.setProtected(state.alive && this.isProtected)
    this.d.hud.setVisible(state.alive)

    if (state.alive !== this.wasAlive) {
      if (state.alive) this.d.hud.hideDeath()
      else
        this.d.hud.showDeath(
          this.lastDeath?.killer ?? null,
          this.lastDeath?.weapon ?? '',
          this.lastDeath?.headshot ?? false,
        )
      this.wasAlive = state.alive
    }
    this.updateHover(state.alive)
    this.d.effects.update(dt)
    this.d.debug.updateLocal(this.d.remotes.visiblePoses())
    this.d.debug.update(dt)
  }
}
