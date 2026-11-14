import { ITEMS, sizeOf, WEAPONS, WeaponId } from '@office-fps/shared'

/**
 * Little blocky pictures of everything you can carry, for the inventory grid: drawn once per
 * item on a canvas (16 px a cell, shown larger with pixelated scaling) in the same chunky style
 * as the rest of the game — no images to load, nothing smooth.
 */

/** Pixels per grid cell in the drawn icon. */
export const ICON_CELL = 16

type Paint = (g: Pen) => void

/** A pen working in icon pixels. */
class Pen {
  constructor(
    readonly g: CanvasRenderingContext2D,
    readonly w: number,
    readonly h: number,
  ) {}

  rect(x: number, y: number, w: number, h: number, color: string): this {
    this.g.fillStyle = color
    this.g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h))
    return this
  }

  /** A filled ellipse made of whole pixels. */
  blob(cx: number, cy: number, rx: number, ry: number, color: string): this {
    this.g.fillStyle = color
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
        const dx = (x + 0.5 - cx) / rx
        const dy = (y + 0.5 - cy) / ry
        if (dx * dx + dy * dy <= 1) this.g.fillRect(x, y, 1, 1)
      }
    }
    return this
  }

  /** Dark outline round everything drawn so far (reads well on the dark grid). */
  outline(color = 'rgba(0,0,0,0.85)'): this {
    const { g, w, h } = this
    const img = g.getImageData(0, 0, w, h)
    const a = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < w && y < h ? (img.data[(y * w + x) * 4 + 3] ?? 0) : 0
    g.fillStyle = color
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (a(x, y) > 0) continue
        if (a(x - 1, y) || a(x + 1, y) || a(x, y - 1) || a(x, y + 1)) g.fillRect(x, y, 1, 1)
      }
    }
    return this
  }
}

// --- Weapons -------------------------------------------------------------------------------

const GUNMETAL = '#3b3e44'
const STEEL = '#6b7078'
const DARK = '#24262a'
const WOOD = '#7a4f2c'
const WOOD_LIGHT = '#9a6a3c'
const POLYMER = '#2e3329'

interface GunLook {
  /** Wooden stock and grip (else black). */
  wood?: boolean
  stock?: boolean
  mag?: 'box' | 'curved' | 'drum' | 'tube'
  scope?: boolean
  pump?: boolean
  /** Barrel length as a share of the icon's width (from the receiver). */
  barrel?: number
  /** Two barrels side by side (seen as one fatter barrel). */
  double?: boolean
  suppressor?: boolean
  bipod?: boolean
}

/** A long gun lying flat, muzzle to the right. */
function longGun(look: GunLook): Paint {
  return (p) => {
    const { w, h } = p
    const mid = Math.round(h / 2) - 2
    const furniture = look.wood ? WOOD : POLYMER
    const stockEnd = look.stock === false ? Math.round(w * 0.22) : 1
    // Stock
    if (look.stock !== false) {
      p.rect(stockEnd, mid - 1, w * 0.24, 5, furniture)
      p.rect(stockEnd, mid + 2, 4, 4, furniture)
    }
    // Receiver
    const rx = w * 0.24
    const rw = w * 0.26
    p.rect(rx, mid - 2, rw, 6, look.wood ? GUNMETAL : DARK)
    // Pistol grip
    p.rect(rx + 2, mid + 4, 4, 5, furniture)
    // Barrel and handguard
    const bx = rx + rw
    const bw = (w - bx - 1) * (look.barrel ?? 1)
    p.rect(bx, mid - 1, bw, look.double ? 4 : 2, STEEL)
    p.rect(bx, mid, bw * 0.55, 4, look.pump ? WOOD_LIGHT : furniture)
    if (look.pump) p.rect(bx + bw * 0.2, mid + 3, bw * 0.3, 2, WOOD_LIGHT)
    if (look.suppressor) p.rect(bx + bw - 8, mid - 2, 8, 4, DARK)
    // Magazine
    if (look.mag === 'box') p.rect(rx + rw - 9, mid + 4, 5, 6, DARK)
    if (look.mag === 'curved') {
      p.rect(rx + rw - 9, mid + 4, 5, 4, DARK)
      p.rect(rx + rw - 7, mid + 7, 5, 4, DARK)
    }
    if (look.mag === 'drum') p.blob(rx + rw - 6, mid + 8, 5, 4, '#3f4a36')
    if (look.scope) {
      p.rect(rx + 1, mid - 6, rw + 6, 3, DARK)
      p.rect(rx + 4, mid - 3, 2, 1, DARK)
      p.rect(rx + rw, mid - 3, 2, 1, DARK)
    }
    if (look.bipod) {
      p.rect(bx + bw * 0.6, mid + 2, 1, 6, DARK)
      p.rect(bx + bw * 0.6 + 3, mid + 2, 1, 6, DARK)
    }
    p.outline()
  }
}

