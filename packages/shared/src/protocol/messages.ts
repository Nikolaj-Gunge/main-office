import type { MatchInfo } from '../modes.ts'
import { DEFAULT_RULES, type GameRules, mergeRules } from '../rules.ts'
import type { HitPose, HitZone } from '../sim/hitboxes.ts'
import type { PlayerInput } from '../sim/input.ts'
import type { PlayerState } from '../sim/player.ts'
import type { VehicleState } from '../sim/vehicle.ts'
import type { WeaponState } from '../sim/weapon-sim.ts'
import type { WeaponId } from '../sim/weapons.ts'
import type { SocialEvent, SocialRequest } from '../social.ts'
import { ITEM_LIST, itemIndex } from '../survival/items.ts'
import type {
  Dialog,
  LootItem,
  Notice,
  SurvivalAction,
  SurvivalSelf,
} from '../survival/protocol.ts'
import { BinaryReader, BinaryWriter } from './binary.ts'
import { decodePitch, decodeYaw, encodePitch, encodeYaw } from './quantize.ts'

/** Message ids sent from client to server (0x01–0x7f). */
export const ClientMsg = {
  Hello: 0x01,
  Input: 0x02,
  Ping: 0x03,
  SetDebug: 0x04,
  /** Survival: something done from the inventory, a shop or a conversation. */
  Action: 0x05,
  /** Chat, a ping, a wave or muting someone (social.ts). */
  Social: 0x06,
} as const
export type ClientMsg = (typeof ClientMsg)[keyof typeof ClientMsg]

/** Message ids sent from server to client (0x80–0xff). */
export const ServerMsg = {
  Welcome: 0x81,
  Snapshot: 0x82,
  PlayerJoined: 0x83,
  Pong: 0x84,
  PlayerLeft: 0x85,
  ShotFired: 0x86,
  HitConfirm: 0x87,
  Damaged: 0x88,
  Kill: 0x89,
  DebugShot: 0x8a,
  Scoreboard: 0x8b,
  ItemSpawn: 0x8c,
  ItemRemove: 0x8d,
  Rules: 0x8e,
  Match: 0x8f,
  // Survival mode:
  Survival: 0x90,
  Loot: 0x91,
  Notice: 0x92,
  Dialog: 0x93,
  /** Somebody said something, pinged or waved (social.ts). */
  Social: 0x94,
} as const
export type ServerMsg = (typeof ServerMsg)[keyof typeof ServerMsg]

/** One tick of input, numbered so the server can acknowledge it. */
export interface InputCommand extends PlayerInput {
  seq: number
  /**
   * Fractional server tick the client was *seeing* other players at when this input was made.
   * The server rewinds everyone to this moment to check hits (lag compensation).
   */
  viewTick: number
}

/** Debug flags a client can request (SetDebug). */
export const DebugFlag = {
  /** Send the server's rewound hitbox poses back after every shot. */
  LagComp: 1,
} as const

/** What other players need to draw someone: position and pose, no physics internals. */
export interface RemotePlayerState {
  id: number
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  /** 0 = standing, 1 = fully crouched. */
  crouch: number
  grounded: boolean
  alive: boolean
  /** Just spawned: can't be damaged yet. */
  protected: boolean
  weapon: WeaponId
  /** Aiming down sights (with a sniper: scoped — others see the lens glint). */
  aiming: boolean
  /** Walk cycle 0–1 and horizontal speed (m/s): drive the running animation and its hitboxes. */
  stride: number
  speed: number
  /** Which way they move relative to where they face (radians, 0 = forward, +π/2 = right). */
  moveDir: number
  /** Vertical speed (m/s): a jump tucks the legs, a fall reaches them down. */
  vy: number
  /** Landing impact 0–1, fading after touchdown: the knees give. */
  land: number
  /** Aim-down-sights blend 0–1 (eased in and out by the server): the gun comes up to the eye. */
  ads: number
  /** Seconds since they last fired or swung, capped at 1: recoil, melee swings, claw swipes. */
  shotAge: number
  /** Lying down 0–1 (animated), how far through a slide (1 → 0), and a climb onto a ledge. */
  prone: number
  slide: number
  /** Climb progress 0–1 (0 = not climbing) and the ledge's height above their feet (m). */
  mantle: number
  ledge: number
  /** Survival: their torch is on. */
  light?: boolean
  /**
   * Survival: what they wear that shows (u16, see gear.ts:
   * head look | body look << 4 | legs look << 8 | feet look << 12).
   */
  gear?: number
  /** A zombie winding up a blow: how far through (0–1); absent or 0 when it isn't. */
  windup?: number
}

