import {
  BITTEN_STORY,
  BOARD_REACH,
  countOf,
  DAY_SECONDS,
  daylight,
  gearLooks,
  heightAt,
  type Interactable,
  ITEMS,
  type LootItem,
  MAX_PLANKS,
  type MapDef,
  type Npc,
  type PhysicsWorld,
  PLANK_ITEM,
  type PlayerState,
  type RemotePlayerState,
  randomAppearance,
  remotePose,
  type ServerMessage,
  ServerMsg,
  type SurvivalAction,
  type SurvivalDef,
  type SurvivalSelf,
  type SurvivalShared,
  seeded,
  setBarricades,
  spotCentre,
  syncForest,
  VICINITY,
  VICINITY_UP,
  WALKERS,
  type WalkerState,
  WeaponId,
} from '@office-fps/shared'
import * as THREE from 'three'
import type { AudioEngine } from '../audio/audio-engine.ts'
import { SurvivalHud } from '../hud/survival-hud.ts'
import { Avatar } from '../render/avatar.ts'
import { BarricadeView } from '../render/barricades.ts'
import { CampFolk } from '../render/camp-folk.ts'
import { HeliView } from '../render/heli.ts'
import { Leaves } from '../render/leaves.ts'
import { LootView } from '../render/loot-view.ts'
import { updateMapLod } from '../render/map-mesh.ts'
import { Night } from '../render/night.ts'
import { fadeShadowEdges } from '../render/shadow-fade.ts'
import { WeatherView } from '../render/weather-view.ts'
import { Wilds } from '../render/wilds.ts'
import { Infection, type InfectionFx } from './infection.ts'
import type { RemotePlayers } from './remote-players.ts'
import { VehiclesClient } from './vehicles-client.ts'

/** How far you reach for things, and how close you stand to talk (m): the server's numbers. */
const REACH = 2.4
const TALK_REACH = 3
/** What the people of Haven wear, by what they do. */
const NPC_GEAR: Partial<Record<Npc['role'], string[]>> = {
  guard: ['helmet', 'militaryvest', 'camopants', 'militaryboots'],
  leader: ['jacket', 'jeans', 'boots'],
  trader: ['cowboyhat', 'flannel', 'jeans', 'boots'],
  medic: ['raincoat', 'cargopants', 'sneakers'],
  mechanic: ['cap', 'flannel', 'worktrousers', 'boots'],
  cook: ['bandana', 'jeans', 'sneakers'],
  hunter: ['beanie', 'camojacket', 'camopants', 'boots'],
  kid: ['hoodie', 'jeans', 'sneakers'],
}

/** Before the night has made its fog. */
const FOG = new THREE.Color(0x0c121c)

/** Other people's torches lit at once. */
const TORCHES = 1

const torch = () => {
  const light = new THREE.SpotLight(0xfff2d8, 0, 48, 0.4, 0.6, 1)
  light.castShadow = false
  return light
}

/**
 * The client's side of survival mode: draws the world outside the buildings and its night, the
 * things lying about and the people of Haven, runs the torch, and keeps the HUD fed with what
 * the server says.
 */
export class SurvivalClient {
  readonly hud: SurvivalHud
  self: SurvivalSelf | null = null
  shared: SurvivalShared | null = null
  /** What E would do right now ("Take …", "Talk to …"), or null. */
  prompt: string | null = null
  /** The bite on screen this frame (for the post pass), or null when you're clean. */
  infectionFx: InfectionFx | null = null
  private readonly infection: Infection
  /** The cars: drawn, driven, ridden in. */
  readonly vehicles: VehiclesClient
  private readonly myId: () => number

