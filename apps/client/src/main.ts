import {
  Button,
  ClientMsg,
  createPhysicsWorld,
  DEFAULT_MAP_ID,
  DebugFlag,
  type GameRules,
  INPUT_BATCH_TICKS,
  type InputCommand,
  initPhysics,
  loadMap,
  MAPS,
  PLAYER_QUERY_GROUPS,
  RAPIER,
  ServerMsg,
  TICK_DT,
  WEAPONS,
  WeaponId,
  weaponSway,
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
import { CombatHud } from './hud/combat-hud.ts'
import { Menu } from './hud/menu.ts'
import { Minimap } from './hud/minimap.ts'
import { Overlay } from './hud/overlay.ts'
import { Scoreboard, type ScorePlayer } from './hud/scoreboard.ts'
import { actionFor, keyLabel } from './input/bindings.ts'
import { Keyboard } from './input/keyboard.ts'
import { MouseLook } from './input/mouse-look.ts'
import { AimState, samplePlayerInput } from './input/player-input.ts'
import { Connection } from './net/connection.ts'
import { DebugHitboxes } from './render/debug-hitboxes.ts'
import { Effects } from './render/effects.ts'
import { createLighting } from './render/lighting.ts'
import { buildMapObject } from './render/map-mesh.ts'
import { PixelRenderer } from './render/pixel-renderer.ts'
import { Ragdolls } from './render/ragdoll.ts'
import { createSky, createSkyline } from './render/sky.ts'
import { Viewmodel } from './render/viewmodel.ts'
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

const canvas = requireElement<HTMLCanvasElement>('#game')
const hudRoot = requireElement<HTMLDivElement>('#hud')
const settings = loadSettings()
const hud = new CombatHud(hudRoot)
const overlay = new Overlay(hudRoot)
const scoreboard = new Scoreboard(hudRoot)
const menu = new Menu(hudRoot, settings, () => applySettings())

// --- World ----------------------------------------------------------------------------
await initPhysics()
// `?map=gym` loads another map (the server tells us which one it runs on join).
const params = new URLSearchParams(location.search)
const requestedMap = params.get('map') ?? ''
const mapId = requestedMap in MAPS ? requestedMap : DEFAULT_MAP_ID
const map = loadMap(mapId)
const physics = createPhysicsWorld(map)
const minimap = new Minimap(hudRoot, map)

// --- Rendering ------------------------------------------------------------------------
const pixels = new PixelRenderer(canvas)
const scene = new THREE.Scene()
// Near plane 0.1 m (not closer): doubles depth precision, so far-away surfaces don't flicker.
const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 500)

scene.add(buildMapObject(map))
createLighting(map, scene)
// The map never moves: draw the sun's (big) shadow map once instead of every frame — the
// single most expensive thing a laptop GPU was doing each frame.
pixels.renderer.shadowMap.autoUpdate = false
pixels.renderer.shadowMap.needsUpdate = true
const sky = createSky(map.lighting.skyColor, map.lighting.fogColor)
scene.add(sky)
if (map.skyline) scene.add(createSkyline())

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

// Ragdolls: players who die fall over instead of vanishing. The Kill message (which arrives
// ~100 ms before we draw the death) says who shot them, so the body flies the right way.
const ragdolls = new Ragdolls(scene, map)
const PUSH_SPEED: Record<WeaponId, number> = {
  [WeaponId.Handgun]: 3,
  [WeaponId.Rifle]: 3.5,
  [WeaponId.Sniper]: 7,
  [WeaponId.Shotgun]: 6,
  [WeaponId.Knife]: 2.5,
}
const recentKills = new Map<number, { from: THREE.Vector3; weapon: WeaponId; headshot: boolean }>()
remotes.onDeath = (id, pose, velocity, colorIndex, skin, scale) => {
  const kill = recentKills.get(id)
  recentKills.delete(id)
  const at = new THREE.Vector3(pose.x, pose.y, pose.z)
  const dir = kill ? at.clone().sub(kill.from).setY(0) : new THREE.Vector3()
  if (dir.lengthSq() < 1e-6) dir.set(Math.sin(pose.yaw), 0, Math.cos(pose.yaw)) // falls backwards
  dir.normalize().setY(0.25).normalize()
  const speed = (kill ? PUSH_SPEED[kill.weapon] : 2) + (kill?.headshot ? 1 : 0)
  ragdolls.spawn(skin, colorIndex, pose, scale, velocity, {
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
    switch (msg.type) {
      case ServerMsg.Welcome:
        if (msg.mapId !== map.id && msg.mapId in MAPS) {
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
        itemSoundsFrom = performance.now() + 500
        overlay.setBanner(null)
        everJoined = true
        if (debugHitboxes.enabled) net.send({ type: ClientMsg.SetDebug, flags: DebugFlag.LagComp })
        break
      case ServerMsg.PlayerJoined:
        combat.setName(msg.id, msg.name)
        roster.set(msg.id, { name: msg.name, color: msg.color })
        if (msg.id !== net.playerId) remotes.add(msg.id, msg.name, msg.color)
        break
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
        if (at) minimap.ping(at.x, at.z)
        break
      }
    }
  },
})

