import * as THREE from 'three'

const LIFE = 1.4
const RISE = 0.6

interface FloatingNumber {
  sprite: THREE.Sprite
  texture: THREE.CanvasTexture
  start: THREE.Vector3
  age: number
}

/**
 * Damage numbers floating up next to whoever you hit ("show damage" on the admin page): the
 * damage in big digits, the hit zone and your distance below. Drawn on top of everything, a
 * fixed size on screen, so you can read them on a target 100 m away.
 */
export class DamageNumbers {
  private readonly scene: THREE.Scene
  private readonly numbers: FloatingNumber[] = []

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  show(at: THREE.Vector3, damage: number, detail: string, color: string): void {
    // Hits close together on the same spot stack upwards instead of overlapping.
    const stacked = this.numbers.filter((n) => n.age < 0.4 && n.start.distanceTo(at) < 0.6).length
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 112
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.textAlign = 'center'
    ctx.lineJoin = 'round'
    ctx.font = 'bold 64px "Pixelify Sans", monospace'
    ctx.lineWidth = 8
    ctx.strokeStyle = '#000'
    ctx.strokeText(String(damage), 128, 62)
    ctx.fillStyle = color
    ctx.fillText(String(damage), 128, 62)
    ctx.font = 'bold 26px "Pixelify Sans", monospace'
    ctx.lineWidth = 5
    ctx.strokeText(detail, 128, 100)
    ctx.fillStyle = '#f2f2f2'
    ctx.fillText(detail, 128, 100)
    const texture = new THREE.CanvasTexture(canvas)
    texture.magFilter = THREE.NearestFilter
    texture.minFilter = THREE.LinearFilter
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        depthTest: false,
        depthWrite: false,
        sizeAttenuation: false,
        transparent: true,
        fog: false,
      }),
    )
    sprite.scale.set(0.24, 0.105, 1)
    sprite.renderOrder = 20
    const start = at.clone().add(new THREE.Vector3(0, stacked * 0.25, 0))
    sprite.position.copy(start)
    this.scene.add(sprite)
    this.numbers.push({ sprite, texture, start, age: 0 })
  }

  update(dt: number): void {
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i]
      if (!n) continue
      n.age += dt
      if (n.age >= LIFE) {
        this.scene.remove(n.sprite)
        n.texture.dispose()
        n.sprite.material.dispose()
        this.numbers.splice(i, 1)
        continue
      }
      const t = n.age / LIFE
      n.sprite.position.copy(n.start).add(new THREE.Vector3(0, RISE * (1 - (1 - t) ** 2), 0))
      n.sprite.material.opacity = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3
    }
  }
}
