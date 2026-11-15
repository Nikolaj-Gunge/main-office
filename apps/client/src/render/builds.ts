import {
  type MaterialId,
  PIECES,
  type Piece,
  pieceBase,
  pieceBoxes,
  pieceCentre,
  type SurvivalDef,
  unpackPieces,
} from '@office-fps/shared'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { getSurfaceMaterial } from './textures.ts'

/** What changed at a piece since the last update, for the sounds. */
export interface PieceChange {
  at: { x: number; y: number; z: number }
  what: 'built' | 'hit' | 'broke' | 'door'
}

/** Old boards, a little darker than floorboards; scrap for the metal bits. */
const MATERIALS: Partial<Record<MaterialId, THREE.Material>> = {}
function materialFor(id: MaterialId): THREE.Material {
  let m = MATERIALS[id]
  if (!m) {
    m = (getSurfaceMaterial(id) as THREE.MeshLambertMaterial).clone()
    if (id === 'wood') (m as THREE.MeshLambertMaterial).color.setHex(0x8a6c50)
    MATERIALS[id] = m
  }
  return m
}

/** Merges a piece's boxes into one mesh per material (a wall is ~10 boxes: one draw call). */
export function pieceMesh(boxes: ReturnType<typeof pieceBoxes>, material?: THREE.Material) {
  const byMaterial = new Map<MaterialId, THREE.BufferGeometry[]>()
  const euler = new THREE.Euler()
  const matrix = new THREE.Matrix4()
  for (const box of boxes) {
    const g = new THREE.BoxGeometry(...box.size)
    euler.set(...(box.rotation ?? [0, 0, 0]))
    matrix.makeRotationFromEuler(euler).setPosition(...box.center)
    g.applyMatrix4(matrix)
    const list = byMaterial.get(box.material) ?? []
    list.push(g)
    byMaterial.set(box.material, list)
  }
  const group = new THREE.Group()
  for (const [id, list] of byMaterial) {
    const merged = mergeGeometries(list)
    for (const g of list) g.dispose()
    if (!merged) continue
    const mesh = new THREE.Mesh(merged, material ?? materialFor(id))
    mesh.castShadow = !material
    mesh.receiveShadow = !material
    group.add(mesh)
  }
  return group
}

/**
 * What people built (building.ts): walls, doors, spike traps and stash crates, drawn from the
 * server's list; reports what changed (something put up, a blow, something falling apart, a
 * door swinging) so the right sound plays there.
 */
export class BuildView {
  readonly root = new THREE.Group()
  pieces: Piece[] = []
  private readonly def: SurvivalDef
  private readonly shown = new Map<number, { sig: string; group: THREE.Group; piece: Piece }>()
  private first = true

  constructor(def: SurvivalDef) {
    this.def = def
    this.root.name = 'builds'
  }

  /** `flat` is the server's list (see packPieces). */
  apply(flat: readonly number[]): PieceChange[] {
    const next = unpackPieces(flat)
    const changes: PieceChange[] = []
    const seen = new Set<number>()
    for (const p of next) {
      seen.add(p.id)
      const sig = `${p.kind}:${p.x}:${p.z}:${p.rot}:${p.open ? 1 : 0}`
      const had = this.shown.get(p.id)
      const at = pieceCentre(p, pieceBase(this.def, p))
      if (!had && !this.first) changes.push({ at, what: 'built' })
      if (had && p.hp < had.piece.hp - 0.5 && p.kind !== 'spikes') changes.push({ at, what: 'hit' })
      if (had && had.piece.open !== p.open) changes.push({ at, what: 'door' })
      if (had?.sig !== sig) this.draw(p)
      else had.piece = p
    }
    for (const [id, s] of this.shown) {
      if (seen.has(id)) continue
      changes.push({ at: pieceCentre(s.piece, pieceBase(this.def, s.piece)), what: 'broke' })
      this.drop(id)
    }
    this.pieces = next
    this.first = false
    return changes
  }

  private draw(p: Piece): void {
    this.drop(p.id)
    const group = pieceMesh(pieceBoxes(p, pieceBase(this.def, p)))
    this.root.add(group)
    const sig = `${p.kind}:${p.x}:${p.z}:${p.rot}:${p.open ? 1 : 0}`
    this.shown.set(p.id, { sig, group, piece: p })
  }

  private drop(id: number): void {
    const s = this.shown.get(id)
    if (!s) return
    this.root.remove(s.group)
    for (const child of s.group.children) (child as THREE.Mesh).geometry.dispose()
    this.shown.delete(id)
  }

  /** How sound a piece is (0–1). */
  static health(p: Piece): number {
    return p.hp / PIECES[p.kind].hp
  }

  clear(): void {
    for (const id of [...this.shown.keys()]) this.drop(id)
    this.pieces = []
    this.first = true
  }
}
