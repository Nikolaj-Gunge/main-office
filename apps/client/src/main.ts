import {
  type BaseWeaponId,
  Button,
  bodyParts,
  ClientMsg,
  type CoopGoal,
  createPhysicsWorld,
  DEFAULT_MAP_ID,
  DebugFlag,
  type GameRules,
  goalZones,
  HitZone,
  INFECTED_SPEED,
  INPUT_BATCH_TICKS,
  type InputCommand,
  initPhysics,
  loadMapAsync,
  MAP_IDS,
  type MatchInfo,
  type PartName,
  PLAYER_QUERY_GROUPS,
  RAPIER,
  ServerMsg,
  SURVIVAL_MAP,
  setGates,
  syncForest,
  TEAMS,
  TICK_DT,
  WEAPONS,
  WeaponId,
  weaponLook,
  weaponSway,
  ZombieKind,
} from '@office-fps/shared'
import Stats from 'stats-gl'
import * as THREE from 'three'
import { AudioEngine } from './audio/audio-engine.ts'
import { createSettingsGui } from './debug/gui.ts'
import { addNetworkFolder } from './debug/network.ts'
import { addTuningFolders } from './debug/tuning.ts'
import { ClientCombat } from './game/combat.ts'
import { FreeFly } from './game/free-fly.ts'
import { LocalPlayer } from './game/local-player.ts'
import { Recoil } from './game/recoil.ts'
import { RemotePlayers } from './game/remote-players.ts'
import { ScreenShake } from './game/screen-shake.ts'
import { Spectator } from './game/spectator.ts'
import { CombatHud } from './hud/combat-hud.ts'
import { MatchHud } from './hud/match-hud.ts'
import { Menu } from './hud/menu.ts'
import { Minimap } from './hud/minimap.ts'
import { ObjectiveMarker } from './hud/objective-marker.ts'
import { Overlay } from './hud/overlay.ts'
import { Scoreboard, type ScorePlayer } from './hud/scoreboard.ts'
import { actionFor, keyLabel } from './input/bindings.ts'
import { Keyboard } from './input/keyboard.ts'
import { MouseLook } from './input/mouse-look.ts'
import { AimState, samplePlayerInput } from './input/player-input.ts'
import { serverMap, trackPhysicsDownload } from './loading.ts'
import { Connection } from './net/connection.ts'
import { AutoQuality } from './render/auto-quality.ts'
import { Avatar } from './render/avatar.ts'
import { CoopZoneMarker } from './render/coop-zone.ts'
import { updateCorn } from './render/corn.ts'
import { DamageNumbers } from './render/damage-numbers.ts'
import { DebugHitboxes } from './render/debug-hitboxes.ts'
import { Effects } from './render/effects.ts'
import { createGameRenderer, rendererChoice } from './render/game-renderer.ts'
import { createLighting, gradeLighting } from './render/lighting.ts'
import { buildMapObject, swingLamps } from './render/map-mesh.ts'
import { Ragdolls } from './render/ragdoll.ts'
import { createSky, createSkyline } from './render/sky.ts'
import { setSmoothTextures } from './render/textures.ts'
import { Viewmodel } from './render/viewmodel.ts'
import { syncWindUniforms, tickWind, wind } from './render/wind.ts'
import { WorldItemsView } from './render/world-items.ts'
import { loadSettings, saveSettings } from './settings.ts'
import '@fontsource/pixelify-sans/400.css'
import '@fontsource/pixelify-sans/700.css'

function requireElement<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector)
  if (!el) throw new Error(`Missing element ${selector}`)
  return el
}

/** Set before reloading into a new map so the next page load rejoins on its own. */
const AUTOJOIN_KEY = 'office-fps:autojoin'

const hudRoot = requireElement<HTMLDivElement>('#hud')
const settings = loadSettings()
const hud = new CombatHud(hudRoot)
const overlay = new Overlay(hudRoot)
const scoreboard = new Scoreboard(hudRoot)
const menu = new Menu(hudRoot, settings, () => applySettings())

document.getElementById('boot')?.remove()

// --- World ----------------------------------------------------------------------------
// Rapier downloads and compiles while we find out which map to build and build it.
trackPhysicsDownload((done) => menu.setStatus(`Loading… ${Math.round(done * 100)}%`))
const physicsReady = initPhysics()
// `?map=gym` loads another map; otherwise the one the server runs (it says so again on join).
const params = new URLSearchParams(location.search)
const requestedMap = params.get('map') ?? (await serverMap(1500)) ?? ''
const mapId = MAP_IDS.includes(requestedMap) ? requestedMap : DEFAULT_MAP_ID
// Survival's code only loads for the survival map (it downloads alongside the world builder).
const survivalCode = mapId === SURVIVAL_MAP ? import('./game/survival-client.ts') : null
const map = await loadMapAsync(mapId)

