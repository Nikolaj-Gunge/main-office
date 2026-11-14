import { type BaseWeaponId, WeaponId } from '@office-fps/shared'
import * as THREE from 'three'
import { action } from './base-guns.ts'
import {
  ALLOY,
  ASH,
  apertureSights,
  atWorldDetail,
  BARREL,
  BIRCH,
  BLADE,
  BLUED,
  BRASS,
  bake,
  barrel,
  box,
  EDGE,
  fine,
  fist,
  LAMINATE,
  lathe,
  leftHand,
  limb,
  marker,
  OLIVE,
  type P2,
  PARKERIZED,
  type Paint,
  POLYMER,
  paint,
  part,
  RED,
  RED_METAL,
  RUBBER,
  rail,
  redDot,
  rightHand,
  rod,
  STAINLESS,
  scope,
  slab,
  stripHands,
  supportHand,
  sweep,
  TRITIUM,
  triggerGuard,
  type V3,
  WALNUT,
  WHITE,
} from './gun-kit.ts'
import type { GunModel, Recoil } from './viewmodel.ts'

/**
 * The survival weapons' models. Each is built from the modelling kit like the originals in
 * base-guns.ts (gloved hands and sleeves included) and exposes the same parts, so it moves with
 * the recoil, reload and action of the original it handles like. Without the hands the same
 * models lie in the world (gun-models.ts).
 */

/** The weapons that only survival mode has (everything but the eight originals). */
export type SurvivalWeaponId = Exclude<WeaponId, BaseWeaponId>

const DARK_STEEL = paint(0x2f3237, 'metal')
const GUN_GREY = paint(0x6a6e77, 'metal')
const SCOPE_BODY = paint(0x25272b, 'metal')
const OD_GREEN = paint(0x4e5442, 'metal')
const AK_STEEL = paint(0x3a3c40, 'metal')
const BLACK_GRIPS = paint(0x1b1c20, 'polymer')
const STRING = paint(0xd9d2c0, 'cloth')
const TAPE = paint(0x2b2b2f, 'cloth')
const WRAP = paint(0xe0d8c4, 'cloth')
const IRON = paint(0x5d6168, 'metal')
const HEAD_FACE = paint(0x9ba0a8, 'metal')
const KATANA_BLADE = paint(0xdfe3e8, 'metal')
const TSUBA = paint(0x8a6f3a, 'brass')
const CASE = paint(0xc9a24a, 'brass')
const BULLET = paint(0x9a6a42, 'brass')
const VANE_RED = paint(0xb3261e, 'polymer')
const VANE_YELLOW = paint(0xe6c229, 'polymer')
const CROSSBOW_BODY = paint(0x3f4535, 'polymer')

/** A brass cartridge, fed by hand into revolvers and lever-actions. */
function cartridge(): THREE.Group {
  const g = new THREE.Group()
  g.add(
    lathe(
      CASE,
      [
        [0.017, 0],
        [0.017, 0.0058],
        [0.0155, 0.0058],
        [0.015, 0.005],
        [-0.009, 0.005],
        [-0.009, 0],
      ],
      undefined,
      { radial: 8 },
    ),
    lathe(
      BULLET,
      [
        [-0.008, 0],
        [-0.008, 0.0045],
        [-0.016, 0.0038, 0.003],
        [-0.022, 0],
      ],
      undefined,
      { radial: 8 },
    ),
  )
  return g
}

// ── Pistols ──

const PISTOL_SIGHT = 0.0335

interface PistolLook {
  slide: Paint
  frame: Paint
  grips: Paint
  /** Slide length and grip width (m): a single-stack .45 is slimmer than a double-stack 9 mm. */
  length: number
  width: number
  recoil: Recoil
  /** What sets it apart: parts on the frame, and parts that ride on the slide. */
  fixed: THREE.Object3D[]
  riding: THREE.Object3D[]
  /** M9: the open-top slide (a cut-out over the barrel). */
  openTop?: boolean
}

/** Both hands on a pistol grip: the right round the grip, the left wrapped round it. */
function pistolHands(trigger: V3, gw: number): { right: THREE.Group; left: THREE.Group } {
  return {
    right: rightHand({ at: [0, -0.06, 0.0635], rake: 0.2, gw, gd: 0.047, trigger, thumb: 0.044 }),
    left: leftHand({
      at: [-0.004, -0.068, 0.06],
      rake: 0.2,
      gw: gw + 0.02,
      gd: 0.062,
      thumb: 0.036,
      elbow: [-0.1, -0.16, 0.33],
    }),
  }
}

/** A slide-operated steel pistol: same hold, sights and reload as the handgun. */
function pistol(look: PistolLook): GunModel {
  const group = new THREE.Group()
  const back = 0.075
  const front = back - look.length
  const top = 0.0265
  const slideProfile: P2[] = look.openTop
    ? [
        [back, -0.002],
        [back, top, 0.005],
        [-0.01, top, 0.004],
        [-0.02, top - 0.012, 0.006],
        [front + 0.012, top - 0.012, 0.004],
        [front, 0.004, 0.004],
        [front + 0.004, -0.002],
      ]
    : [
        [back, -0.002],
        [back, top, 0.005],
        [front + 0.004, top, 0.006],
        [front, 0.012, 0.004],
        [front + 0.004, -0.002],
      ]
  const slide = part()
  slide.add(
    slab(look.slide, slideProfile, look.width + 0.002, 0, 0.005),
    rod(RUBBER, 0.0045, front + 0.004, front - 0.0008, [0, 0.012, 0], 8, 0),
    box(
      look.slide,
      [0.0042, 0.007, 0.006],
      [0, PISTOL_SIGHT - 0.0035, front + 0.012],
      undefined,
      0.001,
    ),
    box(
      look.slide,
      [0.0085, 0.0075, 0.007],
      [-0.0068, PISTOL_SIGHT - 0.00375, back - 0.009],
      undefined,
      0.001,
    ),
    box(
      look.slide,
      [0.0085, 0.0075, 0.007],
      [0.0068, PISTOL_SIGHT - 0.00375, back - 0.009],
      undefined,
      0.001,
    ),
    box(look.slide, [0.026, 0.004, 0.009], [0, top + 0.001, back - 0.009], undefined, 0.001),
    box(WHITE, [0.0022, 0.0022, 0.001], [0, PISTOL_SIGHT - 0.002, front + 0.0152], undefined, 0),
    ...look.riding,
  )
  if (fine()) {
    for (let k = 0; k < 6; k++)
      slide.add(
        box(
          RUBBER,
          [look.width + 0.0026, 0.016, 0.0022],
          [0, 0.011, back - 0.009 - k * 0.0055],
          undefined,
          0,
        ),
      )
  }
  const mag = part([0, -0.064, 0.064])
  mag.rotation.x = -0.2
  mag.add(
    box(BLUED, [look.width - 0.008, 0.1, 0.03], undefined, undefined, 0.003),
    box(look.frame, [look.width + 0.002, 0.011, 0.045], [0, -0.054, 0.002], undefined, 0.004),
    box(BRASS, [0.009, 0.006, 0.022], [0, 0.052, -0.002], undefined, 0.002),
  )
  const frameFront = front + 0.03
  const { right, left } = pistolHands([0, -0.031, 0.006], look.width)
  const support = part([0, 0, 0], left)
  group.add(
    slide,
    mag,
    slab(
      look.frame,
      [
        [frameFront, -0.002],
        [0.072, -0.002],
        [0.087, -0.008, 0.006],
        [0.079, -0.02, 0.004],
        [0.096, -0.108, 0.008],
        [0.05, -0.11, 0.008],
        [0.034, -0.028, 0.006],
        [0.026, -0.018],
        [frameFront, -0.018, 0.004],
      ],
      look.width,
      0,
      0.005,
    ),
    slab(
      look.grips,
      [
        [0.078, -0.026],
        [0.092, -0.098, 0.004],
        [0.054, -0.1, 0.004],
        [0.042, -0.03],
      ],
      look.width + 0.004,
      0,
      0.002,
    ),
    ...triggerGuard(look.frame, -0.018, -0.024, 0.03, 0.026, 0.0034),
    ...look.fixed,
    right,
    support,
  )
  const muzzle = marker(0, 0.012, front - 0.01)
  const ejectPort = marker(0.02, 0.02, -0.01)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.15, -0.15, -0.38),
    ads: new THREE.Vector3(0, -PISTOL_SIGHT, -0.3),
    recoil: look.recoil,
    action: action(slide, 0.035, 0.09, true),
    mag,
    support,
    handRest: new THREE.Vector3(-0.02, -0.1, 0.07),
    handle: new THREE.Vector3(0, 0.03, 0.05),
    tilt: { roll: -0.4, pitch: 0.1 },
  }
}

/** M1911: slim parkerized steel, walnut grip panels, a hammer spur and grip safety. */
function m1911(): GunModel {
  return pistol({
    slide: PARKERIZED,
    frame: PARKERIZED,
    grips: WALNUT,
    length: 0.2,
    width: 0.027,
    // A .45: a slower, heavier flip than the 9 mm.
    recoil: { back: 0.035, climb: 0.26, roll: 0.07, side: 0.03, recover: 17 },
    fixed: [
      slab(
        BLUED,
        [
          [0.078, 0.004],
          [0.084, 0.02, 0.003],
          [0.092, 0.018, 0.002],
          [0.086, 0.002],
        ],
        0.008,
      ), // hammer
      box(BLUED, [0.004, 0.006, 0.016], [-0.015, 0.002, 0.04], undefined, 0.001), // thumb safety
    ],
    riding: [rod(STAINLESS, 0.0085, -0.118, -0.127, [0, 0.012, 0], 10, 0.3)], // barrel bushing
  })
}

/** Beretta M9: black, fat double-stack grip, the barrel showing through the open slide. */
function m9(): GunModel {
  return pistol({
    slide: DARK_STEEL,
    frame: paint(0x2a2b30, 'metal'),
    grips: BLACK_GRIPS,
    length: 0.205,
    width: 0.033,
    recoil: { back: 0.028, climb: 0.18, roll: 0.055, side: 0.03, recover: 21 },
    openTop: true,
    fixed: [rod(GUN_GREY, 0.0075, -0.02, -0.133, [0, 0.012, 0], 10)], // barrel in the open top
    riding: [
      box(GUN_GREY, [0.006, 0.01, 0.02], [0.0175, 0.012, 0.04], undefined, 0.002), // decocker
      box(GUN_GREY, [0.006, 0.01, 0.02], [-0.0175, 0.012, 0.04], undefined, 0.002),
    ],
  })
}

const RUGER_SIGHT = 0.034

