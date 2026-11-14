import { describe, expect, test } from 'bun:test'
import { DEFAULT_APPEARANCE, packAppearance } from '../appearance.ts'
import { HitZone } from '../sim/hitboxes.ts'
import { createPlayerState } from '../sim/player.ts'
import { createWeaponState } from '../sim/weapon-sim.ts'
import { WeaponId } from '../sim/weapons.ts'
import { gearLooks } from '../survival/gear.ts'
import {
  type ClientMessage,
  ClientMsg,
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeServerMessage,
  type ServerMessage,
  ServerMsg,
  ShotResult,
} from './messages.ts'
import { quantizeInput } from './quantize.ts'

describe('client messages', () => {
  const cases: ClientMessage[] = [
    { type: ClientMsg.Hello, protocolVersion: 7, name: 'Nikolaj' },
    {
      type: ClientMsg.Hello,
      protocolVersion: 7,
      name: 'Nikolaj',
      appearance: packAppearance({ body: 1, skin: 7, hair: 9, hairColor: 9, eyes: 5, beard: 4 }),
    },
    { type: ClientMsg.Hello, protocolVersion: 7, name: 'Bald', appearance: 0 },
    { type: ClientMsg.Ping, clientTime: 12345.678, rtt: 23 },
    { type: ClientMsg.SetDebug, flags: 1 },
    {
      type: ClientMsg.Input,
      commands: [
        {
          seq: 1,
          viewTick: 1000,
          ...quantizeInput({ buttons: 0b1010001, yaw: 1.234, pitch: -0.5 }),
        },
        { seq: 2, viewTick: 1001, ...quantizeInput({ buttons: 0, yaw: -7.5, pitch: 1.5 }) },
      ],
    },
    { type: ClientMsg.Social, social: { kind: 'chat', text: 'Over here — æøå', channel: 'all' } },
    { type: ClientMsg.Social, social: { kind: 'ping', ping: 'loot', x: 1.5, y: -2, z: 300.25 } },
    { type: ClientMsg.Social, social: { kind: 'emote' } },
    { type: ClientMsg.Social, social: { kind: 'mute', id: 12, muted: true } },
  ]
  for (const msg of cases) {
    test(`round-trips 0x${msg.type.toString(16)}`, () => {
      expect(decodeClientMessage(encodeClientMessage(msg))).toEqual(msg)
    })
  }

  test('viewTick keeps sub-tick precision', () => {
    const msg = decodeClientMessage(
      encodeClientMessage({
        type: ClientMsg.Input,
        commands: [{ seq: 1, viewTick: 123456.5, buttons: 0, yaw: 0, pitch: 0 }],
      }),
    )
    if (msg.type !== ClientMsg.Input) throw new Error('wrong type')
    expect(msg.commands[0]?.viewTick).toBeCloseTo(123456.5, 2)
  })

  test('rejects unknown ids', () => {
    expect(() => decodeClientMessage(new Uint8Array([0x7f]))).toThrow()
  })

  test('rejects truncated messages', () => {
    const bytes = encodeClientMessage({ type: ClientMsg.Ping, clientTime: 1, rtt: 0 })
    expect(() => decodeClientMessage(bytes.subarray(0, 4))).toThrow()
  })
})