// --- Rendering ------------------------------------------------------------------------
// WebGL by default; `?renderer=webgpu` (or the setting) tries WebGPU and falls back by itself.
const pixels = await createGameRenderer(
  requireElement<HTMLCanvasElement>('#game'),
  rendererChoice(settings),
)
const canvas = pixels.canvas
const scene = new THREE.Scene()
// Near plane 0.1 m (not closer): doubles depth precision, so far-away surfaces don't flicker.
const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 500)

const mapObject = buildMapObject(map)
scene.add(mapObject)
// Zombies mode: the current goal area in the world, and a waypoint to it on the HUD.
const coopZone = new CoopZoneMarker()
scene.add(coopZone.root)
// Survival lights itself (see SurvivalClient): a moon that follows you, lamps only nearby.
if (!map.survival) createLighting(map, scene)
// Survival: nothing past the fog is worth drawing (the sky is pinned to the far plane anyway);
// by day the haze lifts to ~420 m and a faint treeline stands at 560 m (see forest-lod.ts).
if (map.survival) camera.far = 640
// The map never moves: draw the sun's (big) shadow map once instead of every frame — the
// single most expensive thing a laptop GPU was doing each frame.
pixels.shadows.autoUpdate = false
pixels.shadows.needsUpdate = true
const graded = gradeLighting(map.lighting)
const sky = createSky(graded.skyColor, graded.fogColor)
scene.add(sky)
if (map.skyline) scene.add(createSkyline())

await physicsReady
performance.mark('load:physics')
menu.setStatus('')
const physics = createPhysicsWorld(map)
// Survival's world is far too big for the minimap: it has a compass and a real map instead.
const minimap = map.survival ? null : new Minimap(hudRoot, map)
if (map.survival)
  syncForest(physics, [{ x: map.spawns[0]?.pos[0] ?? 0, z: map.spawns[0]?.pos[2] ?? 0 }])
performance.mark('load:world')

const stats = new Stats({ trackGPU: true, horizontal: false })
stats.init(pixels.renderer)
document.body.appendChild(stats.dom)

/**
 * Horizontal FOV is what players configure; Three wants vertical. `zoom` > 1 narrows it
 * (aiming down sights).
 */
let currentZoom = 1
function updateProjection(zoom = currentZoom) {
  currentZoom = zoom
  const aspect = pixels.size.x / pixels.size.y
  const hfov = (settings.fov * Math.PI) / 180
  camera.fov = (2 * Math.atan(Math.tan(hfov / 2) / aspect / zoom) * 180) / Math.PI
  camera.aspect = aspect
  camera.updateProjectionMatrix()
  viewmodel.setAspect(aspect)
}

// --- Players & input ------------------------------------------------------------------
const keys = new Keyboard()
const look = new MouseLook(canvas)
const player = new LocalPlayer(physics, map.spawns[0])
const remotes = new RemotePlayers(scene)
look.yaw = player.state.yaw
const fly = new FreeFly(camera, keys, look)
const aim = new AimState()
let noclip = false

// --- Combat ---------------------------------------------------------------------------
const viewmodel = new Viewmodel()
const audio = new AudioEngine()
// `?mute=1` starts silent (used for automated test sessions); M toggles mute in game.
audio.muted = new URLSearchParams(location.search).has('mute')
const recoil = new Recoil()
const shake = new ScreenShake()
const worldRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })
const effects = new Effects(scene, (origin, dir, maxDistance) => {
  worldRay.origin = origin
  worldRay.dir = dir
  const hit = physics.world.castRayAndGetNormal(
    worldRay,
    maxDistance,
    true,
    undefined,
    PLAYER_QUERY_GROUPS,
  )
  return hit
    ? {
        distance: hit.timeOfImpact,
        normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      }
    : null
})
effects.onCasingHit = (at) => audio.playNear('casing', at, 0.45, 15)
const survival =
  map.survival && survivalCode
    ? new (await survivalCode).SurvivalClient({
        map,
        def: map.survival,
        scene,
        camera,
        physics,
        sky,
        hudRoot,
        audio,
        send: (action) => net.send({ type: ClientMsg.Action, action }),
      })
    : null
/** A survival screen that needs the mouse is open (backpack, shop): the menu stays away. */
let uiOpen = false
if (survival) {
  survival.hud.onModalChange = (open) => {
    uiOpen = open
    if (open) document.exitPointerLock()
    else closeMenu()
  }
  survival.hud.onSound = (cue) => {
    if (cue === 'open' || cue === 'close')
      audio.play('reload.in', { bus: 'ui', volume: 0.3, rate: cue === 'open' ? 1.3 : 1 })
    else if (cue === 'use') audio.play('pickup', { bus: 'ui', volume: 0.5 })
    else if (cue === 'deny') audio.play('dryfire', { bus: 'ui', volume: 0.5 })
    else if (cue === 'coin') audio.play('casing', { bus: 'ui', volume: 0.6 })
    else if (cue === 'quest') audio.play('hit.head', { bus: 'ui', volume: 0.5, rate: 0.8 })
    else if (cue === 'story') audio.play('dread', { bus: 'ui', volume: 0.35, rate: 1.2 })
  }
}
const debugHitboxes = new DebugHitboxes(scene)
const worldItems = new WorldItemsView(scene)
/** Ignore item sounds for the batch the server sends right after joining. */
let itemSoundsFrom = Number.POSITIVE_INFINITY