  private readonly def: SurvivalDef
  private readonly scene: THREE.Scene
  private readonly camera: THREE.PerspectiveCamera
  private readonly physics: PhysicsWorld
  private readonly audio: AudioEngine
  private readonly send: (action: SurvivalAction) => void
  private readonly wilds: Wilds
  private readonly night: Night
  /** The map's buildings (main.ts adds them first), for their level of detail. */
  private readonly mapObject: THREE.Object3D | null
  private readonly loot: LootView
  private readonly leaves: Leaves
  private readonly boards: BarricadeView
  private readonly heli: HeliView
  /** Haven's townsfolk going about their day. */
  private readonly folk: CampFolk
  /** Rain, mist, lightning and the rest (what the weather is comes from the server). */
  readonly weather: WeatherView
  private readonly projected = new THREE.Vector3()
  /** When the server last said what time it is (ms). */
  private clockAt = 0
  private readonly npcs: { def: Npc; avatar: Avatar; state: RemotePlayerState }[] = []
  /** People walking with somebody (or waiting to be found), by key: drawn where the server says. */
  private readonly walkers = new Map<
    string,
    { avatar: Avatar; state: RemotePlayerState; to: WalkerState }
  >()
  private readonly torch = torch()
  private readonly others: THREE.SpotLight[] = []
  private torchLevel = 0
  private sinceForest = 1
  private sinceAmbience = 4
  private dreadAt = 0

  constructor(o: {
    map: MapDef
    def: SurvivalDef
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    physics: PhysicsWorld
    sky: THREE.Mesh
    hudRoot: HTMLElement
    audio: AudioEngine
    send: (action: SurvivalAction) => void
    /** Your player id (0 before joining). */
    myId: () => number
    /** Your player id. */
    me?: () => number
  }) {
    this.def = o.def
    this.myId = o.myId
    this.scene = o.scene
    this.camera = o.camera
    this.physics = o.physics
    this.audio = o.audio
    this.send = o.send
    fadeShadowEdges()
    this.wilds = new Wilds(o.def)
    o.scene.add(this.wilds.root)
    this.mapObject = o.scene.getObjectByName(`map:${o.map.id}`) ?? null
    this.night = new Night(o.map, o.scene, o.sky)
    this.loot = new LootView(o.scene)
    this.leaves = new Leaves(o.def.terrain)
    o.scene.add(this.leaves.mesh)
    this.boards = new BarricadeView(o.def.spots)
    o.scene.add(this.boards.root)
    this.heli = new HeliView(o.scene, o.audio, (x, z) => heightAt(o.def.terrain, x, z))
    this.folk = new CampFolk(o.def, o.audio)
    o.scene.add(this.folk.root)
    this.weather = new WeatherView(o.def, o.physics, o.audio)
    o.scene.add(this.weather.root)
    this.hud = new SurvivalHud(o.hudRoot, o.def, o.send)
    if (o.me) this.hud.me = o.me
    this.infection = new Infection(o.audio)
    this.vehicles = new VehiclesClient({
      scene: o.scene,
      physics: o.physics,
      terrain: o.def.terrain,
      audio: o.audio,
      hudRoot: o.hudRoot,
    })

    // The torch rides on the camera, a little to the right, like a hand holding it.
    o.scene.add(o.camera)
    this.torch.position.set(0.22, -0.18, 0.1)
    this.torch.target.position.set(0, -0.4, -10)
    o.camera.add(this.torch, this.torch.target)
    for (let i = 0; i < TORCHES; i++) {
      const light = torch()
      o.scene.add(light, light.target)
      this.others.push(light)
    }

    o.def.npcs.forEach((npc, i) => {
      // Each survivor at Haven has a face of their own (the same one every visit).
      const look = randomAppearance(seeded(0x5eed + i * 7919))
      const avatar = new Avatar(npc.name, npc.color, 'worker', look)
      o.scene.add(avatar.root)
      this.npcs.push({
        def: npc,
        avatar,
        state: standing(60000 + i, npc.pos, npc.yaw, gearLooks(NPC_GEAR[npc.role] ?? [])),
      })
    })
  }

  /** The people walking with somebody: new ones appear, gone ones go, the rest walk on. */
  private applyWalkers(list: readonly WalkerState[]): void {
    const seen = new Set<string>()
    for (const w of list) {
      seen.add(w.key)
      const have = this.walkers.get(w.key)
      if (have) {
        have.to = w
        continue
      }
      const def = WALKERS[w.who]
      const look = randomAppearance(seeded(0x5eed + w.who.length * 104729))
      const avatar = new Avatar(def?.name ?? w.who, def?.color ?? 0, 'worker', look)
      this.scene.add(avatar.root)
      const state = standing(
        61000 + this.walkers.size,
        [w.x, w.y, w.z],
        w.yaw,
        gearLooks(def?.gear ?? []),
      )
      this.walkers.set(w.key, { avatar, state, to: w })
    }
    for (const [key, w] of this.walkers) {
      if (seen.has(key)) continue
      this.scene.remove(w.avatar.root)
      this.walkers.delete(key)
    }
  }