/** Suppressed .22 (a Ruger Mark): round receiver, raked grip, a long can on the front. */
function ruger(): GunModel {
  const group = new THREE.Group()
  // Only the bolt's ears move; barrel and sights stay put.
  const bolt = part(
    [0, 0.016, 0.077],
    box(STAINLESS, [0.034, 0.008, 0.012], undefined, undefined, 0.003),
    rod(STAINLESS, 0.009, 0.006, -0.012, [0, -0.002, 0], 10),
  )
  const mag = part([0, -0.06, 0.052])
  mag.rotation.x = -0.3
  mag.add(
    box(STAINLESS, [0.017, 0.09, 0.027], undefined, undefined, 0.002),
    box(BLACK_GRIPS, [0.025, 0.01, 0.04], [0, -0.05, 0], undefined, 0.003),
  )
  const { right, left } = pistolHands([0, -0.03, 0.012], 0.026)
  const support = part([0, 0, 0], left)
  group.add(
    rod(BLUED, 0.0145, 0.075, -0.06, [0, 0.014, 0]), // receiver tube
    bolt,
    rod(BLUED, 0.0085, -0.06, -0.12, [0, 0.014, 0]), // barrel
    // Suppressor: a long tube with ribbed ends.
    lathe(
      RUBBER,
      [
        [-0.11, 0],
        [-0.11, 0.0175, 0.003],
        [-0.118, 0.0185],
        [-0.282, 0.0185],
        [-0.29, 0.0175, 0.003],
        [-0.29, 0.005],
        [-0.288, 0],
      ],
      [0, 0.014, 0],
      { radial: 12 },
    ),
    box(BLUED, [0.004, 0.006, 0.01], [0, RUGER_SIGHT - 0.003, -0.05], undefined, 0.001), // front sight
    box(BLUED, [0.022, 0.006, 0.008], [0, RUGER_SIGHT - 0.003, 0.064], undefined, 0.001), // rear sight
    box(TRITIUM, [0.002, 0.002, 0.001], [0, RUGER_SIGHT - 0.002, -0.0448], undefined, 0),
    slab(
      BLACK_GRIPS,
      [
        [-0.05, 0.002],
        [0.07, 0.002],
        [0.086, -0.005, 0.006],
        [0.094, -0.108, 0.008],
        [0.054, -0.11, 0.008],
        [0.03, -0.03, 0.006],
        [0.024, -0.016],
        [-0.05, -0.012, 0.004],
      ],
      0.026,
    ), // frame and grip
    ...triggerGuard(BLUED, -0.014, -0.022, 0.028, 0.024, 0.003),
    mag,
    right,
    support,
  )
  const muzzle = marker(0, 0.014, -0.29)
  const ejectPort = marker(0.02, 0.02, 0.03)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.15, -0.15, -0.36),
    ads: new THREE.Vector3(0, -RUGER_SIGHT, -0.3),
    // Barely moves: a .22 with a weight on the front.
    recoil: { back: 0.01, climb: 0.06, roll: 0.02, side: 0.01, recover: 26 },
    action: action(bolt, 0.03, 0.07, true),
    noFlash: true,
    mag,
    support,
    handRest: new THREE.Vector3(-0.02, -0.1, 0.07),
    handle: new THREE.Vector3(0, 0.03, 0.07),
    tilt: { roll: -0.4, pitch: 0.1 },
  }
}

const REVOLVER_SIGHT = 0.037

/** .357 revolver: stainless, walnut grip, a fluted cylinder that swings out to be loaded. */
function revolver(): GunModel {
  const group = new THREE.Group()
  // The cylinder hangs on its crane below the frame and swings out to the left.
  const crane = part([-0.004, -0.022, -0.015])
  const flutes: THREE.Object3D[] = []
  if (fine()) {
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + Math.PI / 6
      flutes.push(
        box(
          BLUED,
          [0.006, 0.006, 0.032],
          [0.004 + Math.cos(a) * 0.0195, 0.024 + Math.sin(a) * 0.0195, 0],
          [0, 0, a],
          0.002,
        ),
      )
    }
  }
  crane.add(
    lathe(
      GUN_GREY,
      [
        [0.025, 0],
        [0.025, 0.018, 0.004],
        [-0.025, 0.021, 0.003],
        [-0.025, 0],
      ],
      [0.004, 0.024, 0],
      { radial: 12 },
    ),
    ...flutes,
    rod(STAINLESS, 0.003, 0.0, -0.034, [0.004, 0.011, -0.012]), // ejector rod
  )
  const { right, left } = pistolHands([0, -0.03, 0.012], 0.03)
  const support = part([0, 0, 0], left)
  group.add(
    // Barrel with its full underlug.
    slab(
      STAINLESS,
      [
        [-0.04, 0.026],
        [-0.165, 0.026, 0.004],
        [-0.168, -0.012, 0.006],
        [-0.04, -0.012],
      ],
      0.02,
      0,
      0.005,
    ),
    rod(RUBBER, 0.0045, -0.166, -0.169, [0, 0.014, 0], 8, 0),
    // Frame round the cylinder, the top strap and the grip frame.
    slab(
      STAINLESS,
      [
        [-0.05, 0.03],
        [0.03, 0.03, 0.004],
        [0.05, 0.022, 0.004],
        [0.06, 0.0, 0.004],
        [0.05, -0.03],
        [0.03, -0.035],
        [0.0, -0.034],
        [-0.05, -0.022],
        [-0.05, 0.022],
        [0.035, 0.022],
        [0.034, -0.025],
        [-0.042, -0.025],
        [-0.042, 0.022],
        [-0.05, 0.022],
      ],
      0.028,
      0,
      0.004,
    ),
    crane,
    slab(
      STAINLESS,
      [
        [0.042, 0.018],
        [0.054, 0.04, 0.003],
        [0.062, 0.037, 0.002],
        [0.056, 0.012],
      ],
      0.009,
    ), // hammer
    slab(
      WALNUT,
      [
        [0.04, -0.03],
        [0.07, -0.022, 0.006],
        [0.1, -0.104, 0.012],
        [0.056, -0.112, 0.01],
        [0.03, -0.04, 0.006],
      ],
      0.032,
      0,
      0.008,
    ), // grip
    ...triggerGuard(STAINLESS, -0.032, -0.02, 0.03, 0.022, 0.003),
    slab(
      STAINLESS,
      [
        [-0.148, 0.026],
        [-0.152, REVOLVER_SIGHT, 0.002],
        [-0.162, REVOLVER_SIGHT],
        [-0.164, 0.026],
      ],
      0.005,
    ), // front ramp
    box(BLUED, [0.006, 0.006, 0.01], [-0.0055, REVOLVER_SIGHT - 0.003, 0.03], undefined, 0.001), // rear notch
    box(BLUED, [0.006, 0.006, 0.01], [0.0055, REVOLVER_SIGHT - 0.003, 0.03], undefined, 0.001),
    box(RED, [0.0025, 0.004, 0.006], [0, REVOLVER_SIGHT - 0.003, -0.157], undefined, 0),
    right,
    support,
  )
  const muzzle = marker(0, 0.014, -0.175)
  const ejectPort = marker(0.02, 0.01, -0.015)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.15, -0.15, -0.38),
    ads: new THREE.Vector3(0, -REVOLVER_SIGHT, -0.3),
    // A magnum: the muzzle goes for the ceiling and takes its time coming back.
    recoil: { back: 0.045, climb: 0.34, roll: 0.09, side: 0.03, recover: 13 },
    support,
    handRest: new THREE.Vector3(-0.02, -0.1, 0.07),
    // Cartridges go in one by one, from behind the swung-out cylinder.
    port: new THREE.Vector3(-0.027, -0.043, 0.03),
    round: cartridge(),
    hinge: { part: crane, axis: 'z', open: 1.35 },
    tilt: { roll: -0.2, pitch: 0.3 },
  }
}

// ── Break-action shotguns ──

/** Where you aim a side-by-side: the bead at the end of the rib. */
const RIB_SIGHT = 0.031

/** A side-by-side shotgun that breaks open to load; `sawn` = barrels and stock cut right down. */
function breakAction(sawn: boolean): GunModel {
  const group = new THREE.Group()
  const length = sawn ? 0.2 : 0.5
  const forend = sawn ? 0.1 : 0.2
  // The barrels turn on a pin under them; the breech sits 5 cm behind it, so it lifts clear of
  // the receiver when they drop.
  const pin = new THREE.Vector3(0, -0.02, -0.1)
  const breech = 0.05
  const end = breech - length
  const barrels = part([pin.x, pin.y, pin.z])
  const support = supportHand([0, 0.006, -0.02 - forend / 2], 0.046, 0.034, [-0.11, -0.2, 0.15])
  barrels.add(
    rod(BLUED, 0.0122, breech, end, [-0.0122, 0.032, 0]),
    rod(BLUED, 0.0122, breech, end, [0.0122, 0.032, 0]),
    rod(RUBBER, 0.0095, end + 0.002, end - 0.0006, [-0.0122, 0.032, 0], 8, 0),
    rod(RUBBER, 0.0095, end + 0.002, end - 0.0006, [0.0122, 0.032, 0], 8, 0),
    box(BLUED, [0.008, 0.006, length - 0.01], [0, 0.045, (breech + end) / 2], undefined, 0.002), // rib
    lathe(
      BRASS,
      [
        [0.003, 0],
        [0.0015, 0.0028],
        [-0.0015, 0.0028],
        [-0.003, 0],
      ],
      [0, RIB_SIGHT - 0.0028 - pin.y, end + 0.01],
      { radial: 8 },
    ), // bead
    slab(
      WALNUT,
      [
        [-0.02, 0.022],
        [-0.02 - forend, 0.022, 0.006],
        [-0.02 - forend, -0.006, 0.01],
        [-0.03, -0.012, 0.006],
      ],
      0.046,
      0,
      0.008,
    ), // forend
    support,
  )
  const receiver: P2[] = sawn
    ? [
        [0.07, 0.026],
        [0.1, 0.012, 0.01],
        [0.16, -0.05, 0.01],
        [0.19, -0.11, 0.01],
        [0.14, -0.12, 0.012],
        [0.1, -0.06, 0.02],
        [0.06, -0.03],
      ]
    : [
        [0.07, 0.026],
        [0.14, 0.018, 0.02],
        [0.37, 0.0, 0.006],
        [0.385, -0.004],
        [0.385, -0.112, 0.006],
        [0.37, -0.116],
        [0.2, -0.06, 0.04],
        [0.13, -0.045, 0.02],
        [0.07, -0.03],
      ]
  group.add(
    slab(
      PARKERIZED,
      [
        [0.07, -0.03],
        [0.07, 0.026, 0.004],
        [-0.045, 0.026, 0.004],
        [-0.05, 0.0, 0.006],
        [-0.075, -0.012, 0.004],
        [-0.12, -0.032, 0.006],
        [-0.085, -0.035],
      ],
      0.05,
      0,
      0.006,
    ), // receiver and knuckle
    box(STAINLESS, [0.008, 0.005, 0.03], [0, 0.029, 0.045], undefined, 0.002), // top lever
    slab(
      BLUED,
      [
        [0.05, 0.02],
        [0.058, 0.036, 0.003],
        [0.066, 0.034, 0.002],
        [0.062, 0.018],
      ],
      0.006,
      -0.016,
    ), // hammers
    slab(
      BLUED,
      [
        [0.05, 0.02],
        [0.058, 0.036, 0.003],
        [0.066, 0.034, 0.002],
        [0.062, 0.018],
      ],
      0.006,
      0.016,
    ),
    slab(WALNUT, receiver, 0.044, 0, 0.008), // stock (or what's left)
    ...triggerGuard(BLUED, -0.03, 0.0, 0.055, 0.024),
    barrels,
    rightHand({
      at: sawn ? [0, -0.06, 0.12] : [0, -0.038, 0.12],
      rake: sawn ? 0.6 : 0.9,
      gw: 0.04,
      gd: 0.048,
      trigger: [0, -0.046, 0.03],
      thumb: 0.034,
    }),
  )
  if (!sawn) group.add(box(RUBBER, [0.046, 0.12, 0.014], [0, -0.058, 0.39], [-0.06, 0, 0], 0.004))
  const muzzle = marker(0, 0.012, pin.z + end - 0.01)
  const ejectPort = marker(0.03, 0.015, -0.02)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: sawn ? new THREE.Vector3(0.15, -0.16, -0.4) : new THREE.Vector3(0.16, -0.17, -0.44),
    ads: new THREE.Vector3(0, -RIB_SIGHT, -0.38),
    recoil: sawn
      ? // Nothing to hold on to: it tries to leave your hands.
        { back: 0.07, climb: 0.5, roll: 0.16, side: 0.06, recover: 12 }
      : { back: 0.085, climb: 0.36, roll: 0.11, side: 0.04, recover: 11 },
    support,
    handRest: pin.clone().add(support.position),
    // Shells go into the open breech, the hand coming up beside the gun.
    port: new THREE.Vector3(-0.04, 0.015, 0),
    hinge: { part: barrels, axis: 'x', open: -0.45 },
    tilt: { roll: 0.3, pitch: 0.1 },
  }
}

