import type * as THREE from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import type { RendererSetting, Settings } from '../settings.ts'
import { PixelRenderer } from './pixel-renderer.ts'

/** What the game needs from a renderer: PixelRenderer (WebGL) or GpuPixelRenderer (WebGPU). */
export interface GameRenderer {
  /** Which path is drawing: WebGL, WebGPU, or WebGPURenderer on its WebGL 2 backend. */
  readonly backend: 'webgl' | 'webgpu' | 'webgpu-gl'
  /** The underlying three.js renderer (for stats-gl). */
  readonly renderer: THREE.WebGLRenderer | WebGPURenderer
  readonly canvas: HTMLCanvasElement
  /** Internal resolution in game pixels. */
  readonly size: THREE.Vector2
  /** Screen pixels per game pixel. */
  readonly scale: number
  /** Shadow redraw switches, as WebGLRenderer.shadowMap. */
  readonly shadows: { autoUpdate: boolean; needsUpdate: boolean }
  applySettings(settings: Settings): void
  setBias(bias: number): void
  resize(): void
  maxAnisotropy(): number
  /** Builds the shaders for everything in the scene now (visible or not). */
  compile(scene: THREE.Scene, camera: THREE.Camera): void
  setAnimationLoop(callback: (() => void) | null): void
  /** Survival's bite on screen (see game/infection.ts); null: none. */
  setInfection(fx: { level: number; pulse: number; time: number; motion: number } | null): void
  render(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    overlay?: { scene: THREE.Scene; camera: THREE.Camera },
  ): void
}

/** `webgpu-gl`: WebGPURenderer forced onto its WebGL 2 backend (for checking without WebGPU). */
export type RendererChoice = RendererSetting | 'webgpu-gl'

/** `?renderer=webgl|webgpu|webgpu-gl` wins over the setting. */
export function rendererChoice(settings: Settings, search = location.search): RendererChoice {
  const asked = new URLSearchParams(search).get('renderer')
  if (asked === 'webgl' || asked === 'webgpu' || asked === 'webgpu-gl') return asked
  return settings.renderer === 'webgpu' ? 'webgpu' : 'webgl'
}

async function hasWebGPU(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
  if (!gpu) return false
  try {
    return (await gpu.requestAdapter()) !== null
  } catch {
    return false
  }
}

/**
 * The renderer for `choice`. Anything but WebGL is loaded on demand (three/webgpu stays out of
 * the main bundle), and falls back to the WebGL path when there's no WebGPU or it fails to
 * start — on a fresh canvas, as the old one may already hold a context. Use the returned
 * renderer's `canvas`.
 */
export async function createGameRenderer(
  canvas: HTMLCanvasElement,
  choice: RendererChoice,
): Promise<GameRenderer> {
  if (choice === 'webgl') return new PixelRenderer(canvas)
  try {
    if (choice === 'webgpu' && !(await hasWebGPU())) throw new Error('no WebGPU adapter')
    const { GpuPixelRenderer } = await import('./webgpu/gpu-pixel-renderer.ts')
    return await GpuPixelRenderer.create(canvas, choice === 'webgpu-gl')
  } catch (err) {
    console.warn('[render] WebGPU unavailable, using WebGL:', err)
    const fresh = canvas.cloneNode(false) as HTMLCanvasElement
    canvas.replaceWith(fresh)
    return new PixelRenderer(fresh)
  }
}
