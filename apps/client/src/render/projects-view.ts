import {
  heightAt,
  type MaterialId,
  PROJECT_BOARD,
  PROJECTS,
  type ProjectDef,
  type ProjectId,
  type ProjectShared,
  projectProgress,
  type SurvivalDef,
} from '@office-fps/shared'
import * as THREE from 'three'
import { pieceMesh } from './builds.ts'

type Box = {
  size: [number, number, number]
  center: [number, number, number]
  material: MaterialId
  rotation?: [number, number, number]
}

/** A box standing with its bottom at `y` (and turned about Y by `ry`, or tipped by `rx`/`rz`). */
const b = (
  material: MaterialId,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  rot?: [number, number, number],
): Box => ({
  size: [w, h, d],
  center: [x, y + h / 2, z],
  material,
  ...(rot ? { rotation: rot } : {}),
})

/** A fixed hash 0–1, so the posts of a wall are always the same heights. */
const hash = (n: number) => {
  const s = Math.sin(n * 127.1) * 43758.5453
  return s - Math.floor(s)
}

/** The watchtower: four legs, braces, a railed platform under a roof, a ladder and a lantern. */
function watchtower(): Box[] {
  const out: Box[] = []
  const H = 5.4
  for (const [x, z] of [
    [-1.3, -1.3],
    [1.3, -1.3],
    [-1.3, 1.3],
    [1.3, 1.3],
  ] as const)
    out.push(b('log', 0.26, H, 0.26, x, 0, z))
  for (const e of [-1, 1]) {
    out.push(b('wood', 0.1, 3.2, 0.12, 0, 1.2, e * 1.3, [0, 0, 0.72]))
    out.push(b('wood', 0.12, 3.2, 0.1, e * 1.3, 1.2, 0, [0.72, 0, 0]))
  }
  out.push(b('wood', 3.2, 0.16, 3.2, 0, H, 0))
  for (const e of [-1, 1]) {
    out.push(b('wood', 3.2, 0.12, 0.08, 0, H + 0.9, e * 1.56))
    out.push(b('wood', 0.08, 0.12, 3.2, e * 1.56, H + 0.9, 0))
    out.push(b('wood', 3.2, 0.45, 0.05, 0, H + 0.16, e * 1.58))
    out.push(b('wood', 0.05, 0.45, 3.2, e * 1.58, H + 0.16, 0))
  }
  for (const [x, z] of [
    [-1.5, -1.5],
    [1.5, -1.5],
    [-1.5, 1.5],
    [1.5, 1.5],
  ] as const)
    out.push(b('log', 0.14, 2.2, 0.14, x, H, z))
  out.push(b('shingle', 3.9, 0.14, 3.9, 0, H + 2.2, 0))
  out.push(b('shingle', 2.6, 0.14, 2.6, 0, H + 2.34, 0))
  // The ladder, up the side facing Haven (south-east).
  for (const e of [-1, 1]) out.push(b('wood', 0.07, H + 0.9, 0.07, 1.62, 0, 0.6 + e * 0.25))
  for (let y = 0.35; y < H; y += 0.4) out.push(b('wood', 0.06, 0.06, 0.55, 1.62, y, 0.6))
  out.push(b('lantern', 0.2, 0.28, 0.2, 0, H + 1.7, 0))
  return out
}

/** The well: a stone ring, dark water, a roofed winch and a bucket. */
function well(): Box[] {
  const out: Box[] = []
  for (const e of [-1, 1]) {
    out.push(b('brick', 1.9, 0.8, 0.32, 0, 0, e * 0.8))
    out.push(b('brick', 0.32, 0.8, 1.3, e * 0.8, 0, 0))
  }
  out.push(b('asphalt', 1.3, 0.05, 1.3, 0, 0.5, 0))
  for (const e of [-1, 1]) out.push(b('log', 0.16, 2.3, 0.16, e * 0.9, 0, 0))
  out.push(b('log', 2.1, 0.14, 0.14, 0, 1.75, 0))
  for (const e of [-1, 1])
    out.push(b('shingle', 2.3, 0.08, 0.9, 0, 2.15, e * 0.36, [e * 0.55, 0, 0]))
  out.push(b('canvas', 0.03, 0.7, 0.03, 0.2, 1.05, 0))
  out.push(b('rust', 0.3, 0.3, 0.3, 0.2, 0.78, 0))
  out.push(b('wood', 0.5, 0.06, 0.06, 1.15, 1.72, 0))
  return out
}

/** The outer wall: palisade either side of the gate road, posts uneven, rails behind. */
function outerWall(ground: (x: number) => number): Box[] {
  const out: Box[] = []
  for (const side of [-1, 1]) {
    let i = 0
    for (let x = 8; x <= 22; x += 0.42, i++) {
      const h = 2.7 + hash(i * side + 3) * 0.6
      const px = side * x
      out.push(b('log', 0.36, h, 0.36, px, ground(px) - 0.3, 0))
      out.push(b('log', 0.24, 0.3, 0.24, px, ground(px) - 0.3 + h, 0))
    }
    for (const y of [0.9, 2.1]) {
      const mid = side * 15
      out.push(b('wood', 14.4, 0.16, 0.1, mid, ground(mid) + y, 0.26))
    }
  }
  return out
}

