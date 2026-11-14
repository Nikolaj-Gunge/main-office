import {
  CarPart,
  carFixFor,
  carToWorld,
  carTrouble,
  carTune,
  cloneVehicleState,
  type DriveTune,
  distanceToCar,
  Engine,
  FUEL_SPUTTER,
  forwardSpeed,
  type InputCommand,
  type PhysicsWorld,
  PLAYER_QUERY_GROUPS,
  RAPIER,
  SEATS,
  stepVehicle,
  type Terrain,
  TICK_DT,
  VehicleBody,
  type VehicleNet,
  type VehicleState,
} from '@office-fps/shared'
import * as THREE from 'three'
import type { AmbientLoop, AudioEngine } from '../audio/audio-engine.ts'
import { distanceLowpass, falloff } from '../audio/mixing.ts'
import { type CarPose, CarView, HEADLAMP } from '../render/vehicle-view.ts'

/** The server's reach for getting into a car, and for working on one (m from its body). */
const ENTER_REACH = 1.7
const WORK_REACH = 2.2
/** Corrections bigger than this snap; smaller ones fade out over CORRECTION_SMOOTH_TIME (s). */
const SNAP_DISTANCE = 3
const CORRECTION_SMOOTH_TIME = 0.15
/** Unacknowledged inputs kept for replay (~2 s). */
const MAX_PENDING = 120
/** Chase camera: how far behind and how high it sits (m), and what it looks at. */
const CHASE_DISTANCE = 7
const CHASE_TARGET = 1.3
/** Headlamp beams lit at once (the nearest cars with someone at the wheel). */
const BEAMS = 2
/** Engines are heard this far (m). */
const ENGINE_RANGE = 70

interface Sample {
  tick: number
  net: VehicleNet
}

interface Car {
  id: number
  view: CarView
  body: VehicleBody
  samples: Sample[]
  latest: VehicleNet
  /** In the newest snapshot (else it's out of range: hidden). */
  present: boolean
  /** As drawn this frame. */
  pose: CarPose
  speed: number
  engine: AmbientLoop | null
}