/** A car as everyone near it is told (survival): enough to draw it and to drive it on. */
export interface VehicleNet {
  id: number
  /** Paint and body (see the client's vehicle view). */
  look: number
  /** 0 (wrecked) – 100. */
  health: number
  wrecked: boolean
  /** Who sits where (player ids; 0 = empty): driver, front passenger, rear left, rear right. */
  seats: number[]
  /** Everything the car's simulation needs to carry on from here (the driver predicts it). */
  state: VehicleState
}

/** What a shot hit, for drawing tracers and impacts on other clients. */
export const ShotResult = {
  Nothing: 0,
  World: 1,
  Player: 2,
} as const
export type ShotResult = (typeof ShotResult)[keyof typeof ShotResult]

export type ClientMessage =
  | {
      type: typeof ClientMsg.Hello
      protocolVersion: number
      name: string
      /** What they chose in the character creator (packAppearance); absent = server picks. */
      appearance?: number
    }
  | { type: typeof ClientMsg.Input; commands: InputCommand[] }
  /** `rtt` = the client's last measured round trip (ms), shown on the scoreboard. */
  | { type: typeof ClientMsg.Ping; clientTime: number; rtt: number }
  | { type: typeof ClientMsg.SetDebug; flags: number }
  | { type: typeof ClientMsg.Action; action: SurvivalAction }
  | { type: typeof ClientMsg.Social; social: SocialRequest }

export interface ScoreEntry {
  id: number
  kills: number
  deaths: number
  /** Round-trip time in ms, as reported by the player's client. */
  ping: number
}

export type ServerMessage =
  | {
      type: typeof ServerMsg.Welcome
      playerId: number
      serverTick: number
      tickRate: number
      snapshotRate: number
      /** Map the server runs (clients load the same one). */
      mapId: string
    }
  | {
      type: typeof ServerMsg.Snapshot
      tick: number
      /** Last input seq the server has applied for the recipient. */
      ackSeq: number
      /** Recipient's own authoritative state (full precision, for reconciliation). */
      self: PlayerState | null
      /** Recipient's health (0–100). */
      health: number
      /** Seconds until respawn while dead, else 0. */
      respawnIn: number
      /** Recipient has spawn protection. */
      protected: boolean
      players: RemotePlayerState[]
      /** Survival: the cars near the recipient (absent when there are none). */
      vehicles?: VehicleNet[]
    }
  | {
      type: typeof ServerMsg.PlayerJoined
      id: number
      color: number
      name: string
      /** 0 = a person or normal bot; otherwise a ZombieKind (zombies mode). */
      kind?: number
      /** What they look like (packAppearance); absent for zombies. */
      appearance?: number
    }
  /** The server's game rules (admin page); sent on join and whenever they change. */
  | { type: typeof ServerMsg.Rules; rules: GameRules }
  /** Mode, round clock, scores and the round result (every second and on changes). */
  | { type: typeof ServerMsg.Match; match: MatchInfo }
  | { type: typeof ServerMsg.PlayerLeft; id: number }
  | { type: typeof ServerMsg.Pong; clientTime: number; serverTime: number; tickMs: number }
  | {
      /** Someone else fired: draw their tracer to `end` and an impact if it hit something. */
      type: typeof ServerMsg.ShotFired
      shooterId: number
      weapon: WeaponId
      end: { x: number; y: number; z: number }
      normal: { x: number; y: number; z: number }
      result: ShotResult
      /** One of a shotgun's extra pellets: draw it, but the shot itself was already heard. */
      pellet?: boolean
    }
  | {
      /** Your shot hit someone (server-confirmed). */
      type: typeof ServerMsg.HitConfirm
      victimId: number
      zone: HitZone
      damage: number
      killed: boolean
    }
  | {
      /** You were hit. `from` is the attacker's position, for the direction indicator. */
      type: typeof ServerMsg.Damaged
      attackerId: number
      damage: number
      health: number
      from: { x: number; y: number; z: number }
    }
  | {
      type: typeof ServerMsg.Kill
      killerId: number
      victimId: number
      weapon: WeaponId
      headshot: boolean
    }
  | { type: typeof ServerMsg.Scoreboard; entries: ScoreEntry[] }
  /** A weapon now lies on the floor (map pickup, thrown or dropped on death). Full ammo. */
  | {
      type: typeof ServerMsg.ItemSpawn
      id: number
      weapon: WeaponId
      pos: { x: number; y: number; z: number }
      yaw: number
    }
  | { type: typeof ServerMsg.ItemRemove; id: number }
  /** Survival: your backpack, hunger and so on (whenever they change). */
  | { type: typeof ServerMsg.Survival; self: SurvivalSelf }
  /** Survival: things lying around near you that appeared (`add`) or went (`remove`: ids). */
  | { type: typeof ServerMsg.Loot; add: LootItem[]; remove: number[] }
  | { type: typeof ServerMsg.Notice; notice: Notice }
  /** Survival: somebody talks to you (null closes the conversation). */
  | { type: typeof ServerMsg.Dialog; dialog: Dialog | null }
  | { type: typeof ServerMsg.Social; social: SocialEvent }
  | {
      /** Debug: where the server placed everyone when checking your shot. */
      type: typeof ServerMsg.DebugShot
      origin: { x: number; y: number; z: number }
      dir: { x: number; y: number; z: number }
      viewTick: number
      poses: (HitPose & { id: number })[]
    }

