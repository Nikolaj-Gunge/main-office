import * as THREE from 'three'
import {
  ALLOY,
  apertureSights,
  BARREL,
  BLADE,
  BLUED,
  BRASS,
  barrel,
  box,
  EDGE,
  fine,
  fist,
  lathe,
  leftHand,
  limb,
  marker,
  OLIVE,
  PARKERIZED,
  POLYMER,
  paint,
  part,
  postSights,
  RED,
  RUBBER,
  rail,
  redDot,
  rightHand,
  rod,
  scope,
  slab,
  supportHand,
  TRITIUM,
  triggerGuard,
  WALNUT,
  WHITE,
} from './gun-kit.ts'
import type { Action, GunModel } from './viewmodel.ts'

/**
 * The first-person models of the eight original weapons (survival-guns.ts has the rest), built
 * from the modelling kit with gloved hands and sleeves. Without the hands the same models lie
 * in the world (gun-models.ts).
 */

/** Darker polymer for textured grip panels. */
const GRIP_PANEL = paint(0x1f2024, 'polymer')

export function action(
  part: THREE.Object3D,
  travel: number,
  time: number,
  lockOpen = false,
): Action {
  return { part, travel, time, rest: part.position.z, lockOpen }
}

/** Height of the handgun's sights above its bore axis' origin (front post and rear notch tops). */
const PISTOL_SIGHT = 0.0335

/**
 * A polymer-framed 9 mm: rounded slide with rear serrations, a raked grip with stippled panels,
 * three-dot sights, both hands on it. Pistols in survival-guns.ts reuse its pieces.
 */
