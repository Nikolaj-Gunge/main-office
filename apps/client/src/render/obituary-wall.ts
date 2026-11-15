import {
  type Interactable,
  type ObitWall,
  pileSize,
  portraitColours,
  seeded,
  survivedText,
  WALL_NAMES,
} from '@office-fps/shared'
import * as THREE from 'three'

/** The names board, in metres (structures: places-haven.ts obituaryWall). */
const BOARD_W = 3.3
const BOARD_H = 1.65
/** Its face, out from the wall's interactable towards the reader (−x), and up from it. */
const FACE_OUT = 0.05
const FACE_UP = 0.1
/** The interactable sits this high above the ground. */
const PROMPT_UP = 1.3

const PETALS = [0xc8b8a0, 0xb04a3a, 0xd8b048, 0x8a6aa8, 0xe0d8cc, 0xc87a50]
const MAX_FLOWERS = 48

/**
 * Haven's obituary wall (ROADMAP 4.5): the names of the world's recent dead painted on a board,
 * each with a little blocky portrait, how long they lasted, their kills and how they went, and a
 * pile of blocky flowers at its foot that grows as people leave them.
 */
export class ObituaryView {
  readonly root = new THREE.Group()
  private readonly canvas = document.createElement('canvas')
  private readonly texture: THREE.CanvasTexture
  private readonly flowers: THREE.InstancedMesh
  private readonly at: THREE.Vector3 | null
  private shown = ''

  constructor(interactables: readonly Interactable[]) {
    this.root.name = 'obituary-wall'
    const spot = interactables.find((i) => i.kind === 'obituary')
    this.at = spot ? new THREE.Vector3(...spot.pos) : null
    this.canvas.width = 1024
    this.canvas.height = 512
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.anisotropy = 4
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(BOARD_W, BOARD_H),
      // A touch self-lit, so the names read by the lantern at night.
      new THREE.MeshLambertMaterial({
        map: this.texture,
        emissiveMap: this.texture,
        emissive: 0x2a2a2a,
      }),
    )
    board.receiveShadow = true
    // The flowers: a stem and a head each (instances 2i and 2i + 1).
    this.flowers = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial(),
      MAX_FLOWERS * 2,
    )
    this.flowers.count = 0
    this.flowers.castShadow = false
    this.flowers.frustumCulled = false
    if (this.at) {
      board.position.set(this.at.x - FACE_OUT, this.at.y + FACE_UP, this.at.z)
      board.rotation.y = -Math.PI / 2
      this.root.add(board, this.flowers)
    }
    this.set({ dead: [], flowers: 0 })
  }

  /** Draws the wall as the server has it (only redraws when it changed). */
  set(wall: ObitWall): void {
    const key = JSON.stringify(wall)
    if (key === this.shown) return
    this.shown = key
    this.paint(wall)
    this.pile(wall.flowers)
  }

  private paint(wall: ObitWall): void {
    const g = this.canvas.getContext('2d')
    if (!g) return
    const W = this.canvas.width
    const H = this.canvas.height
    // Weathered boards: dark planks with seams.
    g.fillStyle = '#2b2119'
    g.fillRect(0, 0, W, H)
    for (let y = 0; y < H; y += 64) {
      g.fillStyle = (y / 64) % 2 ? '#30251c' : '#2a2018'
      g.fillRect(0, y, W, 62)
      g.fillStyle = '#1a130e'
      g.fillRect(0, y + 62, W, 2)
    }
    g.fillStyle = '#d8ccb4'
    g.font = 'bold 34px monospace'
    g.textAlign = 'center'
    g.fillText('THEY WERE HERE', W / 2, 44)
    g.textAlign = 'left'
    if (wall.dead.length === 0) {
      g.fillStyle = '#a89a84'
      g.font = '26px monospace'
      g.textAlign = 'center'
      g.fillText('No names yet.', W / 2, H / 2)
      g.textAlign = 'left'
      this.texture.needsUpdate = true
      return
    }
    // Two columns of five.
    const rows = Math.ceil(WALL_NAMES / 2)
    const rowH = (H - 70) / rows
    wall.dead.slice(0, WALL_NAMES).forEach((d, i) => {
      const x = 22 + Math.floor(i / rows) * (W / 2)
      const y = 64 + (i % rows) * rowH
      // Portrait: a blocky head (hair over skin) on dark shoulders.
      const c = portraitColours(d.look)
      g.fillStyle = '#4a4038'
      g.fillRect(x, y + 50, 52, 22)
      g.fillStyle = c.skin
      g.fillRect(x + 10, y + 10, 32, 38)
      g.fillStyle = c.hair
      g.fillRect(x + 8, y + 4, 36, 12)
      g.fillStyle = '#1a1410'
      g.fillRect(x + 17, y + 26, 5, 5)
      g.fillRect(x + 30, y + 26, 5, 5)
      g.fillStyle = '#e8dcc4'
      g.font = 'bold 26px monospace'
      g.fillText(d.name, x + 66, y + 26, W / 2 - 100)
      g.fillStyle = '#b4a690'
      g.font = '19px monospace'
      const kills = `${d.kills} kill${d.kills === 1 ? '' : 's'}`
      g.fillText(`${survivedText(d.alive)} · ${kills}`, x + 66, y + 50, W / 2 - 100)
      g.fillStyle = '#9a8670'
      g.font = 'italic 18px monospace'
      const flowers = d.flowers > 0 ? `  ✿${d.flowers}` : ''
      g.fillText(`${d.cause}${flowers}`, x + 66, y + 72, W / 2 - 100)
    })
    this.texture.needsUpdate = true
  }

  /** The pile at the wall's foot: more flowers, a bigger pile (seeded: same for everyone). */
  private pile(total: number): void {
    if (!this.at) return
    const n = pileSize(total)
    const r = seeded(0xf10e)
    const m = new THREE.Matrix4()
    const colour = new THREE.Color()
    const groundY = this.at.y - PROMPT_UP
    for (let i = 0; i < n; i++) {
      const along = (r() - 0.5) * BOARD_W * Math.min(1, 0.35 + i / 30)
      const out = 0.2 + r() * (0.25 + Math.min(0.5, i / 60))
      const x = this.at.x - FACE_OUT - out
      const z = this.at.z + along
      const tall = 0.12 + r() * 0.18
      const lean = (r() - 0.5) * 0.5
      m.makeRotationZ(lean).setPosition(x, groundY + tall / 2, z)
      m.scale(new THREE.Vector3(0.025, tall, 0.025))
      this.flowers.setMatrixAt(i * 2, m)
      this.flowers.setColorAt(i * 2, colour.setHex(0x4a6a34))
      m.makeRotationY(r() * Math.PI).setPosition(x - Math.sin(lean) * tall, groundY + tall, z)
      m.scale(new THREE.Vector3(0.08, 0.06, 0.08))
      this.flowers.setMatrixAt(i * 2 + 1, m)
      this.flowers.setColorAt(i * 2 + 1, colour.setHex(PETALS[i % PETALS.length] as number))
    }
    this.flowers.count = n * 2
    this.flowers.instanceMatrix.needsUpdate = true
    if (this.flowers.instanceColor) this.flowers.instanceColor.needsUpdate = true
  }
}
