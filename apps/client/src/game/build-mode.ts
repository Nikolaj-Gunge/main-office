import {
  BUILD_REACH,
  BUILD_TURNS,
  countOf,
  heightAt,
  KIT_PIECES,
  mapBlocks,
  type PhysicsWorld,
  PIECES,
  type Piece,
  pieceBase,
  pieceBoxes,
  placeProblem,
  type SurvivalAction,
  type SurvivalDef,
  type SurvivalSelf,
  snapPiece,
} from '@office-fps/shared'
import * as THREE from 'three'
import { pieceMesh } from '../render/builds.ts'

/** The kits in the order G steps through them. */
const KITS = Object.keys(KIT_PIECES)

/**
 * Build mode (building.ts): with a kit on you, G shows a see-through ghost of the piece where
 * you look, standing on the ground (and snapped to the walls already up). R turns it, E puts it
 * up, G again steps to your next kind of kit and then puts the ghost away. The server decides;
 * the ghost goes red, with the reason, where it would say no.
 */
export class BuildMode {
  /** The kit being placed, or null when not building. */
  kit: string | null = null
  private turn = 0
  private readonly ghost = new THREE.Group()
  private ghostSig = ''
  private readonly ok = new THREE.MeshBasicMaterial({
    color: 0xc8b070,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  })
  private readonly bad = new THREE.MeshBasicMaterial({
    color: 0xa04030,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  })
  /** Where it would go, and why it can't (null: it can). */
  private at: Pick<Piece, 'kind' | 'x' | 'z' | 'rot'> | null = null
  private problem: string | null = null
  private checkedAt = 0

  constructor(
    private readonly def: SurvivalDef,
    scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    private readonly send: (action: SurvivalAction) => void,
  ) {
    this.ghost.name = 'build-ghost'
    this.ghost.visible = false
    scene.add(this.ghost)
  }

  get active(): boolean {
    return this.kit !== null
  }

  /** G: the next kind of kit you carry, or out of build mode after the last. */
  toggle(self: SurvivalSelf | null): string | null {
    const have = KITS.filter((k) => countOf(self?.inv ?? [], k) > 0)
    if (have.length === 0) {
      this.stop()
      return 'Nothing to build with. Make a kit from planks and scrap (backpack, Make).'
    }
    const i = this.kit === null ? 0 : have.indexOf(this.kit) + 1
    this.kit = have[i] ?? null
    if (!this.kit) this.stop()
    return null
  }

  stop(): void {
    this.kit = null
    this.ghost.visible = false
    this.at = null
  }

  /** R: a turn of an eighth. */
  rotate(): void {
    this.turn = (this.turn + 1) % BUILD_TURNS
    this.checkedAt = 0
  }

  /** E: put it up (if the ghost says it may go). */
  place(): void {
    if (!this.kit || !this.at) return
    this.send({ a: 'build', kit: this.kit, x: this.at.x, z: this.at.z, rot: this.at.rot })
  }

  /**
   * Every frame: the ghost where you look. Returns the prompt line (E puts it up), or null when
   * not building. `yaw`/`pitch` are the server's angles.
   */
  update(
    self: SurvivalSelf | null,
    pieces: readonly Piece[],
    eye: { x: number; y: number; z: number },
    yaw: number,
    pitch: number,
  ): string | null {
    if (!this.kit) return null
    if (countOf(self?.inv ?? [], this.kit) < 1) {
      // Used the last one: on to the next kind, if any.
      this.kit = KITS.find((k) => countOf(self?.inv ?? [], k) > 0) ?? null
      if (!this.kit) {
        this.stop()
        return null
      }
    }
    const kind = KIT_PIECES[this.kit]
    if (!kind) return null
    // Down the line of sight to the ground, no further than you can reach.
    const cp = Math.cos(pitch)
    const fx = -Math.sin(yaw) * cp
    const fy = Math.sin(pitch)
    const fz = -Math.cos(yaw) * cp
    let x = eye.x + fx * BUILD_REACH
    let z = eye.z + fz * BUILD_REACH
    for (let d = 1.2; d <= BUILD_REACH; d += 0.1) {
      const px = eye.x + fx * d
      const pz = eye.z + fz * d
      if (eye.y + fy * d <= heightAt(this.def.terrain, px, pz)) {
        x = px
        z = pz
        break
      }
    }
    // Facing you, turned as far as R has turned it.
    const step = (Math.PI * 2) / BUILD_TURNS
    const rot = (((Math.round(yaw / step) + this.turn) % BUILD_TURNS) + BUILD_TURNS) % BUILD_TURNS
    const snapped = snapPiece(pieces, { kind, x, z, rot })
    const at = {
      kind,
      x: Math.round(snapped.x * 10) / 10,
      z: Math.round(snapped.z * 10) / 10,
      rot: snapped.rot,
    }
    const moved =
      !this.at ||
      this.at.kind !== at.kind ||
      this.at.rot !== at.rot ||
      this.at.x !== at.x ||
      this.at.z !== at.z
    this.at = at
    const now = performance.now()
    if (moved || now - this.checkedAt > 250) {
      this.checkedAt = now
      this.problem = placeProblem(this.def, pieces, at, (p, base) =>
        mapBlocks(this.physics, p, base),
      )
    }
    this.draw(at)
    const name = PIECES[kind].name.toLowerCase()
    const left = countOf(self?.inv ?? [], this.kit)
    if (this.problem) return `${this.problem} (G: next / done)`
    return `Build ${name}${left > 1 ? ` (${left})` : ''}  ·  R: turn  ·  G: next / done`
  }

  private draw(at: Pick<Piece, 'kind' | 'x' | 'z' | 'rot'>): void {
    const sig = `${at.kind}:${at.rot}:${this.problem ? 1 : 0}`
    if (sig !== this.ghostSig) {
      this.ghostSig = sig
      for (const child of [...this.ghost.children]) {
        this.ghost.remove(child)
        for (const m of child.children) (m as THREE.Mesh).geometry.dispose()
      }
      const piece: Piece = { id: 0, kind: at.kind, x: 0, z: 0, rot: at.rot, hp: 1 }
      this.ghost.add(pieceMesh(pieceBoxes(piece, 0), this.problem ? this.bad : this.ok))
    }
    this.ghost.position.set(at.x, pieceBase(this.def, at), at.z)
    this.ghost.visible = true
  }
}