const TAU = Math.PI * 2
const FLAG_CROUCHED = 1
const FLAG_GROUNDED = 2
const FLAG_DEAD = 4
const FLAG_PROTECTED = 8
const FLAG_AIMING = 16
const FLAG_LIGHT = 32
const FLAG_WINDED = 64
const FLAG_PRONE = 128
/** Others' state only: a gear u16 follows the animation bytes (own state uses bit 0 for crouch). */
const FLAG_GEAR = 1
const FLAG_WINDUP = 64

// --- Own player state: f64 everywhere so client replays start from the exact server state ---

function writePlayerState(w: BinaryWriter, s: PlayerState): void {
  w.f64(s.pos.x).f64(s.pos.y).f64(s.pos.z)
  w.f64(s.vel.x).f64(s.vel.y).f64(s.vel.z)
  w.f64(s.yaw).f64(s.pitch)
  w.f64(s.crouchAmount).f64(s.airTime).f64(s.jumpBuffer)
  w.u8(
    (s.crouched ? FLAG_CROUCHED : 0) |
      (s.grounded ? FLAG_GROUNDED : 0) |
      (s.alive ? 0 : FLAG_DEAD) |
      (s.winded ? FLAG_WINDED : 0) |
      (s.prone ? FLAG_PRONE : 0),
  )
  w.u16(s.prevButtons).f64(s.stamina)
  w.f64(s.proneAmount).f64(s.slide).f64(s.slideCooldown)
  const m = s.mantle
  w.u8(m ? (m.crouch ? 2 : 1) : 0)
  if (m) {
    w.f64(m.from.x).f64(m.from.y).f64(m.from.z)
    w.f64(m.to.x).f64(m.to.y).f64(m.to.z)
    w.f64(m.time).f64(m.duration)
  }
  writeWeapon(w, s.weapon)
  w.u8(s.holstered ? 1 : 0)
  if (s.holstered) writeWeapon(w, s.holstered)
  w.u8(s.pocket ? 1 : 0)
  if (s.pocket) writeWeapon(w, s.pocket)
}

function writeWeapon(w: BinaryWriter, wp: WeaponState): void {
  w.u8(wp.id).u8(wp.ammo).u16(wp.reserve)
  w.f64(wp.cooldown).f64(wp.reload).f64(wp.draw).f64(wp.fireBuffer).f64(wp.sprintRecover)
  w.u32(wp.shotIndex).u32(wp.spreadSeed)
  w.f64(wp.aimTime)
    .f64(wp.swayTime)
    .f64(wp.breath)
    .u8(wp.steady ? 1 : 0)
}

function readWeapon(r: BinaryReader): WeaponState {
  return {
    id: r.u8() as WeaponId,
    ammo: r.u8(),
    reserve: r.u16(),
    cooldown: r.f64(),
    reload: r.f64(),
    draw: r.f64(),
    fireBuffer: r.f64(),
    sprintRecover: r.f64(),
    shotIndex: r.u32(),
    spreadSeed: r.u32(),
    aimTime: r.f64(),
    swayTime: r.f64(),
    breath: r.f64(),
    steady: r.u8() === 1,
  }
}