// ── Kalashnikovs ──

const AK_SIGHT = 0.056

interface KalashnikovLook {
  /** Stock, grip and handguard. */
  furniture: Paint
  /** Saiga-12: the shotgun built on the same action (fat barrel, straight box magazine). */
  shotgun: boolean
  recoil: Recoil
  hip: THREE.Vector3
}

/** The AK shape: stamped receiver, gas tube over the barrel, charging handle on the right. */
function kalashnikov(look: KalashnikovLook): GunModel {
  const group = new THREE.Group()
  const bore = look.shotgun ? 0.014 : 0.009
  const barrelEnd = look.shotgun ? -0.5 : -0.52
  const mag = part()
  if (look.shotgun) {
    mag.position.set(0, -0.04, -0.06)
    mag.rotation.x = 0.06
    mag.add(
      slab(
        POLYMER,
        [
          [0.034, 0.02],
          [-0.034, 0.02],
          [-0.036, -0.1, 0.006],
          [0.036, -0.1, 0.006],
        ],
        0.04,
        0,
        0.006,
      ),
    )
  } else {
    // The banana: curving forward all the way down, ribbed.
    mag.position.set(0, -0.035, -0.06)
    mag.rotation.x = 0.05
    const banana: P2[] = [
      [0.028, 0.025],
      [-0.028, 0.025],
      [-0.034, -0.03, 0.02],
      [-0.07, -0.12, 0.008],
      [-0.03, -0.135, 0.008],
      [0.004, -0.05, 0.02],
    ]
    mag.add(slab(paint(0x2a2c2f, 'metal'), banana, 0.028, 0, 0.005))
    if (fine())
      mag.add(
        box(paint(0x2a2c2f, 'metal'), [0.031, 0.008, 0.04], [0, -0.03, -0.012], [0.5, 0, 0], 0.002),
      )
  }
  const handle = part(
    [0.03, 0.012, -0.02],
    box(STAINLESS, [0.012, 0.01, 0.024], [-0.004, 0, 0], undefined, 0.003),
    rod(STAINLESS, 0.0055, 0.005, -0.005, [0.004, 0, 0], 8),
  )
  const support = supportHand([0, -0.006, -0.22], 0.048, 0.046)
  group.add(
    slab(
      AK_STEEL,
      [
        [0.13, -0.03],
        [0.13, 0.016, 0.004],
        [-0.11, 0.02, 0.004],
        [-0.115, -0.03],
      ],
      0.045,
      0,
      0.005,
    ), // receiver
    // Dust cover with its rib, and the rear sight leaf at its front.
    lathe(
      AK_STEEL,
      [
        [0.13, 0],
        [0.13, 0.019, 0.004],
        [-0.09, 0.02, 0.003],
        [-0.09, 0],
      ],
      [0, 0.014, 0],
      { radial: 12, sx: 1.12, sy: 0.6 },
    ),
    slab(
      AK_STEEL,
      [
        [-0.08, 0.02],
        [-0.085, AK_SIGHT - 0.003, 0.003],
        [-0.125, 0.036, 0.004],
        [-0.125, 0.018],
      ],
      0.024,
      0,
      0.004,
    ),
    box(AK_STEEL, [0.012, 0.006, 0.006], [0, AK_SIGHT - 0.003, -0.082], undefined, 0.001), // notch
    box(RUBBER, [0.002, 0.016, 0.06], [0.0226, 0.0, 0.03], undefined, 0), // ejection port
    // Wooden handguard, lower and upper, and the gas tube.
    lathe(
      look.furniture,
      [
        [-0.12, 0],
        [-0.12, 0.022, 0.004],
        [-0.29, 0.02, 0.008],
        [-0.29, 0],
      ],
      [0, -0.006, 0],
      { radial: 12, sx: 1.08 },
    ),
    lathe(
      look.furniture,
      [
        [-0.13, 0],
        [-0.13, 0.012, 0.003],
        [-0.27, 0.012, 0.004],
        [-0.27, 0],
      ],
      [0, 0.026, 0],
      { radial: 10, sx: 1.25 },
    ),
    ...barrel(BARREL, bore, -0.29, barrelEnd, 0.004),
    // Gas block with the front sight post standing on it.
    slab(
      AK_STEEL,
      [
        [-0.29, -0.01],
        [-0.29, 0.034, 0.004],
        [-0.315, 0.034, 0.004],
        [-0.315, -0.01],
      ],
      0.024,
      0,
      0.004,
    ),
    slab(
      AK_STEEL,
      [
        [barrelEnd + 0.06, -0.006],
        [barrelEnd + 0.052, AK_SIGHT - 0.012, 0.004],
        [barrelEnd + 0.028, AK_SIGHT - 0.012, 0.004],
        [barrelEnd + 0.02, -0.006],
      ],
      0.022,
      0,
      0.004,
    ),
    box(
      AK_STEEL,
      [0.003, 0.014, 0.004],
      [0, AK_SIGHT - 0.007, barrelEnd + 0.04],
      undefined,
      0.0008,
    ),
    box(
      AK_STEEL,
      [0.003, 0.012, 0.02],
      [-0.011, AK_SIGHT - 0.01, barrelEnd + 0.04],
      undefined,
      0.001,
    ),
    box(
      AK_STEEL,
      [0.003, 0.012, 0.02],
      [0.011, AK_SIGHT - 0.01, barrelEnd + 0.04],
      undefined,
      0.001,
    ),
    // Stock and grip.
    slab(
      look.furniture,
      [
        [0.12, 0.012],
        [0.36, -0.005, 0.006],
        [0.37, -0.012],
        [0.37, -0.105, 0.008],
        [0.35, -0.108],
        [0.16, -0.045, 0.03],
        [0.12, -0.03],
      ],
      0.04,
      0,
      0.007,
    ),
    box(AK_STEEL, [0.042, 0.1, 0.008], [0, -0.058, 0.372], [-0.05, 0, 0], 0.003), // butt plate
    slab(
      look.furniture,
      [
        [0.06, -0.03],
        [0.1, -0.03],
        [0.13, -0.108, 0.008],
        [0.09, -0.112, 0.008],
      ],
      0.028,
      0,
      0.007,
    ),
    ...triggerGuard(AK_STEEL, -0.03, 0.005, 0.06, 0.022, 0.003),
    box(AK_STEEL, [0.003, 0.01, 0.07], [0.0235, 0.006, -0.0], undefined, 0.001), // safety lever
    mag,
    handle,
    support,
    rightHand({
      at: [0, -0.068, 0.096],
      rake: 0.35,
      gw: 0.028,
      gd: 0.042,
      trigger: [0, -0.047, 0.032],
    }),
  )
  if (!look.shotgun) {
    // Slant muzzle brake.
    group.add(
      lathe(
        AK_STEEL,
        [
          [barrelEnd + 0.002, 0],
          [barrelEnd + 0.002, 0.012, 0.002],
          [barrelEnd - 0.03, 0.012, 0.003],
          [barrelEnd - 0.034, 0.0],
        ],
        [0, 0.004, 0],
        { radial: 10 },
      ),
    )
  }
  const muzzle = marker(0, 0.004, look.shotgun ? -0.51 : -0.555)
  const ejectPort = marker(0.025, 0.006, 0.03)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: look.hip,
    ads: new THREE.Vector3(0, -AK_SIGHT, -0.3),
    recoil: look.recoil,
    action: action(handle, 0.04, 0.07),
    mag,
    support,
    handRest: support.position.clone(),
    handle: handle.position.clone(),
  }
}

/** AK-47: red-brown laminate, curved magazine. */
function ak47(): GunModel {
  return kalashnikov({
    furniture: LAMINATE,
    shotgun: false,
    // Kicks harder and settles slower than the rifle.
    recoil: { back: 0.024, climb: 0.07, roll: 0.04, side: 0.03, recover: 18 },
    hip: new THREE.Vector3(0.16, -0.16, -0.44),
  })
}