/** A handgun (or a stubby gun) facing right. */
function pistol(look: { long?: number; color?: string; revolver?: boolean; grip?: string }): Paint {
  return (p) => {
    const { w, h } = p
    const len = w * (look.long ?? 0.75)
    const top = Math.round(h * 0.28)
    const x0 = Math.round((w - len) / 2)
    p.rect(x0, top, len, 6, look.color ?? DARK)
    if (look.revolver) p.blob(x0 + len * 0.35, top + 6, 4, 3, look.color ?? STEEL)
    // Grip, raked back
    const grip = look.grip ?? POLYMER
    p.rect(x0 + 1, top + 5, 7, 6, grip)
    p.rect(x0, top + 10, 7, 6, grip)
    // Trigger guard
    p.rect(x0 + 8, top + 6, 5, 1, look.color ?? DARK)
    p.rect(x0 + 12, top + 6, 1, 4, look.color ?? DARK)
    p.outline()
  }
}

function smg(look: { len: number; stock?: boolean; mag: 'long' | 'grip' | 'curved' }): Paint {
  return (p) => {
    const { w, h } = p
    const top = Math.round(h * 0.3)
    const len = w * look.len
    const x0 = Math.round((w - len) / 2)
    p.rect(x0, top, len, 6, DARK)
    p.rect(x0 + len - 4, top + 1, 4, 3, STEEL)
    if (look.stock) p.rect(x0 - 6, top + 1, 7, 3, DARK)
    if (look.mag === 'grip') p.rect(x0 + len * 0.4, top + 6, 5, 10, POLYMER)
    else {
      p.rect(x0 + 2, top + 6, 5, 6, POLYMER)
      const mx = x0 + len * 0.5
      p.rect(mx, top + 6, 4, look.mag === 'long' ? 10 : 7, DARK)
      if (look.mag === 'curved') p.rect(mx + 2, top + 12, 4, 4, DARK)
    }
    p.outline()
  }
}

/** Long melee weapons stand upright: blade or head at the top. */
function blade(look: {
  blade: string
  handle: string
  handleShare: number
  guard?: string
}): Paint {
  return (p) => {
    const { w, h } = p
    const cx = Math.round(w / 2) - 2
    const hl = h * look.handleShare
    p.rect(cx, h - hl - 1, 4, hl, look.handle)
    if (look.guard) p.rect(cx - 3, h - hl - 3, 10, 2, look.guard)
    p.rect(cx, 2, 4, h - hl - 3, look.blade)
    p.rect(cx + 1, 1, 2, 2, look.blade)
    p.rect(cx + 3, 3, 1, h - hl - 5, '#d8dce2')
    p.outline()
  }
}

function hafted(look: { head: string; handle: string; axe?: boolean; size: number }): Paint {
  return (p) => {
    const { w, h } = p
    const cx = Math.round(w / 2) - 2
    p.rect(cx, 4, 4, h - 6, look.handle)
    if (look.axe) {
      p.rect(cx - look.size, 3, look.size + 4, 10, look.head)
      p.rect(cx - look.size - 2, 1, 3, 14, '#c8ccd2')
    } else p.rect(cx - look.size, 2, look.size * 2 + 4, 10, look.head)
    p.outline()
  }
}