function readPlayerState(r: BinaryReader): PlayerState {
  const pos = { x: r.f64(), y: r.f64(), z: r.f64() }
  const vel = { x: r.f64(), y: r.f64(), z: r.f64() }
  const yaw = r.f64()
  const pitch = r.f64()
  const crouchAmount = r.f64()
  const airTime = r.f64()
  const jumpBuffer = r.f64()
  const flags = r.u8()
  const prevButtons = r.u16()
  const stamina = r.f64()
  const proneAmount = r.f64()
  const slide = r.f64()
  const slideCooldown = r.f64()
  const mantling = r.u8()
  const mantle =
    mantling === 0
      ? null
      : {
          from: { x: r.f64(), y: r.f64(), z: r.f64() },
          to: { x: r.f64(), y: r.f64(), z: r.f64() },
          time: r.f64(),
          duration: r.f64(),
          crouch: mantling === 2,
        }
  const weapon = readWeapon(r)
  const holstered = r.u8() ? readWeapon(r) : null
  const pocket = r.u8() ? readWeapon(r) : null
  return {
    pos,
    vel,
    yaw,
    pitch,
    crouchAmount,
    airTime,
    jumpBuffer,
    crouched: (flags & FLAG_CROUCHED) !== 0,
    grounded: (flags & FLAG_GROUNDED) !== 0,
    prevButtons,
    alive: (flags & FLAG_DEAD) === 0,
    weapon,
    holstered,
    pocket,
    stamina,
    winded: (flags & FLAG_WINDED) !== 0,
    prone: (flags & FLAG_PRONE) !== 0,
    proneAmount,
    slide,
    slideCooldown,
    mantle,
  }
}

// --- Other players: compact (f32 position, quantized angles) ------------------------------

function writeRemote(w: BinaryWriter, p: RemotePlayerState): void {
  w.u16(p.id).f32(p.x).f32(p.y).f32(p.z)
  w.u16(encodeYaw(p.yaw)).i16(encodePitch(p.pitch))
  w.u8(Math.round(Math.max(0, Math.min(1, p.crouch)) * 255))
  w.u8(
    (p.grounded ? FLAG_GROUNDED : 0) |
      (p.alive ? 0 : FLAG_DEAD) |
      (p.protected ? FLAG_PROTECTED : 0) |
      (p.aiming ? FLAG_AIMING : 0) |
      (p.light ? FLAG_LIGHT : 0) |
      (p.gear ? FLAG_GEAR : 0) |
      (p.windup ? FLAG_WINDUP : 0),
  )
  w.u8(p.weapon)
  w.u8(Math.round((((p.stride % 1) + 1) % 1) * 255))
  w.u8(Math.round(Math.max(0, Math.min(25.5, p.speed)) * 10))
  writeAnimation(w, p)
  if (p.gear) w.u16(p.gear & 0xffff)
  if (p.windup) w.u8(Math.max(1, Math.round(Math.min(1, p.windup) * 255)))
}

/**
 * The animation-only extras of a pose (9 bytes): movement direction, jump, landing, aim, shot,
 * lying down, sliding, climbing.
 */
function writeAnimation(
  w: BinaryWriter,
  p: {
    moveDir?: number
    vy?: number
    land?: number
    ads?: number
    shotAge?: number
    prone?: number
    slide?: number
    mantle?: number
    ledge?: number
  },
): void {
  w.u8(Math.round((((((p.moveDir ?? 0) / TAU) % 1) + 1) % 1) * 256) & 0xff)
  w.u8(Math.round(Math.max(-25.4, Math.min(25.4, p.vy ?? 0)) * 5) + 127)
  w.u8(Math.round(Math.max(0, Math.min(1, p.land ?? 0)) * 255))
  w.u8(Math.round(Math.max(0, Math.min(1, p.ads ?? 0)) * 255))
  w.u8(Math.round(Math.max(0, Math.min(1, p.shotAge ?? 1)) * 255))
  w.u8(Math.round(Math.max(0, Math.min(1, p.prone ?? 0)) * 255))
  w.u8(Math.round(Math.max(0, Math.min(1, p.slide ?? 0)) * 255))
  w.u8(Math.round(Math.max(0, Math.min(1, p.mantle ?? 0)) * 255))
  w.u8(Math.round(Math.max(-1, Math.min(4, p.ledge ?? 0)) * 50) + 50)
}