/** Saiga-12: an all-black AK with a shotgun's barrel and a fat box magazine. */
function saiga(): GunModel {
  return kalashnikov({
    furniture: POLYMER,
    shotgun: true,
    // A shotgun's shove, softened by the gas action.
    recoil: { back: 0.06, climb: 0.24, roll: 0.08, side: 0.04, recover: 13 },
    hip: new THREE.Vector3(0.16, -0.17, -0.44),
  })
}

// ── Rifles with wooden stocks ──

/** A one-piece rifle stock: forend to butt with a straight wrist (z, y profile). */
function rifleStock(front: number, top: number, bottom: number): P2[] {
  return [
    [front, top, 0.006],
    [front, bottom + 0.006, 0.01],
    [-0.04, bottom, 0.02],
    [0.08, bottom - 0.006, 0.02],
    [0.16, -0.06, 0.03],
    [0.36, -0.106, 0.006],
    [0.372, -0.104],
    [0.372, 0.008, 0.006],
    [0.35, 0.016, 0.01],
    [0.16, 0.012, 0.03],
    [0.1, top],
  ]
}

const SKS_SIGHT = 0.05

/** SKS: one long wooden stock, a small fixed magazine, the bayonet folded under the barrel. */
function sks(): GunModel {
  const group = new THREE.Group()
  const wood = paint(0x7d5a36, 'wood')
  const mag = part([0, -0.05, -0.035])
  mag.add(
    slab(
      BLUED,
      [
        [0.04, 0.012],
        [-0.04, 0.012],
        [-0.03, -0.022, 0.008],
        [0.01, -0.03, 0.008],
        [0.04, -0.008],
      ],
      0.03,
      0,
      0.004,
    ),
  )
  const handle = part(
    [0.03, 0.022, 0],
    box(STAINLESS, [0.016, 0.01, 0.02], [-0.004, 0, 0], undefined, 0.003),
    rod(STAINLESS, 0.0062, 0.006, -0.006, [0.006, 0, 0], 8),
  )
  const support = supportHand([0, -0.01, -0.22], 0.046, 0.044)
  group.add(
    slab(wood, rifleStock(-0.33, 0.0, -0.045), 0.046, 0, 0.008),
    rod(BLUED, 0.018, 0.11, -0.11, [0, 0.016, 0], 12), // receiver
    box(RUBBER, [0.002, 0.012, 0.05], [0.0182, 0.02, 0.02], undefined, 0),
    lathe(
      wood,
      [
        [-0.11, 0],
        [-0.11, 0.013, 0.003],
        [-0.29, 0.012, 0.004],
        [-0.29, 0],
      ],
      [0, 0.028, 0],
      { radial: 10, sx: 1.25 },
    ), // upper handguard over the gas tube
    ...barrel(BARREL, 0.0085, -0.29, -0.6, 0.012),
    box(BLUED, [0.022, 0.03, 0.02], [0, 0.022, -0.3], undefined, 0.004), // gas block
    slab(
      BLADE,
      [
        [-0.34, 0.0],
        [-0.56, 0.0, 0.004],
        [-0.585, -0.005],
        [-0.56, -0.012, 0.006],
        [-0.34, -0.012],
      ],
      0.006,
      0,
      0.002,
    ), // folded bayonet
    ...apertureSights(BLUED, SKS_SIGHT, -0.57, -0.1, 0.02),
    ...triggerGuard(BLUED, -0.045, 0.02, 0.08, 0.022),
    mag,
    handle,
    support,
    rightHand({
      at: [0, -0.04, 0.13],
      rake: 0.95,
      gw: 0.04,
      gd: 0.048,
      trigger: [0, -0.058, 0.05],
      thumb: 0.034,
    }),
  )
  const muzzle = marker(0, 0.012, -0.6)
  const ejectPort = marker(0.03, 0.03, 0)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.16, -0.17, -0.44),
    ads: new THREE.Vector3(0, -SKS_SIGHT, -0.3),
    // One round at a time, each a solid thump.
    recoil: { back: 0.03, climb: 0.1, roll: 0.05, side: 0.02, recover: 16 },
    action: action(handle, 0.04, 0.08),
    mag,
    support,
    handRest: support.position.clone(),
    handle: handle.position.clone(),
  }
}

const CARBINE_SIGHT = 0.045

/** Ruger 10/22: a small, light carbine in pale birch with a stubby rotary magazine. */
function carbine22(): GunModel {
  const group = new THREE.Group()
  const mag = part([0, -0.05, -0.04])
  mag.rotation.x = 0.12
  mag.add(box(RUBBER, [0.026, 0.04, 0.042], undefined, undefined, 0.006))
  const handle = part(
    [0.024, 0.016, -0.01],
    box(STAINLESS, [0.014, 0.008, 0.016], [-0.003, 0, 0], undefined, 0.003),
  )
  const support = supportHand([0, -0.012, -0.16], 0.044, 0.04)
  group.add(
    slab(BIRCH, rifleStock(-0.26, 0.0, -0.04), 0.044, 0, 0.008),
    slab(
      ALLOY,
      [
        [0.09, -0.004],
        [0.09, 0.022, 0.008],
        [-0.08, 0.026, 0.006],
        [-0.08, -0.004],
      ],
      0.032,
      0,
      0.007,
    ), // receiver
    box(RUBBER, [0.002, 0.012, 0.04], [0.0162, 0.012, 0.0], undefined, 0),
    ...barrel(BARREL, 0.0085, -0.08, -0.35, 0.012),
    lathe(
      BLUED,
      [
        [-0.214, 0],
        [-0.214, 0.026, 0.002],
        [-0.226, 0.026, 0.002],
        [-0.226, 0],
      ],
      [0, -0.004, 0],
      { radial: 10, sx: 0.85 },
    ), // barrel band
    ...apertureSights(BLUED, CARBINE_SIGHT, -0.32, -0.06, 0.018),
    ...triggerGuard(BLUED, -0.04, 0.02, 0.075, 0.022),
    mag,
    handle,
    support,
    rightHand({
      at: [0, -0.036, 0.13],
      rake: 0.95,
      gw: 0.04,
      gd: 0.048,
      trigger: [0, -0.055, 0.047],
      thumb: 0.034,
    }),
  )
  const muzzle = marker(0, 0.012, -0.35)
  const ejectPort = marker(0.026, 0.02, -0.01)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.15, -0.16, -0.42),
    ads: new THREE.Vector3(0, -CARBINE_SIGHT, -0.28),
    // A .22: it twitches.
    recoil: { back: 0.008, climb: 0.025, roll: 0.015, side: 0.01, recover: 26 },
    action: action(handle, 0.03, 0.05),
    mag,
    support,
    handRest: support.position.clone(),
    handle: handle.position.clone(),
  }
}

/** Hunting rifle: dark walnut, a long thin barrel, a bolt, and a short scope you look through. */
function huntingRifle(): GunModel {
  const group = new THREE.Group()
  const bolt = part([0.0, 0.008, 0.05])
  bolt.add(
    rod(PARKERIZED, 0.008, 0.05, -0.05, [0, 0, 0]),
    limb(PARKERIZED, [0.008, 0, 0], [0.034, -0.012, 0.006], 0.004, 0.0035),
    lathe(
      RUBBER,
      [
        [0.008, 0],
        [0.005, 0.0065],
        [-0.004, 0.007],
        [-0.008, 0],
      ],
      [0.037, -0.014, 0.006],
      { radial: 10 },
    ),
  )
  const mag = part([0, -0.05, -0.03])
  mag.add(box(BLUED, [0.03, 0.012, 0.08], undefined, undefined, 0.003))
  const support = supportHand([0, -0.016, -0.2], 0.046, 0.04)
  // The scope is a hollow tube, so aiming you see through it: it only zooms a little and doesn't
  // take over the screen like the sniper's.
  const eye = 0.066
  const inner = 0.02
  group.add(
    mag,
    rod(BLUED, 0.0165, 0.13, -0.1, [0, 0.008, 0], 12), // receiver
    slab(WALNUT, rifleStock(-0.3, 0.0, -0.044), 0.046, 0, 0.009),
    box(RUBBER, [0.048, 0.118, 0.014], [0, -0.046, 0.378], [-0.06, 0, 0], 0.004),
    lathe(
      BARREL,
      [
        [-0.1, 0],
        [-0.1, 0.012],
        [-0.18, 0.0095, 0.04],
        [-0.63, 0.0078],
        [-0.63, 0],
      ],
      [0, 0.008, 0],
      { radial: 10 },
    ),
    // Hollow scope: tube walls, objective bell, eyepiece.
    lathe(
      SCOPE_BODY,
      [
        [0.03, inner],
        [0.03, inner + 0.004, 0.001],
        [-0.1, inner + 0.004],
        [-0.12, inner + 0.008, 0.003],
        [-0.142, inner + 0.008, 0.002],
        [-0.142, inner + 0.002],
        [0.03, inner],
      ],
      [0, eye, 0],
      { radial: 16 },
    ),
    box(paint(0x08080a, 'polymer'), [0.0015, 2 * inner, 0.0015], [0, eye, -0.06], undefined, 0), // crosshair
    box(paint(0x08080a, 'polymer'), [2 * inner, 0.0015, 0.0015], [0, eye, -0.06], undefined, 0),
    box(
      SCOPE_BODY,
      [0.012, eye - inner - 0.012, 0.014],
      [0, (eye - inner + 0.012) / 2 + 0.004, -0.09],
      undefined,
      0.002,
    ),
    box(
      SCOPE_BODY,
      [0.012, eye - inner - 0.012, 0.014],
      [0, (eye - inner + 0.012) / 2 + 0.004, 0.0],
      undefined,
      0.002,
    ),
    lathe(
      SCOPE_BODY,
      [
        [0.01, 0],
        [0.01, 0.007, 0.002],
        [0, 0.007],
        [0, 0],
      ],
      [0, eye + inner + 0.002, -0.045],
      { radial: 10, rot: [-Math.PI / 2, 0, 0] },
    ), // turret
    ...triggerGuard(BLUED, -0.046, 0.02, 0.075, 0.022),
    bolt,
    support,
    rightHand({
      at: [0, -0.04, 0.13],
      rake: 0.95,
      gw: 0.042,
      gd: 0.048,
      trigger: [0, -0.06, 0.047],
      thumb: 0.034,
    }),
  )
  const muzzle = marker(0, 0.008, -0.64)
  const ejectPort = marker(0.03, 0.02, 0.02)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.16, -0.17, -0.44),
    ads: new THREE.Vector3(0, -eye, -0.24),
    recoil: { back: 0.05, climb: 0.24, roll: 0.1, side: 0.03, recover: 12 },
    bolt,
    mag,
    support,
    handRest: support.position.clone(),
    handle: new THREE.Vector3(0.037, -0.006, 0.056),
  }
}

const LEVER_SIGHT = 0.049

