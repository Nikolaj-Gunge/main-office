import GUI from 'lil-gui'
import { withDefaults } from '../input/bindings.ts'
import { PALETTES } from '../render/palettes.ts'
import { COLOR_MODES, DEFAULT_SETTINGS, type Settings } from '../settings.ts'

/** Live tweak panel for every feel/look parameter. Toggle with F1. */
export function createSettingsGui(settings: Settings, onChange: () => void): GUI {
  const gui = new GUI({ title: 'Settings (F1)' })

  const render = gui.addFolder('Pixel look')
  render.add(settings, 'pixelHeight', [180, 216, 240, 270, 320, 360, 480, 720]).name('pixel height')
  render.add(settings, 'colorMode', Object.keys(COLOR_MODES)).name('color mode')
  render.add(settings, 'colorLevels', 2, 64, 1).name('levels / channel')
  render.add(settings, 'palette', Object.keys(PALETTES))
  render.add(settings, 'dither', 0, 2, 0.05)
  render.add(settings, 'outlines', 0, 1, 0.05)
  render.add(settings, 'bloom', 0, 2, 0.05)
  render.add(settings, 'contrast', 0, 1, 0.05)
  render.add(settings, 'saturation', 0, 2, 0.05)
  render.add(settings, 'vignette', 0, 1, 0.05)
  render.add(settings, 'exposure', 0.2, 3, 0.05)

  const camera = gui.addFolder('Camera & input')
  camera.add(settings, 'fov', 60, 120, 1).name('fov (horizontal)')
  camera.add(settings, 'sensitivity', 0.1, 10, 0.05)

  const audio = gui.addFolder('Audio')
  audio.add(settings, 'masterVolume', 0, 1, 0.05).name('master volume')
  audio.add(settings, 'sfxVolume', 0, 1, 0.05).name('effects volume')

  const debug = gui.addFolder('Debug')
  debug.add(settings, 'showStats').name('stats')
  debug.add(settings, 'showDebug').name('debug text (F3)')
  debug
    .add(
      {
        reset: () => {
          Object.assign(settings, DEFAULT_SETTINGS, { keybinds: withDefaults(undefined) })
          for (const c of gui.controllersRecursive()) c.updateDisplay()
          onChange()
        },
      },
      'reset',
    )
    .name('reset to defaults')

  gui.onChange(onChange)
  gui.close()
  return gui
}