/** Server game rules (admin page): movement, shooting, looks and kill jingles. */
function applyRules(rules: GameRules) {
  player.applyRules(rules)
  recoil.amount = rules.recoil
  remotes.setLook(rules.skin, rules.playerScale)
  combat.jingles = rules.jingles
  ragdolls.setGravity(rules.gravity)
}

// After the admin switches map the page reloads into it: rejoin without the Play click (the
// mouse still needs one click to lock — browsers require it).
if (sessionStorage.getItem(AUTOJOIN_KEY)) {
  sessionStorage.removeItem(AUTOJOIN_KEY)
  net.connect(menu.name)
}

menu.onPlay((name) => {
  audio.unlock() // browsers only allow audio after a click
  if (net.state === 'idle') net.connect(name)
  void look.lock()
})
// Esc releases the mouse: show the menu. Clicking Resume locks it again.
look.onLockChange = (locked) => {
  menu.setVisible(!locked && !resumeByClick)
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
function applySettings() {
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

let scoreboardHeld = false
window.addEventListener('keyup', (e) => {
  if (actionFor(settings.keybinds, e.code) === 'scoreboard') scoreboardHeld = false
})
window.addEventListener('keydown', (e) => {
  if (menu.isCapturing) return // rebinding a key in the menu
  const action = actionFor(settings.keybinds, e.code)
  if (action === 'scoreboard') {
    e.preventDefault() // Tab would move focus
    scoreboardHeld = true
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
    if (gui._closed) gui.open()
    else gui.close()
    // Interacting with the panel needs a free cursor.
    if (!gui._closed) document.exitPointerLock()
  }
  if (e.code === 'F3') {
    e.preventDefault()
    settings.showDebug = !settings.showDebug
    applySettings()
    menu.refresh()
    for (const c of gui.controllersRecursive()) c.updateDisplay()
  }
  if (action === 'mute') {
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
  const primary = s.weapon.id !== WeaponId.Handgun ? s.weapon.id : (s.holstered?.id ?? null)
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

pixels.renderer.setAnimationLoop(() => {
  const now = performance.now()
  const dt = Math.min(0.25, (now - last) / 1000)
  last = now
  fpsSmoothed += (1 / Math.max(dt, 1e-4) - fpsSmoothed) * 0.05
  frameTimes[frameIndex++ % frameTimes.length] = dt * 1000

  // The player keeps simulating in noclip while online (standing still), so the server and
  // prediction stay in step.
  accumulator += dt
  let ticks = 0
  while (accumulator >= TICK_DT && ticks < MAX_TICKS_PER_FRAME) {
    const input = noclip
      ? { buttons: 0, yaw: look.yaw, pitch: look.pitch }
      : samplePlayerInput(keys, look, settings.keybinds, aim)
    const { command, events } = player.tick(input, remotes.renderTick)
    const aiming = (input.buttons & Button.Aim) !== 0
    if (events.shot) combat.onLocalShot(events.shot, player.state.weapon.id, aiming)
    if (events.weapon) combat.onWeaponEvents(events.weapon, player.state.weapon)
    // Toggle-aim drops out of the scope like letting go would: reload, switch, death.
    if (events.switched || events.weapon?.reloadStarted || !player.state.alive) aim.release()
    if (events.landed && events.landingSpeed > 3) {
      audio.play('land', { volume: Math.min(0.35, events.landingSpeed / 20) })
    }
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

  // Aiming down sights zooms the view; sensitivity follows so aim speed feels the same.
  const zoom = 1 + (WEAPONS[player.state.weapon.id].aimZoom - 1) * viewmodel.aimProgress
  if (Math.abs(zoom - currentZoom) > 1e-4) updateProjection(zoom)
  look.sensitivityScale = 1 / zoom
  camera.updateMatrixWorld()
  audio.setListener(camera)
  audio.update(dt)
  remotes.update(now, camera.position)
  ragdolls.update(dt)
  worldItems.update(dt)
  minimap.setItems(worldItems.positions())
  updatePickups()
  minimap.update(dt, player.state.pos, look.yaw)
  minimap.setVisible(joined && !noclip)
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

  if (settings.showDebug) {
    const s = player.state
    const deg = 180 / Math.PI
    const kb = (b: number) => (b / 1024).toFixed(1)
    overlay.debug.textContent = [
      `${fpsSmoothed.toFixed(0)} fps · ${pixels.size.x}×${pixels.size.y} ×${pixels.scale}`,
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
    },
  })
}