function handgun(): GunModel {
  const group = new THREE.Group()
  // The slide carries the sights, so they blow back with it.
  const slide = part()
  slide.add(
    slab(
      BLUED,
      [
        [0.075, -0.002],
        [0.075, 0.0265, 0.005],
        [-0.112, 0.0265, 0.007],
        [-0.116, 0.012, 0.004],
        [-0.112, -0.002],
      ],
      0.03,
      0,
      0.0058,
    ),
    // Barrel hood showing in the ejection port, and the bore at the front.
    box(PARKERIZED, [0.012, 0.002, 0.03], [0.002, 0.0268, -0.01], undefined, 0.0008),
    rod(RUBBER, 0.0045, -0.11, -0.1168, [0, 0.012, 0], 8, 0),
    // Front post and the rear notch's two ears, each with a dot.
    box(BLUED, [0.0042, 0.007, 0.006], [0, PISTOL_SIGHT - 0.0035, -0.104], undefined, 0.001),
    box(BLUED, [0.0085, 0.0075, 0.007], [-0.0068, PISTOL_SIGHT - 0.00375, 0.066], undefined, 0.001),
    box(BLUED, [0.0085, 0.0075, 0.007], [0.0068, PISTOL_SIGHT - 0.00375, 0.066], undefined, 0.001),
    box(BLUED, [0.026, 0.004, 0.009], [0, 0.0275, 0.066], undefined, 0.001),
    box(TRITIUM, [0.0022, 0.0022, 0.001], [0, PISTOL_SIGHT - 0.002, -0.1008], undefined, 0),
    box(WHITE, [0.0022, 0.0022, 0.001], [-0.0068, PISTOL_SIGHT - 0.0025, 0.0697], undefined, 0),
    box(WHITE, [0.0022, 0.0022, 0.001], [0.0068, PISTOL_SIGHT - 0.0025, 0.0697], undefined, 0),
  )
  if (fine()) {
    // Serrations at the back of the slide.
    for (let k = 0; k < 6; k++)
      slide.add(box(RUBBER, [0.0312, 0.016, 0.0022], [0, 0.011, 0.066 - k * 0.0055], undefined, 0))
  }
  // Magazine inside the grip; only the base plate shows until it drops out.
  const mag = part([0, -0.064, 0.064])
  mag.rotation.x = -0.2
  mag.add(
    box(BLUED, [0.021, 0.1, 0.03], undefined, undefined, 0.003),
    box(POLYMER, [0.031, 0.011, 0.045], [0, -0.054, 0.002], undefined, 0.004),
    box(BRASS, [0.009, 0.006, 0.022], [0, 0.052, -0.002], undefined, 0.002),
  )
  group.add(
    slide,
    mag,
    // Frame: dust cover, beavertail and the raked grip in one piece.
    slab(
      POLYMER,
      [
        [-0.11, -0.002],
        [0.072, -0.002],
        [0.087, -0.008, 0.006],
        [0.079, -0.02, 0.004],
        [0.096, -0.108, 0.008],
        [0.05, -0.11, 0.008],
        [0.034, -0.028, 0.006],
        [0.026, -0.018],
        [-0.11, -0.018, 0.004],
      ],
      0.03,
      0,
      0.006,
    ),
    slab(
      GRIP_PANEL,
      [
        [0.078, -0.03],
        [0.091, -0.096],
        [0.055, -0.098],
        [0.043, -0.034],
      ],
      0.0316,
      0,
      0.001,
    ),
    ...triggerGuard(POLYMER, -0.018, -0.026, 0.03, 0.026, 0.0034, POLYMER),
  )
  if (fine()) {
    group.add(
      box(BLUED, [0.003, 0.005, 0.02], [-0.0158, -0.006, 0.012], undefined, 0.001), // slide stop
      box(BLUED, [0.003, 0.007, 0.007], [-0.0158, -0.024, 0.036], undefined, 0.001), // mag release
      box(RUBBER, [0.026, 0.002, 0.008], [0, -0.019, -0.07], undefined, 0), // rail slots
      box(RUBBER, [0.026, 0.002, 0.008], [0, -0.019, -0.088], undefined, 0),
    )
  }
  const support = leftHand({
    at: [-0.004, -0.068, 0.06],
    rake: 0.2,
    gw: 0.05,
    gd: 0.062,
    thumb: 0.036,
    elbow: [-0.1, -0.16, 0.33],
  })
  const supportPart = part([0, 0, 0], support)
  group.add(
    rightHand({
      at: [0, -0.06, 0.0635],
      rake: 0.2,
      gw: 0.03,
      gd: 0.047,
      trigger: [0, -0.031, 0.006],
      thumb: 0.044,
    }),
    supportPart,
  )
  const muzzle = marker(0, 0.012, -0.12)
  const ejectPort = marker(0.02, 0.022, -0.01)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.15, -0.15, -0.38),
    ads: new THREE.Vector3(0, -PISTOL_SIGHT, -0.3),
    // Snappy flip, back on target quickly.
    recoil: { back: 0.03, climb: 0.2, roll: 0.06, side: 0.03, recover: 20 },
    action: action(slide, 0.035, 0.09, true),
    mag,
    support: supportPart,
    handRest: new THREE.Vector3(-0.02, -0.1, 0.07),
    handle: new THREE.Vector3(0, 0.03, 0.05),
    tilt: { roll: -0.4, pitch: 0.1 },
  }
}

/** Height of the rifle's red dot above its bore line (the sight sits on a riser). */
const RED_DOT_Y = 0.09

