import {
  aimProgress,
  carried,
  currentSpread,
  HitZone,
  type JingleId,
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
/** Kills closer together than this count as a streak (double kill, triple kill). */
const STREAK_MS = 4000
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
  /** Kill jingle set from the game rules ('off' = just the ding). */
  jingles: JingleId = 'arcade'
  /** Your recent kill times (ms), for double / triple kill jingles. */
  private streak: number[] = []
  private wasAlive = true
  private isProtected = false
  /** Your feet, refreshed every frame (for your own death effects). */
  private readonly selfPos = { x: 0, y: 0, z: 0 }
  private readonly hoverRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 })

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
    const weapon = WEAPONS[weaponId]
    if (weapon.fireMode === 'melee') {
      this.localSwing(shot, weapon.range)
      return
    }
    // Scoped, the gun is hidden: the tracer starts just below the eye instead of the muzzle.
    const { origin } = shot
    const muzzle = this.d.viewmodel.scoped
      ? new THREE.Vector3(origin.x, origin.y - 0.08, origin.z)
      : this.d.camera.localToWorld(this.d.viewmodel.muzzleView.clone())
    const heavy = weapon.id === WeaponId.Sniper || weapon.id === WeaponId.Shotgun
    // Every pellet gets its tracer and impact; the shot itself (smoke, sound, kick) once.
    shot.pellets.forEach((dir, i) => {
      const { end, kind } = this.localTracer(origin, dir, weapon.range, muzzle, heavy, i === 0)
      if (i < 3) this.impactSound(end, kind) // a few impact sounds are plenty
    })
    this.d.viewmodel.onShot()
    this.d.recoil.kick(weapon, aiming)
    this.d.shake.add(
      weapon.id === WeaponId.Shotgun
        ? 0.55
        : heavy
          ? 0.5
          : weapon.fireMode === 'auto'
            ? 0.13
            : 0.32,
    )
    this.d.audio.gunshot(undefined, weapon.id)
    if (weapon.fireMode === 'bolt') this.d.audio.play('bolt', { volume: 0.6, delay: 0.35 })
    if (weapon.fireMode === 'pump') this.d.audio.play('pump', { volume: 0.7, delay: 0.3 })
    this.ejectCasing()
  }

  /** A knife swing: swish, and a predicted stab + blood if it touches someone we see. */
  private localSwing(shot: ShotEvent, range: number): void {
    this.d.viewmodel.onShot()
    this.d.audio.play('swish', { volume: 0.7 })
    let best: { distance: number; dir: { x: number; y: number; z: number } } | null = null
    for (const dir of shot.pellets) {
      for (const pose of this.d.remotes.visiblePoses().values()) {
        const hit = raycastPose(shot.origin, dir, best?.distance ?? range, pose)
        if (hit) best = { distance: hit.distance, dir }
      }
    }
    if (!best) return
    const { origin } = shot
    const at = new THREE.Vector3(origin.x, origin.y, origin.z).addScaledVector(
      new THREE.Vector3(best.dir.x, best.dir.y, best.dir.z),
      best.distance,
    )
    this.d.audio.play('stab', { volume: 0.8 })
    this.d.effects.bleed(at, new THREE.Vector3(best.dir.x, best.dir.y, best.dir.z), false)
  }

  /** Draws one predicted bullet/pellet: tracer to the first wall or visible player. */
  private localTracer(
    origin: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    range: number,
    muzzle: THREE.Vector3,
    heavy: boolean,
    withMuzzleEffects: boolean,
  ): { end: THREE.Vector3; kind: 'world' | 'player' | 'nothing' } {
    const wall = this.d.physics.world.castRayAndGetNormal(
      new RAPIER.Ray(origin, dir),
      range,
      true,
      undefined,
      PLAYER_QUERY_GROUPS,
    )
    let distance = wall ? wall.timeOfImpact : range
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
    this.d.effects.shot(muzzle, end, normal, kind, heavy, true, withMuzzleEffects)
    return { end, kind }
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

  /** Plays the rules' jingle after the kill ding; kills within 4 s of each other escalate it. */
  private killJingle(): void {
    if (this.jingles === 'off') return
    const now = performance.now()
    this.streak = this.streak.filter((t) => now - t < STREAK_MS)
    this.streak.push(now)
    this.d.audio.play(`jingle.${this.jingles}`, {
      bus: 'ui',
      rate: 1,
      volume: 0.8,
      delay: 0.12,
      variant: this.streak.length - 1,
    })
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
        if (msg.weapon === WeaponId.Claws) {
          // A zombie lashing out: a swipe, and a slash if it got someone.
          this.d.audio.playNear('swish', from, 0.5, 12)
          if (msg.result === ShotResult.Player) {
            const at = new THREE.Vector3(msg.end.x, msg.end.y, msg.end.z)
            this.d.audio.playNear('claw', at, 0.9, 20)
            this.d.effects.bleed(at, at.clone().sub(from).normalize(), false)
          }
          break
        }
        if (msg.weapon === WeaponId.Knife) {
          // Someone else's knife: the swing, and the stab if it connected. No tracer.
          this.d.audio.playNear('swish', from, 0.7, 15)
          if (msg.result === ShotResult.Player) {
            const at = new THREE.Vector3(msg.end.x, msg.end.y, msg.end.z)
            this.d.audio.playNear('stab', at, 0.8, 20)
            this.d.effects.bleed(at, at.clone().sub(from).normalize(), false)
          }
          break
        }
        const kind =
          msg.result === ShotResult.Player
            ? 'player'
            : msg.result === ShotResult.World
              ? 'world'
              : 'nothing'
        const end = new THREE.Vector3(msg.end.x, msg.end.y, msg.end.z)
        const heavy = msg.weapon === WeaponId.Sniper || msg.weapon === WeaponId.Shotgun
        const first = !msg.pellet
        this.d.effects.shot(
          from,
          end,
          new THREE.Vector3(msg.normal.x, msg.normal.y, msg.normal.z),
          kind,
          heavy,
          false,
          first,
        )
        // An extra shotgun pellet: tracer and impact only, the shot was already heard.
        if (first) {
          this.d.audio.gunshot(from, msg.weapon)
          if (msg.weapon === WeaponId.Sniper) this.d.audio.playNear('bolt', from, 0.6, 25)
          if (msg.weapon === WeaponId.Shotgun) this.d.audio.playNear('pump', from, 0.6, 25)
          this.impactSound(end, kind)
          this.nearMiss(from, end)
        }
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
        // Blood pool where they fell (as you see them, ~100 ms behind; you, where you are).
        const fell =
          msg.victimId === me ? this.selfPos : this.d.remotes.visiblePoses().get(msg.victimId)
        if (fell) this.d.effects.deathPool(new THREE.Vector3(fell.x, fell.y, fell.z))
        const weapon = WEAPONS[msg.weapon].name
        // Zombies mode: the horde dies by the dozen — only your own zombie kills are listed.
        const zombie = this.d.remotes.kindOf(msg.victimId) !== 0
        if (!zombie || msg.killerId === me)
          this.d.hud.kill(
            this.name(msg.killerId),
            this.name(msg.victimId),
            weapon,
            msg.headshot,
            msg.killerId === me || msg.victimId === me,
          )
        if (msg.killerId === me && msg.victimId !== me && !zombie) this.killJingle()
        if (msg.victimId === me) {
          this.streak = []
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
    this.hoverRay.origin = origin
    this.hoverRay.dir = dir
    const wall = this.d.physics.world.castRay(
      this.hoverRay,
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
    this.selfPos.x = state.pos.x
    this.selfPos.y = state.pos.y
    this.selfPos.z = state.pos.z
    const w = state.weapon
    this.d.viewmodel.update(dt, look.delta, bob, w, state.alive)
    this.d.hud.setWeapon(carried(state))
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
