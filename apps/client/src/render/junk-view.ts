import {
  HOOP_BOARD,
  HOOP_HEIGHT,
  hoopAt,
  type JunkKind,
  type JunkSpot,
  junkSpots,
  type SocialEvent,
  type SurvivalDef,
  unpackJunk,
} from '@office-fps/shared'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { AudioEngine } from '../audio/audio-engine.ts'

/**
 * Kickable junk, drawn (shared junk.ts has the rules, the server's junk.ts decides where things
 * land): tin cans, bottles, buckets and tyres as little blocky boxes, one instanced mesh a kind.
 * A kick plays as a tumbling hop or two along the ground to where the server says it lands; at
 * rest each piece sits where the shared state has it. And the tally chalked by Haven's barrel.
 */

type Kick = Extract<SocialEvent, { kind: 'junk' }>

/** A box of `w × h × d` standing on y = 0 at (x, z), in one colour (vertex colours). */
function part(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed()
  g.translate(x, y + h / 2, z)
  const c = new THREE.Color(color)
  const n = g.getAttribute('position').count
  const colors = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3)
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return g
}

/** Each kind's look, standing up, its middle at the origin's height `mid` (for tumbling). */
function lookOf(kind: JunkKind): { geometry: THREE.BufferGeometry; mid: number } {
  const parts: THREE.BufferGeometry[] = []
  let mid = 0.06
  if (kind === 'can') {
    parts.push(part(0.1, 0.12, 0.1, 0x8d9296), part(0.104, 0.06, 0.104, 0x9a3324, 0, 0.03))
  } else if (kind === 'bottle') {
    parts.push(part(0.07, 0.17, 0.07, 0x3b5a2c), part(0.03, 0.08, 0.03, 0x3b5a2c, 0, 0.17))
    mid = 0.12
  } else if (kind === 'bucket') {
    parts.push(
      part(0.26, 0.28, 0.26, 0x5d6b73),
      part(0.3, 0.03, 0.3, 0x48545b, 0, 0.27),
      part(0.02, 0.12, 0.02, 0x2c3236, -0.14, 0.28),
      part(0.02, 0.12, 0.02, 0x2c3236, 0.14, 0.28),
      part(0.3, 0.02, 0.02, 0x2c3236, 0, 0.39),
    )
    mid = 0.15
  } else {
    // A tyre lying flat: four blocky sides round a hole.
    for (const [x, z, w, d] of [
      [0, -0.24, 0.64, 0.16],
      [0, 0.24, 0.64, 0.16],
      [-0.24, 0, 0.16, 0.32],
      [0.24, 0, 0.16, 0.32],
    ] as const) {
      parts.push(part(w, 0.2, d, 0x1d1d1f, x, 0, z))
    }
    mid = 0.1
  }
  const geometry = mergeGeometries(parts)
  for (const p of parts) p.dispose()
  geometry.translate(0, -mid, 0)
  return { geometry, mid }
}

interface Piece {
  spot: JunkSpot
  mesh: THREE.InstancedMesh
  slot: number
  mid: number
  x: number
  z: number
  /** Lying on its side (after a kick) or standing (where it belongs). */
  fallen: boolean
  /** Resting turn about the vertical. */
  yaw: number
  fly: {
    x0: number
    z0: number
    x1: number
    z1: number
    t0: number
    t: number
    hoop: boolean
  } | null
  /** In the barrel: not drawn until it's home again. */
  sunk: boolean
}

const KINDS: readonly JunkKind[] = ['can', 'bottle', 'bucket', 'tyre']
const m = new THREE.Matrix4()
const q = new THREE.Quaternion()
const e = new THREE.Euler()
const pos = new THREE.Vector3()
const ONE = new THREE.Vector3(1, 1, 1)
const HIDDEN = new THREE.Vector3(0, 0, 0)