/** A modern piston carbine: flat-topped upper, octagonal handguard, folding stock, red dot. */
function rifle(): GunModel {
  const group = new THREE.Group()
  const mag = part([0, -0.045, -0.065])
  mag.rotation.x = 0.1
  mag.add(
    slab(
      ALLOY,
      [
        [0.028, 0.045],
        [-0.028, 0.045],
        [-0.032, -0.01],
        [-0.044, -0.062, 0.006],
        [0.012, -0.066, 0.006],
        [0.022, -0.01],
      ],
      0.024,
      0,
      0.004,
    ),
    slab(
      POLYMER,
      [
        [0.016, -0.06],
        [-0.046, -0.056],
        [-0.049, -0.07, 0.004],
        [0.018, -0.075, 0.004],
      ],
      0.028,
      0,
      0.004,
    ),
  )
  const handle = part(
    [0.03, 0.012, -0.02],
    box(PARKERIZED, [0.014, 0.012, 0.028], undefined, undefined, 0.004),
  )
  const support = supportHand([0, 0, -0.25], 0.048, 0.048)
  group.add(
    // Upper receiver, handguard and the rail along the top.
    slab(
      ALLOY,
      [
        [0.15, -0.012],
        [0.15, 0.028, 0.004],
        [-0.13, 0.028, 0.004],
        [-0.13, -0.012],
      ],
      0.044,
      0,
      0.006,
    ),
    lathe(
      ALLOY,
      [
        [-0.12, 0],
        [-0.12, 0.025, 0.003],
        [-0.36, 0.025, 0.004],
        [-0.36, 0],
      ],
      [0, 0.001, 0],
      { radial: 8, phase: Math.PI / 8 },
    ),
    ...rail(0.145, -0.355, 0.028),
    box(RUBBER, [0.002, 0.008, 0.06], [0.0221, 0.012, 0], undefined, 0), // charging handle slot
    box(RUBBER, [0.002, 0.016, 0.04], [0.0221, -0.002, 0.065], undefined, 0), // ejection port
    // Lower: trigger housing and magazine well.
    slab(
      POLYMER,
      [
        [0.13, -0.012],
        [0.13, -0.03, 0.004],
        [0.075, -0.034],
        [-0.005, -0.034],
        [-0.028, -0.04],
        [-0.034, -0.064, 0.003],
        [-0.1, -0.064, 0.003],
        [-0.106, -0.04],
        [-0.12, -0.012],
      ],
      0.04,
      0,
      0.005,
    ),
    // Pistol grip.
    slab(
      POLYMER,
      [
        [0.066, -0.03],
        [0.112, -0.03],
        [0.141, -0.108, 0.008],
        [0.096, -0.112, 0.008],
      ],
      0.03,
      0,
      0.007,
    ),
    ...triggerGuard(POLYMER, -0.034, 0.02, 0.07, 0.024, 0.0032),
    // Folding stock and its butt pad.
    slab(
      POLYMER,
      [
        [0.13, 0.024],
        [0.34, 0.026, 0.008],
        [0.355, 0.016, 0.004],
        [0.355, -0.07, 0.006],
        [0.335, -0.082, 0.006],
        [0.2, -0.04, 0.03],
        [0.13, -0.03],
      ],
      0.04,
      0,
      0.006,
    ),
    box(RUBBER, [0.042, 0.096, 0.014], [0, -0.026, 0.36], undefined, 0.004),
    // Barrel and flash hider.
    ...barrel(BARREL, 0.0085, -0.355, -0.46, 0),
    lathe(
      BLUED,
      [
        [-0.455, 0],
        [-0.455, 0.011, 0.002],
        [-0.505, 0.011, 0.002],
        [-0.505, 0.006],
        [-0.5, 0],
      ],
      undefined,
      { radial: 10 },
    ),
    // Red-dot sight on the rail: you look through an open tube over the gun, so aiming keeps
    // most of the view clear.
    ...redDot(RED_DOT_Y, -0.045, 0.034),
    mag,
    handle,
    support,
    rightHand({ at: [0, -0.07, 0.103], rake: 0.35, gd: 0.044, trigger: [0, -0.048, 0.046] }),
  )
  if (fine()) {
    for (const side of [-1, 1])
      for (let k = 0; k < 4; k++)
        group.add(
          box(
            RUBBER,
            [0.002, 0.008, 0.022],
            [side * 0.0225, 0.001, -0.17 - k * 0.045],
            undefined,
            0,
          ),
        )
    group.add(
      box(PARKERIZED, [0.004, 0.008, 0.008], [-0.021, -0.022, 0.08], undefined, 0.002), // selector
      box(BLUED, [0.016, 0.022, 0.018], [0, -0.018, -0.37], undefined, 0.003), // gas block
    )
  }
  const muzzle = marker(0, 0, -0.51)
  const ejectPort = marker(0.025, 0.004, 0.065)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.16, -0.16, -0.44),
    // The dot sits on screen centre, ~0.3 m in front of the eye; the gun itself stays low.
    ads: new THREE.Vector3(0, -RED_DOT_Y, -0.26),
    recoil: { back: 0.018, climb: 0.05, roll: 0.03, side: 0.02, recover: 20 },
    action: action(handle, 0.03, 0.07),
    mag,
    support,
    handRest: support.position.clone(),
    handle: handle.position.clone(),
  }
}

/** Scope axis height on the sniper (its eyepiece is what you look through). */
const SNIPER_SCOPE = 0.06