function readAnimation(r: BinaryReader): {
  moveDir: number
  vy: number
  land: number
  ads: number
  shotAge: number
  prone: number
  slide: number
  mantle: number
  ledge: number
} {
  return {
    moveDir: (r.u8() / 256) * TAU,
    vy: (r.u8() - 127) / 5,
    land: r.u8() / 255,
    ads: r.u8() / 255,
    shotAge: r.u8() / 255,
    prone: r.u8() / 255,
    slide: r.u8() / 255,
    mantle: r.u8() / 255,
    ledge: (r.u8() - 50) / 50,
  }
}

function readRemote(r: BinaryReader): RemotePlayerState {
  const id = r.u16()
  const x = r.f32()
  const y = r.f32()
  const z = r.f32()
  const yaw = decodeYaw(r.u16())
  const pitch = decodePitch(r.i16())
  const crouch = r.u8() / 255
  const flags = r.u8()
  const weapon = r.u8() as WeaponId
  const stride = r.u8() / 255
  const speed = r.u8() / 10
  const animation = readAnimation(r)
  const gear = flags & FLAG_GEAR ? r.u16() : 0
  const windup = flags & FLAG_WINDUP ? r.u8() / 255 : 0
  return {
    stride,
    speed,
    ...animation,
    id,
    x,
    y,
    z,
    yaw,
    pitch,
    crouch,
    grounded: (flags & FLAG_GROUNDED) !== 0,
    alive: (flags & FLAG_DEAD) === 0,
    protected: (flags & FLAG_PROTECTED) !== 0,
    aiming: (flags & FLAG_AIMING) !== 0,
    weapon,
    ...(flags & FLAG_LIGHT ? { light: true } : {}),
    ...(gear ? { gear } : {}),
    ...(windup ? { windup } : {}),
  }
}

// --- Cars ------------------------------------------------------------------------------------

function writeVehicle(w: BinaryWriter, v: VehicleNet): void {
  w.u8(v.id).u8(v.look)
  w.u8(Math.max(0, Math.min(100, Math.ceil(v.health))) | (v.wrecked ? 0x80 : 0))
  for (let i = 0; i < 4; i++) w.u16(v.seats[i] ?? 0)
  const s = v.state
  w.f32(s.x).f32(s.y).f32(s.z).f32(s.yaw)
  w.f32(s.vx).f32(s.vy).f32(s.vz).f32(s.steer)
  w.f32(s.pitch).f32(s.roll)
}

function readVehicle(r: BinaryReader): VehicleNet {
  const id = r.u8()
  const look = r.u8()
  const health = r.u8()
  const seats = [r.u16(), r.u16(), r.u16(), r.u16()]
  const state: VehicleState = {
    x: r.f32(),
    y: r.f32(),
    z: r.f32(),
    yaw: r.f32(),
    vx: r.f32(),
    vy: r.f32(),
    vz: r.f32(),
    steer: r.f32(),
    pitch: r.f32(),
    roll: r.f32(),
  }
  return { id, look, health: health & 0x7f, wrecked: (health & 0x80) !== 0, seats, state }
}

// --- Small helpers ---------------------------------------------------------------------------

function writeVec(w: BinaryWriter, v: { x: number; y: number; z: number }): void {
  w.f32(v.x).f32(v.y).f32(v.z)
}

function readVec(r: BinaryReader): { x: number; y: number; z: number } {
  return { x: r.f32(), y: r.f32(), z: r.f32() }
}

/** Unit vector → 3 × i8 (≈1° precision, plenty for impact orientation). */
function writeNormal(w: BinaryWriter, n: { x: number; y: number; z: number }): void {
  const q = (v: number) => (Math.round(Math.max(-1, Math.min(1, v)) * 127) + 256) % 256
  w.u8(q(n.x)).u8(q(n.y)).u8(q(n.z))
}

function readNormal(r: BinaryReader): { x: number; y: number; z: number } {
  const d = (b: number) => (b > 127 ? b - 256 : b) / 127
  return { x: d(r.u8()), y: d(r.u8()), z: d(r.u8()) }
}

/** A packed appearance (packAppearance: 24 bits), or NO_APPEARANCE when there is none. */
const NO_APPEARANCE = 0xffffffff

function writeAppearance(w: BinaryWriter, appearance: number | undefined): void {
  w.u32(appearance === undefined ? NO_APPEARANCE : appearance & 0xffffff)
}

function readAppearance(r: BinaryReader): number | undefined {
  const v = r.u32()
  return v === NO_APPEARANCE ? undefined : v
}