// Footsteps: yours (from the camera bob cycle) and everyone else's (from their movement).
player.feel.onFootstep = () => {
  const s = player.state
  const sprinting = Math.hypot(s.vel.x, s.vel.z) > player.movement.walkSpeed * 1.1
  audio.play('step', { volume: s.crouched ? 0.05 : sprinting ? 0.16 : 0.11 })
}
remotes.onFootstep = (at, sprinting) => audio.playNear('step', at, sprinting ? 0.8 : 0.55, 30)
remotes.onLand = (at) => audio.playNear('land', at, 0.6, 25)
remotes.onMove = (sound, at) => audio.playNear(sound, at, 0.5, 25)
remotes.onGroan = (at) => audio.playNear('groan', at, 0.9, 28)

// Ragdolls: players who die fall over instead of vanishing. The Kill message (which arrives
// ~100 ms before we draw the death) says who shot them, so the body flies the right way.
const ragdolls = new Ragdolls(scene, map)
const PUSH_SPEED: Record<BaseWeaponId, number> = {
  [WeaponId.Handgun]: 3,
  [WeaponId.Rifle]: 3.5,
  [WeaponId.Sniper]: 7,
  [WeaponId.Shotgun]: 6,
  [WeaponId.Knife]: 2.5,
  [WeaponId.Smg]: 3,
  [WeaponId.Lmg]: 4.5,
  [WeaponId.Claws]: 2,
}
const recentKills = new Map<number, { from: THREE.Vector3; weapon: WeaponId; headshot: boolean }>()
remotes.onDeath = (id, pose, velocity, colorIndex, skin, scale) => {
  const kill = recentKills.get(id)
  recentKills.delete(id)
  const at = new THREE.Vector3(pose.x, pose.y, pose.z)
  const dir = kill ? at.clone().sub(kill.from).setY(0) : new THREE.Vector3()
  if (dir.lengthSq() < 1e-6) dir.set(Math.sin(pose.yaw), 0, Math.cos(pose.yaw)) // falls backwards
  dir.normalize().setY(0.25).normalize()
  const speed = (kill ? PUSH_SPEED[weaponLook(kill.weapon)] : 2) + (kill?.headshot ? 1 : 0)
  const parts = bodyParts({ ...remotes.poseOf(id, pose), scale })
  ragdolls.spawn(skin, colorIndex, parts, scale, velocity, {
    dir,
    speed,
    headshot: kill?.headshot ?? false,
  })
}

// --- Networking -----------------------------------------------------------------------
/** True once the server has welcomed us: from then on the server owns our position. */
let joined = false
/** Have we ever been in a game this session? (Decides banner vs. menu status for problems.) */
let everJoined = false
/** Everyone's name and color, including ours (scoreboard, kill feed). */
const roster = new Map<number, ScorePlayer>()

const combat = new ClientCombat({
  camera,
  physics,
  effects,
  hud,
  viewmodel,
  remotes,
  debug: debugHitboxes,
  audio,
  recoil,
  shake,
  myId: () => net.playerId,
})