/** A bolt-action in a walnut sporter stock with a big scope. */
function sniper(): GunModel {
  const group = new THREE.Group()
  // Bolt: body inside the receiver, shroud behind it, handle and knob out to the right.
  const bolt = part([0, 0.006, 0.04])
  bolt.add(
    rod(PARKERIZED, 0.0085, 0.06, -0.05, [0, 0, 0]),
    rod(BLUED, 0.012, 0.09, 0.062, [0, 0, 0]),
    limb(PARKERIZED, [0.008, 0, 0.012], [0.036, -0.014, 0.018], 0.0045, 0.004),
    lathe(
      BLUED,
      [
        [0.009, 0],
        [0.006, 0.007],
        [-0.004, 0.008],
        [-0.009, 0],
      ],
      [0.04, -0.016, 0.018],
      { radial: 10 },
    ),
  )
  const mag = part([0, -0.05, -0.01])
  mag.add(
    box(BLUED, [0.03, 0.03, 0.075], undefined, undefined, 0.004),
    box(BLUED, [0.034, 0.006, 0.08], [0, -0.016, 0], undefined, 0.002),
  )
  const support = supportHand([0, -0.018, -0.22], 0.046, 0.038)
  group.add(
    mag,
    // Walnut stock: forend, action bed, raked grip, butt with a raised comb.
    slab(
      WALNUT,
      [
        [-0.33, 0.002, 0.006],
        [-0.33, -0.03, 0.01],
        [-0.05, -0.045, 0.02],
        [0.075, -0.046, 0.006],
        [0.082, -0.05],
        [0.108, -0.11, 0.008],
        [0.15, -0.107, 0.008],
        [0.152, -0.078, 0.01],
        [0.2, -0.062, 0.03],
        [0.365, -0.104, 0.006],
        [0.375, -0.1],
        [0.375, 0.022, 0.006],
        [0.35, 0.034, 0.012],
        [0.2, 0.028, 0.03],
        [0.13, 0.002, 0.02],
      ],
      0.046,
      0,
      0.009,
    ),
    box(RUBBER, [0.05, 0.13, 0.014], [0, -0.039, 0.382], [0.05, 0, 0], 0.004), // recoil pad
    // Round receiver, tapered barrel.
    lathe(
      BLUED,
      [
        [0.13, 0],
        [0.13, 0.017, 0.004],
        [-0.1, 0.017, 0.004],
        [-0.1, 0],
      ],
      [0, 0.006, 0],
      { radial: 12 },
    ),
    lathe(
      BARREL,
      [
        [-0.1, 0],
        [-0.1, 0.0125],
        [-0.2, 0.011, 0.04],
        [-0.6, 0.0085, 0.002],
        [-0.615, 0.0085],
        [-0.615, 0],
      ],
      [0, 0.006, 0],
      { radial: 10 },
    ),
    rod(RUBBER, 0.004, -0.613, -0.6155, [0, 0.006, 0], 8, 0),
    box(RUBBER, [0.003, 0.012, 0.05], [0.0165, 0.012, 0.03], undefined, 0), // ejection port
    ...scope(SNIPER_SCOPE, 0.12, -0.17, 0.023, 0.015, 0.025),
    ...triggerGuard(BLUED, -0.045, 0.02, 0.075, 0.022),
    bolt,
    support,
    rightHand({
      at: [0, -0.078, 0.118],
      rake: 0.45,
      gw: 0.044,
      gd: 0.05,
      trigger: [0, -0.06, 0.05],
      thumb: 0.05,
    }),
  )
  if (fine()) {
    group.add(
      rod(BLUED, 0.004, 0.006, -0.006, [0, -0.034, -0.29]), // sling swivel stud
      rod(BLUED, 0.004, 0.006, -0.006, [0, -0.09, 0.3]),
    )
  }
  const muzzle = marker(0, 0.006, -0.62)
  const ejectPort = marker(0.03, 0.02, 0.03)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.16, -0.17, -0.44),
    ads: new THREE.Vector3(0, -SNIPER_SCOPE, -0.12),
    // A big slow heave.
    recoil: { back: 0.06, climb: 0.28, roll: 0.12, side: 0.03, recover: 11 },
    bolt,
    mag,
    support,
    handRest: support.position.clone(),
    handle: new THREE.Vector3(0.04, -0.01, 0.058),
  }
}