/** The greenhouse: a timber frame, glass walls and roof, two beds of green inside. */
function greenhouse(): { solid: Box[]; glass: Box[] } {
  const solid: Box[] = []
  const glass: Box[] = []
  const W = 6
  const D = 4
  const H = 2.3
  for (const x of [-W / 2, 0, W / 2])
    for (const z of [-D / 2, D / 2]) solid.push(b('wood', 0.14, H, 0.14, x, 0, z))
  for (const z of [-D / 2, D / 2]) solid.push(b('wood', W, 0.12, 0.14, 0, H, z))
  solid.push(b('wood', W + 0.2, 0.14, 0.14, 0, H + 1.1, 0))
  for (const e of [-1, 1]) solid.push(b('wood', 0.14, 0.12, D, e * (W / 2), H, 0))
  for (const z of [-D / 2, D / 2]) glass.push(b('glass', W, H, 0.04, 0, 0, z))
  glass.push(b('glass', 0.04, H, D, W / 2, 0, 0))
  glass.push(b('glass', 0.04, H, 1.3, -W / 2, 0, -1.35))
  glass.push(b('glass', 0.04, H, 1.3, -W / 2, 0, 1.35))
  for (const e of [-1, 1])
    glass.push(b('glass', W, 0.04, 2.35, 0, H + 0.5, e * 1, [e * -0.5, 0, 0]))
  // The door, open, on the side facing Haven.
  solid.push(b('wood', 0.06, 2, 0.9, -W / 2 - 0.4, 0, -0.75, [0, 0.9, 0]))
  for (const z of [-1, 1]) {
    solid.push(b('wood', W - 1.2, 0.4, 0.9, 0.3, 0, z))
    for (let x = -2.1; x <= 2.7; x += 0.6)
      solid.push(b('plant', 0.32, 0.3 + hash(x * 7 + z) * 0.35, 0.4, x, 0.4, z))
  }
  return { solid, glass }
}

/** Builders' stakes and a pile of what's been given so far (a project under way). */
function site(def: ProjectDef, progress: number): Box[] {
  const r = def.id === 'wall' ? 0 : def.id === 'greenhouse' ? 3 : 1.6
  const out: Box[] = []
  if (def.id === 'wall')
    for (const x of [-15, -8, 8, 15]) out.push(b('log', 0.12, 1, 0.12, x, 0, 0))
  else
    for (const [x, z] of [
      [-r, -r],
      [r, -r],
      [-r, r],
      [r, r],
    ] as const)
      out.push(b('log', 0.1, 0.9, 0.1, x, 0, z))
  const layers = 1 + Math.floor(progress * 6)
  for (let i = 0; i < layers; i++)
    out.push(
      b('wood', 2, 0.1, 0.5, def.id === 'wall' ? 10 : 0, i * 0.11, 0, [0, i % 2 ? 0.2 : -0.1, 0]),
    )
  return out
}

/** Where each plaque stands, relative to its project (facing Haven). */
const PLAQUE_AT: Record<ProjectId, [number, number]> = {
  watchtower: [0, 2.4],
  well: [1.5, 1.4],
  wall: [7.2, 0.9],
  greenhouse: [-4, 2.4],
}

interface Shown {
  def: ProjectDef
  built: THREE.Group
  site: THREE.Group
  siteKey: number
  plaque: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; key: string }
  base: number
}

function canvasTex(w: number, h: number) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  return { canvas, tex }
}

const short = (def: ProjectDef) => def.name.replace(/^The /, '').toUpperCase()

/**
 * Haven's community projects (shared/survival/projects.ts) in the world: the project board's
 * chalk, builders' stakes and a pile of materials while one is under way, and the finished thing,
 * blocky, with a brass plaque of the builders' names. Hangs off the camp view (Haven's origin).
 */
export class ProjectsView {
  readonly root = new THREE.Group()
  private readonly shown = new Map<ProjectId, Shown>()
  private readonly board = canvasTex(128, 84)
  private boardKey = ''