const net = new Connection({
  onState: (state, reason) => {
    if (state === 'closed') {
      joined = false
      remotes.clear()
      roster.clear()
      worldItems.clear()
      menu.setJoined(false)
      survival?.hud.setVisible(false)
      const fatal = reason?.includes('Protocol') ?? false
      const text = reason
        ? fatal
          ? 'The game was updated — reload to keep playing.'
          : `Disconnected: ${reason}`
        : 'Connection lost — reconnecting…'
      menu.setStatus(text)
      if (everJoined || fatal) overlay.setBanner(text, fatal)
    }
    if (state === 'connecting') menu.setStatus('Connecting…')
  },
  onMessage: (msg) => {
    combat.onMessage(msg)
    if (survival?.onMessage(msg)) return
    switch (msg.type) {
      case ServerMsg.Welcome:
        if (msg.mapId !== map.id && MAP_IDS.includes(msg.mapId)) {
          // Server runs another map (or the admin just switched it): reload into it and
          // rejoin straight away (keeps ?mute and other params).
          if (joined) sessionStorage.setItem(AUTOJOIN_KEY, '1')
          params.set('map', msg.mapId)
          location.search = params.toString()
          return
        }
        joined = true
        noclip = false
        remotes.clear()
        player.resetPrediction()
        menu.setJoined(true)
        menu.setStatus('')
        worldItems.clear()
        survival?.reset()
        itemSoundsFrom = performance.now() + 500
        overlay.setBanner(null)
        everJoined = true
        if (debugHitboxes.enabled) net.send({ type: ClientMsg.SetDebug, flags: DebugFlag.LagComp })
        break
      case ServerMsg.PlayerJoined: {
        // Zombies (zombies mode) are drawn and named as such, and stay off the scoreboard;
        // survival names the ones who were survivors ("Ray (turned)").
        const kind = msg.kind ?? 0
        const name =
          kind === 0 || msg.name !== 'Zombie' ? msg.name : (ZOMBIE_NAMES[kind] ?? 'Zombie')
        combat.setName(msg.id, name)
        if (kind === 0) roster.set(msg.id, { name: msg.name, color: msg.color })
        else roster.delete(msg.id)
        if (msg.id !== net.playerId) remotes.add(msg.id, name, msg.color, kind, msg.appearance)
        break
      }
      case ServerMsg.PlayerLeft:
        combat.forget(msg.id)
        roster.delete(msg.id)
        remotes.remove(msg.id)
        break
      case ServerMsg.Snapshot:
        if (msg.self) player.onServerState(msg.self, msg.ackSeq)
        remotes.onSnapshot(msg.tick, msg.players, performance.now())
        break
      case ServerMsg.Scoreboard:
        scoreboard.update(msg.entries)
        break
      case ServerMsg.ItemSpawn:
        worldItems.add(msg.id, msg.weapon, msg.pos, msg.yaw)
        if (performance.now() > itemSoundsFrom) audio.playNear('land', msg.pos, 0.35, 20)
        break
      case ServerMsg.ItemRemove:
        worldItems.remove(msg.id)
        break
      case ServerMsg.Rules:
        applyRules(msg.rules)
        break
      case ServerMsg.Match:
        onMatch(msg.match)
        break
      case ServerMsg.HitConfirm:
        if (lastRules?.showDamage) showDamageNumber(msg.victimId, msg.zone, msg.damage, msg.killed)
        break
      case ServerMsg.Kill: {
        const killer =
          msg.killerId === net.playerId ? camera.position.clone() : remotes.muzzleOf(msg.killerId)
        if (killer) {
          recentKills.set(msg.victimId, {
            from: killer,
            weapon: msg.weapon,
            headshot: msg.headshot,
          })
        }
        break
      }
      case ServerMsg.ShotFired: {
        // Shooting gives your position away on the minimap.
        const at = remotes.muzzleOf(msg.shooterId)
        if (at) minimap?.ping(at.x, at.z)
        break
      }
    }
  },
})

const ZOMBIE_NAMES: Record<number, string> = {
  [ZombieKind.Runner]: 'Runner',
  [ZombieKind.Brute]: 'Brute',
  [ZombieKind.Screamer]: 'Screamer',
  [ZombieKind.Stalker]: '???',
}

/** Server game rules (admin page): movement, shooting, looks and kill jingles. */
let lastRules: GameRules | null = null
let match: MatchInfo | null = null
function applyRules(rules: GameRules) {
  lastRules = rules
  // Infected run faster: predict with the same speed the server uses for us.
  const infected = match?.mode === 'infection' && myTeam() === 2
  player.applyRules(infected ? { ...rules, speed: rules.speed * INFECTED_SPEED } : rules)
  recoil.amount = rules.recoil
  remotes.setLook(rules.skin, rules.playerScale)
  combat.jingles = rules.jingles
  ragdolls.setGravity(rules.gravity)
}

// "Show damage" (admin): a number next to the body part you hit, with the zone and distance.
const damageNumbers = new DamageNumbers(scene)
const ZONE_PART: Record<number, PartName> = {
  [HitZone.Head]: 'head',
  [HitZone.Chest]: 'chest',
  [HitZone.Stomach]: 'stomach',
  [HitZone.Arm]: 'armR',
  [HitZone.Leg]: 'thighR',
}
const ZONE_LABEL: Record<number, string> = {
  [HitZone.Head]: 'HEAD',
  [HitZone.Chest]: 'chest',
  [HitZone.Stomach]: 'stomach',
  [HitZone.Arm]: 'arm',
  [HitZone.Leg]: 'leg',
}
function showDamageNumber(victimId: number, zone: HitZone, damage: number, killed: boolean) {
  const pose = remotes.visiblePoses().get(victimId)
  if (!pose) return
  const part = bodyParts(pose).find((p) => p.name === ZONE_PART[zone]) ?? bodyParts(pose)[0]
  if (!part) return
  // Beside the body (to the right as you look at them), at the height of the part you hit.
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).setY(0).normalize()
  const at = new THREE.Vector3(part.center.x, part.center.y, part.center.z).addScaledVector(
    right,
    0.55,
  )
  const distance = camera.position.distanceTo(new THREE.Vector3(pose.x, pose.y, pose.z))
  const detail = `${killed ? 'KILL · ' : ''}${ZONE_LABEL[zone] ?? ''} · ${distance.toFixed(1)} m`
  const color = killed ? '#ff4a3d' : zone === HitZone.Head ? '#ffd23d' : '#ffffff'
  damageNumbers.show(at, damage, detail, color)
}

const matchHud = new MatchHud(hudRoot)
matchHud.coop = map.coop
matchHud.onStageDone = () =>
  audio.play('jingle.fanfare', { bus: 'ui', rate: 1, volume: 0.6, variant: 1 })
