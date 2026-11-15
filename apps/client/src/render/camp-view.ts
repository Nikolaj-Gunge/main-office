import {
  type CampShared,
  DAWN,
  DIG_REACH,
  DUSK,
  GATE_BANNER,
  type GraveShared,
  MORALE_BOARD,
  moraleWord,
  NIGHTFALL,
  type SurvivalDef,
} from '@office-fps/shared'
import * as THREE from 'three'
import type { AudioEngine } from '../audio/audio-engine.ts'
import { createLabel } from './labels.ts'
import { ProjectsView } from './projects-view.ts'

/** The red a Red Night's sky goes. */
export const RED_SKY = new THREE.Color(0x6a0c08)
/** Graves and Haven's things are drawn this close (m). */
const SHOW = 160

/** How red the sky is (0–1) on a Red Night at clock time `t`: rising through dusk, full by night. */
export function redness(red: CampShared['red'], t: number): number {
  if (!red || red === 'eve') return 0
  const u = ((t % 1) + 1) % 1
  if (u >= DUSK && u < NIGHTFALL) return 0.35 + (0.65 * (u - DUSK)) / (NIGHTFALL - DUSK)
  if (u >= NIGHTFALL || u < DAWN) return 1
  return 0
}

const box = (w: number, h: number, d: number, color: number, emissive = 0) =>
  new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color, ...(emissive ? { emissive } : {}) }),
  )

/** A box standing on the ground at (x, z), its bottom at `y`. */
const put = (g: THREE.Object3D, m: THREE.Mesh, x: number, y: number, z: number) => {
  const h = (m.geometry as THREE.BoxGeometry).parameters.height
  m.position.set(x, y + h / 2, z)
  g.add(m)
  return m
}

/**
 * Haven as the world keeps it (shared/survival/camp.ts): the tally banner over the gate, the
 * morale board's chalk, the stalls and lamps Red Nights won (and the stall boarded up after one
 * lost), graves with crosses and names, the taken lying shrouded by the fire, and the sky going
 * red on a Red Night. All blocky boxes and pixel text.
 */