const WEAPON_ICONS: Partial<Record<WeaponId, Paint>> = {
  [WeaponId.Handgun]: pistol({}),
  [WeaponId.M9]: pistol({ color: '#2a2a2a', grip: '#3a3530' }),
  [WeaponId.M1911]: pistol({ color: '#4a4c50', grip: WOOD }),
  [WeaponId.Revolver]: pistol({ color: STEEL, grip: WOOD, revolver: true, long: 0.8 }),
  [WeaponId.Ruger]: pistol({ long: 0.9 }),
  [WeaponId.SawedOff]: longGun({ wood: true, stock: false, double: true, barrel: 0.6 }),
  [WeaponId.Smg]: smg({ len: 0.7, stock: true, mag: 'curved' }),
  [WeaponId.Uzi]: smg({ len: 0.6, mag: 'grip' }),
  [WeaponId.Ump]: smg({ len: 0.72, stock: true, mag: 'long' }),
  [WeaponId.Mac10]: smg({ len: 0.5, mag: 'grip' }),
  [WeaponId.Rifle]: longGun({ mag: 'box', barrel: 0.9 }),
  [WeaponId.Ak47]: longGun({ wood: true, mag: 'curved' }),
  [WeaponId.Sks]: longGun({ wood: true, mag: 'box' }),
  [WeaponId.HuntingRifle]: longGun({ wood: true, scope: true }),
  [WeaponId.Carbine22]: longGun({ wood: true, mag: 'box', barrel: 0.8 }),
  [WeaponId.LeverAction]: longGun({ wood: true, mag: 'tube' }),
  [WeaponId.Shotgun]: longGun({ pump: true }),
  [WeaponId.DoubleBarrel]: longGun({ wood: true, double: true }),
  [WeaponId.AutoShotgun]: longGun({ mag: 'box' }),
  [WeaponId.Sniper]: longGun({ scope: true, mag: 'box' }),
  [WeaponId.Svd]: longGun({ wood: true, scope: true, mag: 'box' }),
  [WeaponId.Barrett]: longGun({ scope: true, mag: 'box', bipod: true }),
  [WeaponId.Lmg]: longGun({ mag: 'drum', bipod: true }),
  [WeaponId.Knife]: blade({ blade: '#a8adb4', handle: '#2a2420', handleShare: 0.4 }),
  [WeaponId.Machete]: blade({ blade: '#9aa0a6', handle: '#2a2420', handleShare: 0.25 }),
  [WeaponId.Katana]: blade({
    blade: '#c0c4ca',
    handle: '#3a2228',
    handleShare: 0.25,
    guard: '#c8a040',
  }),
  [WeaponId.Bat]: (p) => {
    const cx = Math.round(p.w / 2) - 2
    p.rect(cx + 1, p.h * 0.45, 3, p.h * 0.55 - 2, WOOD_LIGHT)
    p.rect(cx, 3, 5, p.h * 0.5, '#b88a50')
    p.rect(cx + 1, p.h - 3, 3, 2, DARK)
    p.outline()
  },
  [WeaponId.Crowbar]: (p) => {
    const cx = Math.round(p.w / 2) - 1
    p.rect(cx, 4, 3, p.h - 6, '#8a2a24')
    p.rect(cx - 4, 2, 7, 3, '#8a2a24')
    p.rect(cx + 1, p.h - 4, 4, 3, '#8a2a24')
    p.outline()
  },
  [WeaponId.Axe]: hafted({ head: '#b8302a', handle: '#c8a040', axe: true, size: 7 }),
  [WeaponId.Sledge]: hafted({ head: '#4a4c50', handle: WOOD_LIGHT, size: 5 }),
  [WeaponId.Crossbow]: (p) => {
    const mid = Math.round(p.h / 2)
    p.rect(4, mid - 1, p.w - 10, 4, WOOD)
    p.rect(p.w - 10, 3, 3, p.h - 6, DARK)
    p.rect(8, mid, p.w - 16, 1, '#c8c0a0')
    p.outline()
  },
}

// --- Everything else ---------------------------------------------------------------------

function can(label: string, opts: { flat?: boolean; lid?: string } = {}): Paint {
  return (p) => {
    const w = p.w - 6
    const h = opts.flat ? p.h * 0.45 : p.h - 8
    const x = 3
    const y = p.h - h - 3
    p.rect(x, y, w, h, '#a8acb0')
    p.rect(x, y + 2, w, h - 4, label)
    p.rect(x, y, w, 1, opts.lid ?? '#d0d4d8')
    p.rect(x + 2, y + h * 0.4, w - 4, 2, 'rgba(255,255,255,0.35)')
    p.outline()
  }
}