export class JunkView {
  readonly root = new THREE.Group()
  private readonly pieces: Piece[] = []
  private readonly audio: AudioEngine
  private readonly hoop: { x: number; y: number; z: number } | null
  private readonly board: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture } | null = null
  private tally = -1

  constructor(def: SurvivalDef, audio: AudioEngine) {
    this.audio = audio
    this.root.name = 'junk'
    const spots = junkSpots(def.pois)
    const material = new THREE.MeshLambertMaterial({ vertexColors: true })
    for (const kind of KINDS) {
      const mine = spots.filter((s) => s.kind === kind)
      if (mine.length === 0) continue
      const look = lookOf(kind)
      const mesh = new THREE.InstancedMesh(look.geometry, material, mine.length)
      mesh.castShadow = true
      mesh.receiveShadow = true
      // Spread over the whole forest: the bounding sphere would cover it all anyway.
      mesh.frustumCulled = false
      mine.forEach((spot, slot) => {
        this.pieces[spot.i] = {
          spot,
          mesh,
          slot,
          mid: look.mid,
          x: spot.x,
          z: spot.z,
          fallen: false,
          yaw: (spot.i * 2.39996) % (Math.PI * 2),
          fly: null,
          sunk: false,
        }
      })
      this.root.add(mesh)
    }
    for (const p of this.pieces) this.place(p, 0)
    this.hoop = hoopAt(def.pois)
    const haven = def.pois.find((p) => p.key === 'haven')
    if (haven) {
      // The chalkboard beside the barrel: tally marks in fives.
      const canvas = document.createElement('canvas')
      canvas.width = 48
      canvas.height = 32
      const tex = new THREE.CanvasTexture(canvas)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.magFilter = THREE.NearestFilter
      tex.minFilter = THREE.NearestFilter
      tex.generateMipmaps = false
      this.board = { canvas, tex }
      const face = new THREE.Mesh(
        new THREE.PlaneGeometry(0.58, 0.4),
        new THREE.MeshLambertMaterial({ map: tex }),
      )
      const [bx, bz] = HOOP_BOARD
      face.position.set(haven.x + bx - 0.075, haven.y + 1.22, haven.z + bz)
      face.rotation.y = -Math.PI / 2
      this.root.add(face)
      this.setTally(0)
    }
  }

  /** Somebody kicked something (the server says where it lands). */
  onKick(k: Kick, nowMs: number): void {
    const p = this.pieces[k.i]
    if (!p) return
    p.fly = { x0: p.x, z0: p.z, x1: k.x, z1: k.z, t0: nowMs, t: k.t * 1000, hoop: !!k.hoop }
    p.sunk = false
    const at = { x: p.x, y: p.spot.y + 0.2, z: p.z }
    const tin = p.spot.kind === 'can' || p.spot.kind === 'bucket'
    this.audio.play('impact.world', { at, volume: 0.5, rate: tin ? 1.5 : 0.8 })
  }

  /** The world's shared state: where everything lies, and the barrel's tally. */
  setShared(packed: number[] | undefined, tally: number | undefined): void {
    const moved = unpackJunk(packed)
    for (const p of this.pieces) {
      if (!p || p.fly) continue
      const to = moved.get(p.spot.i) ?? p.spot
      if (Math.abs(to.x - p.x) < 0.05 && Math.abs(to.z - p.z) < 0.05 && !p.sunk) continue
      p.x = to.x
      p.z = to.z
      p.sunk = false
      p.fallen = moved.has(p.spot.i)
      this.place(p, 0)
    }
    this.setTally(tally ?? 0)
  }

  update(nowMs: number): void {
    for (const p of this.pieces) {
      if (!p?.fly) continue
      const f = p.fly
      const u = Math.min(1, (nowMs - f.t0) / Math.max(1, f.t))
      if (u >= 1) {
        p.fly = null
        p.x = f.x1
        p.z = f.z1
        p.fallen = true
        p.sunk = f.hoop
        this.place(p, 0)
        this.landed(p, f.hoop)
        continue
      }
      p.x = f.x0 + (f.x1 - f.x0) * u
      p.z = f.z0 + (f.z1 - f.z0) * u
      const d = Math.hypot(f.x1 - f.x0, f.z1 - f.z0)
      let h: number
      if (f.hoop && this.hoop) {
        // One high arc that drops in over the rim.
        h = ((HOOP_HEIGHT + 0.6) * Math.sin(u * Math.PI * 0.62)) / Math.sin(Math.PI * 0.62)
        h = Math.max(h, u > 0.5 ? HOOP_HEIGHT * 0.6 : 0)
      } else {
        // A hop and a smaller one, then a skid.
        const peak = Math.min(1.4, 0.15 + d * 0.12)
        h =
          u < 0.65
            ? peak * Math.sin((u / 0.65) * Math.PI)
            : peak * 0.3 * Math.sin(((u - 0.65) / 0.35) * Math.PI)
      }
      this.place(p, Math.max(0, h), u * (6 + d * 2))
    }
  }

  private landed(p: Piece, hoop: boolean): void {
    const at = { x: p.x, y: p.spot.y + 0.1, z: p.z }
    if (hoop) {
      this.audio.play('bang', { at, volume: 0.7, rate: 1.6 })
      this.audio.play('impact.world', { at, volume: 0.6, rate: 0.6, delay: 0.08 })
    } else if (p.spot.kind === 'can' || p.spot.kind === 'bucket') {
      this.audio.play('casing', { at, volume: 0.8, rate: 0.55 })
    } else this.audio.play('impact.world', { at, volume: 0.4, rate: 0.9 })
  }

  /** Writes piece `p`'s matrix: on the ground (or `lift` m above it), turning `spin` radians. */
  private place(p: Piece, lift: number, spin = 0): void {
    if (p.sunk) {
      m.compose(pos.set(p.x, p.spot.y - 5, p.z), q.identity(), HIDDEN)
    } else {
      const lying = p.fallen && p.spot.kind !== 'tyre'
      // Lying down, its middle is as high as it is wide; standing, its own middle.
      const r = p.mid
      const rest = lying ? Math.min(r, 0.06 + (p.spot.kind === 'bucket' ? 0.08 : 0)) : r
      e.set(lying ? Math.PI / 2 + spin : spin * 0.7, p.yaw + spin * 0.3, 0, 'YXZ')
      q.setFromEuler(e)
      m.compose(pos.set(p.x, p.spot.y + rest + lift, p.z), q, ONE)
    }
    p.mesh.setMatrixAt(p.slot, m)
    p.mesh.instanceMatrix.needsUpdate = true
  }

  private setTally(n: number): void {
    if (!this.board || n === this.tally) return
    this.tally = n
    const { canvas, tex } = this.board
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#1e2420'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#d8d6c8'
    // Fives: four strokes and one across, up to what fits; then the number.
    const shown = Math.min(n, 20)
    for (let i = 0; i < shown; i++) {
      const group = Math.floor(i / 5)
      const gx = 3 + (group % 2) * 22
      const gy = 3 + Math.floor(group / 2) * 14
      const k = i % 5
      if (k < 4) ctx.fillRect(gx + k * 4, gy, 1, 10)
      else for (let s = 0; s < 16; s++) ctx.fillRect(gx - 1 + s, gy + 8 - Math.floor(s / 2), 1, 1)
    }
    if (n > 20) {
      ctx.font = '8px monospace'
      ctx.fillText(String(n), 30, 30)
    }
    tex.needsUpdate = true
  }
}