describe('server messages', () => {
  const self = createPlayerState({ pos: [1.5, 2.25, -3.125], yaw: 0.7 })
  self.vel = { x: 0.1, y: -2, z: 5.2 }
  self.crouched = true
  self.crouchAmount = 0.375
  self.prevButtons = 0x8041 // incl. the top bit (prone)
  self.prone = true
  self.proneAmount = 0.6
  self.slide = 0.25
  self.slideCooldown = 0.125
  self.mantle = {
    from: { x: 1, y: 0, z: 2 },
    to: { x: 1, y: 1.2, z: 1.1 },
    time: 0.1,
    duration: 0.58,
    crouch: true,
  }
  self.alive = false
  self.weapon = { ...self.weapon, ammo: 7, cooldown: 0.05, shotIndex: 42, spreadSeed: 0xdeadbeef }
  self.holstered = {
    ...createWeaponState(WeaponId.Handgun),
    ammo: 3,
    aimTime: 0.1,
    swayTime: 2.5,
    breath: 1.5,
    steady: true,
  }

  const cases: ServerMessage[] = [
    {
      type: ServerMsg.Welcome,
      playerId: 7,
      serverTick: 99999,
      tickRate: 60,
      snapshotRate: 30,
      mapId: 'office',
    },
    { type: ServerMsg.Pong, clientTime: 1.25, serverTime: 1700000000000.5, tickMs: 0.5 },
    { type: ServerMsg.PlayerJoined, id: 3, color: 5, name: 'Bo' },
    { type: ServerMsg.PlayerJoined, id: 4, color: 1, name: 'Zombie', kind: 2 },
    {
      type: ServerMsg.PlayerJoined,
      id: 5,
      color: 2,
      name: 'Ida',
      appearance: packAppearance(DEFAULT_APPEARANCE),
    },
    { type: ServerMsg.PlayerLeft, id: 3 },
    {
      type: ServerMsg.Social,
      social: { kind: 'chat', from: 3, name: 'Bo', text: 'Anyone at the mill?', channel: 'nearby' },
    },
    { type: ServerMsg.Social, social: { kind: 'ping', from: 3, ping: 'zombie', x: 1, y: 2, z: 3 } },
    { type: ServerMsg.Social, social: { kind: 'emote', from: 9 } },
    { type: ServerMsg.Social, social: { kind: 'system', text: 'Slow down.' } },
    {
      type: ServerMsg.Snapshot,
      tick: 10,
      ackSeq: 0,
      self: null,
      health: 0,
      respawnIn: 2.5,
      protected: true,
      players: [],
    },
    {
      type: ServerMsg.ShotFired,
      shooterId: 4,
      weapon: WeaponId.Sniper,
      end: { x: 1.5, y: 2, z: -3.25 },
      normal: { x: 0, y: 1, z: 0 },
      result: ShotResult.World,
    },
    { type: ServerMsg.HitConfirm, victimId: 2, zone: HitZone.Head, damage: 100, killed: true },
    {
      type: ServerMsg.Damaged,
      attackerId: 1,
      damage: 26,
      health: 74,
      from: { x: 1, y: 0, z: 2 },
    },
    { type: ServerMsg.Kill, killerId: 1, victimId: 2, weapon: WeaponId.Handgun, headshot: true },
    { type: ServerMsg.ItemRemove, id: 12 },
    {
      type: ServerMsg.Scoreboard,
      entries: [
        { id: 1, kills: 12, deaths: 3, ping: 18 },
        { id: 7, kills: 0, deaths: 9, ping: 140 },
      ],
    },
  ]
  for (const msg of cases) {
    test(`round-trips 0x${msg.type.toString(16)}`, () => {
      expect(decodeServerMessage(encodeServerMessage(msg))).toEqual(msg)
    })
  }

  test('snapshot keeps own state exact and others close', () => {
    const msg: ServerMessage = {
      type: ServerMsg.Snapshot,
      tick: 1234,
      ackSeq: 999,
      self,
      health: 74,
      respawnIn: 0,
      protected: false,
      players: [
        {
          id: 2,
          x: 10.1,
          y: 0,
          z: -20.3,
          yaw: 1,
          pitch: 0.2,
          crouch: 0.5,
          grounded: true,
          alive: false,
          protected: true,
          weapon: WeaponId.Sniper,
          aiming: true,
          stride: 0,
          speed: 0,
          moveDir: -Math.PI / 2,
          vy: -7.4,
          land: 0.4,
          ads: 0.75,
          shotAge: 0.12,
          prone: 1,
          slide: 0.5,
          mantle: 0.25,
          ledge: 1.2,
        },
      ],
    }
    const out = decodeServerMessage(encodeServerMessage(msg))
    if (out.type !== ServerMsg.Snapshot) throw new Error('wrong type')
    expect(out.self).toEqual(self)
    expect(out.health).toBe(74)
    const p = out.players[0]
    expect(p?.x).toBeCloseTo(10.1, 4)
    expect(p?.z).toBeCloseTo(-20.3, 4)
    expect(p?.yaw).toBeCloseTo(1, 3)
    expect(p?.pitch).toBeCloseTo(0.2, 3)
    expect(p?.crouch).toBeCloseTo(0.5, 2)
    expect(p?.grounded).toBe(true)
    expect(p?.alive).toBe(false)
    expect(p?.protected).toBe(true)
    expect(p?.weapon).toBe(WeaponId.Sniper)
    expect(p?.aiming).toBe(true)
    // Animation extras (moving left, falling, landing, half-way to the sights, just fired).
    expect(Math.sin(p?.moveDir ?? 0)).toBeCloseTo(-1, 3)
    expect(p?.vy).toBeCloseTo(-7.4, 1)
    expect(p?.land).toBeCloseTo(0.4, 2)
    expect(p?.ads).toBeCloseTo(0.75, 2)
    expect(p?.shotAge).toBeCloseTo(0.12, 2)
    // Lying down, sliding, climbing a 1.2 m ledge.
    expect(p?.prone).toBe(1)
    expect(p?.slide).toBeCloseTo(0.5, 2)
    expect(p?.mantle).toBeCloseTo(0.25, 2)
    expect(p?.ledge).toBeCloseTo(1.2, 2)
  })

  test("others' worn clothes survive the wire as a u16 (all four slots)", () => {
    const gear = gearLooks(['helmet', 'militaryvest', 'camopants', 'militaryboots'])
    expect(gear).toBeGreaterThan(0xff)
    const player = {
      id: 9,
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      pitch: 0,
      crouch: 0,
      grounded: true,
      alive: true,
      protected: false,
      weapon: WeaponId.Knife,
      aiming: false,
      stride: 0,
      speed: 0,
      moveDir: 0,
      vy: 0,
      land: 0,
      ads: 0,
      shotAge: 1,
      prone: 0,
      slide: 0,
      mantle: 0,
      ledge: 0,
    }
    const out = decodeServerMessage(
      encodeServerMessage({
        type: ServerMsg.Snapshot,
        tick: 1,
        ackSeq: 1,
        self: null,
        health: 100,
        respawnIn: 0,
        protected: false,
        players: [{ ...player, gear }, player, { ...player, id: 10, gear: 0xf000 }],
      }),
    )
    if (out.type !== ServerMsg.Snapshot) throw new Error('wrong type')
    expect(out.players.map((p) => p.gear)).toEqual([gear, undefined, 0xf000])
    expect(out.players[2]?.id).toBe(10)
    // A zombie winding up a blow: the progress rides along (after any gear), none means none.
    const windups = decodeServerMessage(
      encodeServerMessage({
        type: ServerMsg.Snapshot,
        tick: 1,
        ackSeq: 1,
        self: null,
        health: 100,
        respawnIn: 0,
        protected: false,
        players: [{ ...player, windup: 0.5, gear }, { ...player, windup: 0.001 }, player],
      }),
    )
    if (windups.type !== ServerMsg.Snapshot) throw new Error('wrong type')
    expect(windups.players[0]?.windup).toBeCloseTo(0.5, 2)
    expect(windups.players[0]?.gear).toBe(gear)
    expect(windups.players[1]?.windup).toBeGreaterThan(0)
    expect(windups.players[2]?.windup).toBeUndefined()
  })

  test('item spawns survive the wire', () => {
    const out = decodeServerMessage(
      encodeServerMessage({
        type: ServerMsg.ItemSpawn,
        id: 3,
        weapon: WeaponId.Sniper,
        pos: { x: 1.5, y: 4.5, z: -7.25 },
        yaw: 1.2,
      }),
    )
    if (out.type !== ServerMsg.ItemSpawn) throw new Error('wrong type')
    expect(out.weapon).toBe(WeaponId.Sniper)
    expect(out.pos).toEqual({ x: 1.5, y: 4.5, z: -7.25 })
    expect(out.yaw).toBeCloseTo(1.2, 3)
  })

  test('an empty primary slot survives the wire', () => {
    const s = { ...self, holstered: null }
    const out = decodeServerMessage(
      encodeServerMessage({
        type: ServerMsg.Snapshot,
        tick: 1,
        ackSeq: 1,
        self: s,
        health: 100,
        respawnIn: 0,
        protected: false,
        players: [],
      }),
    )
    if (out.type !== ServerMsg.Snapshot) throw new Error('wrong type')
    expect(out.self?.holstered).toBeNull()
  })

  test('debug shot poses survive the wire', () => {
    const out = decodeServerMessage(
      encodeServerMessage({
        type: ServerMsg.DebugShot,
        origin: { x: 1, y: 1.65, z: 2 },
        dir: { x: 0, y: 0, z: -1 },
        viewTick: 500.25,
        poses: [
          { id: 3, x: 4, y: 0, z: -5, yaw: 1.5, crouch: 1 },
          {
            id: 4,
            x: 0,
            y: 0,
            z: 0,
            yaw: 0,
            crouch: 0,
            ads: 1,
            moveDir: 1,
            shotAge: 0.3,
            prone: 0.5,
            ledge: -0.5,
            weapon: WeaponId.Claws,
            gait: 3,
            scale: 1.38,
            time: 8.25,
          },
        ],
      }),
    )
    if (out.type !== ServerMsg.DebugShot) throw new Error('wrong type')
    expect(out.viewTick).toBeCloseTo(500.25, 2)
    expect(out.poses[0]?.id).toBe(3)
    expect(out.poses[0]?.yaw).toBeCloseTo(1.5, 3)
    expect(out.poses[0]?.crouch).toBe(1)
    expect(out.poses[0]?.weapon).toBeUndefined()
    expect(out.poses[0]?.scale).toBe(1)
    // Everything the server's hit pose was built from, so the debug view matches it.
    const p = out.poses[1]
    expect(p?.ads).toBe(1)
    expect(p?.moveDir).toBeCloseTo(1, 1)
    expect(p?.shotAge).toBeCloseTo(0.3, 2)
    expect(p?.prone).toBeCloseTo(0.5, 2)
    expect(p?.ledge).toBeCloseTo(-0.5, 2)
    expect(p?.weapon).toBe(WeaponId.Claws)
    expect(p?.gait).toBe(3)
    expect(p?.scale).toBeCloseTo(1.38, 2)
    expect(p?.time).toBe(8.25)
    expect(p?.seed).toBe(4)
  })
})

describe('quantizeInput', () => {
  test('is idempotent and survives the wire bit-exactly', () => {
    const q = quantizeInput({ buttons: 3, yaw: 123.456, pitch: -0.987 })
    expect(quantizeInput(q)).toEqual(q)
    const wire = decodeClientMessage(
      encodeClientMessage({ type: ClientMsg.Input, commands: [{ seq: 1, viewTick: 5, ...q }] }),
    )
    if (wire.type !== ClientMsg.Input) throw new Error('wrong type')
    expect(wire.commands[0]).toEqual({ seq: 1, viewTick: 5, ...q })
  })

  test('keeps the movement direction (sin/cos of yaw) within 0.01°', () => {
    for (const yaw of [-10, -1, 0, 0.5, 3, 100]) {
      const q = quantizeInput({ buttons: 0, yaw, pitch: 0 }).yaw
      expect(Math.abs(Math.atan2(Math.sin(q - yaw), Math.cos(q - yaw)))).toBeLessThan(
        (0.01 * Math.PI) / 180,
      )
    }
  })
})