matchHud.onRoundEnd = (won) =>
  audio.play('jingle.fanfare', { bus: 'ui', rate: 1, volume: 0.8, variant: won ? 2 : 0 })
function myTeam(): number {
  return match?.players.find((p) => p.id === net.playerId)?.team ?? 0
}
/** Mode, clock, scores and teams (once a second, and when something changes). */
function onMatch(next: MatchInfo) {
  const wasTeam = myTeam()
  match = next
  syncCoop(next)
  survival?.setShared(next.survival)
  survival?.hud.setVisible(joined && next.mode === 'survival')
  document.body.classList.toggle('survival', next.mode === 'survival')
  menu.setMode(next.mode)
  matchHud.update(next, net.playerId, (id) => roster.get(id)?.name ?? `Player ${id}`)
  const teams = TEAMS[next.mode]
  const teamOf = new Map(next.players.map((p) => [p.id, p.team]))
  remotes.setTeams((id) => {
    const team = teamOf.get(id) ?? 0
    return teams && team !== 0 ? teams[team as 1 | 2].color : null
  })
  if (myTeam() !== wasTeam && lastRules) applyRules(lastRules)
}

/** Zombies mode: open gates (physics, ragdolls and what you see) and the goal marker. */
let gatesShown = -1
function syncCoop(next: MatchInfo) {
  const coop = next.mode === 'zombies' ? next.coop : undefined
  const open = coop ? coop.gates : (next.survival?.gates ?? 0xffff)
  if (open !== gatesShown) {
    gatesShown = open
    const isOpen = (id: number) => (open & (1 << id)) !== 0
    setGates(physics, isOpen)
    ragdolls.setGates(isOpen)
    for (const child of mapObject.children) {
      if (child.name.startsWith('gate:')) child.visible = !isOpen(Number(child.name.slice(5)))
    }
    pixels.shadows.needsUpdate = true
  }
  const goal = coop ? map.coop?.stages[coop.stage]?.goal : undefined
  // Activate goals: only the spots still to do.
  const zones = goal && next.phase === 'playing' ? goalZones(goal) : []
  coopZone.set(
    goal?.kind === 'activate' ? zones.filter((_, i) => !((coop?.parts ?? 0) & (1 << i))) : zones,
  )
  hud.outText = next.mode === 'zombies' ? 'Back at the next checkpoint' : 'Out until the next round'
}
const objective = new ObjectiveMarker(hudRoot)
// Dead with teammates still up: follow one of them (click for the next, right-click back).
const spectator = new Spectator(hudRoot)
const viewRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })
window.addEventListener('mousedown', (e) => {
  if (spectator.active) spectator.cycle(e.button === 2 ? -1 : 1)
})
/** Teammates you can watch: same team, in a mode that has teams (zombies: the survivors). */
function teammates(): number[] {
  const team = myTeam()
  if (!match || team === 0) return []
  return match.players.filter((p) => p.team === team && p.id !== net.playerId).map((p) => p.id)
}
/** What the co-op waypoint says over the goal. */
function waypointText(goal: CoopGoal): string {
  if (goal.kind === 'hold') return 'HOLD'
  if (goal.kind === 'activate' || goal.kind === 'defend') return goal.what.toUpperCase()
  return 'GO'
}
const goalAt = new THREE.Vector3()

// After the admin switches map the page reloads into it: rejoin without the Play click (the
// mouse still needs one click to lock — browsers require it).
if (sessionStorage.getItem(AUTOJOIN_KEY)) {
  sessionStorage.removeItem(AUTOJOIN_KEY)
  net.connect(menu.name, menu.appearance)
}

menu.onPlay((name) => {
  audio.unlock() // browsers only allow audio after a click
  if (net.state === 'idle') net.connect(name, menu.appearance)
  void look.lock()
})
// A new look applies the next time you join (a reconnect included).
menu.onCharacter((appearance) => {
  net.appearance = appearance
})
// Esc releases the mouse: show the menu. Clicking Resume locks it again.
look.onLockChange = (locked) => {
  menu.setVisible(!locked && !resumeByClick && !uiOpen)
  if (locked) {
    resumeByClick = false
    overlay.setBanner(null)
  }
}

/**
 * Esc again closes the menu. Browsers don't let a page re-capture the mouse from an Esc key
 * press (it isn't a "user activation", and Chrome adds a cooldown after leaving), so when that
 * is refused we wait for a click on the game instead.
 */
let resumeByClick = false
function closeMenu(): void {
  menu.setVisible(false)
  const refused = () => {
    if (look.locked || menu.visible) return
    resumeByClick = true
    overlay.setBanner('Click to resume')
  }
  // Some browsers reject the request, others just never lock: check shortly after either way.
  look.lock().catch(refused)
  setTimeout(refused, 300)
}
canvas.addEventListener('click', () => {
  if (resumeByClick) void look.lock()
})

// --- Settings -------------------------------------------------------------------------
const autoQuality = new AutoQuality()
let qualityFor = ''