/** Lever-action: brass receiver, octagonal barrel over a tube magazine, the lever round the hand. */
function leverAction(): GunModel {
  const group = new THREE.Group()
  // The lever turns on a pin ahead of the trigger and takes the hand down with it.
  const lever = part([0, -0.03, 0.02])
  lever.add(
    sweep(
      BLUED,
      [
        [0, 0.002, 0],
        [0, -0.012, 0.03],
        [0, -0.035, 0.07],
        [0, -0.05, 0.1],
        [0, -0.03, 0.125],
        [0, -0.005, 0.12],
        [0, 0.0, 0.1],
      ],
      0.0042,
      0.0042,
      fine() ? 10 : 4,
      6,
    ),
  )
  const support = supportHand([0, -0.01, -0.2], 0.044, 0.044)
  const hand = rightHand({
    at: [0, -0.045, 0.125],
    rake: 1.1,
    gw: 0.038,
    gd: 0.044,
    trigger: [0, -0.045, 0.06],
    thumb: 0.034,
  })
  group.add(
    slab(
      BRASS,
      [
        [0.08, -0.03],
        [0.08, 0.02, 0.006],
        [0.06, 0.028, 0.006],
        [-0.08, 0.028, 0.006],
        [-0.08, -0.03, 0.006],
      ],
      0.04,
      0,
      0.006,
    ), // receiver
    box(RUBBER, [0.002, 0.03, 0.05], [0.0202, 0.002, -0.01], undefined, 0), // loading gate / port
    slab(
      BLUED,
      [
        [0.064, 0.02],
        [0.072, 0.04, 0.003],
        [0.08, 0.038, 0.002],
        [0.074, 0.018],
      ],
      0.008,
    ), // hammer
    lathe(
      BLUED,
      [
        [-0.08, 0],
        [-0.08, 0.011],
        [-0.505, 0.0098],
        [-0.505, 0],
      ],
      [0, 0.012, 0],
      { radial: 8, phase: Math.PI / 8 },
    ), // octagonal barrel
    rod(RUBBER, 0.005, -0.503, -0.506, [0, 0.012, 0], 8, 0),
    rod(BLUED, 0.008, -0.08, -0.46, [0, -0.01, 0]), // tube magazine
    lathe(
      WALNUT,
      [
        [-0.085, 0],
        [-0.085, 0.022, 0.004],
        [-0.28, 0.021, 0.006],
        [-0.28, 0],
      ],
      [0, -0.006, 0],
      { radial: 12, sx: 1.0, sy: 1.0 },
    ), // forend
    rod(BRASS, 0.012, -0.28, -0.29, [0, -0.002, 0], 10, 0.3), // forend cap
    slab(
      WALNUT,
      [
        [0.08, 0.014],
        [0.12, 0.012, 0.02],
        [0.36, -0.006, 0.006],
        [0.372, -0.012],
        [0.372, -0.11, 0.008],
        [0.35, -0.114],
        [0.17, -0.06, 0.03],
        [0.08, -0.028],
      ],
      0.042,
      0,
      0.008,
    ), // butt
    box(BRASS, [0.044, 0.1, 0.006], [0, -0.06, 0.374], [-0.05, 0, 0], 0.002), // butt plate
    slab(
      BRASS,
      [
        [-0.47, 0.022],
        [-0.476, LEVER_SIGHT, 0.002],
        [-0.484, LEVER_SIGHT],
        [-0.488, 0.022],
      ],
      0.004,
    ), // front sight
    box(BLUED, [0.004, 0.026, 0.008], [-0.008, LEVER_SIGHT - 0.013, -0.1], undefined, 0.001), // rear sight
    box(BLUED, [0.004, 0.026, 0.008], [0.008, LEVER_SIGHT - 0.013, -0.1], undefined, 0.001),
    box(BLUED, [0.022, 0.006, 0.008], [0, 0.026, -0.1], undefined, 0.001),
    lever,
    support,
  )
  // The hand rides with the lever; its forearm stays with the gun.
  group.add(hand)
  group.updateMatrixWorld(true)
  lever.attach(hand.children[0] as THREE.Object3D)
  const muzzle = marker(0, 0.012, -0.51)
  const ejectPort = marker(0.025, 0.03, 0)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.16, -0.17, -0.44),
    ads: new THREE.Vector3(0, -LEVER_SIGHT, -0.26),
    recoil: { back: 0.04, climb: 0.18, roll: 0.07, side: 0.03, recover: 14 },
    lever,
    support,
    handRest: support.position.clone(),
    // Cartridges go in through the gate, one by one.
    port: new THREE.Vector3(-0.005, -0.045, -0.02),
    round: cartridge(),
    tilt: { roll: -0.45, pitch: 0.2 },
  }
}

// ── Submachine guns ──

const UZI_SIGHT = 0.06

/** Uzi: a ribbed steel box with the magazine up through the grip and the cocking knob on top. */
function uzi(): GunModel {
  const group = new THREE.Group()
  const body = paint(0x34363b, 'metal')
  const mag = part([0, -0.11, 0.07])
  mag.add(
    box(BLUED, [0.022, 0.17, 0.03], undefined, undefined, 0.003),
    box(POLYMER, [0.028, 0.01, 0.036], [0, -0.088, 0], undefined, 0.003),
  )
  const knob = part(
    [0, 0.045, -0.04],
    lathe(
      RUBBER,
      [
        [0.009, 0],
        [0.009, 0.009, 0.003],
        [-0.009, 0.009, 0.003],
        [-0.009, 0],
      ],
      undefined,
      {
        radial: 10,
        sy: 0.8,
      },
    ),
  )
  const support = supportHand([0, -0.006, -0.1], 0.046, 0.06)
  group.add(
    slab(
      body,
      [
        [0.15, -0.03],
        [0.15, 0.03, 0.006],
        [-0.15, 0.03, 0.006],
        [-0.15, -0.03, 0.006],
      ],
      0.046,
      0,
      0.006,
    ), // receiver
    box(body, [0.04, 0.008, 0.26], [0, 0.034, 0], undefined, 0.003), // top cover
    rod(PARKERIZED, 0.016, -0.15, -0.168, [0, 0.002, 0], 12, 0.3), // barrel nut
    ...barrel(BARREL, 0.0085, -0.165, -0.22, 0.002),
    ...apertureSights(body, UZI_SIGHT, -0.13, 0.13, 0.036, false),
    slab(
      PARKERIZED,
      [
        [0.15, -0.03],
        [0.24, -0.03, 0.004],
        [0.24, -0.045, 0.004],
        [0.15, -0.045],
      ],
      0.038,
      0,
      0.003,
    ), // folded stock
    slab(
      RUBBER,
      [
        [0.04, -0.03],
        [0.1, -0.03],
        [0.098, -0.13, 0.008],
        [0.04, -0.13, 0.008],
      ],
      0.036,
      0,
      0.006,
    ), // grip round the magazine
    ...triggerGuard(body, -0.03, -0.02, 0.04, 0.026),
    mag,
    knob,
    support,
    rightHand({ at: [0, -0.08, 0.072], rake: 0.0, gw: 0.036, gd: 0.06, trigger: [0, -0.05, 0.01] }),
  )
  if (fine()) {
    for (let k = 0; k < 5; k++)
      group.add(box(body, [0.0475, 0.006, 0.006], [0, 0.018, -0.09 + k * 0.04], undefined, 0.002)) // ribs
  }
  const muzzle = marker(0, 0.002, -0.23)
  const ejectPort = marker(0.025, 0.015, 0)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.15, -0.15, -0.4),
    ads: new THREE.Vector3(0, -UZI_SIGHT, -0.32),
    recoil: { back: 0.014, climb: 0.035, roll: 0.025, side: 0.03, recover: 24 },
    action: action(knob, 0.035, 0.05),
    mag,
    support,
    handRest: support.position.clone(),
    handle: knob.position.clone(),
  }
}

const UMP_SIGHT = 0.07

/** UMP45: a slab of black polymer, a straight magazine, a rail and a skeleton stock. */
function ump(): GunModel {
  const group = new THREE.Group()
  const polymer = paint(0x34363b, 'polymer')
  const mag = part([0, -0.06, -0.08])
  mag.rotation.x = 0.05
  mag.add(
    slab(
      RUBBER,
      [
        [0.022, 0.03],
        [-0.022, 0.03],
        [-0.024, -0.1, 0.006],
        [0.024, -0.1, 0.006],
      ],
      0.03,
      0,
      0.005,
    ),
  )
  const handle = part(
    [-0.03, 0.02, -0.16],
    box(PARKERIZED, [0.024, 0.008, 0.01], [0.004, 0, 0], undefined, 0.002),
  )
  const support = supportHand([0, -0.006, -0.2], 0.046, 0.05)
  group.add(
    slab(
      polymer,
      [
        [0.12, -0.03],
        [0.12, 0.032, 0.006],
        [-0.24, 0.032, 0.006],
        [-0.25, 0.0, 0.008],
        [-0.24, -0.03, 0.006],
        [-0.12, -0.035],
        [-0.04, -0.035],
      ],
      0.044,
      0,
      0.008,
    ), // receiver and handguard
    ...rail(0.11, -0.2, 0.032, 0.02),
    ...barrel(BARREL, 0.009, -0.25, -0.28, 0.005),
    ...apertureSights(BLUED, UMP_SIGHT, -0.19, 0.08, 0.038),
    // Skeleton stock: two bars and a butt plate, daylight between them.
    slab(
      polymer,
      [
        [0.12, 0.022],
        [0.33, 0.016, 0.006],
        [0.345, 0.012],
        [0.345, -0.07, 0.006],
        [0.33, -0.075],
        [0.32, -0.06],
        [0.32, 0.0],
        [0.12, 0.005],
      ],
      0.02,
      0,
      0.005,
    ),
    slab(
      polymer,
      [
        [0.12, -0.03],
        [0.32, -0.055],
        [0.32, -0.07],
        [0.12, -0.045],
      ],
      0.018,
      0,
      0.004,
    ),
    slab(
      polymer,
      [
        [0.06, -0.03],
        [0.1, -0.03],
        [0.13, -0.108, 0.008],
        [0.09, -0.112, 0.008],
      ],
      0.03,
      0,
      0.007,
    ), // grip
    ...triggerGuard(polymer, -0.034, 0.0, 0.06, 0.024, 0.0036),
    mag,
    handle,
    support,
    rightHand({ at: [0, -0.07, 0.097], rake: 0.35, gd: 0.042, trigger: [0, -0.05, 0.03] }),
  )
  const muzzle = marker(0, 0.005, -0.29)
  const ejectPort = marker(0.024, 0.015, -0.04)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.15, -0.15, -0.4),
    ads: new THREE.Vector3(0, -UMP_SIGHT, -0.32),
    // Slower and heavier than the MP5: a thud rather than a buzz.
    recoil: { back: 0.016, climb: 0.045, roll: 0.025, side: 0.025, recover: 22 },
    action: action(handle, 0.025, 0.06),
    mag,
    support,
    handRest: support.position.clone(),
    handle: handle.position.clone(),
  }
}