/** The shotgun's sight line: a ghost ring on the receiver, a tall blade at the muzzle. */
const SHOTGUN_SIGHT = 0.058

/** A pump-action: blued receiver, vent rib, ghost-ring sights, ribbed walnut forend. */
function shotgun(): GunModel {
  const group = new THREE.Group()
  // The pump: forend + support hand, slides back along the tube magazine after each shot.
  const pump = part()
  const support = supportHand([0, -0.012, -0.27], 0.044, 0.04)
  const ribs: [number, number][] = []
  for (let z = -0.205; z > -0.335; z -= 0.013) ribs.push([z, 0.022], [z - 0.0065, 0.0195])
  pump.add(
    lathe(
      WALNUT,
      [[-0.2, 0], [-0.2, 0.0185], ...ribs, [-0.34, 0.019], [-0.34, 0]],
      [0, -0.012, 0],
      {
        radial: 12,
        sy: 0.92,
      },
    ),
    box(BLUED, [0.003, 0.006, 0.09], [0.012, -0.014, -0.155], undefined, 0.001), // action bars
    box(BLUED, [0.003, 0.006, 0.09], [-0.012, -0.014, -0.155], undefined, 0.001),
    support,
  )
  group.add(
    slab(
      BLUED,
      [
        [0.12, -0.035],
        [0.12, 0.016, 0.006],
        [0.1, 0.026, 0.01],
        [-0.12, 0.03, 0.006],
        [-0.13, 0.0, 0.004],
        [-0.13, -0.035],
      ],
      0.044,
      0,
      0.006,
    ),
    box(RUBBER, [0.002, 0.018, 0.05], [0.0221, 0.008, 0], undefined, 0), // ejection port
    ...barrel(BLUED, 0.0125, -0.12, -0.58, 0.012),
    box(BLUED, [0.008, 0.004, 0.44], [0, 0.0265, -0.36], undefined, 0.0015), // vent rib
    ...apertureSights(BLUED, SHOTGUN_SIGHT, -0.55, 0.07, 0.024),
    rod(BLUED, 0.0105, -0.12, -0.5, [0, -0.016, 0]), // tube magazine
    lathe(
      BLUED,
      [
        [-0.5, 0],
        [-0.5, 0.012, 0.002],
        [-0.522, 0.011, 0.004],
        [-0.528, 0],
      ],
      [0, -0.016, 0],
      { radial: 10 },
    ), // magazine cap
    ...triggerGuard(BLUED, -0.035, 0.03, 0.09, 0.024),
    // Walnut stock and its pad.
    slab(
      WALNUT,
      [
        [0.12, 0.022],
        [0.16, 0.018, 0.02],
        [0.37, 0.0, 0.006],
        [0.385, -0.004],
        [0.385, -0.105, 0.006],
        [0.37, -0.11],
        [0.2, -0.052, 0.04],
        [0.12, -0.04],
      ],
      0.044,
      0,
      0.008,
    ),
    box(RUBBER, [0.046, 0.122, 0.015], [0, -0.048, 0.39], [-0.06, 0, 0], 0.004),
    rightHand({
      at: [0, -0.034, 0.152],
      rake: 1.0,
      gw: 0.04,
      gd: 0.048,
      trigger: [0, -0.052, 0.062],
      thumb: 0.036,
    }),
    pump,
  )
  if (fine()) {
    group.add(
      box(RUBBER, [0.024, 0.002, 0.07], [0, -0.036, 0], undefined, 0), // loading port
      lathe(
        BLUED,
        [
          [-0.47, 0],
          [-0.47, 0.03],
          [-0.482, 0.03],
          [-0.482, 0],
        ],
        [0, 0.0, 0],
        {
          radial: 10,
          sx: 0.55,
        },
      ), // barrel clamp
    )
    for (let z = -0.16; z > -0.56; z -= 0.04)
      group.add(box(BLUED, [0.004, 0.003, 0.004], [0, 0.0255, z], undefined, 0))
  }
  const muzzle = marker(0, 0.012, -0.58)
  const ejectPort = marker(0.03, 0.015, -0.02)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.16, -0.17, -0.44),
    // Front blade on screen centre through the ghost ring.
    ads: new THREE.Vector3(0, -SHOTGUN_SIGHT, -0.26),
    // The hardest kick: a shove into the shoulder and a big flip.
    recoil: { back: 0.075, climb: 0.32, roll: 0.1, side: 0.04, recover: 12 },
    pump,
    support,
    handRest: support.position.clone(),
    port: new THREE.Vector3(0, -0.04, 0.02),
    tilt: { roll: -0.45, pitch: 0.2 },
  }
}

