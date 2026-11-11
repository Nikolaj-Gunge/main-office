import {
  ClientMsg,
  createPhysicsWorld,
  DEFAULT_MAP_ID,
  DebugFlag,
  type InputCommand,
  initPhysics,
  loadMap,
  ServerMsg,
  TICK_DT,
} from '@office-fps/shared'
import Stats from 'stats-gl'
import * as THREE from 'three'
import { createSettingsGui } from './debug/gui.ts'
import { addNetworkFolder } from './debug/network.ts'
import { addTuningFolders } from './debug/tuning.ts'
import { ClientCombat } from './game/combat.ts'
import { FreeFly } from './game/free-fly.ts'
import { LocalPlayer } from './game/local-player.ts'
import { RemotePlayers } from './game/remote-players.ts'
import { CombatHud } from './hud/combat-hud.ts'
import { Overlay } from './hud/overlay.ts'
import { Keyboard } from './input/keyboard.ts'
import { MouseLook } from './input/mouse-look.ts'
import { samplePlayerInput } from './input/player-input.ts'
import { Connection } from './net/connection.ts'
import { DebugHitboxes } from './render/debug-hitboxes.ts'
import { Effects } from './render/effects.ts'
import { createLighting } from './render/lighting.ts'
import { buildMapObject } from './render/map-mesh.ts'
import { PixelRenderer } from './render/pixel-renderer.ts'
import { createSky } from './render/sky.ts'
import { Viewmodel } from './render/viewmodel.ts'
import { loadSettings, saveSettings } from './settings.ts'

function requireElement<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector)
  if (!el) throw new Error(`Missing element ${selector}`)
  return el
}

const canvas = requireElement<HTMLCanvasElement>('#game')
const hudRoot = requireElement<HTMLDivElement>('#hud')
const hud = new CombatHud(hudRoot)
const overlay = new Overlay(hudRoot)
const settings = loadSettings()

// --- World ----------------------------------------------------------------------------
await initPhysics()
const map = loadMap(DEFAULT_MAP_ID)
const physics = createPhysicsWorld(map)

// --- Rendering ------------------------------------------------------------------------
const pixels = new PixelRenderer(canvas)
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 500)

scene.add(buildMapObject(map))
createLighting(map, scene)
const sky = createSky(map.lighting.skyColor, map.lighting.fogColor)
scene.add(sky)

const stats = new Stats({ trackGPU: true, horizontal: false })
stats.init(pixels.renderer)
document.body.appendChild(stats.dom)

/** Horizontal FOV is what players configure; Three wants vertical. */
function updateProjection() {
  const aspect = pixels.size.x / pixels.size.y
  const hfov = (settings.fov * Math.PI) / 180
  camera.fov = (2 * Math.atan(Math.tan(hfov / 2) / aspect) * 180) / Math.PI
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
let noclip = false

// --- Combat ---------------------------------------------------------------------------
const viewmodel = new Viewmodel()
const effects = new Effects(scene)
const debugHitboxes = new DebugHitboxes(scene)

// --- Networking -----------------------------------------------------------------------
/** True once the server has welcomed us: from then on the server owns our position. */
let joined = false

const combat = new ClientCombat({
  camera,
  physics,
  effects,
  hud,
  viewmodel,
  remotes,
  debug: debugHitboxes,
  myId: () => net.playerId,
})

const net = new Connection({
  onState: (state, reason) => {
    if (state === 'closed') {
      joined = false
      remotes.clear()
      overlay.setJoined(false)
      overlay.setStatus(reason ? `Disconnected: ${reason}` : 'Connection lost — reconnecting…')
    }
    if (state === 'connecting') overlay.setStatus('Connecting…')
  },
  onMessage: (msg) => {
    combat.onMessage(msg)
    switch (msg.type) {
      case ServerMsg.Welcome:
        joined = true
        noclip = false
        remotes.clear()
        player.resetPrediction()
        overlay.setJoined(true)
        overlay.setStatus('')
        if (debugHitboxes.enabled) net.send({ type: ClientMsg.SetDebug, flags: DebugFlag.LagComp })
        break
      case ServerMsg.PlayerJoined:
        combat.setName(msg.id, msg.name)
        if (msg.id !== net.playerId) remotes.add(msg.id, msg.name, msg.color)
        break
      case ServerMsg.PlayerLeft:
        combat.forget(msg.id)
        remotes.remove(msg.id)
        break
      case ServerMsg.Snapshot:
        if (msg.self) player.onServerState(msg.self, msg.ackSeq)
        remotes.onSnapshot(msg.tick, msg.players, performance.now())
        break
    }
  },
})

overlay.onPlay((name) => {
  if (net.state === 'idle') net.connect(name)
  void look.lock()
})
look.onLockChange = (locked) => overlay.setLocked(locked)

// --- Settings -------------------------------------------------------------------------
function applySettings() {
  pixels.applySettings(settings)
  look.sensitivity = settings.sensitivity
  stats.dom.style.display = settings.showStats ? '' : 'none'
  overlay.setDebugVisible(settings.showDebug)
  updateProjection()
  saveSettings(settings)
}

const gui = createSettingsGui(settings, applySettings)
addTuningFolders(gui, player)
addNetworkFolder(gui, net, remotes)

window.addEventListener('keydown', (e) => {
  if (e.repeat) return
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
    for (const c of gui.controllersRecursive()) c.updateDisplay()
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

// --- Loop -----------------------------------------------------------------------------
/** Max ticks to simulate per frame; beyond this we drop time instead of spiralling. */
const MAX_TICKS_PER_FRAME = 8
let last = performance.now()
let accumulator = 0
let fpsSmoothed = 60
const outgoing: InputCommand[] = []

pixels.renderer.setAnimationLoop(() => {
  const now = performance.now()
  const dt = Math.min(0.25, (now - last) / 1000)
  last = now
  fpsSmoothed += (1 / Math.max(dt, 1e-4) - fpsSmoothed) * 0.05

  // The player keeps simulating in noclip while online (standing still), so the server and
  // prediction stay in step.
  accumulator += dt
  let ticks = 0
  while (accumulator >= TICK_DT && ticks < MAX_TICKS_PER_FRAME) {
    const input = noclip
      ? { buttons: 0, yaw: look.yaw, pitch: look.pitch }
      : samplePlayerInput(keys, look)
    const { command, events } = player.tick(input, remotes.renderTick)
    if (events.shot) combat.onLocalShot(events.shot, player.state.weapon.id)
    if (joined) outgoing.push(command)
    accumulator -= TICK_DT
    ticks++
  }
  if (ticks === MAX_TICKS_PER_FRAME) accumulator = 0
  if (outgoing.length > 0) {
    net.send({ type: ClientMsg.Input, commands: outgoing.splice(0, outgoing.length) })
  }

  if (noclip) fly.update(dt)
  else player.updateCamera(camera, accumulator / TICK_DT, look.yaw, look.pitch, dt)
  remotes.update(now)
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
    },
  })
}