const MAC_SIGHT = 0.05

/** MAC-10: a grey brick with a stub of threaded barrel, a long magazine in the grip, a strap. */
function mac10(): GunModel {
  const group = new THREE.Group()
  const mag = part([0, -0.12, 0.07])
  mag.add(
    box(BLUED, [0.024, 0.18, 0.032], undefined, undefined, 0.003),
    box(RUBBER, [0.03, 0.012, 0.038], [0, -0.092, 0], undefined, 0.003),
  )
  const knob = part(
    [0, 0.036, -0.02],
    lathe(
      RUBBER,
      [
        [0.008, 0],
        [0.008, 0.009, 0.003],
        [-0.008, 0.009, 0.003],
        [-0.008, 0],
      ],
      undefined,
      {
        radial: 10,
      },
    ),
  )
  const support = supportHand([0, -0.045, -0.055], 0.03, 0.05, [-0.12, -0.24, 0.1])
  const threads: P2[] = [[-0.07, 0]]
  for (let z = -0.07; z > -0.115; z -= 0.006) threads.push([z, 0.0105], [z - 0.003, 0.0092])
  threads.push([-0.118, 0.009], [-0.118, 0])
  group.add(
    slab(
      PARKERIZED,
      [
        [0.14, -0.029],
        [0.14, 0.029, 0.004],
        [-0.07, 0.029, 0.004],
        [-0.07, -0.029, 0.004],
      ],
      0.052,
      0,
      0.005,
    ),
    lathe(BLUED, threads, [0, -0.004, 0], { radial: 10 }),
    rod(RUBBER, 0.005, -0.116, -0.119, [0, -0.004, 0], 8, 0),
    sweep(
      OLIVE,
      [
        [0, -0.028, -0.06],
        [0, -0.05, -0.062],
        [0, -0.07, -0.05],
        [0, -0.07, -0.03],
      ],
      0.006,
      0.006,
      fine() ? 6 : 3,
      6,
    ), // strap
    ...apertureSights(PARKERIZED, MAC_SIGHT, -0.06, 0.13, 0.029, false),
    // Wire stock, pushed in.
    rod(BLUED, 0.0025, 0.2, 0.05, [-0.029, 0, 0], 6),
    rod(BLUED, 0.0025, 0.2, 0.05, [0.029, 0, 0], 6),
    box(BLUED, [0.062, 0.04, 0.006], [0, 0, 0.2], undefined, 0.002),
    slab(
      PARKERIZED,
      [
        [0.04, -0.029],
        [0.1, -0.029],
        [0.096, -0.125, 0.006],
        [0.044, -0.125, 0.006],
      ],
      0.036,
      0,
      0.006,
    ), // grip round the magazine
    ...triggerGuard(PARKERIZED, -0.029, -0.02, 0.04, 0.026),
    mag,
    knob,
    support,
    rightHand({
      at: [0, -0.08, 0.072],
      rake: 0.0,
      gw: 0.036,
      gd: 0.056,
      trigger: [0, -0.048, 0.01],
    }),
  )
  const muzzle = marker(0, -0.004, -0.12)
  const ejectPort = marker(0.028, 0.015, 0.02)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.15, -0.15, -0.38),
    ads: new THREE.Vector3(0, -MAC_SIGHT, -0.32),
    // Tiny and far too fast: it shakes itself all over the place.
    recoil: { back: 0.016, climb: 0.05, roll: 0.035, side: 0.045, recover: 24 },
    action: action(knob, 0.025, 0.04),
    mag,
    support,
    handRest: support.position.clone(),
    handle: knob.position.clone(),
  }
}

// ── Marksman ──

const SVD_SCOPE = 0.062

/** SVD Dragunov: long thin barrel, laminate skeleton stock, the scope sitting off a side rail. */
function svd(): GunModel {
  const group = new THREE.Group()
  const mag = part([0, -0.04, -0.03])
  mag.rotation.x = 0.1
  mag.add(
    slab(
      paint(0x2a2c2f, 'metal'),
      [
        [0.03, 0.02],
        [-0.03, 0.02],
        [-0.036, -0.07, 0.006],
        [0.026, -0.07, 0.006],
      ],
      0.028,
      0,
      0.005,
    ),
  )
  const handle = part(
    [0.028, 0.012, -0.02],
    box(STAINLESS, [0.014, 0.01, 0.026], undefined, undefined, 0.003),
  )
  const support = supportHand([0, -0.002, -0.23], 0.044, 0.042)
  group.add(
    mag,
    slab(
      AK_STEEL,
      [
        [0.13, -0.025],
        [0.13, 0.02, 0.005],
        [-0.13, 0.022, 0.005],
        [-0.13, -0.025],
      ],
      0.04,
      0,
      0.006,
    ), // receiver
    lathe(
      LAMINATE,
      [
        [-0.13, 0],
        [-0.13, 0.022, 0.004],
        [-0.33, 0.02, 0.008],
        [-0.33, 0],
      ],
      [0, 0.0, 0],
      { radial: 10, sx: 1.0, sy: 1.1 },
    ), // handguard
    ...barrel(BARREL, 0.0075, -0.33, -0.68, 0.006),
    lathe(
      AK_STEEL,
      [
        [-0.675, 0],
        [-0.675, 0.011, 0.002],
        [-0.735, 0.011, 0.002],
        [-0.735, 0.006],
        [-0.73, 0],
      ],
      [0, 0.006, 0],
      { radial: 10 },
    ), // flash hider
    box(AK_STEEL, [0.006, 0.03, 0.01], [0, 0.024, -0.65], undefined, 0.002), // front sight
    ...scope(SVD_SCOPE, 0.13, -0.13, 0.036, 0.015, 0.02, SCOPE_BODY),
    box(AK_STEEL, [0.012, 0.024, 0.1], [-0.014, 0.036, 0], undefined, 0.003), // side mount
    // Skeleton stock: comb above, strut below, the butt joining them.
    slab(
      LAMINATE,
      [
        [0.12, 0.02],
        [0.36, 0.02, 0.008],
        [0.39, 0.01],
        [0.39, -0.08, 0.008],
        [0.37, -0.085],
        [0.17, -0.07, 0.01],
        [0.12, -0.06],
        [0.12, -0.04],
        [0.17, -0.045],
        [0.34, -0.055, 0.008],
        [0.355, -0.04],
        [0.355, -0.012, 0.004],
        [0.3, -0.006],
        [0.12, -0.016],
      ],
      0.034,
      0,
      0.006,
    ),
    box(RUBBER, [0.03, 0.012, 0.12], [0, 0.026, 0.24], undefined, 0.004), // cheek pad
    slab(
      LAMINATE,
      [
        [0.08, -0.025],
        [0.12, -0.025],
        [0.15, -0.105, 0.008],
        [0.11, -0.11, 0.008],
      ],
      0.03,
      0,
      0.007,
    ), // grip
    ...triggerGuard(AK_STEEL, -0.025, 0.02, 0.075, 0.022),
    handle,
    support,
    rightHand({
      at: [0, -0.066, 0.118],
      rake: 0.35,
      gw: 0.03,
      gd: 0.044,
      trigger: [0, -0.042, 0.047],
    }),
  )
  const muzzle = marker(0, 0.006, -0.74)
  const ejectPort = marker(0.028, 0.02, -0.02)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.16, -0.17, -0.44),
    ads: new THREE.Vector3(0, -SVD_SCOPE, -0.12),
    // Lighter than the bolt-action's heave, and back on target sooner.
    recoil: { back: 0.045, climb: 0.2, roll: 0.09, side: 0.03, recover: 13 },
    action: action(handle, 0.04, 0.08),
    mag,
    support,
    handRest: support.position.clone(),
    handle: handle.position.clone(),
  }
}

const BARRETT_SCOPE = 0.09

/** Barrett .50: enormous. A slab receiver, a fat barrel with a muzzle brake, a folded bipod. */
function barrett(): GunModel {
  const group = new THREE.Group()
  const body = OD_GREEN
  const mag = part([0, -0.06, -0.02])
  mag.rotation.x = 0.1
  mag.add(box(BLUED, [0.046, 0.08, 0.12], undefined, undefined, 0.006))
  const handle = part(
    [0.04, 0.015, -0.05],
    box(STAINLESS, [0.018, 0.016, 0.034], undefined, undefined, 0.004),
  )
  const support = supportHand([0, -0.01, -0.27], 0.06, 0.06)
  group.add(
    mag,
    slab(
      body,
      [
        [0.22, -0.04],
        [0.22, 0.042, 0.006],
        [-0.21, 0.042, 0.006],
        [-0.21, -0.044, 0.006],
      ],
      0.06,
      0,
      0.008,
    ), // receiver
    ...rail(0.2, -0.2, 0.042, 0.024),
    lathe(
      body,
      [
        [-0.2, 0],
        [-0.2, 0.032, 0.004],
        [-0.37, 0.03, 0.008],
        [-0.37, 0],
      ],
      [0, 0.004, 0],
      { radial: 8, phase: Math.PI / 8 },
    ), // barrel shroud
    lathe(
      BARREL,
      [
        [-0.37, 0],
        [-0.37, 0.017],
        [-0.72, 0.015, 0.002],
        [-0.72, 0],
      ],
      [0, 0.008, 0],
      { radial: 12 },
    ),
    // Muzzle brake: a wide arrowhead with ports.
    slab(
      STAINLESS,
      [
        [-0.715, 0.02],
        [-0.79, 0.02, 0.006],
        [-0.8, 0.008, 0.004],
        [-0.79, -0.004, 0.006],
        [-0.715, -0.004],
      ],
      0.075,
      0,
      0.008,
    ),
    box(RUBBER, [0.077, 0.014, 0.012], [0, 0.008, -0.74], undefined, 0),
    box(RUBBER, [0.077, 0.014, 0.012], [0, 0.008, -0.765], undefined, 0),
    box(BLUED, [0.07, 0.02, 0.02], [0, -0.036, -0.3], undefined, 0.005), // bipod yoke
    limb(BLUED, [-0.03, -0.042, -0.3], [-0.03, -0.046, -0.52], 0.006),
    limb(BLUED, [0.03, -0.042, -0.3], [0.03, -0.046, -0.52], 0.006),
    ...scope(BARRETT_SCOPE, 0.16, -0.17, 0.048, 0.018, 0.028, SCOPE_BODY),
    slab(
      body,
      [
        [0.2, 0.03],
        [0.35, 0.03, 0.006],
        [0.36, -0.08, 0.006],
        [0.3, -0.085, 0.01],
        [0.2, -0.04],
      ],
      0.056,
      0,
      0.008,
    ), // butt
    box(RUBBER, [0.058, 0.12, 0.022], [0, -0.025, 0.368], undefined, 0.006), // recoil pad
    slab(
      RUBBER,
      [
        [0.06, -0.04],
        [0.1, -0.04],
        [0.13, -0.122, 0.008],
        [0.09, -0.126, 0.008],
      ],
      0.032,
      0,
      0.007,
    ), // grip
    ...triggerGuard(body, -0.042, 0.0, 0.06, 0.024, 0.004),
    handle,
    support,
    rightHand({
      at: [0, -0.084, 0.098],
      rake: 0.35,
      gw: 0.032,
      gd: 0.044,
      trigger: [0, -0.06, 0.03],
    }),
  )
  const muzzle = marker(0, 0.008, -0.8)
  const ejectPort = marker(0.04, 0.02, -0.05)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.18, -0.2, -0.46),
    ads: new THREE.Vector3(0, -BARRETT_SCOPE, -0.14),
    // It doesn't kick, it shoves you across the room, and it is in no hurry to come back.
    recoil: { back: 0.11, climb: 0.38, roll: 0.14, side: 0.04, recover: 8 },
    action: action(handle, 0.06, 0.14),
    mag,
    support,
    handRest: support.position.clone(),
    handle: handle.position.clone(),
    tilt: { roll: -0.4, pitch: 0.03 },
  }
}