/** The MP5's sight line above its bore origin. */
const MP5_SIGHT = 0.06

/** MP5: round-topped stamped receiver, cocking tube, slimline handguard, curved magazine. */
function mp5(): GunModel {
  const group = new THREE.Group()
  // The curved 9 mm magazine, bottom swept forward.
  const mag = part([0, -0.045, -0.08])
  mag.rotation.x = 0.2
  mag.add(
    slab(
      BLUED,
      [
        [0.016, 0.03],
        [-0.016, 0.03],
        [-0.024, -0.03],
        [-0.042, -0.085, 0.005],
        [-0.012, -0.092, 0.005],
        [0.004, -0.035],
      ],
      0.022,
      0,
      0.004,
    ),
  )
  const support = supportHand([0, -0.008, -0.2], 0.044, 0.048)
  // Cocking lever, front left, sticking out of the cocking tube.
  const handle = part(
    [-0.022, 0.016, -0.17],
    box(PARKERIZED, [0.024, 0.006, 0.008], [-0.006, 0, 0], undefined, 0.002),
    rod(RUBBER, 0.005, 0.006, -0.006, [-0.019, 0, 0]),
  )
  group.add(
    slab(
      BLUED,
      [
        [0.11, -0.024],
        [0.11, 0.02, 0.01],
        [0.1, 0.026, 0.006],
        [-0.13, 0.026, 0.006],
        [-0.135, -0.024],
      ],
      0.042,
      0,
      0.009,
    ),
    rod(BLUED, 0.011, -0.13, -0.265, [0, 0.016, 0]), // cocking tube
    lathe(
      POLYMER,
      [
        [-0.13, 0],
        [-0.13, 0.022, 0.004],
        [-0.265, 0.02, 0.008],
        [-0.265, 0],
      ],
      [0, -0.009, 0],
      { radial: 12, sy: 1.1 },
    ),
    box(BLUED, [0.03, 0.026, 0.04], [0, -0.034, -0.08], undefined, 0.004), // magazine well
    ...barrel(BARREL, 0.0075, -0.265, -0.31, 0.005),
    rod(BLUED, 0.0098, -0.298, -0.312, [0, 0.005, 0], 10, 0.3), // three-lug
    ...apertureSights(BLUED, MP5_SIGHT, -0.252, 0.088, 0.024),
    // Trigger housing and grip.
    slab(
      POLYMER,
      [
        [0.03, -0.022],
        [0.1, -0.022],
        [0.1, -0.04, 0.004],
        [0.106, -0.106, 0.008],
        [0.066, -0.108, 0.008],
        [0.058, -0.06, 0.01],
        [0.03, -0.045],
      ],
      0.032,
      0,
      0.007,
    ),
    ...triggerGuard(POLYMER, -0.026, -0.008, 0.045, 0.024),
    // Collapsed stock: two rails and the butt plate.
    rod(BLUED, 0.0045, 0.2, 0.1, [0.016, 0.0, 0]),
    rod(BLUED, 0.0045, 0.2, 0.1, [-0.016, 0.0, 0]),
    slab(
      RUBBER,
      [
        [0.198, 0.02],
        [0.218, 0.02, 0.004],
        [0.218, -0.065, 0.008],
        [0.198, -0.06, 0.004],
      ],
      0.044,
      0,
      0.006,
    ),
    mag,
    handle,
    support,
    rightHand({ at: [0, -0.068, 0.083], rake: 0.3, gd: 0.042, trigger: [0, -0.044, 0.018] }),
  )
  const muzzle = marker(0, 0.005, -0.33)
  const ejectPort = marker(0.022, 0.015, -0.04)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.15, -0.15, -0.4),
    // Front post on screen centre, the gun held out and low.
    ads: new THREE.Vector3(0, -MP5_SIGHT, -0.3),
    // Light and fast: a buzz more than a kick.
    recoil: { back: 0.012, climb: 0.03, roll: 0.02, side: 0.025, recover: 26 },
    action: action(handle, 0.02, 0.05),
    mag,
    support,
    handRest: support.position.clone(),
    handle: handle.position.clone(),
  }
}