function applySettings() {
  // A new pixel size (or auto quality switched off) starts from the player's choice again.
  const quality = `${settings.pixelHeight}/${settings.autoQuality}`
  if (quality !== qualityFor) {
    qualityFor = quality
    autoQuality.reset()
    pixels.setBias(0)
  }
  setSmoothTextures(settings.smoothPixels, Math.min(8, pixels.maxAnisotropy()))
  pixels.applySettings(settings)
  look.sensitivity = settings.sensitivity
  audio.setVolumes(settings.masterVolume, settings.sfxVolume)
  aim.toggle = settings.aimToggle
  if (!aim.toggle) aim.release()
  stats.dom.style.display = settings.showStats ? '' : 'none'
  overlay.setDebugVisible(settings.showDebug)
  updateProjection()
  saveSettings(settings)
}

const gui = createSettingsGui(settings, () => {
  applySettings()
  menu.refresh()
})
addTuningFolders(gui, player)
addNetworkFolder(gui, net, remotes)
// Out of sight until F1: it covered the quest tracker.
gui.hide()

let scoreboardHeld = false
window.addEventListener('keyup', (e) => {
  if (actionFor(settings.keybinds, e.code) === 'scoreboard') scoreboardHeld = false
})
window.addEventListener('keydown', (e) => {
  if (menu.isCapturing) return // rebinding a key in the menu
  const action = actionFor(settings.keybinds, e.code)
  const surviving = survival !== null && joined && match?.mode === 'survival'
  if (surviving && survival && !menu.visible) {
    // The backpack, the shop, the map and conversations get first go at every key.
    if (e.code === 'Escape' ? survival.hud.close() : survival.hud.key(e.code)) {
      e.preventDefault()
      if (!e.repeat && (action === 'scoreboard' || action === 'inventory'))
        survival.hud.toggleBackpack()
      return
    }
    if (!e.repeat) {
      if (action === 'scoreboard' || action === 'inventory') {
        e.preventDefault()
        survival.hud.toggleBackpack()
        return
      }
      if (action === 'map') return survival.hud.toggleMap()
      if (action === 'light') return survival.toggleTorch()
    }
  }
  if (action === 'scoreboard') {
    e.preventDefault() // Tab would move focus
    scoreboardHeld = !surviving
  }
  if (e.repeat) return
  if (e.code === 'Escape' && menu.visible && menu.isJoined && !look.locked) {
    e.preventDefault()
    closeMenu()
    return
  }
  if (e.code === 'Escape' && resumeByClick) {
    // Waiting for the resume click: Esc brings the menu back (it toggles).
    resumeByClick = false
    overlay.setBanner(null)
    menu.setVisible(true)
    return
  }
  if (e.code === 'F1') {
    e.preventDefault()
    if (gui._hidden) {
      gui.show()
      gui.open()
      // Interacting with the panel needs a free cursor.
      document.exitPointerLock()
    } else gui.hide()
  }
  if (e.code === 'F3') {
    e.preventDefault()
    settings.showDebug = !settings.showDebug
    applySettings()
    menu.refresh()
    for (const c of gui.controllersRecursive()) c.updateDisplay()
  }
  if (action === 'mute' || action === 'map') {
    audio.muted = !audio.muted
    overlay.flash(audio.muted ? 'Sound off (M)' : 'Sound on (M)')
  }
  if (e.code === 'F4') {
    e.preventDefault()
    debugHitboxes.enabled = !debugHitboxes.enabled
    net.send({ type: ClientMsg.SetDebug, flags: debugHitboxes.enabled ? DebugFlag.LagComp : 0 })
  }
  if (e.code === 'KeyV') {
    noclip = !noclip
    // Offline, leaving noclip drops you where the camera is. Online the server owns your
    // position, so the camera just returns to your player.
    if (!noclip && !joined) {
      const eye = player.movement.standEyeHeight
      player.teleport(camera.position.x, camera.position.y - eye, camera.position.z)
    }
  }
})

window.addEventListener('resize', () => {
  pixels.resize()
  updateProjection()
})
pixels.resize()
applySettings()

// --- Weapons on the floor --------------------------------------------------------------
let lastPrimary: number | null = null
/** Swap prompt when standing at a weapon with a full slot; pickup sound when it changes. */
function updatePickups() {
  const s = player.state
  if (survival && match?.mode === 'survival') {
    const key = keyLabel(settings.keybinds.use[0] ?? 'KeyE')
    hud.setPickupPrompt(survival.prompt && joined ? `[${key}] ${survival.prompt}` : null)
    return
  }
  const primaryOf = (w: { id: WeaponId } | null) =>
    w && WEAPONS[w.id].slot === 'primary' ? w.id : null
  const primary = primaryOf(s.weapon) ?? primaryOf(s.holstered) ?? primaryOf(s.pocket)
  if (s.alive && primary !== null && primary !== lastPrimary && joined) {
    audio.play('reload.slide', { volume: 0.7 })
  }
  lastPrimary = s.alive ? primary : null
  const near = s.alive && primary !== null ? worldItems.nearestInReach(s.pos) : null
  const key = keyLabel(settings.keybinds.use[0] ?? 'KeyE')
  hud.setPickupPrompt(near ? `[${key}] Swap for ${WEAPONS[near.weapon].name.toUpperCase()}` : null)
}