export class CampView {
  readonly root = new THREE.Group()
  private readonly audio: AudioEngine
  private readonly origin: THREE.Vector3
  private camp: CampShared | null = null
  private readonly banner: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture }
  private readonly board: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture }
  private bannerKey = ''
  private boardKey = ''
  private readonly levels: THREE.Group[] = []
  private readonly shut = new THREE.Group()
  private readonly graves = new Map<number, THREE.Group>()
  private readonly graveRoot = new THREE.Group()
  private readonly shrouds = new THREE.Group()
  private shroudKey = ''
  private lastRed: CampShared['red'] | 'none' | null = null
  /** Haven's community projects (projects-view.ts). */
  private readonly projects: ProjectsView

  constructor(def: SurvivalDef, audio: AudioEngine) {
    this.audio = audio
    const haven = def.pois.find((p) => p.key === 'haven')
    this.origin = new THREE.Vector3(haven?.x ?? 0, haven?.y ?? 0, haven?.z ?? 0)
    this.root.name = 'camp-view'
    this.root.position.copy(this.origin)
    this.banner = this.canvas(48, 72)
    this.board = this.canvas(128, 84)

    // The banner: dark red cloth hanging from its pole, facing into the camp.
    const [gx, gz] = GATE_BANNER
    const cloth = new THREE.Mesh(
      new THREE.PlaneGeometry(1.2, 1.8),
      new THREE.MeshLambertMaterial({
        map: this.banner.tex,
        emissive: 0x2a1410,
        emissiveMap: this.banner.tex,
        side: THREE.DoubleSide,
      }),
    )
    cloth.position.set(gx, 3.2 - 0.9, gz + 0.16)
    this.root.add(cloth)

    // The morale board's chalk, on the plank facing the gate road (east).
    const [bx, bz] = MORALE_BOARD
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

    this.projects = new ProjectsView(def, this.origin)
    this.root.add(this.projects.root)
    this.buildLevels()
    this.buildShut()
    this.root.add(this.shut, this.shrouds)
    // Graves can be anywhere: they hang off the scene's origin, not Haven's.
    this.graveRoot.name = 'graves'
  }

  /** Adds Haven's things and the graves to the scene. */
  addTo(scene: THREE.Scene): void {
    scene.add(this.root, this.graveRoot)
  }

  private canvas(w: number, h: number): { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture } {
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

  /** Won by holding Red Nights: a stall by the square, lamps up the gate road, another stall. */
  private buildLevels(): void {
    const stall = (x: number, z: number, cloth: number, wares: number[]) => {
      const g = new THREE.Group()
      put(g, box(3, 0.9, 0.7, 0x6b4a2e), x, 0, z)
      for (const [px, pz] of [
        [-1.4, -0.3],
        [1.4, -0.3],
        [-1.4, 0.3],
        [1.4, 0.3],
      ] as const)
        put(g, box(0.1, 2.3, 0.1, 0x4a3420), x + px, 0, z + pz)
      const roof = put(g, box(3.4, 0.06, 1.6, cloth), x, 2.25, z)
      roof.rotation.x = -0.12
      wares.forEach((c, i) => {
        put(g, box(0.6, 0.12, 0.4, c), x - 0.9 + i * 0.9, 0.9, z)
      })
      put(g, box(0.6, 0.6, 0.6, 0x7a5a36), x - 0.8, 0, z - 1.2)
      // A lantern hung under the canvas, glowing.
      put(g, box(0.14, 0.18, 0.14, 0xffc070, 0xff9a40), x, 1.85, z + 0.4)
      return g
    }
    const one = stall(14.8, -13, 0x8a3a2a, [0xc8a050, 0x6a7a4a, 0xa05a3a])
    const two = new THREE.Group()
    for (const z of [-22, -16, -10]) {
      put(two, box(0.12, 2.6, 0.12, 0x4a3420), 3.7, 0, z)
      put(two, box(0.2, 0.24, 0.2, 0xffd090, 0xffb060), 3.7, 2.6, z)
    }
    const light = new THREE.PointLight(0xffb070, 6, 12, 1.6)
    light.position.set(3.7, 2.7, -16)
    two.add(light)
    const three = stall(14.8, -17.2, 0x3a5a6a, [0x8a8e94, 0xd0c8a8, 0x5a6a3a])
    for (const g of [one, two, three]) {
      g.visible = false
      this.levels.push(g)
      this.root.add(g)
    }
  }

  /** After a lost Red Night: planks nailed across the front of the cloth-seller's stall. */
  private buildShut(): void {
    const x = 10.8
    const z = -13 + 0.55
    for (const [y, tilt] of [
      [0.35, 0.18],
      [0.85, -0.12],
      [1.35, 0.15],
      [1.8, -0.08],
    ] as const) {
      const plank = box(3.2, 0.2, 0.05, 0x8a6a44)
      plank.position.set(x, y, z)
      plank.rotation.z = tilt
      this.shut.add(plank)
    }
    this.shut.visible = false
  }

  apply(camp: CampShared | undefined): void {
    this.camp = camp ?? null
    if (!camp) return
    this.levels.forEach((g, i) => {
      g.visible = camp.level > i
    })
    this.shut.visible = camp.shut === true
    this.drawBanner(camp)
    this.drawBoard(camp)
    this.syncGraves(camp.graves)
    this.syncShrouds(camp)
    this.projects.apply(camp.projects)
    // The horn as the sky starts to go red (not when you join halfway through).
    if (camp.red === 'dusk' && this.lastRed !== null && this.lastRed !== 'dusk')
      this.audio.play('horn', { volume: 0.9 })
    this.lastRed = camp.red ?? 'none'
  }

  private drawBanner(c: CampShared): void {
    const key = `${c.wins}|${c.losses}`
    if (key === this.bannerKey) return
    this.bannerKey = key
    const { canvas, tex } = this.banner
    const g = canvas.getContext('2d')
    if (!g) return
    g.fillStyle = '#5a1612'
    g.fillRect(0, 0, canvas.width, canvas.height)
    g.fillStyle = '#3a0c0a'
    g.fillRect(0, canvas.height - 6, canvas.width, 6)
    g.fillStyle = '#e8dcc0'
    g.font = 'bold 8px monospace'
    g.textAlign = 'center'
    g.fillText('HELD', canvas.width / 2, 11)
    // Chalk tallies, five to a gate.
    const marks = Math.min(c.wins, 30)
    for (let i = 0; i < marks; i++) {
      const group = Math.floor(i / 5)
      const k = i % 5
      const gx = 6 + (group % 2) * 20
      const gy = 18 + Math.floor(group / 2) * 14
      if (k < 4) g.fillRect(gx + k * 4, gy, 2, 10)
      else {
        g.save()
        g.translate(gx - 1, gy + 8)
        g.rotate(-0.5)
        g.fillRect(0, 0, 18, 2)
        g.restore()
      }
    }
    if (c.wins === 0) g.fillText('—', canvas.width / 2, 34)
    tex.needsUpdate = true
  }

  private drawBoard(c: CampShared): void {
    const key = `${c.morale}|${c.redIn}|${c.red}|${c.wins}|${c.losses}|${c.gone.length}|${c.day}`
    if (key === this.boardKey) return
    this.boardKey = key
    const { canvas, tex } = this.board
    const g = canvas.getContext('2d')
    if (!g) return
    g.fillStyle = '#23282a'
    g.fillRect(0, 0, canvas.width, canvas.height)
    g.fillStyle = '#e4e0d4'
    g.font = 'bold 8px monospace'
    g.fillText(`DAY ${c.day + 1}`, 4, 10)
    g.fillText(`SPIRITS: ${moraleWord(c.morale).toUpperCase()}`, 4, 22)
    // The bar, in chalk: filled as far as morale goes.
    g.strokeStyle = '#e4e0d4'
    g.strokeRect(4.5, 26.5, 119, 9)
    g.fillStyle = c.morale < 25 ? '#c85a4a' : c.morale >= 70 ? '#a8c890' : '#d8c890'
    g.fillRect(6, 28, Math.round((116 * c.morale) / 100), 6)
    g.fillStyle = '#e4e0d4'
    g.fillText(`HELD ${c.wins}   LOST ${c.losses}`, 4, 48)
    g.fillStyle = c.red ? '#e8705a' : '#e4e0d4'
    const red =
      c.red === 'night'
        ? 'RED NIGHT: NOW'
        : c.redIn === 0
          ? 'RED NIGHT: TONIGHT'
          : c.redIn === 1
            ? 'RED NIGHT: TOMORROW'
            : `RED NIGHT IN ${c.redIn} DAYS`
    g.fillText(red, 4, 62)
    g.fillStyle = '#b8b4a8'
    if (c.gone.length > 0) g.fillText(`GONE: ${c.gone.slice(-3).join(', ')}`, 4, 76)
    tex.needsUpdate = true
  }

  /** A mound of earth, a cross of two sticks at its head, and the name. */
  private syncGraves(graves: readonly GraveShared[]): void {
    const want = new Set(graves.map((g) => g.id))
    for (const [id, g] of this.graves) {
      if (want.has(id)) continue
      this.graveRoot.remove(g)
      this.graves.delete(id)
    }
    for (const gr of graves) {
      if (this.graves.has(gr.id)) continue
      const g = new THREE.Group()
      g.position.set(gr.x, gr.y, gr.z)
      g.rotation.y = gr.yaw
      put(g, box(0.9, 0.22, 1.8, 0x4a3a2a), 0, -0.02, 0)
      put(g, box(0.7, 0.1, 1.5, 0x5a4632), 0, 0.18, 0)
      // The cross, at the end away from whoever dug it.
      put(g, box(0.08, 1, 0.08, 0x7a5a3a), 0, 0, 1)
      put(g, box(0.5, 0.08, 0.08, 0x7a5a3a), 0, 0.65, 1)
      const label = createLabel(gr.name)
      label.position.set(0, 1.35, 1)
      g.add(label)
      this.graves.set(gr.id, g)
      this.graveRoot.add(g)
    }
  }

  /** The taken, lying shrouded by the fire till somebody buries them (only in Haven). */
  private syncShrouds(c: CampShared): void {
    const inside = (c.remains ?? []).filter(
      (r) => r.name && Math.hypot(r.x - this.origin.x, r.z - this.origin.z) < 30,
    )
    const key = inside.map((r) => `${r.name}@${r.x},${r.z}`).join('|')
    if (key === this.shroudKey) return
    this.shroudKey = key
    this.shrouds.clear()
    for (const r of inside) {
      const body = box(0.5, 0.26, 1.75, 0xb8b0a0)
      body.position.set(r.x - this.origin.x, 0.13, r.z - this.origin.z)
      this.shrouds.add(body)
    }
  }

  /** Every frame: only drawn when near enough to see. */
  update(eye: THREE.Vector3): void {
    this.root.visible = Math.hypot(eye.x - this.origin.x, eye.z - this.origin.z) < SHOW + 60
    for (const g of this.graves.values())
      g.visible = Math.hypot(eye.x - g.position.x, eye.z - g.position.z) < SHOW
  }

  /** How red the sky should be now. */
  redness(time: number): number {
    return redness(this.camp?.red, time)
  }

  /**
   * What E does here with a shovel (the server's camp.dig): a body or a grave within reach.
   * `first` asks only what crouching with a shovel takes before anything else.
   */
  prompt(
    pos: { x: number; z: number },
    crouched: boolean,
    shovel: boolean,
    first: boolean,
  ): string | null {
    const c = this.camp
    if (!c) return null
    const d = (o: { x: number; z: number }) => Math.hypot(o.x - pos.x, o.z - pos.z)
    const body = (c.remains ?? []).filter((r) => d(r) < DIG_REACH).sort((a, b) => d(a) - d(b))[0]
    const grave = c.graves.find((g) => d(g) < DIG_REACH)
    const digs = crouched && shovel
    if (first !== digs) return null
    if (body) {
      const who = body.name || 'this one'
      if (digs) return `Bury ${who}`
      return shovel
        ? `Crouch + E: bury ${who}`
        : `${body.name || 'Somebody'} lies here. A shovel would do.`
    }
    if (grave) {
      if (digs)
        return grave.stash
          ? `Dig at ${grave.name}'s grave`
          : `Bury your latest find with ${grave.name}`
      return `${grave.name} rests here`
    }
    return null
  }

  clear(): void {
    this.apply(undefined)
    this.projects.apply(undefined)
    for (const g of this.graves.values()) this.graveRoot.remove(g)
    this.graves.clear()
    this.shrouds.clear()
    this.shroudKey = ''
    this.lastRed = null
  }
}