function bottle(glass: string, cap: string, fill = 0.7): Paint {
  return (p) => {
    const cx = Math.round(p.w / 2)
    const bw = Math.min(10, p.w - 4)
    p.rect(cx - 2, 2, 4, 3, cap)
    p.rect(cx - 2, 5, 4, 4, glass)
    p.rect(cx - bw / 2, 9, bw, p.h - 11, glass)
    p.rect(cx - bw / 2, 9 + (p.h - 11) * (1 - fill), bw, (p.h - 11) * fill, 'rgba(0,0,0,0.18)')
    p.rect(cx - bw / 2 + 1, 11, 2, p.h - 15, 'rgba(255,255,255,0.35)')
    p.outline()
  }
}

function box(color: string, opts: { band?: string; cross?: string; inset?: number } = {}): Paint {
  return (p) => {
    const i = opts.inset ?? 2
    p.rect(i, i + 1, p.w - i * 2, p.h - i * 2 - 1, color)
    p.rect(i, i + 1, p.w - i * 2, 2, 'rgba(255,255,255,0.25)')
    if (opts.band) p.rect(i, p.h / 2 - 2, p.w - i * 2, 4, opts.band)
    if (opts.cross) {
      const cx = p.w / 2
      const cy = p.h / 2 + 1
      p.rect(cx - 1.5, cy - 5, 3, 10, opts.cross)
      p.rect(cx - 5, cy - 1.5, 10, 3, opts.cross)
    }
    p.outline()
  }
}

function rounds(brass: string, tip: string, n = 3): Paint {
  return (p) => {
    for (let i = 0; i < n; i++) {
      const x = 2 + i * 4
      p.rect(x, 6, 3, 8, brass)
      p.rect(x, 3, 3, 3, tip)
      p.rect(x, 12, 3, 2, '#7a6020')
    }
    p.outline()
  }
}

function shirt(
  color: string,
  opts: { sleeves?: boolean; trim?: string; hood?: boolean } = {},
): Paint {
  return (p) => {
    const { w, h } = p
    const bx = w * 0.25
    const bw = w * 0.5
    p.rect(bx, 6, bw, h - 9, color)
    if (opts.sleeves !== false) {
      p.rect(bx - 7, 6, 8, 6, color)
      p.rect(bx + bw - 1, 6, 8, 6, color)
      p.rect(bx - 7, 12, 5, h * 0.4, color)
      p.rect(bx + bw + 2, 12, 5, h * 0.4, color)
    }
    if (opts.hood) p.rect(w / 2 - 5, 2, 10, 5, color)
    p.rect(w / 2 - 3, 6, 6, 3, 'rgba(0,0,0,0.35)')
    if (opts.trim) p.rect(bx, h * 0.55, bw, 3, opts.trim)
    p.outline()
  }
}

function trousers(color: string, pocket?: string): Paint {
  return (p) => {
    const { w, h } = p
    const x = w * 0.25
    const lw = w * 0.5
    p.rect(x, 3, lw, 6, color)
    p.rect(x, 9, lw / 2 - 1, h - 12, color)
    p.rect(x + lw / 2 + 1, 9, lw / 2 - 1, h - 12, color)
    p.rect(x, 3, lw, 2, 'rgba(0,0,0,0.3)')
    if (pocket) {
      p.rect(x + 1, h * 0.5, 4, 5, pocket)
      p.rect(x + lw - 5, h * 0.5, 4, 5, pocket)
    }
    p.outline()
  }
}

function boots(color: string, sole: string, high = 0.5): Paint {
  return (p) => {
    const { w, h } = p
    for (const x of [3, w / 2 + 1]) {
      p.rect(x, h * (1 - high) - 3, 7, h * high, color)
      p.rect(x, h - 7, 12, 4, color)
      p.rect(x, h - 4, 12, 2, sole)
    }
    p.outline()
  }
}