  constructor(def: SurvivalDef, origin: THREE.Vector3) {
    this.root.name = 'projects'
    const ground = (x: number, z: number) =>
      heightAt(def.terrain, origin.x + x, origin.z + z) - origin.y
    for (const p of PROJECTS) {
      const [ax, az] = p.at
      const base = ground(ax, az)
      const built = new THREE.Group()
      built.position.set(ax, base, az)
      if (p.id === 'greenhouse') {
        const { solid, glass } = greenhouse()
        built.add(pieceMesh(solid), pieceMesh(glass))
      } else if (p.id === 'wall') built.add(pieceMesh(outerWall((x) => ground(ax + x, az) - base)))
      else built.add(pieceMesh(p.id === 'watchtower' ? watchtower() : well()))
      built.visible = false
      const siteGroup = new THREE.Group()
      siteGroup.position.copy(built.position)

      // The plaque: a brass plate on a short post, turned to face Haven's fire.
      const [px, pz] = PLAQUE_AT[p.id]
      const plaque = canvasTex(128, 144)
      const post = new THREE.Group()
      const wx = ax + px
      const wz = az + pz
      post.position.set(px, ground(wx, wz) - base, pz)
      post.rotation.y = Math.atan2(-wx, -wz)
      post.add(pieceMesh([b('log', 0.12, 1.05, 0.12, 0, 0, -0.06)]))
      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(0.72, 0.81),
        new THREE.MeshLambertMaterial({
          map: plaque.tex,
          emissive: 0x302410,
          emissiveMap: plaque.tex,
        }),
      )
      plate.position.set(0, 1.3, 0)
      post.add(pieceMesh([b('rust', 0.8, 0.9, 0.04, 0, 0.85, -0.03)]), plate)
      built.add(post)

      this.root.add(built, siteGroup)
      this.shown.set(p.id, {
        def: p,
        built,
        site: siteGroup,
        siteKey: -1,
        plaque: { ...plaque, key: '' },
        base,
      })
    }

    // The board's chalk, on its plank facing the gate road (east), like the morale board.
    const [bx, bz] = PROJECT_BOARD
    const chalk = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 0.99),
      new THREE.MeshLambertMaterial({
        map: this.board.tex,
        emissive: 0x1a1a1a,
        emissiveMap: this.board.tex,
      }),
    )
    chalk.position.set(bx + 0.045, 1.45, bz)
    chalk.rotation.y = Math.PI / 2
    this.root.add(chalk)
  }

  apply(projects: readonly ProjectShared[] | undefined): void {
    for (const s of this.shown.values()) {
      const p = projects?.find((q) => q.id === s.def.id)
      const done = p?.done !== undefined
      s.built.visible = done
      const progress = p ? projectProgress(s.def, p.given) : 0
      // Under way: stakes and a pile, growing with what's been given.
      const key = done || progress <= 0 ? 0 : 1 + Math.floor(progress * 6)
      if (key !== s.siteKey) {
        s.siteKey = key
        s.site.clear()
        if (key > 0) s.site.add(pieceMesh(site(s.def, progress)))
      }
      if (done && p) this.drawPlaque(s, p)
    }
    this.drawBoard(projects ?? [])
  }

  private drawPlaque(s: Shown, p: ProjectShared): void {
    const names = p.names ?? []
    const key = `${p.done}|${names.join(',')}`
    if (key === s.plaque.key) return
    s.plaque.key = key
    const { canvas, tex } = s.plaque
    const g = canvas.getContext('2d')
    if (!g) return
    g.fillStyle = '#a07c34'
    g.fillRect(0, 0, canvas.width, canvas.height)
    g.strokeStyle = '#5a4418'
    g.lineWidth = 2
    g.strokeRect(3, 3, canvas.width - 6, canvas.height - 6)
    g.fillStyle = '#2a1e0c'
    g.textAlign = 'center'
    g.font = 'bold 8px monospace'
    g.fillText(short(s.def), canvas.width / 2, 15)
    g.font = '8px monospace'
    g.fillText(`RAISED DAY ${(p.done ?? 0) + 1}`, canvas.width / 2, 26)
    g.fillRect(16, 30, canvas.width - 32, 1)
    g.fillText('BUILT BY', canvas.width / 2, 41)
    names.forEach((n, i) => {
      g.fillText(n.slice(0, 20), canvas.width / 2, 53 + i * 9)
    })
    tex.needsUpdate = true
  }

  private drawBoard(projects: readonly ProjectShared[]): void {
    const key = projects.map((p) => `${p.id}:${p.given.join(',')}:${p.done ?? ''}`).join('|')
    if (key === this.boardKey) return
    this.boardKey = key
    const { canvas, tex } = this.board
    const g = canvas.getContext('2d')
    if (!g) return
    g.fillStyle = '#23282a'
    g.fillRect(0, 0, canvas.width, canvas.height)
    g.fillStyle = '#e4e0d4'
    g.font = 'bold 8px monospace'
    g.fillText('HAVEN BUILDS', 4, 10)
    PROJECTS.forEach((def, i) => {
      const p = projects.find((q) => q.id === def.id)
      const y = 22 + i * 16
      const done = p?.done !== undefined
      const progress = p ? projectProgress(def, p.given) : 0
      g.fillStyle = done ? '#a8c890' : '#e4e0d4'
      g.fillText(short(def), 4, y)
      g.strokeStyle = '#e4e0d4'
      g.strokeRect(4.5, y + 2.5, 119, 6)
      g.fillStyle = done ? '#a8c890' : '#d8c890'
      g.fillRect(6, y + 4, Math.round(116 * progress), 3)
      if (done) {
        g.fillStyle = '#a8c890'
        g.fillText('BUILT', 92, y)
      }
    })
    tex.needsUpdate = true
  }
}