/** The car you drive, predicted ahead of the server like your own feet are. */
interface Driven {
  id: number
  state: VehicleState
  prev: VehicleState
  pending: { seq: number; buttons: number }[]
  /** Visual-only offset hiding small corrections. */
  smooth: THREE.Vector3
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const lerpAngle = (a: number, b: number, t: number) => a + wrap(b - a) * t

/**
 * Survival's cars on the client: draws them where the server says (smoothly, a little in the
 * past like other players), predicts the one you drive, puts the camera behind it, keeps them
 * solid in your physics, runs their engines, headlamps and the speedometer.
 */
export class VehiclesClient {
  /** Where you sit (null on foot). */
  seat: { car: number; seat: number } | null = null
  /** V: from behind the car (default) or from the driver's seat. */
  firstPerson = false
  private readonly cars = new Map<number, Car>()
  private readonly scene: THREE.Scene
  private readonly physics: PhysicsWorld
  private readonly terrain: Terrain
  private readonly audio: AudioEngine
  private driven: Driven | null = null
  private readonly occupied = new Set<number>()
  private readonly beams: THREE.SpotLight[] = []
  private readonly hud: HTMLDivElement
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })
  private readonly carColliders = new Set<number>()
  private lastLook = { yaw: 0, pitch: 0 }
  private lookIdle = 0
  private crashedAt = 0

  constructor(o: {
    scene: THREE.Scene
    physics: PhysicsWorld
    terrain: Terrain
    audio: AudioEngine
    hudRoot: HTMLElement
  }) {
    this.scene = o.scene
    this.physics = o.physics
    this.terrain = o.terrain
    this.audio = o.audio
    for (let i = 0; i < BEAMS; i++) {
      const light = new THREE.SpotLight(HEADLAMP, 0, 70, 0.55, 0.5, 1)
      light.castShadow = false
      o.scene.add(light, light.target)
      this.beams.push(light)
    }
    this.hud = document.createElement('div')
    Object.assign(this.hud.style, {
      position: 'absolute',
      left: '50%',
      bottom: '84px',
      transform: 'translateX(-50%)',
      font: '16px "Pixelify Sans", monospace',
      color: '#e8e2d4',
      textShadow: '0 1px 2px #000',
      textAlign: 'center',
      pointerEvents: 'none',
      whiteSpace: 'pre',
      display: 'none',
    })
    o.hudRoot.appendChild(this.hud)
  }

  get seated(): boolean {
    return this.seat !== null
  }

  /** At the wheel of a car that still goes. */
  get driving(): boolean {
    return this.driven !== null
  }

  /** Is this player sitting in a car (so not drawn)? */
  isSeated(id: number): boolean {
    return this.occupied.has(id)
  }

  /** A snapshot's cars (`ackSeq`: your last input the server has used). */
  onSnapshot(tick: number, list: readonly VehicleNet[], ackSeq: number, myId: number): void {
    for (const car of this.cars.values()) car.present = false
    this.occupied.clear()
    this.seat = null
    let mine: VehicleNet | null = null
    for (const net of list) {
      let car = this.cars.get(net.id)
      if (!car) {
        const view = new CarView(net.look)
        this.scene.add(view.root)
        const body = new VehicleBody(this.physics, this.terrain)
        this.carColliders.add(body.collider.handle)
        car = {
          id: net.id,
          view,
          body,
          samples: [],
          latest: net,
          present: true,
          pose: { ...net.state },
          speed: 0,
          engine: null,
        }
        this.cars.set(net.id, car)
      }
      const last = car.samples[car.samples.length - 1]
      if (!last || tick > last.tick) car.samples.push({ tick, net })
      if (car.samples.length > 12) car.samples.shift()
      car.latest = net
      car.present = true
      net.seats.forEach((id, seat) => {
        if (id === 0) return
        this.occupied.add(id)
        if (id === myId) {
          this.seat = { car: net.id, seat }
          if (seat === 0 && !net.wrecked) mine = net
        }
      })
    }
    this.reconcile(mine, ackSeq)
    // Everyone else's car stands where the server last had it; yours where you predict it.
    for (const car of this.cars.values()) {
      if (this.driven?.id === car.id) car.body.place(this.driven.state)
      else if (car.present) car.body.place(car.latest.state)
      else car.body.place({ ...car.latest.state, y: -5000 })
      car.view.root.visible = car.present
    }
    this.physics.world.step()
  }

  /** Rewinds your car to the server's and replays what it hasn't seen yet. */
  private reconcile(net: VehicleNet | null, ackSeq: number): void {
    if (!net) {
      this.driven = null
      return
    }
    const car = this.cars.get(net.id)
    if (!car) return
    let d = this.driven
    if (!d || d.id !== net.id) {
      d = {
        id: net.id,
        state: cloneVehicleState(net.state),
        prev: cloneVehicleState(net.state),
        pending: [],
        smooth: new THREE.Vector3(),
      }
      this.driven = d
      return
    }
    while (d.pending.length > 0 && (d.pending[0]?.seq ?? 0) <= ackSeq) d.pending.shift()
    const before = d.state
    const state = cloneVehicleState(net.state)
    const tune = tuneOf(net)
    for (const p of d.pending) stepVehicle(state, p.buttons, TICK_DT, car.body, tune)
    d.state = state
    const cx = state.x - before.x
    const cy = state.y - before.y
    const cz = state.z - before.z
    if (Math.hypot(cx, cy, cz) > SNAP_DISTANCE) {
      d.prev = cloneVehicleState(state)
      d.smooth.set(0, 0, 0)
      return
    }
    d.prev.x += cx
    d.prev.y += cy
    d.prev.z += cz
    d.smooth.x -= cx
    d.smooth.y -= cy
    d.smooth.z -= cz
  }

  /** One predicted tick of your input (only does anything at the wheel). */
  predict(command: InputCommand): void {
    const d = this.driven
    const car = d ? this.cars.get(d.id) : undefined
    if (!d || !car) return
    d.prev = cloneVehicleState(d.state)
    const { impact } = stepVehicle(d.state, command.buttons, TICK_DT, car.body, tuneOf(car.latest))
    car.body.place(d.state)
    d.pending.push({ seq: command.seq, buttons: command.buttons })
    if (d.pending.length > MAX_PENDING) d.pending.shift()
    const now = performance.now()
    if (impact > 4 && now - this.crashedAt > 250) {
      this.crashedAt = now
      this.audio.play('bang', { volume: Math.min(1, impact / 14), rate: 0.7 })
    }
  }

  /**
   * Every frame: where each car is drawn, its lamps and engine. `alpha` is how far real time is
   * into the current tick (your own car), `renderTick` the moment others are drawn at.
   */
  update(dt: number, alpha: number, renderTick: number, night: number, eye: THREE.Vector3): void {
    const fade = Math.exp(-dt / CORRECTION_SMOOTH_TIME)
    const running: Car[] = []
    for (const car of this.cars.values()) {
      if (!car.present) {
        car.engine?.set(0)
        continue
      }
      const d = this.driven?.id === car.id ? this.driven : null
      if (d) {
        d.smooth.multiplyScalar(fade)
        const a = d.prev
        const b = d.state
        const l = (x: number, y: number) => x + (y - x) * alpha
        car.pose = {
          x: l(a.x, b.x) + d.smooth.x,
          y: l(a.y, b.y) + d.smooth.y,
          z: l(a.z, b.z) + d.smooth.z,
          yaw: lerpAngle(a.yaw, b.yaw, alpha),
          pitch: l(a.pitch, b.pitch),
          roll: l(a.roll, b.roll),
          steer: l(a.steer, b.steer),
        }
        car.speed = forwardSpeed(b)
      } else {
        const s = sample(car.samples, renderTick)
        car.pose = s
        car.speed = forwardSpeed(s as VehicleState)
      }
      const net = car.latest
      const runs = net.engine === Engine.Ok || net.engine === Engine.Sputter
      const on = net.seats[0] !== 0 && !net.wrecked && runs
      car.view.update(dt, car.pose, car.speed, on, night, net.health, net.wrecked, {
        sputter: on && net.engine === Engine.Sputter,
        flat: (net.needs & CarPart.Tyre) !== 0,
      })
      if (on) running.push(car)
      this.engineSound(car, on, eye)
    }
    // Headlamp beams for the nearest running cars, after dark.
    running.sort(
      (a, b) =>
        Math.hypot(a.pose.x - eye.x, a.pose.z - eye.z) -
        Math.hypot(b.pose.x - eye.x, b.pose.z - eye.z),
    )
    this.beams.forEach((light, i) => {
      const car = running[i]
      light.intensity = car && night > 0.05 ? 200 * night : 0
      if (!car || light.intensity === 0) return
      const p = car.pose
      const front = carToWorld(p as VehicleState, 0, -2.3)
      const ahead = carToWorld(p as VehicleState, 0, -18)
      light.position.set(front.x, p.y + 0.8 + Math.sin(p.pitch) * 2.3, front.z)
      light.target.position.set(ahead.x, p.y - 0.6 + Math.sin(p.pitch) * 18, ahead.z)
      light.target.updateMatrixWorld()
    })
    this.updateHud()
  }

  private engineSound(car: Car, on: boolean, eye: THREE.Vector3): void {
    const distance = Math.hypot(car.pose.x - eye.x, car.pose.y - eye.y, car.pose.z - eye.z)
    if (!on || distance > ENGINE_RANGE) {
      car.engine?.set(0, 20000, 0.3)
      return
    }
    car.engine ??= this.audio.loop('engine')
    if (!car.engine) return
    const mine = this.seat?.car === car.id
    const rev = Math.min(1, Math.abs(car.speed) / 25)
    // A worn engine idles rough; a dying one misses and catches.
    const t = performance.now() / 1000
    const rough = (1 - car.latest.top) * 0.5 * Math.sin(t * 37) * Math.sin(t * 5.3)
    const sputter = car.latest.engine === Engine.Sputter
    const miss = sputter && Math.sin(t * 11) * Math.sin(t * 3.7 + car.id) > 0.25
    car.engine.pitch((0.75 + rev * 1.5) * (1 + rough) * (miss ? 0.7 : 1))
    const volume =
      (mine ? 0.28 + rev * 0.12 : 0.45 * falloff(distance, 4, ENGINE_RANGE)) * (miss ? 0.25 : 1)
    car.engine.set(volume, mine ? 2400 : distanceLowpass(distance))
  }

  private updateHud(): void {
    const car = this.seat ? this.cars.get(this.seat.car) : undefined
    if (!car) {
      this.hud.style.display = 'none'
      return
    }
    this.hud.style.display = ''
    const net = car.latest
    const kmh = Math.round(Math.abs(car.speed) * 3.6)
    const health = Math.max(0, Math.round(net.health))
    const fuel = Math.round(net.fuel)
    const help = this.seat?.seat === 0 ? '\nW/S drive · A/D steer · Space handbrake · V view' : ''
    // The dashboard's warning, if any.
    const blink = Math.floor(performance.now() / 450) % 2 === 0
    let warn = ''
    if (net.engine === Engine.Dead) warn = carTrouble(net) ?? "Won't start"
    else if (net.engine === Engine.Stalled) warn = 'STALLED — let it cool, then hold W'
    else if (net.engine === Engine.Sputter)
      warn = blink ? (net.fuel < FUEL_SPUTTER ? '! FUEL EMPTY' : '! ENGINE HOT') : ''
    else if (net.fuel < 10) warn = 'LOW FUEL'
    if (net.engine !== Engine.Dead && net.needs & CarPart.Tyre) warn ||= 'FLAT TYRE'
    const worn = net.top < 0.9 ? '  ·  worn' : ''
    this.hud.textContent = `${kmh} km/h  ·  fuel ${fuel}%  ·  car ${health}%${worn}${
      warn ? `\n${warn}` : ''
    }${help}`
  }

  /**
   * Seated: puts the camera behind your car (or in your seat, V), returning true. The mouse
   * looks around; left alone, the view swings back behind the car.
   */
  camera(
    camera: THREE.PerspectiveCamera,
    look: { yaw: number; pitch: number },
    dt: number,
  ): boolean {
    const seat = this.seat
    const car = seat ? this.cars.get(seat.car) : undefined
    if (!seat || !car) return false
    const p = car.pose
    const moved =
      Math.abs(look.yaw - this.lastLook.yaw) > 1e-5 ||
      Math.abs(look.pitch - this.lastLook.pitch) > 1e-5
    this.lookIdle = moved ? 0 : this.lookIdle + dt
    if (this.lookIdle > 1.2 && Math.abs(car.speed) > 1.5) {
      // Behind the car (reversing: still behind it, looking where it goes would spin you round).
      look.yaw += wrap(p.yaw - look.yaw) * Math.min(1, dt * 2.5)
    }
    this.lastLook = { yaw: look.yaw, pitch: look.pitch }
    if (this.firstPerson) {
      const [lx, lz] = SEATS[seat.seat] as [number, number]
      const at = carToWorld(p as VehicleState, lx, lz)
      camera.position.set(at.x, p.y + 1.22, at.z)
      camera.rotation.set(look.pitch, look.yaw, 0, 'YXZ')
      return true
    }
    const target = new THREE.Vector3(p.x, p.y + CHASE_TARGET, p.z)
    const elevation = Math.max(0.06, Math.min(1.1, 0.26 - look.pitch * 0.8))
    const dir = new THREE.Vector3(
      Math.sin(look.yaw) * Math.cos(elevation),
      Math.sin(elevation),
      Math.cos(look.yaw) * Math.cos(elevation),
    )
    // Pull in where a tree or a wall is in the way (cars don't count: yours is right there).
    this.ray.origin = target
    this.ray.dir = dir
    const hit = this.physics.world.castRay(
      this.ray,
      CHASE_DISTANCE,
      true,
      undefined,
      PLAYER_QUERY_GROUPS,
      undefined,
      undefined,
      (c) => !this.carColliders.has(c.handle),
    )
    const distance = hit ? Math.max(1.2, hit.timeOfImpact - 0.3) : CHASE_DISTANCE
    camera.position.copy(target).addScaledVector(dir, distance)
    camera.rotation.set(-elevation * 0.85 + 0.04, look.yaw, 0, 'YXZ')
    return true
  }

  /**
   * What E does about cars here: get out, fix one with what you carry (`has`), drive, get in;
   * and what's known to be wrong with it. Null: no car in reach.
   */
  prompt(pos: { x: number; y: number; z: number }, has?: (item: string) => boolean): string | null {
    if (this.seat) return 'Get out'
    const nearest = (reach: number, free: boolean) => {
      let best: { car: Car; d: number } | null = null
      for (const car of this.cars.values()) {
        const net = car.latest
        if (!car.present || net.wrecked || (free && !net.seats.includes(0))) continue
        if (Math.abs(pos.y - net.state.y) > 2.5) continue
        const d = distanceToCar(net.state, pos.x, pos.z)
        if (d <= reach && (!best || d < best.d)) best = { car, d }
      }
      return best?.car ?? null
    }
    // The same choice the server makes: a car you can fix first, then one to get into.
    const work = nearest(WORK_REACH, false)
    if (work) {
      const net = work.latest
      const trouble = carTrouble(net)
      if (net.work > 0) return `Working… ${Math.round(net.work * 100)}% (keep holding)`
      const fix = has ? carFixFor(net, has) : null
      if (fix) return `${fix.label} (hold)${trouble ? `  ·  ${trouble}` : ''}`
    }
    const car = nearest(ENTER_REACH, true)
    if (!car) return null
    // Nobody at the wheel: the server puts you there.
    const what = car.latest.seats[0] === 0 ? 'Drive' : 'Get in'
    const trouble = carTrouble(car.latest)
    return trouble ? `${what}  ·  ${trouble}` : what
  }

  /** A new game: no cars until the server says. */
  clear(): void {
    for (const car of this.cars.values()) {
      this.scene.remove(car.view.root)
      car.view.dispose()
      car.body.free()
      car.engine?.set(0)
    }
    this.cars.clear()
    this.carColliders.clear()
    this.occupied.clear()
    this.seat = null
    this.driven = null
    this.hud.style.display = 'none'
  }
}

