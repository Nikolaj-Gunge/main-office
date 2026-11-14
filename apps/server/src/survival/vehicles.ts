import {
  CAR_HALF_LENGTH,
  CAR_HALF_WIDTH,
  carSpots,
  carToWorld,
  createVehicleState,
  distanceToCar,
  forwardSpeed,
  type InputCommand,
  type Notice,
  SEAT_DROP,
  SEATS,
  type SurvivalDef,
  stepSeated,
  stepVehicle,
  syncForest,
  TICK_DT,
  TICK_RATE,
  VehicleBody,
  type VehicleNet,
  type VehicleState,
  ZombieKind,
} from '@office-fps/shared'
import type { Game, ServerPlayer } from '../game.ts'

/** The free seat whose door is nearest `pos` (−1 if the car is full). */
export function nearestFreeSeat(
  state: VehicleState,
  seats: readonly number[],
  pos: { x: number; z: number },
): number {
  let seat = -1
  let nearest = Number.POSITIVE_INFINITY
  seats.forEach((who, i) => {
    if (who !== 0) return
    const [lx, lz] = SEATS[i] as [number, number]
    const door = carToWorld(state, Math.sign(lx) * (CAR_HALF_WIDTH + 0.4), lz)
    const d = Math.hypot(door.x - pos.x, door.z - pos.z)
    if (d < nearest) {
      nearest = d
      seat = i
    }
  })
  return seat
}

/** Cars further than this from you aren't in your snapshots (m). */
const SEEN = 350
/** How close to a car you have to be to get in (m from its body). */
const ENTER_REACH = 1.7
const MAX_HEALTH = 100
/** Hitting something slower than this (m/s) doesn't hurt the car; faster costs this per m/s. */
const CRASH_SPEED = 6
const CRASH_DAMAGE = 2.5
/** Faster than this (m/s), the dead in the way are run down. */
const RUN_DOWN = 3.5
/** A wrecked car is towed back (a fresh one turns up where it was left) after this long… */
const WRECK_SECONDS = 150
/** …and one left somewhere else nobody is near, after this long. */
const ABANDON_SECONDS = 8 * 60
/** Nobody may be this close (m) to a car, or to where it goes back to, when it is put back. */
const UNSEEN = 70
/** Health a car loses per second for each of the dead clawing at it while someone is inside. */
const SCRATCH = 2.5

interface Car {
  id: number
  look: number
  home: VehicleState
  state: VehicleState
  body: VehicleBody
  health: number
  wrecked: boolean
  /** Player ids by seat (0 = empty): driver, front passenger, rear left, rear right. */
  seats: number[]
  /** Tick it was last sat in, or wrecked. */
  usedAt: number
  /** The dead it ran down lately (id → tick), so one body isn't hit every tick. */
  hits: Map<number, number>
  /** Its driver steered it this tick (it isn't rolled on by itself). */
  driven: boolean
}

export type Say = (player: ServerPlayer, kind: Notice['kind'], text: string) => void

/**
 * Survival's cars: a dozen parked by the roads, which anyone can get in (E), drive (WASD, space
 * for the handbrake) and get out of again. The driver's inputs move the car (the same step the
 * driver's client predicts), the dead in the way are run down, and a car that is knocked about
 * enough is wrecked and, in time, replaced.
 */
export class Vehicles {
  private readonly game: Game
  private readonly say: Say
  private cars: Car[] = []
  /** The physics world the cars' bodies live in (a new map frees it under us). */
  private physics: Game['world']['physics'] | null = null

  constructor(game: Game, say: Say) {
    this.game = game
    this.say = say
  }

  /** Parks every car where it was first left (a new game). */
  reset(def: SurvivalDef): void {
    this.dispose()
    const physics = this.game.world.physics
    this.physics = physics
    const spots = carSpots(def)
    // The trees around the spots, so no car is parked in one (they let go of them again later).
    syncForest(physics, spots)
    for (const spot of spots) {
      const body = new VehicleBody(physics, def.terrain)
      const state = this.park(body, spot)
      if (!state) {
        body.free()
        continue
      }
      body.place(state)
      physics.world.step()
      this.cars.push({
        id: this.cars.length + 1,
        look: spot.look,
        home: { ...state },
        state,
        body,
        health: MAX_HEALTH,
        wrecked: false,
        seats: [0, 0, 0, 0],
        usedAt: this.game.tick,
        hits: new Map(),
        driven: false,
      })
    }
  }