// --- Loop -----------------------------------------------------------------------------
/** Max ticks to simulate per frame; beyond this we drop time instead of spiralling. */
const MAX_TICKS_PER_FRAME = 8
let last = performance.now()
let accumulator = 0
let fpsSmoothed = 60
/** Last ~2 s of frame times (ms), for spotting stalls in the F3 readout. */
const frameTimes = new Float32Array(120)
let frameIndex = 0
const outgoing: InputCommand[] = []

/**
 * Compiles every shader the game will need now, while loading, instead of stalling a frame the
 * first time a zombie, a muzzle flash or a blood splash shows up: one body of every look is put
 * out of sight for the moment, and hidden pooled effects are briefly shown to the compiler.
 */
async function warmShaders(): Promise<void> {
  const looks = ['worker', 'zombie', 'runner', 'brute', 'screamer', 'stalker'] as const
  const bodies = looks.map((look, i) => {
    const body = new Avatar('', i, look)
    body.root.position.set(0, -5000, 0)
    scene.add(body.root)
    return body
  })
  const hidden: THREE.Object3D[] = []
  scene.traverse((o) => {
    if (!o.visible) {
      hidden.push(o)
      o.visible = true
    }
  })
  try {
    await pixels.compile(scene, camera)
  } finally {
    for (const o of hidden) o.visible = false
    for (const body of bodies) {
      scene.remove(body.root)
      body.dispose()
    }
  }
}
// Survival: the ground you start on, so its shaders are warmed too.
survival?.prime(player.state.pos.x, player.state.pos.z)
performance.mark('load:scene')
await warmShaders()
performance.mark('load:shaders')