/** The LMG's sight line. */
const LMG_SIGHT = 0.078

/** Belt-fed LMG: wide receiver and feed cover, heat shield, folded bipod, olive ammo box. */
function lmg(): GunModel {
  const group = new THREE.Group()
  const handle = part(
    [-0.038, 0.01, -0.1],
    box(PARKERIZED, [0.016, 0.014, 0.036], undefined, undefined, 0.004),
    rod(RUBBER, 0.006, 0.006, -0.006, [-0.012, 0, 0]),
  )
  ;(handle.children[1] as THREE.Object3D).rotation.y = Math.PI / 2
  // Ammo box and the belt running up into the receiver's left side.
  const mag = part([0.02, -0.08, -0.04])
  mag.add(
    box(OLIVE, [0.09, 0.09, 0.1], undefined, undefined, 0.008),
    box(OLIVE, [0.094, 0.012, 0.104], [0, 0.046, 0], undefined, 0.004), // lid
    box(PARKERIZED, [0.012, 0.02, 0.05], [0.045, 0.0, 0], undefined, 0.003), // latch
  )
  for (let k = 0; k < 5; k++) {
    const t = k / 4
    const round = rod(BRASS, 0.0048, 0.014, -0.014, [0, 0, 0], 8, 0.3)
    round.rotation.y = Math.PI / 2
    round.position.set(-0.025 - t * 0.03, 0.05 + t * 0.03, -0.01 - k * 0.0)
    round.rotation.z = -0.5 * t
    mag.add(round)
  }
  const support = supportHand([0, -0.002, -0.27], 0.052, 0.052)
  group.add(
    slab(
      BLUED,
      [
        [0.15, -0.035],
        [0.15, 0.03, 0.006],
        [-0.17, 0.03, 0.006],
        [-0.17, -0.035, 0.004],
      ],
      0.06,
      0,
      0.007,
    ),
    slab(
      PARKERIZED,
      [
        [0.12, 0.028],
        [0.11, 0.05, 0.008],
        [-0.08, 0.05, 0.008],
        [-0.1, 0.028],
      ],
      0.056,
      0,
      0.006,
    ), // feed cover
    lathe(
      POLYMER,
      [
        [-0.17, 0],
        [-0.17, 0.027, 0.004],
        [-0.37, 0.025, 0.006],
        [-0.37, 0],
      ],
      undefined,
      { radial: 12, sx: 1.05 },
    ), // heat shield / handguard
    ...barrel(BARREL, 0.011, -0.37, -0.56, 0),
    lathe(
      BLUED,
      [
        [-0.555, 0],
        [-0.555, 0.013, 0.002],
        [-0.6, 0.012, 0.002],
        [-0.6, 0],
      ],
      undefined,
      { radial: 10 },
    ),
    rod(BLUED, 0.006, -0.37, -0.46, [0, -0.022, 0]), // gas tube
    // Bipod legs folded forward under the barrel.
    limb(BLUED, [0.013, -0.026, -0.43], [0.013, -0.03, -0.26], 0.005),
    limb(BLUED, [-0.013, -0.026, -0.43], [-0.013, -0.03, -0.26], 0.005),
    ...postSights(BLUED, LMG_SIGHT, -0.5, 0.06, 0.012),
    slab(
      POLYMER,
      [
        [0.15, 0.02],
        [0.36, 0.015, 0.01],
        [0.375, 0.005],
        [0.375, -0.08, 0.008],
        [0.35, -0.09],
        [0.2, -0.05, 0.03],
        [0.15, -0.035],
      ],
      0.05,
      0,
      0.008,
    ), // stock
    slab(
      POLYMER,
      [
        [0.08, -0.033],
        [0.122, -0.033],
        [0.15, -0.11, 0.008],
        [0.106, -0.114, 0.008],
      ],
      0.032,
      0,
      0.007,
    ), // grip
    ...triggerGuard(BLUED, -0.035, 0.03, 0.08, 0.024),
    mag,
    handle,
    support,
    rightHand({ at: [0, -0.074, 0.113], rake: 0.35, gd: 0.044, trigger: [0, -0.052, 0.055] }),
  )
  if (fine()) group.add(...rail(0.1, -0.06, 0.05, 0.02))
  const muzzle = marker(0, 0, -0.61)
  const ejectPort = marker(0.035, 0.02, 0)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.17, -0.18, -0.46),
    ads: new THREE.Vector3(0, -LMG_SIGHT, -0.34),
    // Heavy: shudders side to side as the belt runs.
    recoil: { back: 0.02, climb: 0.05, roll: 0.05, side: 0.04, recover: 16 },
    action: action(handle, 0.035, 0.07),
    mag,
    support,
    handRest: support.position.clone(),
    handle: handle.position.clone(),
    tilt: { roll: -0.35, pitch: 0.02 },
  }
}