  /** Finds room for a car near `spot`: along the road a little, or further off the verge. */
  private park(body: VehicleBody, spot: ReturnType<typeof carSpots>[number]): VehicleState | null {
    for (const shift of [0, 6, -6, 12, -12, 18, -18, 26, -26, 34, -34, 42, -42]) {
      const x = spot.x + spot.along.x * shift
      const z = spot.z + spot.along.z * shift
      // The ground under it: the terrain, then whatever stands on it there (a yard, a kerb).
      const y = body.groundAt(x, z, body.groundAt(x, z, 1e4) + 2)
      if (body.fits(x, y + 0.05, z, spot.yaw)) return createVehicleState(x, y, z, spot.yaw)
    }
    return null
  }

  dispose(): void {
    // After a map change the old world (and every collider in it) is already gone.
    if (this.physics === this.game.world.physics) for (const car of this.cars) car.body.free()
    this.cars = []
    this.physics = null
  }

  /** The car and seat someone is in, or null. */
  seatOf(player: ServerPlayer): { car: Car; seat: number } | null {
    for (const car of this.cars) {
      const seat = car.seats.indexOf(player.id)
      if (seat >= 0) return { car, seat }
    }
    return null
  }

  /**
   * One input command of someone sitting in a car: the driver's moves the car. Returns false
   * for anyone on foot (the game moves them as usual).
   */
  ride(player: ServerPlayer, command: InputCommand): boolean {
    const at = this.seatOf(player)
    if (!at) return false
    const { car, seat } = at
    if (seat === 0 && !car.wrecked) {
      const { impact } = stepVehicle(car.state, command.buttons, TICK_DT, car.body)
      car.driven = true
      car.body.place(car.state)
      if (impact > CRASH_SPEED) this.damage(car, (impact - CRASH_SPEED) * CRASH_DAMAGE)
    }
    stepSeated(player.state, command)
    if (this.seatOf(player)) this.sit(player, car, seat)
    return true
  }

  /** E: get out if you're in a car, else into the nearest one in reach. True if E was used. */
  use(player: ServerPlayer): boolean {
    const at = this.seatOf(player)
    if (at) {
      this.getOut(player, at.car, at.seat)
      return true
    }
    const s = player.state
    let best: { car: Car; d: number } | null = null
    for (const car of this.cars) {
      if (car.wrecked || !car.seats.includes(0)) continue
      if (Math.abs(s.pos.y - car.state.y) > 2.5) continue
      const d = distanceToCar(car.state, s.pos.x, s.pos.z)
      if (d <= ENTER_REACH && (!best || d < best.d)) best = { car, d }
    }
    if (!best) return false
    const car = best.car
    // The wheel if nobody has it (alone, you want to drive); else the free door nearest you.
    const seat = car.seats[0] === 0 ? 0 : nearestFreeSeat(car.state, car.seats, s.pos)
    if (seat < 0) return false
    car.seats[seat] = player.id
    car.usedAt = this.game.tick
    s.vel = { x: 0, y: 0, z: 0 }
    s.crouched = false
    this.sit(player, car, seat)
    return true
  }

  /** Someone died or left: out of their seat, without being put anywhere. */
  leave(player: ServerPlayer): void {
    const at = this.seatOf(player)
    if (at) at.car.seats[at.seat] = 0
  }

  /** How far a car's engine is heard (m) if `player` sits in one that runs; else 0. */
  noiseOf(player: ServerPlayer): number {
    const at = this.seatOf(player)
    if (!at || at.car.wrecked || at.car.seats[0] === 0) return 0
    return Math.min(60, 26 + Math.abs(forwardSpeed(at.car.state)) * 1.4)
  }