/** A crossbow bolt: shaft, broadhead, two coloured vanes. Origin at the middle of the shaft. */
function crossbowBolt(): THREE.Group {
  const g = new THREE.Group()
  g.add(
    rod(STAINLESS, 0.003, 0.15, -0.15, [0, 0, 0], 6, 0.2),
    lathe(
      BLADE,
      [
        [-0.145, 0],
        [-0.145, 0.0075],
        [-0.18, 0],
      ],
      undefined,
      { radial: 3 },
    ),
    box(VANE_RED, [0.02, 0.002, 0.04], [0, 0, 0.12], undefined, 0),
    box(VANE_YELLOW, [0.002, 0.02, 0.04], [0, 0, 0.12], undefined, 0),
  )
  return g
}

const CROSSBOW_DOT = 0.09

/** Crossbow: limbs swept back from the front, a string you can see cocked or loosed, a red dot. */
function crossbow(): GunModel {
  const group = new THREE.Group()
  const sides = [-1, 1] as const
  // Limbs: each curving from the riser, swept back towards its tip.
  const sweepAngle = 0.35
  const span = 0.2
  const tipX = 0.03 + span * Math.cos(sweepAngle)
  const tipZ = -0.36 + span * Math.sin(sweepAngle)
  for (const side of sides) {
    group.add(
      sweep(
        RUBBER,
        [
          [side * 0.03, 0, -0.36],
          [side * 0.1, 0, -0.355],
          [side * 0.17, 0, -0.32],
          [side * tipX, 0, tipZ],
        ],
        0.009,
        0.005,
        fine() ? 6 : 3,
        6,
      ),
      rod(STAINLESS, 0.008, 0.004, -0.004, [side * tipX, 0, tipZ], 8), // cam
    )
  }
  // The string: two straight halves from the limb tips to wherever the middle is held.
  const stringY = 0.016
  const travel = 0.24
  const halves = sides.map((side) => {
    const mesh = box(STRING, [1, 0.003, 0.003], undefined, undefined, 0)
    mesh.userData.keep = true
    return { side, mesh }
  })
  const resting = crossbowBolt()
  resting.userData.keep = true
  const rest = new THREE.Vector3(0, 0.022, -0.2)
  resting.position.copy(rest)
  const set = (drawn: number, loaded: boolean) => {
    const middleZ = tipZ + drawn * travel
    for (const { side, mesh } of halves) {
      mesh.position.set((side * tipX) / 2, stringY, (tipZ + middleZ) / 2)
      mesh.rotation.y = Math.atan2(tipZ - middleZ, -side * tipX)
      mesh.scale.x = Math.hypot(tipX, middleZ - tipZ)
    }
    resting.visible = loaded
  }
  set(1, true)
  const support = supportHand([0, -0.008, -0.2], 0.04, 0.04)
  group.add(
    slab(
      CROSSBOW_BODY,
      [
        [0.06, 0.012],
        [-0.36, 0.012, 0.004],
        [-0.37, -0.01, 0.004],
        [-0.36, -0.028, 0.004],
        [0.06, -0.028],
      ],
      0.036,
      0,
      0.006,
    ), // stock and rail
    box(RUBBER, [0.01, 0.003, 0.36], [0, 0.0125, -0.17], undefined, 0), // groove the bolt lies in
    slab(
      CROSSBOW_BODY,
      [
        [0.06, 0.012],
        [0.33, 0.006, 0.008],
        [0.345, -0.002],
        [0.345, -0.09, 0.008],
        [0.32, -0.095],
        [0.17, -0.05, 0.02],
        [0.13, -0.11, 0.008],
        [0.09, -0.11, 0.008],
        [0.06, -0.028],
      ],
      0.04,
      0,
      0.007,
    ), // butt with a thumbhole grip
    box(PARKERIZED, [0.07, 0.034, 0.04], [0, 0, -0.36], undefined, 0.008), // riser
    sweep(
      PARKERIZED,
      [
        [-0.026, 0, -0.38],
        [-0.024, 0, -0.42],
        [0, 0, -0.43],
        [0.024, 0, -0.42],
        [0.026, 0, -0.38],
      ],
      0.003,
      0.003,
      fine() ? 6 : 3,
      5,
    ), // stirrup
    box(PARKERIZED, [0.03, 0.02, 0.07], [0, 0.02, 0.01], undefined, 0.004), // latch
    ...rail(0.06, -0.06, 0.03, 0.02),
    ...redDot(CROSSBOW_DOT, 0.0, 0.036),
    ...halves.map((half) => half.mesh),
    resting,
    ...triggerGuard(PARKERIZED, -0.028, 0.02, 0.075, 0.024),
    support,
    rightHand({ at: [0, -0.07, 0.108], rake: 0.35, gd: 0.042, trigger: [0, -0.047, 0.047] }),
  )
  const muzzle = marker(0, 0.022, -0.4)
  const ejectPort = marker(0, 0.02, 0)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.14, -0.17, -0.42),
    ads: new THREE.Vector3(0, -CROSSBOW_DOT, -0.26),
    // No powder: just the slap of the limbs.
    recoil: { back: 0.012, climb: 0.03, roll: 0.01, side: 0.006, recover: 20 },
    noFlash: true,
    support,
    handRest: support.position.clone(),
    // Where the hand hauls the string to, and where it lets go of the new bolt.
    handle: new THREE.Vector3(0, stringY + 0.02, tipZ + travel + 0.01),
    port: new THREE.Vector3(-0.045, 0.03, -0.1),
    round: crossbowBolt(),
    bow: { travel, rest, set },
    tilt: { roll: 0.12, pitch: 0.08 },
  }
}

// ── Melee: built lying along -Z with the hand at the origin, then held up in the fist ──

function bat(): THREE.Group {
  const g = new THREE.Group()
  g.add(
    lathe(
      ASH,
      [
        [0.07, 0],
        [0.07, 0.016, 0.004],
        [0.06, 0.017, 0.003],
        [0.056, 0.012],
        [-0.12, 0.013],
        [-0.3, 0.017, 0.04],
        [-0.48, 0.03, 0.06],
        [-0.72, 0.033],
        [-0.745, 0.03, 0.006],
        [-0.75, 0],
      ],
      undefined,
      { radial: 12 },
    ),
    rod(TAPE, 0.0145, 0.06, -0.1, [0, 0, 0], 10, 0.15), // grip tape
  )
  return g
}

function crowbar(): THREE.Group {
  const g = new THREE.Group()
  g.add(
    sweep(
      RED_METAL,
      [
        [0, 0, 0.08],
        [0, 0, -0.1],
        [0, 0, -0.35],
        [0, 0, -0.48],
        [0, -0.03, -0.53],
        [0, -0.08, -0.535],
        [0, -0.115, -0.51],
      ],
      0.0105,
      0.0095,
      fine() ? 14 : 6,
      8,
    ),
    slab(
      BLADE,
      [
        [0.07, 0.006],
        [0.1, 0.002],
        [0.104, -0.002],
        [0.07, -0.006],
      ],
      0.024,
      0,
      0.002,
    ), // chisel end
    slab(
      BLADE,
      [
        [-0.505, -0.1],
        [-0.49, -0.13, 0.003],
        [-0.5, -0.135],
        [-0.522, -0.112],
      ],
      0.024,
      0,
      0.002,
    ), // claw
  )
  return g
}

function machete(): THREE.Group {
  const g = new THREE.Group()
  g.add(
    lathe(
      RUBBER,
      [
        [0.06, 0],
        [0.06, 0.014, 0.004],
        [0.04, 0.016],
        [-0.06, 0.014],
        [-0.07, 0.016, 0.002],
        [-0.075, 0],
      ],
      undefined,
      { radial: 10, sx: 0.75, sy: 1.15 },
    ),
    slab(
      BLADE,
      [
        [-0.07, 0.016],
        [-0.42, 0.022, 0.04],
        [-0.52, 0.006, 0.03],
        [-0.5, -0.038, 0.04],
        [-0.25, -0.03, 0.08],
        [-0.07, -0.016],
      ],
      0.005,
      0,
      0.002,
    ),
    slab(
      EDGE,
      [
        [-0.08, -0.016],
        [-0.25, -0.028, 0.08],
        [-0.49, -0.036, 0.04],
        [-0.515, -0.006],
        [-0.49, -0.041, 0.04],
        [-0.25, -0.034, 0.08],
        [-0.08, -0.021],
      ],
      0.003,
      0,
      0.001,
    ),
  )
  if (fine()) {
    // Rivets through the handle, either side.
    for (const z of [0.03, -0.035])
      g.add(box(BRASS, [0.0235, 0.007, 0.007], [0, 0, z], undefined, 0.0025))
  }
  return g
}