function hat(color: string, kind: 'cap' | 'dome' | 'brim' | 'helmet' | 'mask' | 'band'): Paint {
  return (p) => {
    const { w, h } = p
    const cx = w / 2
    const cy = h * 0.6
    if (kind === 'band') {
      p.rect(2, h / 2 - 3, w - 4, 6, color)
      p.rect(4, h / 2 - 1, 2, 2, '#e8e0d0').rect(w - 7, h / 2, 2, 2, '#e8e0d0')
    } else if (kind === 'mask') {
      p.blob(cx, cy - 2, w * 0.32, h * 0.32, color)
      p.blob(cx - 5, cy - 4, 3, 3, '#7ab0c8').blob(cx + 5, cy - 4, 3, 3, '#7ab0c8')
      p.blob(cx, cy + 6, 4, 4, DARK)
    } else {
      p.blob(cx, cy, w * (kind === 'brim' ? 0.25 : 0.34), h * 0.34, color)
      p.g.clearRect(0, Math.round(cy) + 1, w, h)
      if (kind === 'cap') p.rect(cx, cy, w * 0.45, 3, color)
      if (kind === 'brim') p.rect(2, cy, w - 4, 3, color)
      if (kind === 'helmet') p.rect(cx - w * 0.36, cy, w * 0.72, 2, color)
      if (kind === 'dome') p.rect(cx - w * 0.34, cy - 2, w * 0.68, 3, 'rgba(255,255,255,0.15)')
    }
    p.outline()
  }
}

function backpack(color: string, strap: string): Paint {
  return (p) => {
    const { w, h } = p
    p.rect(w * 0.18, 5, w * 0.64, h - 7, color)
    p.rect(w * 0.18, 5, w * 0.64, h * 0.3, 'rgba(0,0,0,0.2)')
    p.rect(w * 0.3, h * 0.55, w * 0.4, h * 0.3, 'rgba(255,255,255,0.12)')
    p.rect(w * 0.3, 2, w * 0.4, 4, strap)
    p.rect(w * 0.3, h * 0.35, 2, h * 0.5, strap)
    p.rect(w * 0.7 - 2, h * 0.35, 2, h * 0.5, strap)
    p.outline()
  }
}

