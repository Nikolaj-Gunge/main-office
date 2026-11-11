import {
  Button,
  currentSpread,
  hasButton,
  type PhysicsWorld,
  PLAYER_QUERY_GROUPS,
  type PlayerState,
  RAPIER,
  raycastPose,
  type ServerMessage,
  ServerMsg,
  type ShotEvent,
  ShotResult,
  WEAPONS,
  type WeaponId,
} from '@office-fps/shared'
import * as THREE from 'three'
import type { CombatHud } from '../hud/combat-hud.ts'
import type { DebugHitboxes } from '../render/debug-hitboxes.ts'
import type { Effects } from '../render/effects.ts'
import type { Viewmodel } from '../render/viewmodel.ts'
import type { RemotePlayers } from './remote-players.ts'

interface CombatDeps {
  camera: THREE.PerspectiveCamera
  physics: PhysicsWorld
  effects: Effects
  hud: CombatHud
  viewmodel: Viewmodel
  remotes: RemotePlayers
  debug: DebugHitboxes
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
  onLocalShot(shot: ShotEvent, weaponId: WeaponId): void {
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
    const muzzle = this.d.camera.localToWorld(this.d.viewmodel.muzzleView.clone())
    this.d.effects.shot(muzzle, end, normal, kind)
    this.d.viewmodel.onShot()
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
        this.d.effects.shot(
          from,
          new THREE.Vector3(msg.end.x, msg.end.y, msg.end.z),
          new THREE.Vector3(msg.normal.x, msg.normal.y, msg.normal.z),
          kind,
        )
        break
      }
      case ServerMsg.HitConfirm:
        this.d.hud.hitmarker(msg.zone, msg.killed)
        break
      case ServerMsg.Damaged:
        this.d.hud.setHealth(msg.health)
        this.d.hud.damageFrom(msg.from)
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
        this.d.hud.setHealth(msg.health)
        this.d.hud.setDeathTimer(msg.respawnIn)
        this.isProtected = msg.protected
        break
      case ServerMsg.DebugShot:
        this.d.debug.showServer(msg.origin, msg.dir, msg.poses)
        break
    }
  }

  /** Per-frame HUD and viewmodel upkeep. */
  update(
    dt: number,
    state: PlayerState,
    look: { yaw: number; pitch: number; delta: { yaw: number; pitch: number } },
    bob: { phase: number; weight: number },
    walkSpeed: number,
  ): void {
    const aiming = hasButton(state.prevButtons, Button.Aim)
    this.d.viewmodel.update(dt, look.delta, bob, state.weapon, aiming, state.alive)
    this.d.hud.setWeapon(state.weapon)
    this.d.hud.setSpread(
      currentSpread(state.weapon, aiming, {
        sprinting: false,
        grounded: state.grounded,
        crouched: state.crouched,
        speedFactor: Math.hypot(state.vel.x, state.vel.z) / walkSpeed,
      }),
      this.d.camera.fov,
      aiming,
    )
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
    this.d.effects.update(dt)
    this.d.debug.updateLocal(this.d.remotes.visiblePoses())
    this.d.debug.update(dt)
  }
}