function axe(): THREE.Group {
  const g = new THREE.Group()
  g.add(
    lathe(
      ASH,
      [
        [0.07, 0],
        [0.07, 0.016, 0.006],
        [0.04, 0.014],
        [-0.3, 0.013],
        [-0.54, 0.015],
        [-0.56, 0.0],
      ],
      undefined,
      { radial: 10, sx: 0.8, sy: 1.15 },
    ),
    // Head: a wedge through the handle, the bit sweeping down to its edge.
    slab(
      RED_METAL,
      [
        [-0.495, 0.045],
        [-0.545, 0.045, 0.006],
        [-0.548, -0.02],
        [-0.575, -0.1, 0.006],
        [-0.462, -0.11, 0.006],
        [-0.49, -0.02],
      ],
      0.03,
      0,
      0.006,
    ),
    slab(
      EDGE,
      [
        [-0.57, -0.096],
        [-0.578, -0.107, 0.003],
        [-0.46, -0.116, 0.003],
        [-0.466, -0.104],
      ],
      0.012,
      0,
      0.003,
    ),
  )
  return g
}

function sledge(): THREE.Group {
  const g = new THREE.Group()
  g.add(
    lathe(
      ASH,
      [
        [0.06, 0],
        [0.06, 0.016, 0.006],
        [0.03, 0.014],
        [-0.55, 0.014],
        [-0.56, 0],
      ],
      undefined,
      { radial: 10, sx: 0.85, sy: 1.1 },
    ),
    // The head, standing across the handle, its two striking faces bright.
    lathe(
      IRON,
      [
        [0.08, 0],
        [0.08, 0.033, 0.006],
        [0.07, 0.038, 0.004],
        [-0.07, 0.038, 0.004],
        [-0.08, 0.033, 0.006],
        [-0.08, 0],
      ],
      [0, 0, -0.58],
      { radial: 8, phase: Math.PI / 8, rot: [Math.PI / 2, 0, 0] },
    ),
    lathe(
      HEAD_FACE,
      [
        [0.002, 0],
        [0.002, 0.03],
        [-0.002, 0.03],
        [-0.002, 0],
      ],
      [0, 0.081, -0.58],
      { radial: 8, phase: Math.PI / 8, rot: [Math.PI / 2, 0, 0] },
    ),
    lathe(
      HEAD_FACE,
      [
        [0.002, 0],
        [0.002, 0.03],
        [-0.002, 0.03],
        [-0.002, 0],
      ],
      [0, -0.081, -0.58],
      { radial: 8, phase: Math.PI / 8, rot: [Math.PI / 2, 0, 0] },
    ),
  )
  return g
}

function katana(): THREE.Group {
  const g = new THREE.Group()
  g.add(
    lathe(
      RUBBER,
      [
        [0.05, 0],
        [0.05, 0.013],
        [-0.17, 0.014],
        [-0.17, 0],
      ],
      undefined,
      { radial: 10, sx: 0.8, sy: 1.1 },
    ), // grip
    lathe(
      TSUBA,
      [
        [0.062, 0],
        [0.062, 0.012, 0.003],
        [0.05, 0.015],
        [0.05, 0],
      ],
      undefined,
      { radial: 10, sx: 0.8, sy: 1.1 },
    ), // pommel
    lathe(
      TSUBA,
      [
        [-0.17, 0],
        [-0.17, 0.034, 0.004],
        [-0.18, 0.034, 0.004],
        [-0.18, 0],
      ],
      undefined,
      { radial: 12, sx: 0.85 },
    ), // guard
    box(BRASS, [0.01, 0.03, 0.02], [0, -0.002, -0.19], undefined, 0.002), // collar
    slab(
      KATANA_BLADE,
      [
        [-0.18, 0.013],
        [-0.5, 0.017, 0.2],
        [-0.82, 0.048, 0.03],
        [-0.86, 0.064],
        [-0.83, 0.04, 0.02],
        [-0.5, -0.006, 0.2],
        [-0.18, -0.012],
      ],
      0.005,
      0,
      0.002,
    ),
    slab(
      EDGE,
      [
        [-0.185, -0.009],
        [-0.5, -0.003, 0.2],
        [-0.83, 0.043, 0.02],
        [-0.858, 0.062],
        [-0.83, 0.038, 0.02],
        [-0.5, -0.008, 0.2],
        [-0.185, -0.013],
      ],
      0.003,
      0,
      0.001,
    ),
  )
  // The wrap: pale diamonds down the grip.
  if (fine())
    for (let i = 0; i < 6; i++)
      g.add(box(WRAP, [0.022, 0.014, 0.012], [0, 0, 0.03 - i * 0.035], [0, 0, Math.PI / 4], 0.003))
  return g
}

interface Hold {
  /** How far the tip is raised and turned in towards the middle of the view (radians). */
  pitch: number
  yaw: number
  /** Turned about its own length, so a head or an edge faces the way it swings. */
  spin: number
  /** Distance from the hand to the tip (m). */
  reach: number
  /** Thickness of the handle where the hand holds it. */
  grip: number
  hip: THREE.Vector3
  recoil: Recoil
}

/** A melee weapon in the fist, held up and ready; each swings its own way (melee-anim.ts). */
function held(tool: THREE.Group, hold: Hold): GunModel {
  const group = new THREE.Group()
  tool.rotation.set(hold.pitch, hold.yaw, hold.spin)
  const muzzle = marker(0, 0, -hold.reach)
  tool.add(muzzle)
  // The fist turns with the tool; its forearm runs back down to the elbow in the hold's space.
  tool.updateMatrix()
  const elbow = new THREE.Vector3(0.03, -0.045, 0.31).applyMatrix4(tool.matrix.clone().invert())
  tool.add(fist(hold.grip, [elbow.x, elbow.y, elbow.z]))
  const ejectPort = marker(0, 0, 0)
  group.add(tool, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: hold.hip,
    ads: hold.hip,
    recoil: hold.recoil,
    melee: true,
  }
}

/** The melee weapons as they lie (no hand, flat), for the world. */
const TOOLS: Partial<Record<WeaponId, () => THREE.Group>> = {
  [WeaponId.Bat]: bat,
  [WeaponId.Crowbar]: crowbar,
  [WeaponId.Machete]: machete,
  [WeaponId.Axe]: axe,
  [WeaponId.Sledge]: sledge,
  [WeaponId.Katana]: katana,
}

const light = { back: 0.01, climb: 0.04, roll: 0, side: 0, recover: 16 }
const heavy = { back: 0.025, climb: 0.08, roll: 0, side: 0, recover: 10 }

const BUILDERS: Record<SurvivalWeaponId, () => GunModel> = {
  [WeaponId.Bat]: () =>
    held(bat(), {
      pitch: 0.8,
      yaw: 0.1,
      spin: 0,
      reach: 0.75,
      grip: 0.027,
      hip: new THREE.Vector3(0.2, -0.2, -0.4),
      recoil: light,
    }),
  [WeaponId.Crowbar]: () =>
    held(crowbar(), {
      pitch: 0.9,
      yaw: 0.15,
      spin: -0.3,
      reach: 0.53,
      grip: 0.022,
      hip: new THREE.Vector3(0.19, -0.19, -0.38),
      recoil: light,
    }),
  [WeaponId.Machete]: () =>
    held(machete(), {
      pitch: 0.8,
      yaw: 0.15,
      spin: 0,
      reach: 0.51,
      grip: 0.028,
      hip: new THREE.Vector3(0.18, -0.18, -0.38),
      recoil: light,
    }),
  [WeaponId.Axe]: () =>
    held(axe(), {
      pitch: 0.9,
      yaw: 0.12,
      spin: -0.35,
      reach: 0.57,
      grip: 0.028,
      hip: new THREE.Vector3(0.2, -0.2, -0.4),
      recoil: heavy,
    }),
  [WeaponId.Sledge]: () =>
    held(sledge(), {
      pitch: 0.9,
      yaw: 0.1,
      spin: -0.3,
      reach: 0.62,
      grip: 0.029,
      hip: new THREE.Vector3(0.2, -0.21, -0.4),
      // A lot of iron on a stick: it drags the arm with it.
      recoil: { back: 0.035, climb: 0.1, roll: 0, side: 0, recover: 8 },
    }),
  [WeaponId.Katana]: () =>
    held(katana(), {
      pitch: 0.75,
      yaw: 0.1,
      spin: 0,
      reach: 0.77,
      grip: 0.026,
      hip: new THREE.Vector3(0.19, -0.2, -0.4),
      recoil: light,
    }),
  [WeaponId.M1911]: m1911,
  [WeaponId.Revolver]: revolver,
  [WeaponId.M9]: m9,
  [WeaponId.Ruger]: ruger,
  [WeaponId.SawedOff]: () => breakAction(true),
  [WeaponId.Uzi]: uzi,
  [WeaponId.Ump]: ump,
  [WeaponId.Mac10]: mac10,
  [WeaponId.Ak47]: ak47,
  [WeaponId.Sks]: sks,
  [WeaponId.HuntingRifle]: huntingRifle,
  [WeaponId.Carbine22]: carbine22,
  [WeaponId.LeverAction]: leverAction,
  [WeaponId.DoubleBarrel]: () => breakAction(false),
  [WeaponId.AutoShotgun]: saiga,
  [WeaponId.Svd]: svd,
  [WeaponId.Barrett]: barrett,
  [WeaponId.Crossbow]: crossbow,
}

/** A first-person model of every survival weapon, by weapon id (the viewmodel bakes them). */
export function survivalGuns(): Record<SurvivalWeaponId, GunModel> {
  return Object.fromEntries(Object.entries(BUILDERS).map(([id, build]) => [id, build()])) as Record<
    SurvivalWeaponId,
    GunModel
  >
}

/**
 * A weapon as it lies in the world, built at world detail: its first-person model without the
 * hands, merged into one mesh per material, resting on y = 0 (`centre`: also centred along its
 * length, so it turns about its middle).
 */
export function worldModel(build: () => THREE.Object3D, centre: boolean): THREE.Group {
  const model = atWorldDetail(build)
  stripHands(model)
  bake(model)
  const bounds = new THREE.Box3().setFromObject(model)
  model.position.y = -bounds.min.y
  if (centre) model.position.z = -(bounds.min.z + bounds.max.z) / 2
  const out = new THREE.Group()
  out.add(model)
  return out
}

/**
 * A survival weapon as it lies in the world (see worldModel; melee weapons flat and centred).
 * `null` for the eight originals, which gun-models.ts builds itself.
 */
export function survivalWorldModel(id: WeaponId): THREE.Group | null {
  const tool = TOOLS[id]
  if (tool) return worldModel(tool, true)
  const build = (BUILDERS as Partial<Record<WeaponId, () => GunModel>>)[id]
  return build ? worldModel(() => build().group, false) : null
}