const ICONS: Record<string, Paint> = {
  // Food
  beans: can('#c06a2a'),
  soup: can('#b8302a'),
  tuna: can('#3a6aa8', { flat: true }),
  peaches: can('#e0b030'),
  dogfood: can('#7a5a3a'),
  chips: box('#e0c030', { band: '#c03028' }),
  chocolate: box('#5a3a22', { band: '#c8c0b0', inset: 3 }),
  jerky: box('#6a2a20', { inset: 4 }),
  energybar: box('#2a5aa8', { band: '#e0e0e0', inset: 3 }),
  mre: box('#a08a5a', { band: '#6a5a3a' }),
  apple: (p) => {
    p.blob(p.w / 2, p.h / 2 + 1, 6, 6, '#b82a24')
      .rect(p.w / 2, 2, 1, 3, '#4a3a20')
      .outline()
  },
  cereal: box('#d84a2a', { band: '#f0d040' }),
  berries: (p) => {
    for (const [x, y] of [
      [5, 6],
      [10, 5],
      [8, 10],
      [4, 11],
      [11, 11],
    ] as const)
      p.blob(x, y, 2.4, 2.4, '#5a2a7a')
    p.outline()
  },
  // Drink
  water: bottle('#8ac0e8', '#2a6ab0', 0.8),
  soda: can('#c02a2a'),
  energydrink: can('#3ab03a', { lid: '#a0a0a0' }),
  juice: box('#e0a030', { band: '#60a040', inset: 3 }),
  coffee: can('#3a4a3a', { lid: '#8a8a8a' }),
  beer: bottle('#6a3a12', '#c8a040', 0.85),
  dirtywater: bottle('#7a8a5a', '#5a5a4a', 0.75),
  whiskey: bottle('#b0701a', '#2a1a10', 0.6),
  // Medical
  rags: box('#d8d0c0', { inset: 3 }),
  bandage: (p) => {
    p.blob(p.w / 2, p.h / 2, 6, 6, '#f0ece0')
      .blob(p.w / 2, p.h / 2, 2, 2, '#c8c0b0')
      .outline()
  },
  medkit: box('#e8e8e8', { cross: '#c82a24' }),
  painkillers: bottle('#e08a2a', '#f0f0f0', 0),
  antibiotics: bottle('#e0e0e0', '#3a8a3a', 0),
  adrenaline: (p) => {
    p.rect(p.w / 2 - 2, 2, 4, 10, '#c8e0f0')
      .rect(p.w / 2 - 2, 6, 4, 4, '#e04040')
      .rect(p.w / 2 - 3, 12, 6, 1, DARK)
      .rect(p.w / 2 - 1, 13, 2, 2, STEEL)
      .outline()
  },
  cure: bottle('#3ad0d0', '#c8c8c8', 0.6),
  // Tools and junk
  batteries: (p) => {
    for (const x of [3, 9]) {
      p.rect(x, 4, 4, 10, '#c8a030')
        .rect(x, 4, 4, 3, '#2a2a2a')
        .rect(x + 1, 3, 2, 1, STEEL)
    }
    p.outline()
  },
  scrap: (p) => {
    p.rect(3, 12, 20, 6, '#6a6a6a')
      .rect(8, 6, 10, 8, '#8a7a6a')
      .rect(18, 16, 10, 8, '#5a5e64')
      .rect(4, 20, 8, 6, '#7a4a3a')
      .outline()
  },
  ducttape: (p) => {
    p.blob(p.w / 2, p.h / 2, 6, 6, '#8a8e94')
      .blob(p.w / 2, p.h / 2, 2.5, 2.5, '#2a2c30')
      .outline()
  },
  electronics: box('#2a6a3a', { band: '#c8a040' }),
  cigarettes: box('#e8e8e8', { band: '#c02a2a', inset: 3 }),
  lighter: (p) => {
    p.rect(5, 5, 6, 9, '#3a6ac0').rect(5, 3, 6, 2, STEEL).outline()
  },
  planks: (p) => {
    p.rect(3, 2, 5, p.h - 4, WOOD_LIGHT)
      .rect(8, 4, 5, p.h - 6, WOOD)
      .outline()
  },
  watch: (p) => {
    p.rect(p.w / 2 - 2, 1, 4, p.h - 2, '#3a2a20')
      .blob(p.w / 2, p.h / 2, 5, 5, '#c8c0a0')
      .blob(p.w / 2, p.h / 2, 3.5, 3.5, '#f0ece0')
      .outline()
  },
  ring: (p) => {
    p.blob(p.w / 2, p.h / 2 + 1, 5, 5, '#e0b030').outline()
    p.g.clearRect(p.w / 2 - 2, p.h / 2 - 1, 4, 4)
  },
  necklace: (p) => {
    p.blob(p.w / 2, p.h / 2, 6, 5, '#c8ccd2')
    p.g.clearRect(p.w / 2 - 4, p.h / 2 - 4, 8, 7)
    p.blob(p.w / 2, p.h - 4, 2, 2, '#c8ccd2').outline()
  },
  toolkit: box('#b8302a', { band: '#3a3a3a' }),
  gasoline: (p) => {
    p.rect(6, 10, p.w - 12, p.h - 13, '#b82a24')
      .rect(p.w - 14, 4, 6, 7, '#b82a24')
      .rect(10, 6, 12, 3, DARK)
      .rect(10, 16, p.w - 20, p.h - 24, 'rgba(255,255,255,0.15)')
      .outline()
  },
  cash: box('#5a9a4a', { band: '#3a6a2a', inset: 3 }),
  // Quest things
  radio_tube: bottle('#d8d0c0', '#3a3a3a', 0),
  radio_board: box('#2a6a3a', { band: '#c8a040' }),
  fuse: box('#c8c8c8', { band: '#c02a2a', inset: 4 }),
  keycard_blue: box('#2a5ac8', { band: '#e0e0e0', inset: 3 }),
  keycard_red: box('#c82a2a', { band: '#e0e0e0', inset: 3 }),
  research: box('#e8e0c8', { band: '#8a8070' }),
  sample: box('#9aa0a8', { band: '#3ad0d0' }),
  flare: (p) => {
    p.rect(p.w / 2 - 2, 3, 5, p.h - 5, '#d82a24')
      .rect(p.w / 2 - 2, 2, 5, 2, '#f0e0a0')
      .outline()
  },
  teddy: (p) => {
    const c = '#8a5a30'
    p.blob(16, 12, 7, 6, c)
      .blob(16, 22, 9, 8, c)
      .blob(10, 7, 3, 3, c)
      .blob(22, 7, 3, 3, c)
      .rect(13, 11, 2, 2, DARK)
      .outline()
  },
  photo: box('#e8e8e0', { band: '#5a6a8a', inset: 3 }),
  dogtags: (p) => {
    p.rect(4, 6, 7, 9, '#b8bcc2').rect(6, 4, 7, 9, '#d0d4d8').outline()
  },
  insulin: bottle('#e0f0f0', '#e0a030', 0.5),
  seeds: box('#c8a868', { band: '#5a9a3a', inset: 3 }),
  toolbox: box('#2a4ab0', { band: '#2a2a2a' }),
  map_piece: box('#d8cca0', { band: '#c02a2a', inset: 2 }),
  // Backpacks
  pack_school: backpack('#2a5aa8', '#1a2a4a'),
  pack_hiking: backpack('#c8602a', '#3a2a1a'),
  pack_military: backpack('#5a6a3a', '#2a3020'),
  // Clothes
  cap: hat('#2a4a8a', 'cap'),
  beanie: hat('#22252a', 'dome'),
  bandana: hat('#b82a24', 'band'),
  cowboyhat: hat('#8a5a30', 'brim'),
  hardhat: hat('#e0b020', 'helmet'),
  helmet: hat('#4a5a3a', 'helmet'),
  gasmask: hat('#3a3e38', 'mask'),
  hoodie: shirt('#4a4e58', { hood: true }),
  flannel: shirt('#a82a24', { trim: '#3a1a14' }),
  raincoat: shirt('#e0c020', { hood: true }),
  jacket: shirt('#3a2a20', { trim: '#5a4030' }),
  camojacket: shirt('#5a6a3a', { trim: '#3a4428' }),
  policevest: shirt('#1a2a4a', { sleeves: false, trim: '#d0d0d0' }),
  militaryvest: shirt('#4a5236', { sleeves: false, trim: '#2a3020' }),
  jeans: trousers('#2a4a7a'),
  cargopants: trousers('#6a6a4a', '#5a5a3a'),
  camopants: trousers('#5a6a3a', '#3a4428'),
  worktrousers: trousers('#8a6a3a', '#3a3a3a'),
  policetrousers: trousers('#1a2440'),
  sneakers: boots('#e8e8e8', '#3a3a3a', 0.3),
  boots: boots('#6a4a2a', '#2a1a10', 0.5),
  militaryboots: boots('#2a2a26', '#111', 0.65),
}