/** How a car drives, from what the server says of it. */
function tuneOf(net: VehicleNet): DriveTune {
  return carTune(net)
}

/** A car's pose at fractional server tick `t`, between the snapshots either side of it. */
function sample(samples: readonly Sample[], t: number): CarPose & Partial<VehicleState> {
  const first = samples[0]
  if (!first) return { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, steer: 0 }
  let a = first
  let b = first
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i] as Sample
    if (s.tick <= t) {
      a = s
      b = samples[i + 1] ?? s
      break
    }
  }
  const span = b.tick - a.tick
  // Past the newest: a little extrapolation, then hold.
  const k = span > 0 ? Math.min(1.2, Math.max(0, (t - a.tick) / span)) : 0
  const x = a.net.state
  const y = b.net.state
  const l = (p: number, q: number) => p + (q - p) * k
  return {
    x: l(x.x, y.x),
    y: l(x.y, y.y),
    z: l(x.z, y.z),
    yaw: lerpAngle(x.yaw, y.yaw, k),
    pitch: l(x.pitch, y.pitch),
    roll: l(x.roll, y.roll),
    steer: l(x.steer, y.steer),
    vx: l(x.vx, y.vx),
    vy: l(x.vy, y.vy),
    vz: l(x.vz, y.vz),
  }
}