/** Fractional tick → u32 whole tick + u8 fraction. */
function writeTick(w: BinaryWriter, tick: number): void {
  const whole = Math.max(0, Math.floor(tick))
  w.u32(whole).u8(Math.min(255, Math.round((tick - whole) * 255)))
}

function readTick(r: BinaryReader): number {
  return r.u32() + r.u8() / 255
}

export function encodeClientMessage(msg: ClientMessage): Uint8Array<ArrayBuffer> {
  const w = new BinaryWriter(32).u8(msg.type)
  switch (msg.type) {
    case ClientMsg.Hello:
      w.u16(msg.protocolVersion).str8(msg.name)
      writeAppearance(w, msg.appearance)
      break
    case ClientMsg.Input:
      w.u8(msg.commands.length)
      for (const c of msg.commands) {
        w.u32(c.seq).u16(c.buttons).u16(encodeYaw(c.yaw)).i16(encodePitch(c.pitch))
        writeTick(w, c.viewTick)
      }
      break
    case ClientMsg.SetDebug:
      w.u8(msg.flags)
      break
    case ClientMsg.Ping:
      w.f64(msg.clientTime).u16(Math.max(0, Math.min(65535, Math.round(msg.rtt))))
      break
    case ClientMsg.Action:
      w.str16(JSON.stringify(msg.action))
      break
    case ClientMsg.Social:
      w.str16(JSON.stringify(msg.social))
      break
  }
  return w.finish()
}

export function decodeClientMessage(data: ArrayBuffer | Uint8Array): ClientMessage {
  const r = new BinaryReader(data)
  const type = r.u8()
  switch (type) {
    case ClientMsg.Hello: {
      const hello = { type, protocolVersion: r.u16(), name: r.str8() }
      const appearance = readAppearance(r)
      return appearance === undefined ? hello : { ...hello, appearance }
    }
    case ClientMsg.Input: {
      const count = r.u8()
      const commands: InputCommand[] = []
      for (let i = 0; i < count; i++) {
        commands.push({
          seq: r.u32(),
          buttons: r.u16(),
          yaw: decodeYaw(r.u16()),
          pitch: decodePitch(r.i16()),
          viewTick: readTick(r),
        })
      }
      return { type, commands }
    }
    case ClientMsg.SetDebug:
      return { type, flags: r.u8() }
    case ClientMsg.Ping:
      return { type, clientTime: r.f64(), rtt: r.u16() }
    case ClientMsg.Action:
      return { type, action: JSON.parse(r.str16()) as SurvivalAction }
    case ClientMsg.Social:
      // Checked field by field on the server (social.ts there): anything could be in here.
      return { type, social: JSON.parse(r.str16()) as SocialRequest }
    default:
      throw new Error(`Unknown client message type 0x${type.toString(16)}`)
  }
}