let firstFrame = true
pixels.setAnimationLoop(() => {
  const now = performance.now()
  const dt = Math.min(0.25, (now - last) / 1000)
  last = now
  fpsSmoothed += (1 / Math.max(dt, 1e-4) - fpsSmoothed) * 0.05
  frameTimes[frameIndex++ % frameTimes.length] = dt * 1000
  // Automatic quality: coarser pixels when frames run slow, finer again when there's room.
  if (settings.autoQuality && autoQuality.frame(dt)) pixels.setBias(autoQuality.bias)

  // The player keeps simulating in noclip while online (standing still), so the server and
  // prediction stay in step.
  accumulator += dt
  let ticks = 0
  while (accumulator >= TICK_DT && ticks < MAX_TICKS_PER_FRAME) {
    const sampled = samplePlayerInput(keys, look, settings.keybinds, aim)
    // A survival screen is open: stand still. Talking: the digits answer, they don't draw guns.
    if (uiOpen) sampled.buttons = 0
    else if (survival?.hud.inDialog)
      sampled.buttons &= ~(Button.Slot1 | Button.Slot2 | Button.Slot3)
    const input = noclip ? { buttons: 0, yaw: look.yaw, pitch: look.pitch } : sampled
    const { command, events } = player.tick(input, remotes.renderTick)
    const aiming = (input.buttons & Button.Aim) !== 0
    if (events.shot) combat.onLocalShot(events.shot, player.state.weapon.id, aiming)
    if (events.weapon) combat.onWeaponEvents(events.weapon, player.state.weapon)
    // Toggle-aim drops out of the scope like letting go would: reload, switch, death.
    if (events.switched || events.weapon?.reloadStarted || !player.state.alive) aim.release()
    if (events.landed && events.landingSpeed > 3) {
      audio.play('land', { volume: Math.min(0.35, events.landingSpeed / 20) })
    }
    if (events.slid) audio.play('slide', { volume: 0.3 })
    if (events.mantled) audio.play('mantle', { volume: 0.3 })
    if (events.proned) audio.play('prone', { volume: 0.25 })
    if (joined) outgoing.push(command)
    accumulator -= TICK_DT
    ticks++
  }
  if (ticks === MAX_TICKS_PER_FRAME) accumulator = 0
  if (outgoing.length >= INPUT_BATCH_TICKS) {
    net.send({ type: ClientMsg.Input, commands: outgoing.splice(0, outgoing.length) })
  }

  if (noclip) fly.update(dt)
  else {
    // Recoil moves the real aim; shake only the camera.
    const kick = recoil.update(dt)
    look.addRotation(kick.yaw, kick.pitch)
    player.updateCamera(camera, accumulator / TICK_DT, look.yaw, look.pitch, dt)
    // Scope sway: the view drifts exactly as much as the bullet will (shared weaponSway).
    const sway = weaponSway(player.state.weapon)
    camera.rotation.x += sway.pitch
    camera.rotation.y += sway.yaw
    const s = shake.update(dt)
    camera.rotation.x += s.pitch
    camera.rotation.y += s.yaw
    camera.rotation.z += s.roll
  }
  if (!player.state.alive) recoil.reset()
  if (!noclip && joined) {
    spectator.update(
      dt,
      player.state.alive,
      teammates(),
      remotes.visiblePoses(),
      camera,
      (from, dir, max) => {
        viewRay.origin = from
        viewRay.dir = dir
        const hit = physics.world.castRay(viewRay, max, true, undefined, PLAYER_QUERY_GROUPS)
        return hit ? hit.timeOfImpact : max
      },
      (id) => roster.get(id)?.name ?? remotes.nameOf(id) ?? `Player ${id}`,
    )
  }

  // Aiming down sights zooms the view; sensitivity follows so aim speed feels the same.
  const zoom = 1 + (WEAPONS[player.state.weapon.id].aimZoom - 1) * viewmodel.aimProgress
  if (Math.abs(zoom - currentZoom) > 1e-4) updateProjection(zoom)
  look.sensitivityScale = 1 / zoom
  camera.updateMatrixWorld()
  audio.setListener(camera)
  audio.update(dt)
  // One wind for the trees, the lamps and the leaves.
  tickWind(now / 1000)
  syncWindUniforms()
  swingLamps(mapObject, wind.time, map.survival !== undefined)
  remotes.update(now, camera.position)
  updateCorn(now / 1000, [...remotes.visiblePoses().values(), camera.position], camera.position)
  if (survival?.update(dt, player.state, combat.health, look.yaw, look.pitch, remotes)) {
    pixels.shadows.needsUpdate = true
  }
  pixels.setInfection(survival?.infectionFx ?? null)
  ragdolls.update(dt)
  damageNumbers.update(dt)
  coopZone.update(dt)
  matchHud.tick()
  const stage = match?.coop ? map.coop?.stages[match.coop.stage] : undefined
  objective.update(
    camera,
    joined && !noclip && match?.phase === 'playing'
      ? coopZone.centre(goalAt, camera.position)
      : null,
    stage ? waypointText(stage.goal) : '',
  )
  worldItems.update(dt)
  minimap?.setItems(worldItems.positions())
  updatePickups()
  minimap?.update(dt, player.state.pos, look.yaw)
  minimap?.setVisible(joined && !noclip)
  scoreboard.show(scoreboardHeld && joined, roster, net.playerId)
  combat.update(
    dt,
    player.state,
    { yaw: look.yaw, pitch: look.pitch, delta: look.takeDelta() },
    { phase: player.feel.phase, weight: player.feel.bobWeight },
    player.movement.walkSpeed,
  )

  sky.position.copy(camera.position)
  pixels.render(scene, camera, noclip ? undefined : viewmodel)
  stats.update()
  if (firstFrame) {
    firstFrame = false
    performance.mark('load:first-frame')
  }

  if (settings.showDebug) {
    const s = player.state
    const deg = 180 / Math.PI
    const kb = (b: number) => (b / 1024).toFixed(1)
    overlay.debug.textContent = [
      `${fpsSmoothed.toFixed(0)} fps · ${pixels.size.x}×${pixels.size.y} ×${pixels.scale.toFixed(2)} · ${pixels.backend}`,
      `worst frame ${Math.max(...frameTimes).toFixed(1)} ms (last 2 s)`,
      noclip
        ? `NOCLIP (V) · cam ${camera.position.x.toFixed(2)} ${camera.position.y.toFixed(2)} ${camera.position.z.toFixed(2)}`
        : `feet ${s.pos.x.toFixed(2)} ${s.pos.y.toFixed(2)} ${s.pos.z.toFixed(2)}`,
      `speed ${Math.hypot(s.vel.x, s.vel.z).toFixed(2)} m/s · vy ${s.vel.y.toFixed(2)}`,
      `${s.grounded ? 'grounded' : 'airborne'}${s.crouched ? ' · crouched' : ''}`,
      `yaw ${(look.yaw * deg).toFixed(1)}° pitch ${(look.pitch * deg).toFixed(1)}°`,
      joined
        ? [
            `net #${net.playerId} · ping ${net.rtt.toFixed(0)} ms · ${remotes.count} others`,
            `in ${kb(net.bytesInPerSec)} kB/s · out ${kb(net.bytesOutPerSec)} kB/s · server tick ${net.serverTickMs.toFixed(2)} ms`,
            `pending ${player.predictor.pendingCount} · last correction ${(player.lastCorrection * 100).toFixed(1)} cm`,
            net.sim.active ? `NET SIM +${net.sim.latencyMs}±${net.sim.jitterMs} ms each way` : '',
          ].join('\n')
        : `offline (${net.state})`,
    ].join('\n')
  }
})

// Dev-only handle for debugging from the console and automated visual checks.
if (import.meta.env.DEV) {
  Object.assign(window, {
    __game: {
      camera,
      look,
      settings,
      applySettings,
      pixels,
      scene,
      player,
      keys,
      net,
      remotes,
      hud,
      debugHitboxes,
      audio,
      recoil,
      effects,
      viewmodel,
      worldItems,
      ragdolls,
      damageNumbers,
      survival,
    },
  })
}