/** What a kind of ammunition looks like: brass and a tip, or a shell. */
function ammoIcon(item: string): Paint {
  if (item === 'ammo12') return rounds('#c02a24', '#c8a040')
  if (item === 'bolts') return rounds('#7a5a30', '#9aa0a8', 2)
  if (item === 'ammo50') return rounds('#c8a040', '#2a2a2a', 2)
  return rounds('#c8a040', item === 'ammo22' ? '#b8784a' : '#8a6a3a')
}

function paintFor(item: string): Paint {
  const def = ITEMS[item]
  if (ICONS[item]) return ICONS[item]
  if (def?.weapon !== undefined) {
    return (
      WEAPON_ICONS[def.weapon] ??
      (WEAPONS[def.weapon].slot === 'melee'
        ? blade({ blade: '#a8adb4', handle: WOOD, handleShare: 0.3 })
        : longGun({}))
    )
  }
  if (def?.kind === 'ammo') return ammoIcon(item)
  // Anything new without a picture: a plain parcel in the colour of its kind.
  return box(def?.kind === 'quest' ? '#c8a040' : '#7a7468')
}

const cache = new Map<string, string>()

/** A data URL of the item's picture, laid as it lies (r = 1: on its side). */
export function iconUrl(item: string, r = 0): string {
  const key = `${item}:${r}`
  const hit = cache.get(key)
  if (hit) return hit
  const [cw, ch] = sizeOf(item)
  const w = cw * ICON_CELL
  const h = ch * ICON_CELL
  const flat = document.createElement('canvas')
  flat.width = w
  flat.height = h
  const g = flat.getContext('2d')
  if (!g) return ''
  paintFor(item)(new Pen(g, w, h))
  let canvas = flat
  if (r) {
    canvas = document.createElement('canvas')
    canvas.width = h
    canvas.height = w
    const rg = canvas.getContext('2d')
    if (rg) {
      rg.translate(h, 0)
      rg.rotate(Math.PI / 2)
      rg.drawImage(flat, 0, 0)
    }
  }
  const url = canvas.toDataURL()
  cache.set(key, url)
  return url
}