export function encodeServerMessage(msg: ServerMessage): Uint8Array<ArrayBuffer> {
  const w = new BinaryWriter(64).u8(msg.type)
  switch (msg.type) {
    case ServerMsg.Welcome:
      w.u16(msg.playerId).u32(msg.serverTick).u8(msg.tickRate).u8(msg.snapshotRate)
      w.str8(msg.mapId)
      break
    case ServerMsg.Snapshot:
      w.u32(msg.tick).u32(msg.ackSeq)
      w.u8(msg.self ? 1 : 0)
      if (msg.self) writePlayerState(w, msg.self)
      w.u8(Math.max(0, Math.min(255, Math.ceil(msg.health))))
      w.f32(msg.respawnIn)
      w.u8(msg.protected ? 1 : 0)
      w.u8(msg.players.length)
      for (const p of msg.players) writeRemote(w, p)
      w.u8(msg.vehicles?.length ?? 0)
      for (const v of msg.vehicles ?? []) writeVehicle(w, v)
      break
    case ServerMsg.PlayerJoined:
      w.u16(msg.id)
        .u8(msg.color)
        .str8(msg.name)
        .u8(msg.kind ?? 0)
      writeAppearance(w, msg.appearance)
      break
    case ServerMsg.PlayerLeft:
      w.u16(msg.id)
      break
    case ServerMsg.Pong:
      w.f64(msg.clientTime).f64(msg.serverTime).f32(msg.tickMs)
      break
    case ServerMsg.ShotFired:
      w.u16(msg.shooterId).u8(msg.weapon)
      writeVec(w, msg.end)
      writeNormal(w, msg.normal)
      // Top bit: an extra shotgun pellet (no gunshot sound or muzzle effects for it).
      w.u8(msg.result | (msg.pellet ? 0x80 : 0))
      break
    case ServerMsg.HitConfirm:
      w.u16(msg.victimId)
        .u8(msg.zone)
        .u8(Math.min(255, Math.round(msg.damage)))
      w.u8(msg.killed ? 1 : 0)
      break
    case ServerMsg.Damaged:
      w.u16(msg.attackerId).u8(Math.min(255, Math.round(msg.damage)))
      w.u8(Math.max(0, Math.ceil(msg.health)))
      writeVec(w, msg.from)
      break
    case ServerMsg.Kill:
      w.u16(msg.killerId)
        .u16(msg.victimId)
        .u8(msg.weapon)
        .u8(msg.headshot ? 1 : 0)
      break
    case ServerMsg.ItemSpawn:
      w.u16(msg.id).u8(msg.weapon)
      writeVec(w, msg.pos)
      w.u16(encodeYaw(msg.yaw))
      break
    case ServerMsg.ItemRemove:
      w.u16(msg.id)
      break
    case ServerMsg.Rules:
      w.str16(JSON.stringify(msg.rules))
      break
    case ServerMsg.Match:
      w.str16(JSON.stringify(msg.match))
      break
    case ServerMsg.Survival:
      w.str16(JSON.stringify(msg.self))
      break
    case ServerMsg.Notice:
      w.str16(JSON.stringify(msg.notice))
      break
    case ServerMsg.Dialog:
      w.str16(JSON.stringify(msg.dialog))
      break
    case ServerMsg.Social:
      w.str16(JSON.stringify(msg.social))
      break
    case ServerMsg.Loot:
      w.u16(msg.add.length)
      for (const l of msg.add) {
        w.u32(l.id).u8(itemIndex(l.item)).u16(Math.min(65535, l.n))
        w.f32(l.x).f32(l.y).f32(l.z)
      }
      w.u16(msg.remove.length)
      for (const id of msg.remove) w.u32(id)
      break
    case ServerMsg.Scoreboard:
      w.u8(msg.entries.length)
      for (const e of msg.entries) {
        w.u16(e.id)
          .u16(e.kills)
          .u16(e.deaths)
          .u16(Math.min(65535, Math.round(e.ping)))
      }
      break
    case ServerMsg.DebugShot:
      writeVec(w, msg.origin)
      writeVec(w, msg.dir)
      writeTick(w, msg.viewTick)
      w.u8(msg.poses.length)
      for (const p of msg.poses) {
        w.u16(p.id).f32(p.x).f32(p.y).f32(p.z).u16(encodeYaw(p.yaw))
        w.u8(Math.round(p.crouch * 255))
        w.i16(encodePitch(p.pitch ?? 0))
        w.u8(Math.round(((((p.stride ?? 0) % 1) + 1) % 1) * 255))
        w.u8(Math.round(Math.min(25.5, p.speed ?? 0) * 10))
        w.u8(p.grounded === false ? 0 : 1)
        writeAnimation(w, p)
        w.u8(p.weapon ?? 255)
        w.u8(p.gait ?? 0)
        w.u8(Math.round(Math.max(0, Math.min(2.55, p.scale ?? 1)) * 100))
        w.f32(p.time ?? 0)
      }
      break
  }
  return w.finish()
}