  /** Walkers ease to where the server last had them, and walk while they do. */
  private moveWalkers(dt: number, eye: THREE.Vector3): void {
    const now = performance.now()
    for (const w of this.walkers.values()) {
      const s = w.state
      const dx = w.to.x - s.x
      const dz = w.to.z - s.z
      const d = Math.hypot(dx, dz)
      // Far behind (just appeared, or a long gap): there at once.
      const k = d > 12 ? 1 : Math.min(1, dt * 6)
      s.x += dx * k
      s.z += dz * k
      s.y += (w.to.y - s.y) * k
      const moved = d * k
      const speed = dt > 0 ? moved / dt : 0
      s.speed += (speed - s.speed) * Math.min(1, dt * 8)
      s.stride = (s.stride + moved / 2.2) % 1
      s.moveDir = 0
      if (moved > 0.01) s.yaw = Math.atan2(-dx, -dz)
      else if (w.to.follow === 0)
        s.yaw +=
          (((w.to.yaw - s.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 3)
      const far = Math.hypot(s.x - eye.x, s.z - eye.z) > 90
      w.avatar.root.visible = !far
      if (!far) w.avatar.update(s, remotePose(s, { time: now / 1000 }), now, eye)
    }
  }

  /** Survival's own messages; returns true if it was one. */
  onMessage(msg: ServerMessage): boolean {
    switch (msg.type) {
      case ServerMsg.Survival:
        // Clean again (cured, dead or turned): the bite's story card goes, even mid-way.
        if ((this.self?.infected ?? null) !== null && (msg.self.infected ?? null) === null)
          this.hud.dropStory(BITTEN_STORY)
        this.self = msg.self
        this.infection.set(msg.self.infected ?? null)
        this.hud.setSelf(msg.self)
        return true
      case ServerMsg.Loot:
        this.loot.apply(msg.add, msg.remove)
        return true
      case ServerMsg.Notice: {
        const n = msg.notice
        if (n.kind === 'scream' && n.at) {
          this.audio.playNear('scream', n.at, 1, 170, 12)
          this.audio.play('dread', { volume: 0.5 })
        } else if (n.kind === 'loot') this.audio.play('pickup', { volume: 0.5 })
        this.hud.notice(n)
        return true
      }
      case ServerMsg.Dialog:
        this.hud.dialog(msg.dialog)
        return true
      case ServerMsg.Snapshot:
        // The cars; the rest of the snapshot is the game's.
        this.vehicles.onSnapshot(msg.tick, msg.vehicles ?? [], msg.ackSeq, this.myId())
        return false
    }
    return false
  }

  setShared(shared: SurvivalShared | undefined): void {
    if (!shared) return
    this.shared = shared
    this.clockAt = performance.now()
    this.hud.setShared(shared)
    this.applyBoards(shared.boards ?? [])
    this.heli.apply(shared.drops)
    this.weather.setShared(shared.weather)
    this.applyWalkers(shared.walkers ?? [])
  }

  /** Planks up and down: what you see, what you bump into, and what you hear. */
  private applyBoards(boards: readonly number[]): void {
    const changes = this.boards.apply(boards)
    if (changes.length === 0) return
    setBarricades(this.physics, this.def.spots, (i) => this.boards.planks(i))
    for (const { spot, what } of changes) {
      const at = spotCentre(spot)
      if (what === 'nailed') this.audio.play('hammer', { at, volume: 0.8 })
      else if (what === 'hit') this.audio.play('bang', { at, volume: 1 })
      else this.audio.play('splinter', { at, volume: 1 })
    }
  }

  /** Joined a (new) game: forget what the last one said. */
  reset(): void {
    this.applyWalkers([])
    this.loot.clear()
    this.heli.clear()
    this.self = null
    this.vehicles.clear()
    this.infection.set(null)
    this.applyBoards([])
  }

  /** The day's clock now: the server's, run on since it last said. */
  get time(): number {
    if (!this.shared) return 0
    return (this.shared.time + (performance.now() - this.clockAt) / 1000 / DAY_SECONDS) % 1
  }

  toggleTorch(): void {
    if (!this.self) return
    if (!this.self.light && this.self.battery <= 0) {
      this.hud.notice({ kind: 'warn', text: 'Your torch is dead. Find batteries.' })
      return
    }
    this.send({ a: 'light', on: !this.self.light })
    this.audio.play('dryfire', { volume: 0.5, rate: 1.4 })
  }

  /**
   * Builds the ground you start on before the first frame, so the shaders it needs can be
   * compiled with the rest while loading (the chunks around it follow over the next frames).
   */
  prime(x: number, z: number): void {
    this.wilds.update(x, z)
  }

  /**
   * Every frame. Returns true when the shadows want redrawing.
   * @param eyeYaw  where you look (the server's angles: 0 = north, + = left)
   */
  update(
    dt: number,
    state: PlayerState,
    health: number,
    eyeYaw: number,
    eyePitch: number,
    remotes: RemotePlayers,
  ): boolean {
    const eye = this.camera.position
    const built = this.wilds.update(eye.x, eye.z)
    this.sinceForest += dt
    if (this.sinceForest > 0.3 || built) {
      this.sinceForest = 0
      // The same trees are solid here as on the server: the ones around you.
      syncForest(this.physics, [state.pos])
      this.loot.prune(eye.x, eye.z)
    }
    const time = this.time
    this.night.setWeather(
      this.weather.update(
        dt,
        this.camera,
        daylight(time),
        this.torchLevel,
        this.scene.fog?.color ?? FOG,
      ),
    )
    this.wilds.setWetness(this.weather.wet)
    this.night.update(dt, eye, time, built)
    this.cullDistant(eye.x, eye.z, (this.scene.fog as THREE.Fog | null)?.far ?? 1000)
    this.leaves.update(dt, eye)
    this.heli.update(dt, eye)

    // Your torch, and the nearest of everyone else's.
    const on = this.self?.light === true && state.alive
    this.torchLevel += ((on ? 1 : 0) - this.torchLevel) * Math.min(1, dt * 18)
    const sputter =
      on && (this.self?.battery ?? 100) < 15 && Math.sin(performance.now() / 53) > 0.6 ? 0.35 : 1
    this.torch.intensity = 70 * this.torchLevel * sputter
    const lit = remotes
      .torches()
      .sort((a, b) => Math.hypot(a.x - eye.x, a.z - eye.z) - Math.hypot(b.x - eye.x, b.z - eye.z))
    this.others.forEach((light, i) => {
      const t = lit[i]
      light.intensity = t ? 55 : 0
      if (!t) return
      const cp = Math.cos(t.pitch)
      light.position.set(t.x, t.y, t.z)
      light.target.position.set(
        t.x - Math.sin(t.yaw) * cp * 10,
        t.y + Math.sin(t.pitch) * 10,
        t.z - Math.cos(t.yaw) * cp * 10,
      )
    })

    // The people of Haven turn to look at you when you come close.
    const now = performance.now()
    for (const npc of this.npcs) {
      const dx = state.pos.x - npc.def.pos[0]
      const dz = state.pos.z - npc.def.pos[2]
      const d = Math.hypot(dx, dz)
      npc.avatar.root.visible = d < 90
      if (d > 90) continue
      const want = d < 7 ? Math.atan2(-dx, -dz) : npc.def.yaw
      let turn = (want - npc.state.yaw) % (Math.PI * 2)
      if (turn > Math.PI) turn -= Math.PI * 2
      if (turn < -Math.PI) turn += Math.PI * 2
      npc.state.yaw += turn * Math.min(1, dt * 4)
      // They breathe and shift their weight (idle motion on the local clock: nobody shoots them).
      npc.avatar.update(npc.state, remotePose(npc.state, { time: now / 1000 }), now, eye)
    }

    this.folk.update(dt, time, eye, state.pos)
    this.moveWalkers(dt, eye)
    this.prompt = state.alive ? this.findPrompt(state, eyeYaw, eyePitch) : null
    this.ambience(dt, remotes, eye)
    this.infectionFx = this.infection.update(dt, state.alive)
    this.hud.update(dt, {
      infected: state.alive ? this.infection.left : null,
      health,
      stamina: state.stamina,
      winded: state.winded,
      pos: state.pos,
      yaw: eyeYaw,
      carried: [state.weapon, state.holstered, state.pocket].filter((w) => w !== null),
      nearby: state.alive ? this.nearby(state) : [],
      project: (x, y, z) => {
        const v = this.projected.set(x, y, z).applyMatrix4(this.camera.matrixWorldInverse)
        const behind = v.z > 0
        v.applyMatrix4(this.camera.projectionMatrix)
        return {
          x: (v.x * 0.5 + 0.5) * window.innerWidth,
          y: (0.5 - v.y * 0.5) * window.innerHeight,
          behind,
        }
      },
    })
    const dirty = this.night.shadowsDirty
    this.night.shadowsDirty = false
    return dirty
  }

  /**
   * Level of detail: nothing past the fog is drawn (it closes in at night), far forest and
   * buildings simplified (see wilds.ts, forest-lod.ts, map-mesh.ts).
   */
  cullDistant(x: number, z: number, fogFar: number): void {
    this.wilds.cull(x, z, fogFar)
    if (this.mapObject) updateMapLod(this.mapObject, x, z, fogFar + 8)
  }

  /** Wind, twigs snapping in the dark, and a sting when something close has its eyes on you. */
  private ambience(dt: number, remotes: RemotePlayers, eye: THREE.Vector3): void {
    this.sinceAmbience -= dt
    if (this.sinceAmbience <= 0) {
      // The windier the weather, the more often the gusts come, and the louder.
      const blow = this.weather.weather.wind
      this.sinceAmbience = (5 + Math.random() * 9) / (1 + blow * 2.5)
      const a = Math.random() * Math.PI * 2
      const at = { x: eye.x + Math.cos(a) * 25, y: eye.y + 4, z: eye.z + Math.sin(a) * 25 }
      if (Math.random() < 0.6 + blow * 0.35) {
        const volume =
          (0.25 + Math.random() * 0.25) * (1 + blow * 1.2) * (this.weather.indoors ? 0.6 : 1)
        this.audio.play('wind', { at, volume, rate: 0.9 + Math.random() * 0.2 - blow * 0.1 })
      } else
        this.audio.play('twig', { at: { ...at, y: eye.y - 1 }, volume: 0.25 + Math.random() * 0.2 })
    }
    // Something within a few metres that you haven't been stung about lately.
    const t = performance.now() / 1000
    if (t < this.dreadAt) return
    for (const [id, pose] of remotes.visiblePoses()) {
      if (remotes.kindOf(id) === 0) continue
      if (Math.hypot(pose.x - eye.x, pose.z - eye.z) > 7) continue
      this.dreadAt = t + 25
      this.audio.play('dread', { volume: 0.55 })
      break
    }
  }

  /**
   * The cars, every frame: drawn where they are, and the camera put behind yours if you sit in
   * one (returns true then). `alpha`: how far real time is into the current tick.
   */
  drive(
    dt: number,
    alpha: number,
    renderTick: number,
    look: { yaw: number; pitch: number },
  ): boolean {
    const night = 1 - daylight(this.time)
    this.vehicles.update(dt, alpha, renderTick, night, this.camera.position)
    return this.vehicles.camera(this.camera, look, dt)
  }

  /** What lies within reach of the inventory screen (the server checks the same distances). */
  private nearby(state: PlayerState): LootItem[] {
    const out: LootItem[] = []
    for (const { loot } of this.loot.all()) {
      if (Math.hypot(loot.x - state.pos.x, loot.z - state.pos.z) > VICINITY) continue
      if (Math.abs(loot.y - state.pos.y) > VICINITY_UP) continue
      out.push(loot)
    }
    return out
  }

  /** The same choice the server makes when E is pressed: who or what you're looking at. */
  private findPrompt(state: PlayerState, yaw: number, pitch: number): string | null {
    if (this.vehicles.seated) return this.vehicles.prompt(state.pos)
    const ex = state.pos.x
    const ey = state.pos.y + 1.6
    const ez = state.pos.z
    const cp = Math.cos(pitch)
    const fx = -Math.sin(yaw) * cp
    const fy = Math.sin(pitch)
    const fz = -Math.cos(yaw) * cp
    const aim = (x: number, y: number, z: number, reach: number) => {
      const dx = x - ex
      const dy = y - ey
      const dz = z - ez
      const d = Math.hypot(dx, dy, dz)
      if (d > reach + 0.6 || Math.hypot(dx, dz) > reach) return -1
      return (dx * fx + dy * fy + dz * fz) / Math.max(d, 0.2) + (reach - d) * 0.05
    }
    let best = 0.3
    let npc: string | null = null
    for (const n of this.def.npcs) {
      const score = aim(n.pos[0], n.pos[1] + 1.4, n.pos[2], TALK_REACH)
      if (score > best) {
        best = score
        npc = n.name
      }
    }
    for (const w of this.walkers.values()) {
      const score = aim(w.to.x, w.to.y + 1.4, w.to.z, TALK_REACH)
      if (score > best) {
        best = score
        npc = WALKERS[w.to.who]?.name ?? w.to.who
      }
    }
    if (npc) return `Talk to ${npc}`
    let thing: Interactable | null = null
    best = 0.2
    for (const t of this.def.interactables) {
      const score = aim(t.pos[0], t.pos[1], t.pos[2], REACH)
      if (score > best) {
        best = score
        thing = t
      }
    }
    let loot: LootItem | null = null
    let lootScore = 0.2
    for (const shown of this.loot.all()) {
      const l = shown.loot
      const score = aim(l.x, l.y, l.z, REACH)
      if (score > lootScore) {
        lootScore = score
        loot = l
      }
    }
    // A doorway or window to board up.
    let spot = -1
    let spotScore = 0.35
    this.def.spots.forEach((p, i) => {
      const c = spotCentre(p)
      const score = aim(c.x, c.y, c.z, BOARD_REACH)
      if (score > spotScore) {
        spotScore = score
        spot = i
      }
    })
    if (spot >= 0 && (!loot || spotScore > lootScore) && (!thing || spotScore >= best)) {
      const planks = this.boards.planks(spot)
      if (state.crouched) return planks > 0 ? 'Pull a plank off' : null
      if (planks >= MAX_PLANKS) return 'Boarded up (crouch + E: pull a plank)'
      const have = countOf(this.self?.inv ?? [], PLANK_ITEM)
      const what = this.def.spots[spot]?.door ? 'door' : 'window'
      return have > 0
        ? `Board up the ${what} (${planks}/${MAX_PLANKS}, ${have} plank${have > 1 ? 's' : ''})`
        : `Board up the ${what}: needs planks`
    }
    if (loot && (!thing || lootScore >= best)) {
      const def = ITEMS[loot.item]
      const name =
        def?.kind === 'money'
          ? `$${loot.n}`
          : `${def?.name ?? loot.item}${loot.n > 1 ? ` ×${loot.n}` : ''}`
      return `Take ${name}`
    }
    if (thing) return thing.label
    const car = this.vehicles.prompt(state.pos)
    if (car) return car
    for (const lake of this.def.lakes) {
      if (Math.hypot(ex - lake.x, ez - lake.z) < lake.r && state.pos.y < lake.y + 0.1)
        return 'Drink'
    }
    return null
  }
}

/** Somebody standing still with empty hands (the people of Haven, and those who walk). */
function standing(
  id: number,
  pos: readonly [number, number, number],
  yaw: number,
  gear: number,
): RemotePlayerState {
  return {
    id,
    x: pos[0],
    y: pos[1],
    z: pos[2],
    yaw,
    pitch: 0,
    crouch: 0,
    grounded: true,
    alive: true,
    protected: false,
    // Empty hands.
    weapon: WeaponId.Claws,
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
    gear,
  }
}