  /** The cars `viewer` should know about: the ones near them (and the one they're in). */
  statesFor(viewer: ServerPlayer): VehicleNet[] {
    const out: VehicleNet[] = []
    const p = viewer.state.pos
    for (const car of this.cars) {
      const near = Math.hypot(car.state.x - p.x, car.state.z - p.z) < SEEN
      if (!near && !car.seats.includes(viewer.id)) continue
      out.push({
        id: car.id,
        look: car.look,
        health: car.health,
        wrecked: car.wrecked,
        seats: car.seats,
        state: car.state,
      })
    }
    return out
  }

  // --- Every tick ----------------------------------------------------------------------------

  step(): void {
    const tick = this.game.tick
    const physics = this.game.world.physics
    if (physics !== this.physics) return
    let moved = false
    for (const car of this.cars) {
      // Occupants who are gone or dead are out.
      for (let i = 0; i < 4; i++) {
        const id = car.seats[i] ?? 0
        if (id !== 0 && !this.game.players.get(id)?.state.alive) car.seats[i] = 0
      }
      const s = car.state
      const rolling = Math.hypot(s.vx, s.vz) > 0.01 || Math.abs(s.vy) > 0.01
      // Nobody at the wheel: it rolls to a stop on its own.
      if (car.seats[0] === 0 && rolling && !car.wrecked) {
        stepVehicle(s, 0, TICK_DT, car.body)
        car.body.place(s)
      }
      if (car.driven || rolling) moved = true
      car.driven = false
      if (car.seats.some((id) => id !== 0)) car.usedAt = tick
      // Passengers ride along.
      car.seats.forEach((id, seat) => {
        const p = id === 0 ? undefined : this.game.players.get(id)
        if (p) this.sit(p, car, seat)
      })
      if (!car.wrecked) this.runDown(car)
      if (tick % 10 === 0 && !car.wrecked) this.scratch(car)
      if (tick % TICK_RATE === 0) this.tidy(car)
    }
    // Everybody else's queries see the cars where they are now.
    if (moved && tick % 2 === 0) physics.world.step()
  }

  /** The dead in the way of a moving car are knocked down (and the car pays a little for it). */
  private runDown(car: Car): void {
    const s = car.state
    const speed = Math.hypot(s.vx, s.vz)
    if (speed < RUN_DOWN) return
    const driver = this.game.players.get(car.seats[0] ?? 0)
    const tick = this.game.tick
    for (const z of this.game.players.values()) {
      if (!z.zombie || !z.state.alive) continue
      const p = z.state.pos
      if (Math.abs(p.x - s.x) > 6 || Math.abs(p.z - s.z) > 6 || Math.abs(p.y - s.y) > 2) continue
      // (They can't step into the car's body: anything touching it is hit.)
      if (distanceToCar(s, p.x, p.z) > 0.75) continue
      if (tick - (car.hits.get(z.id) ?? -TICK_RATE) < TICK_RATE / 2) continue
      car.hits.set(z.id, tick)
      const brute = z.zombie.kind === ZombieKind.Brute
      // Knocked flying the way the car was going (and up a little).
      z.state.vel = { x: s.vx * 0.8, y: 3 + speed * 0.15, z: s.vz * 0.8 }
      z.state.grounded = false
      // Fast enough, and nothing gets up again (the dead of Deadwood take a lot of killing).
      const blow = Math.max(speed * 9, speed * speed * 1.6) * (brute ? 0.5 : 1)
      if (driver) this.game.hurt(z, driver, blow)
      // The car slows and dents: a brute much more than the rest.
      const keep = brute ? 0.55 : 0.85
      s.vx *= keep
      s.vz *= keep
      this.damage(car, (brute ? 6 : 1.5) + speed * 0.15)
      if (car.wrecked) return
    }
    if (car.hits.size > 16) {
      for (const [id, at] of car.hits) if (tick - at > TICK_RATE) car.hits.delete(id)
    }
  }

  /** The dead pressed against a car with someone in it claw at it. */
  private scratch(car: Car): void {
    if (!car.seats.some((id) => id !== 0)) return
    const s = car.state
    if (Math.hypot(s.vx, s.vz) > 2) return
    let claws = 0
    for (const z of this.game.players.values()) {
      if (!z.zombie || !z.state.alive) continue
      const p = z.state.pos
      if (Math.abs(p.x - s.x) > 4 || Math.abs(p.z - s.z) > 4 || Math.abs(p.y - s.y) > 2) continue
      if (distanceToCar(s, p.x, p.z) < 0.9) claws++
    }
    if (claws > 0) this.damage(car, claws * SCRATCH * (10 / TICK_RATE))
  }

