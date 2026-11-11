import {
  createPhysicsWorld,
  DEFAULT_MAP_ID,
  initPhysics,
  loadMap,
  ServerMsg,
  TICK_DT,
} from '@office-fps/shared'
import Stats from 'stats-gl'
import * as THREE from 'three'
import { createSettingsGui } from './debug/gui.ts'
import { addTuningFolders } from './debug/tuning.ts'
import { FreeFly } from './game/free-fly.ts'
import { LocalPlayer } from './game/local-player.ts'
import { Overlay } from './hud/overlay.ts'
import { Keyboard } from './input/keyboard.ts'
import { MouseLook } from './input/mouse-look.ts'
import { samplePlayerInput } from './input/player-input.ts'
import { Connection } from './net/connection.ts'
import { createLighting } from './render/lighting.ts'
import { buildMapObject } from './render/map-mesh.ts'
import { PixelRenderer } from './render/pixel-renderer.ts'
import { createSky } from './render/sky.ts'
import { loadSettings, saveSettings } from './settings.ts'

function requireElement<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector)
  if (!el) throw new Error(`Missing element ${selector}`)
  return el
}

const canvas = requireElement<HTMLCanvasElement>('#game')
const overlay = new Overlay(requireElement<HTMLDivElement>('#hud'))
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
}

// --- Player & input -------------------------------------------------------------------
const keys = new Keyboard()
const look = new MouseLook(canvas)
const player = new LocalPlayer(physics, map.spawns[0])
look.yaw = player.state.yaw
const fly = new FreeFly(camera, keys, look)
let noclip = false

overlay.onClickToPlay(() => void look.lock())
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
  if (e.code === 'KeyV') {
    noclip = !noclip
    if (!noclip) {
      // Drop the player where the noclip camera is.
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

// --- Networking -----------------------------------------------------------------------
let netState = 'connecting'
const net = new Connection(localStorage.getItem('playerName') ?? 'Player', {
  onState: (state) => {
    netState = state
  },
  onMessage: (msg) => {
    if (msg.type === ServerMsg.Welcome) console.log(`[net] joined as #${msg.playerId}`)
  },
})
net.connect()

// --- Loop -----------------------------------------------------------------------------
/** Max ticks to simulate per frame; beyond this we drop time instead of spiralling. */
const MAX_TICKS_PER_FRAME = 8
let last = performance.now()
let accumulator = 0
let fpsSmoothed = 60

pixels.renderer.setAnimationLoop(() => {
  const now = performance.now()
  const dt = Math.min(0.25, (now - last) / 1000)
  last = now
  fpsSmoothed += (1 / Math.max(dt, 1e-4) - fpsSmoothed) * 0.05

  if (noclip) {
    fly.update(dt)
  } else {
    accumulator += dt
    let ticks = 0
    while (accumulator >= TICK_DT && ticks < MAX_TICKS_PER_FRAME) {
      player.tick(samplePlayerInput(keys, look))
      accumulator -= TICK_DT
      ticks++
    }
    if (ticks === MAX_TICKS_PER_FRAME) accumulator = 0
    player.updateCamera(camera, accumulator / TICK_DT, look.yaw, look.pitch, dt)
  }

  sky.position.copy(camera.position)
  pixels.render(scene, camera)
  stats.update()

  if (settings.showDebug) {
    const s = player.state
    const deg = 180 / Math.PI
    overlay.debug.textContent = [
      `${fpsSmoothed.toFixed(0)} fps · ${pixels.size.x}×${pixels.size.y} ×${pixels.scale}`,
      noclip
        ? `NOCLIP (V) · cam ${camera.position.x.toFixed(2)} ${camera.position.y.toFixed(2)} ${camera.position.z.toFixed(2)}`
        : `feet ${s.pos.x.toFixed(2)} ${s.pos.y.toFixed(2)} ${s.pos.z.toFixed(2)}`,
      `speed ${Math.hypot(s.vel.x, s.vel.z).toFixed(2)} m/s · vy ${s.vel.y.toFixed(2)}`,
      `${s.grounded ? 'grounded' : 'airborne'}${s.crouched ? ' · crouched' : ''}`,
      `yaw ${(look.yaw * deg).toFixed(1)}° pitch ${(look.pitch * deg).toFixed(1)}°`,
      netState === 'open'
        ? `net #${net.playerId} · ping ${net.rtt.toFixed(1)} ms`
        : `net ${netState}…`,
    ].join('\n')
  }
})

// Dev-only handle for debugging from the console and automated visual checks.
if (import.meta.env.DEV) {
  Object.assign(window, {
    __game: { camera, look, settings, applySettings, pixels, scene, player, keys },
  })
}