/** A combat knife: ridged grip, steel guard, clip-point blade with a bright edge. */
function knife(): GunModel {
  const group = new THREE.Group()
  const ridges: [number, number][] = []
  for (let z = 0.062; z > -0.022; z -= 0.014) ridges.push([z, 0.0145], [z - 0.007, 0.0128])
  group.add(
    lathe(
      RUBBER,
      [[0.078, 0], [0.078, 0.012, 0.003], [0.07, 0.015], ...ridges, [-0.03, 0.0135], [-0.03, 0]],
      undefined,
      { radial: 10, sx: 0.8, sy: 1.15 },
    ),
    lathe(
      BLUED,
      [
        [0.088, 0],
        [0.088, 0.009, 0.003],
        [0.076, 0.012],
        [0.076, 0],
      ],
      undefined,
      { radial: 10, sx: 0.85, sy: 1.15 },
    ), // pommel
    slab(
      BLUED,
      [
        [-0.03, 0.026],
        [-0.04, 0.03, 0.003],
        [-0.042, -0.028, 0.003],
        [-0.03, -0.024],
      ],
      0.012,
      0,
      0.003,
    ), // guard
    slab(
      BLADE,
      [
        [-0.04, 0.012],
        [-0.165, 0.012, 0.004],
        [-0.218, 0.0],
        [-0.2, -0.01, 0.03],
        [-0.04, -0.016],
      ],
      0.006,
      0,
      0.0024,
    ),
    slab(
      EDGE,
      [
        [-0.045, -0.013],
        [-0.195, -0.008, 0.03],
        [-0.217, 0.0],
        [-0.2, -0.0125, 0.03],
        [-0.045, -0.018],
      ],
      0.0036,
      0,
      0.001,
    ),
    box(BLUED, [0.0064, 0.004, 0.09], [0, 0.004, -0.1], undefined, 0.001), // fuller
    part([0, 0, 0.025], fist(0.028, [0.025, -0.045, 0.3])),
  )
  const muzzle = marker(0, 0, -0.22)
  const ejectPort = marker(0, 0, 0)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.17, -0.17, -0.36),
    ads: new THREE.Vector3(0.17, -0.17, -0.36),
    recoil: { back: 0.01, climb: 0.03, roll: 0, side: 0, recover: 18 },
    melee: true,
  }
}

/** A shotgun shell: red hull, brass base. */
export function shell(): THREE.Group {
  const g = new THREE.Group()
  g.add(
    rod(RED, 0.0085, 0.012, -0.028, [0, 0, 0], 10, 0.15),
    lathe(
      BRASS,
      [
        [0.023, 0],
        [0.023, 0.0096],
        [0.021, 0.0096],
        [0.02, 0.0088],
        [0.01, 0.0088],
        [0.01, 0],
      ],
      undefined,
      { radial: 10 },
    ),
  )
  return g
}

/** The eight original weapons (claws borrow the knife: nobody plays a zombie in first person). */
export const BASE_GUNS = { handgun, rifle, sniper, shotgun, knife, mp5, lmg }