  /** Once a second: deep water drowns the engine; wrecks and abandoned cars are put back. */
  private tidy(car: Car): void {
    const def = this.game.world.map.survival
    const s = car.state
    if (!car.wrecked && def) {
      for (const lake of def.lakes) {
        if (Math.hypot(s.x - lake.x, s.z - lake.z) < lake.r && s.y < lake.y - 0.9)
          this.damage(car, 20)
      }
    }
    if (s.y < -60) return void this.putBack(car)
    if (car.seats.some((id) => id !== 0)) return
    const idle = (this.game.tick - car.usedAt) / TICK_RATE
    const away = Math.hypot(s.x - car.home.x, s.z - car.home.z) > 25
    const due = car.wrecked ? idle > WRECK_SECONDS : away && idle > ABANDON_SECONDS
    if (!due) return
    for (const p of this.game.players.values()) {
      if (p.zombie || p.dummy || !p.state.alive) continue
      const q = p.state.pos
      if (Math.hypot(q.x - s.x, q.z - s.z) < UNSEEN) return
      if (Math.hypot(q.x - car.home.x, q.z - car.home.z) < UNSEEN) return
    }
    this.putBack(car)
  }

  /** A fresh car where this one was first left. */
  private putBack(car: Car): void {
    car.state = { ...car.home }
    car.health = MAX_HEALTH
    car.wrecked = false
    car.usedAt = this.game.tick
    car.hits.clear()
    car.body.place(car.state)
  }

  private damage(car: Car, amount: number): void {
    if (car.wrecked) return
    car.health = Math.max(0, car.health - amount)
    if (car.health > 0) return
    // Wrecked: everybody out, and it isn't going anywhere any more.
    car.wrecked = true
    car.usedAt = this.game.tick
    car.state.vx = car.state.vz = 0
    car.seats.forEach((id, seat) => {
      const p = id === 0 ? undefined : this.game.players.get(id)
      if (!p) return
      this.getOut(p, car, seat)
      this.say(p, 'warn', 'The car is wrecked. Get clear of it.')
    })
  }

  /** Puts a sitting player in their seat (feet low in the car: the roof covers their head). */
  private sit(player: ServerPlayer, car: Car, seat: number): void {
    const [lx, lz] = SEATS[seat] as [number, number]
    const p = carToWorld(car.state, lx, lz)
    const s = player.state
    s.pos = { x: p.x, y: car.state.y + SEAT_DROP, z: p.z }
    // Still, as far as their legs go (no footsteps, no running about).
    s.vel = { x: 0, y: 0, z: 0 }
    s.grounded = true
  }

  /** Out of the car, on your side of it if there's room, else wherever there is. */
  private getOut(player: ServerPlayer, car: Car, seat: number): void {
    car.seats[seat] = 0
    const s = car.state
    const [lx, lz] = SEATS[seat] as [number, number]
    const side = Math.sign(lx)
    const w = CAR_HALF_WIDTH + 0.65
    const tries: [number, number][] = [
      [side * w, lz],
      [-side * w, lz],
      [0, CAR_HALF_LENGTH + 0.7],
      [0, -CAR_HALF_LENGTH - 0.7],
      [side * (w + 1.2), lz],
      [-side * (w + 1.2), lz],
    ]
    const height = player.body.config.standHeight
    for (const [x, z] of tries) {
      const at = carToWorld(s, x, z)
      const y = car.body.groundAt(at.x, at.z, s.y + 2.2)
      const feet = { x: at.x, y: y + 0.05, z: at.z }
      if (!player.body.fits(feet, height)) continue
      return void this.standAt(player, feet)
    }
    // Hemmed in on every side: out through the roof.
    this.standAt(player, { x: s.x, y: s.y + 1.7, z: s.z })
  }

  private standAt(player: ServerPlayer, feet: { x: number; y: number; z: number }): void {
    const s = player.state
    s.pos = feet
    s.vel = { x: 0, y: 0, z: 0 }
    s.grounded = false
  }
}