export function decodeServerMessage(data: ArrayBuffer | Uint8Array): ServerMessage {
  const r = new BinaryReader(data)
  const type = r.u8()
  switch (type) {
    case ServerMsg.Welcome:
      return {
        type,
        playerId: r.u16(),
        serverTick: r.u32(),
        tickRate: r.u8(),
        snapshotRate: r.u8(),
        mapId: r.str8(),
      }
    case ServerMsg.Snapshot: {
      const tick = r.u32()
      const ackSeq = r.u32()
      const self = r.u8() ? readPlayerState(r) : null
      const health = r.u8()
      const respawnIn = r.f32()
      const isProtected = r.u8() === 1
      const count = r.u8()
      const players: RemotePlayerState[] = []
      for (let i = 0; i < count; i++) players.push(readRemote(r))
      const vehicles: VehicleNet[] = []
      for (let i = r.u8(); i > 0; i--) vehicles.push(readVehicle(r))
      return {
        type,
        tick,
        ackSeq,
        self,
        health,
        respawnIn,
        protected: isProtected,
        players,
        ...(vehicles.length > 0 ? { vehicles } : {}),
      }
    }
    case ServerMsg.PlayerJoined: {
      const joined = { type, id: r.u16(), color: r.u8(), name: r.str8() }
      const kind = r.u8()
      const appearance = readAppearance(r)
      return {
        ...joined,
        ...(kind === 0 ? {} : { kind }),
        ...(appearance === undefined ? {} : { appearance }),
      }
    }
    case ServerMsg.PlayerLeft:
      return { type, id: r.u16() }
    case ServerMsg.Pong:
      return { type, clientTime: r.f64(), serverTime: r.f64(), tickMs: r.f32() }
    case ServerMsg.ShotFired:
      return {
        type,
        shooterId: r.u16(),
        weapon: r.u8() as WeaponId,
        end: readVec(r),
        normal: readNormal(r),
        ...(() => {
          const byte = r.u8()
          const result = (byte & 0x7f) as ShotResult
          return byte & 0x80 ? { result, pellet: true } : { result }
        })(),
      }
    case ServerMsg.HitConfirm:
      return {
        type,
        victimId: r.u16(),
        zone: r.u8() as HitZone,
        damage: r.u8(),
        killed: r.u8() === 1,
      }
    case ServerMsg.Damaged:
      return { type, attackerId: r.u16(), damage: r.u8(), health: r.u8(), from: readVec(r) }
    case ServerMsg.Kill:
      return {
        type,
        killerId: r.u16(),
        victimId: r.u16(),
        weapon: r.u8() as WeaponId,
        headshot: r.u8() === 1,
      }
    case ServerMsg.ItemSpawn:
      return {
        type,
        id: r.u16(),
        weapon: r.u8() as WeaponId,
        pos: readVec(r),
        yaw: decodeYaw(r.u16()),
      }
    case ServerMsg.ItemRemove:
      return { type, id: r.u16() }
    case ServerMsg.Rules:
      return { type, rules: mergeRules(DEFAULT_RULES, JSON.parse(r.str16())) }
    case ServerMsg.Match:
      return { type, match: JSON.parse(r.str16()) as MatchInfo }
    case ServerMsg.Survival:
      return { type, self: JSON.parse(r.str16()) as SurvivalSelf }
    case ServerMsg.Notice:
      return { type, notice: JSON.parse(r.str16()) as Notice }
    case ServerMsg.Dialog:
      return { type, dialog: JSON.parse(r.str16()) as Dialog | null }
    case ServerMsg.Social:
      return { type, social: JSON.parse(r.str16()) as SocialEvent }
    case ServerMsg.Loot: {
      const add: LootItem[] = []
      for (let i = r.u16(); i > 0; i--) {
        const id = r.u32()
        const item = ITEM_LIST[r.u8()]?.id ?? 'scrap'
        add.push({ id, item, n: r.u16(), x: r.f32(), y: r.f32(), z: r.f32() })
      }
      const remove: number[] = []
      for (let i = r.u16(); i > 0; i--) remove.push(r.u32())
      return { type, add, remove }
    }
    case ServerMsg.Scoreboard: {
      const count = r.u8()
      const entries: ScoreEntry[] = []
      for (let i = 0; i < count; i++) {
        entries.push({ id: r.u16(), kills: r.u16(), deaths: r.u16(), ping: r.u16() })
      }
      return { type, entries }
    }
    case ServerMsg.DebugShot: {
      const origin = readVec(r)
      const dir = readVec(r)
      const viewTick = readTick(r)
      const count = r.u8()
      const poses: (HitPose & { id: number })[] = []
      for (let i = 0; i < count; i++) {
        const id = r.u16()
        const pose: HitPose & { id: number } = {
          id,
          x: r.f32(),
          y: r.f32(),
          z: r.f32(),
          yaw: decodeYaw(r.u16()),
          crouch: r.u8() / 255,
          pitch: decodePitch(r.i16()),
          stride: r.u8() / 255,
          speed: r.u8() / 10,
          grounded: r.u8() === 1,
          ...readAnimation(r),
        }
        const weapon = r.u8()
        if (weapon !== 255) pose.weapon = weapon as WeaponId
        pose.gait = r.u8()
        pose.scale = r.u8() / 100
        pose.time = r.f32()
        pose.seed = id
        poses.push(pose)
      }
      return { type, origin, dir, viewTick, poses }
    }
    default:
      throw new Error(`Unknown server message type 0x${type.toString(16)}`)
  }
}
