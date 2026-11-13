import type { Vec3 } from '../maps/types.ts'
import { ZombieKind } from '../modes.ts'
import type { SurvivalDef } from './types.ts'

/**
 * The story of Deadwood and the jobs people at Haven hand out. Quests belong to the whole team:
 * whoever does a step does it for everybody.
 */

export type QuestStep =
  /** Somebody gets to a place. */
  | { kind: 'reach'; poi: string; text: string }
  /** Talk to somebody; `say` is what they tell you. */
  | { kind: 'talk'; npc: string; text: string; say: string }
  /** Bring `n` of an item to somebody (it is handed over). */
  | { kind: 'fetch'; npc: string; item: string; n: number; text: string; say: string }
  /**
   * Use something in the world. `needs` must be in your backpack (used up unless `keeps`);
   * `gives` lands in it; `opens` unlocks a gate; `wakes` stirs up the dead of a place.
   */
  | {
      kind: 'use'
      target: string
      text: string
      needs?: [string, number][]
      keeps?: boolean
      gives?: [string, number][]
      opens?: number
      wakes?: string
      say?: string
    }
  /** Use every one of these, in any order (each hands over `gives`). */
  | { kind: 'collect'; targets: string[]; gives: [string, number][]; text: string }
  /** Kill `n` of the dead — at a place, or of one kind, if given. */
  | { kind: 'kill'; n: number; poi?: string; zombie?: number; text: string }
  /** Somebody stays at a place for `seconds` while `horde` of the dead keep coming. */
  | { kind: 'hold'; poi: string; seconds: number; horde: number; text: string }

export interface QuestDef {
  id: string
  title: string
  /** A chapter of the main story (starts by itself when the one before is done). */
  story?: boolean
  /** Who hands it out (side jobs), and what they say when they offer it. */
  giver?: string
  offer?: string
  /** Only once this quest is done. */
  after?: string
  steps: QuestStep[]
  reward?: { money?: number; items?: [string, number][]; reveals?: boolean }
  /** Shown when it is finished. */
  done: string
}

export const QUESTS: QuestDef[] = [
  // ── The story ──────────────────────────────────────────────────────────────────────────
  {
    id: 'wake',
    title: 'The long night',
    story: true,
    steps: [
      { kind: 'use', target: 'start_note', text: 'Read the note on the table' },
      {
        kind: 'reach',
        poi: 'haven',
        text: 'Follow the track north-east to the road, and the road to Haven',
      },
    ],
    done: "Haven. Walls, a fire, and people with guns who aren't pointing them at you. Yet.",
  },
  {
    id: 'keep',
    title: 'Pull your weight',
    story: true,
    after: 'wake',
    steps: [
      {
        kind: 'talk',
        npc: 'mara',
        text: 'Talk to Mara, who runs Haven',
        say: "New face. Hollis sent you? …Then Hollis is dead.\n\nNobody eats here for free. Lena is out of bandages. Bring her three — houses, clinics, the gas station up the road — and then we'll talk about a bunk.",
      },
      {
        kind: 'fetch',
        npc: 'lena',
        item: 'bandage',
        n: 3,
        text: 'Bring Lena 3 bandages',
        say: 'Clean ones. You just bought somebody a week.\n\nTake this pack — its owner has no more use for it. And sleep in the bunkhouse when you need to: if the night goes wrong, that is where you wake up.',
      },
    ],
    reward: { money: 60, items: [['pack_school', 1]] },
    done: 'You have a bunk at Haven.',
  },
  {
    id: 'deadair',
    title: 'Dead air',
    story: true,
    after: 'keep',
    steps: [
      {
        kind: 'talk',
        npc: 'mara',
        text: 'Talk to Mara',
        say: "You're useful. Good. Ray thinks he can raise the outside on the old forestry transmitter. He needs parts and I can't spare anyone who knows which end of a gun to hold. Talk to him.",
      },
      {
        kind: 'talk',
        npc: 'ray',
        text: 'Talk to Ray in the workshop',
        say: "The tower's on the hill in the north-west, past Pinewatch. The set up there is fried.\n\nI need a vacuum tube — the Gas-N-Go on the highway north kept spares in the back office — and a signal board out of a police radio. Pinewatch had a station. Had.",
      },
      {
        kind: 'use',
        target: 'gas_north_office',
        text: 'Search the back office of the Gas-N-Go, north on the highway',
        gives: [['radio_tube', 1]],
        say: 'Behind a stack of invoices: one vacuum tube, still in its box.',
      },
      {
        kind: 'use',
        target: 'police_locker',
        text: 'Search the evidence locker in the Pinewatch police station',
        gives: [['radio_board', 1]],
        say: "A police radio, smashed. The board inside is whole. The last entry in the log beside it just says: THEY DON'T STAY DOWN.",
      },
      {
        kind: 'fetch',
        npc: 'ray',
        item: 'radio_tube',
        n: 1,
        text: 'Bring the vacuum tube to Ray',
        say: 'Ha! Still sealed.',
      },
      {
        kind: 'fetch',
        npc: 'ray',
        item: 'radio_board',
        n: 1,
        text: 'Bring the transmitter board to Ray',
        say: "…Beautiful. Give me a minute with a soldering iron. Here — you'll need more than that Glock where you're going next.",
      },
    ],
    reward: {
      items: [
        ['m9', 1],
        ['ammo9', 30],
      ],
    },
    done: 'Ray has what he needs to fix the transmitter.',
  },
  {
    id: 'tower',
    title: 'The tower',
    story: true,
    after: 'deadair',
    steps: [
      {
        kind: 'talk',
        npc: 'ray',
        text: 'Talk to Ray',
        say: "Board's ready — take it up there and it'll work. But the tower runs off its own generator: it wants petrol, and the main fuse blew years ago. The sawmill past Mill Creek ran the same model.\n\nFuse. Jerry can. Throw the switch, call out, and keep calling.\n\nAnd listen: a generator is LOUD. Everything in those woods will come and see.",
      },
      {
        kind: 'use',
        target: 'sawmill_fusebox',
        text: 'Take a fuse from the sawmill office, east of Mill Creek',
        gives: [['fuse', 1]],
        say: 'The fuse comes out with a crack that echoes round the yard.',
      },
      {
        kind: 'use',
        target: 'tower_generator',
        text: 'Start the generator at the radio tower (north-west): needs the fuse and a jerry can',
        needs: [
          ['fuse', 1],
          ['gasoline', 1],
        ],
        wakes: 'radio',
        say: 'The generator coughs, catches, and roars. The red light on the mast starts to blink. Down in the trees, something answers.',
      },
      {
        kind: 'use',
        target: 'tower_radio',
        text: 'Use the transmitter',
        say: '"…any station, any station, this is Haven. We are forty souls. Is anybody out there?"\n\nStatic. Keep it running.',
      },
      {
        kind: 'hold',
        poi: 'radio',
        seconds: 90,
        horde: 9,
        text: 'Hold the tower while the message goes out',
      },
    ],
    reward: { money: 150 },
    done: '"Haven, this is RAVEN ACTUAL. We read you. Listen carefully.\n\nDr. Elias Voss. Site Seven. His serum works. Get it to Ashford and light a flare: one bird, one pass, no second try.\n\nRaven out."',
  },
  {
    id: 'soldiers',
    title: 'What the soldiers knew',
    story: true,
    after: 'tower',
    steps: [
      {
        kind: 'talk',
        npc: 'mara',
        text: 'Tell Mara what you heard',
        say: "Site Seven. The army ran it, up on the hill in the north-east. When it all went wrong they sealed it and shot anyone who came close.\n\nIf there's a key, it's at their checkpoint on the road east of Ashford — with whatever is left of them.",
      },
      {
        kind: 'use',
        target: 'checkpoint_tent',
        text: 'Search the command tent at the army checkpoint, east of Ashford',
        gives: [['keycard_blue', 1]],
        say: 'A blue keycard: SITE 7 — LEVEL 1. And a duty log:\n\n"Dr. Voss has not surrendered his card. Went home to Mill Creek. Refuses to leave his wife."',
      },
    ],
    done: 'One key. Voss had the other.',
  },
  {
    id: 'voss',
    title: 'Voss',
    story: true,
    after: 'soldiers',
    steps: [
      {
        kind: 'use',
        target: 'voss_desk',
        text: "Search Dr. Voss's house in Mill Creek, in the east",
        say: 'A letter, never sent:\n\n"Agnes is gone. I buried her at the church with my own hands, and the card with her. Let it stay there. Let all of it stay buried."',
      },
      {
        kind: 'use',
        target: 'church_grave',
        text: "Dig at Agnes Voss's grave, at St. Agnes' church",
        gives: [['keycard_red', 1]],
        wakes: 'church',
        say: "A hand's depth down: a red keycard in a plastic bag.\n\nAnd below it, something scratching back.",
      },
    ],
    done: 'Both keys. Site 7 is waiting.',
  },
  {
    id: 'site7',
    title: 'Site 7',
    story: true,
    after: 'voss',
    steps: [
      { kind: 'reach', poi: 'site7', text: 'Climb to Site 7, on the hill in the far north-east' },
      {
        kind: 'use',
        target: 'site7_door',
        text: 'Open the blast door with the blue keycard',
        needs: [['keycard_blue', 1]],
        keeps: true,
        opens: 0,
        say: 'The keypad turns green. Bolts as thick as your arm slide back, and stale air breathes out of the hill.',
      },
      {
        kind: 'use',
        target: 'site7_power',
        text: 'Throw the breaker inside',
        wakes: 'site7',
        say: 'The lights stutter on.\n\nDeep in the bunker, something that has been standing in the dark for a very long time turns its head.',
      },
      {
        kind: 'use',
        target: 'site7_lab',
        text: 'Open the laboratory with the red keycard',
        needs: [['keycard_red', 1]],
        keeps: true,
        opens: 1,
        say: 'ACCESS GRANTED — WELCOME BACK, DR. VOSS.',
      },
      {
        kind: 'use',
        target: 'site7_safe',
        text: 'Open the specimen safe',
        gives: [
          ['sample', 1],
          ['research', 1],
        ],
        say: 'A steel case, cold as a grave, and a bundle of notes. The last page:\n\n"It works. God forgive me — it works only on the living."',
      },
    ],
    reward: { money: 200 },
    done: 'You have the serum. Now get it out.',
  },
  {
    id: 'cure',
    title: 'The cure',
    story: true,
    after: 'site7',
    steps: [
      {
        kind: 'fetch',
        npc: 'lena',
        item: 'research',
        n: 1,
        text: "Bring Voss's notes to Lena at Haven",
        say: "…This is real. It's a vaccine. Not for them — for us. If Raven can make more of it…\n\nYou need a flare for Ashford. Ask Tom. Tom sees everything from that wall.",
      },
      {
        kind: 'talk',
        npc: 'tom',
        text: 'Ask Tom about flares',
        say: "Flares? An army bird went down in the south-west, out past the trailer park. I watched it burn.\n\nIf the crew carried signal flares, they're still in the cockpit. So is the crew.",
      },
      {
        kind: 'use',
        target: 'crash_cockpit',
        text: 'Search the cockpit of the crashed helicopter, far in the south-west',
        gives: [['flare', 1]],
        say: 'One flare left in the survival kit. The pilot is still strapped in. He watches you take it.',
      },
    ],
    done: 'A flare, a serum, and a long walk north.',
  },
  {
    id: 'lastlight',
    title: 'Last light',
    story: true,
    after: 'cure',
    steps: [
      { kind: 'reach', poi: 'ashford', text: 'Take the serum to Ashford, in the north' },
      {
        kind: 'use',
        target: 'evac_flare',
        text: 'Light the flare on the square',
        needs: [
          ['flare', 1],
          ['sample', 1],
        ],
        keeps: true,
        wakes: 'ashford',
        say: 'Red light floods the square.\n\nEvery dead thing in Ashford turns towards it.',
      },
      {
        kind: 'hold',
        poi: 'ashford',
        seconds: 150,
        horde: 14,
        text: 'Stay alive until the helicopter comes',
      },
    ],
    done: 'Rotors. A searchlight. A hand pulling you up out of the red smoke.\n\nBelow you, Deadwood goes dark.\n\nYou made it.',
  },

  // ── Side jobs ──────────────────────────────────────────────────────────────────────────
  {
    id: 'whiskey',
    title: 'Liquid assets',
    giver: 'gus',
    after: 'wake',
    offer:
      "Business proposition. Two bottles of whiskey — real ones, sealed — and I'll make it very worth your while. Houses, the motel, the diner in Mill Creek. People hid the good stuff.",
    steps: [
      {
        kind: 'fetch',
        npc: 'gus',
        item: 'whiskey',
        n: 2,
        text: 'Bring Gus 2 bottles of whiskey',
        say: "Oh, that's the stuff. Pleasure doing business.",
      },
    ],
    reward: { money: 300 },
    done: 'Gus is a happy man.',
  },
  {
    id: 'insulin',
    title: 'Cold chain',
    giver: 'lena',
    after: 'keep',
    offer:
      "Old Peter is diabetic. I have four days of insulin left. The clinic in Pinewatch had a fridge on a battery backup — if there's any left in this county, it's there.",
    steps: [
      {
        kind: 'use',
        target: 'clinic_fridge',
        text: 'Search the fridge in the Pinewatch clinic',
        gives: [['insulin', 1]],
        say: 'The fridge is warm. But one sealed box at the back is still cool to the touch.',
      },
      {
        kind: 'fetch',
        npc: 'lena',
        item: 'insulin',
        n: 1,
        text: 'Bring the insulin to Lena',
        say: "You have no idea what this means. Take these. I'd rather you had them than need them.",
      },
    ],
    reward: {
      items: [
        ['medkit', 2],
        ['antibiotics', 1],
      ],
    },
    done: 'Peter has a few more months.',
  },
  {
    id: 'toolbox',
    title: 'Tools of the trade',
    giver: 'ray',
    after: 'keep',
    offer:
      "I'm fixing a camp with a butter knife and bad language. The Abernathy farm, west of here — old man Abernathy had a proper toolbox on his workbench in the barn. Heavy thing. Bring it and my good rucksack is yours.",
    steps: [
      {
        kind: 'use',
        target: 'farm_workbench',
        text: 'Take the toolbox from the barn at the Abernathy farm',
        gives: [['toolbox', 1]],
        say: 'Five kilos of honest steel.',
      },
      {
        kind: 'fetch',
        npc: 'ray',
        item: 'toolbox',
        n: 1,
        text: 'Bring the toolbox to Ray',
        say: 'Now THAT is a socket set. A deal is a deal.',
      },
    ],
    reward: { items: [['pack_hiking', 1]] },
    done: 'Ray can finally fix things properly.',
  },
  {
    id: 'herd',
    title: 'Thin the herd',
    giver: 'tom',
    after: 'keep',
    offer:
      "The sawmill past Mill Creek. I count more of them there every night, and they're starting to wander this way. Put ten of them down. Use something quiet, or you'll be putting down thirty.",
    steps: [{ kind: 'kill', n: 10, poi: 'sawmill', text: 'Kill 10 of the dead at the sawmill' }],
    reward: {
      items: [
        ['hunting', 1],
        ['ammo308', 12],
      ],
    },
    done: "Tom nods. From Tom, that's a speech.",
  },
  {
    id: 'brute',
    title: 'The big one',
    giver: 'tom',
    after: 'herd',
    offer:
      "There's one in the quarry. Big as a door. I put four rounds in it from the rim and it looked at me. It LOOKED at me.\n\nI want it dead before it finds its way here.",
    steps: [
      {
        kind: 'kill',
        n: 1,
        zombie: ZombieKind.Brute,
        poi: 'quarry',
        text: 'Kill the brute in the quarry, in the east',
      },
    ],
    reward: { money: 300, items: [['pack_military', 1]] },
    done: 'It took a lot of killing.',
  },
  {
    id: 'soup',
    title: 'Stone soup',
    giver: 'dot',
    after: 'wake',
    offer:
      "Forty mouths and a pot of hot water. Three cans of beans and two bottles of clean water, dear, and I'll see you never go hungry in this camp.",
    steps: [
      {
        kind: 'fetch',
        npc: 'dot',
        item: 'beans',
        n: 3,
        text: 'Bring Dot 3 cans of beans',
        say: "Lovely. Now the water, there's a dear.",
      },
      {
        kind: 'fetch',
        npc: 'dot',
        item: 'water',
        n: 2,
        text: 'Bring Dot 2 bottles of water',
        say: 'Sit. Eat. You look like a ghost.',
      },
    ],
    reward: {
      items: [
        ['mre', 3],
        ['coffee', 1],
      ],
    },
    done: 'Hot soup for forty.',
  },
  {
    id: 'teddy',
    title: 'Mr. Buttons',
    giver: 'sam',
    after: 'wake',
    offer:
      "I left Mr. Buttons under my bed. At Shady Acres. Mum said we'd go back for him.\n\n…Mum's not coming back, is she.",
    steps: [
      {
        kind: 'use',
        target: 'trailer_bed',
        text: "Look under Sam's bed at the Shady Acres trailer park, in the south-west",
        gives: [['teddy', 1]],
        say: 'A bear with one eye, and a drawing: four stick people and a dog, holding hands.',
      },
      {
        kind: 'fetch',
        npc: 'sam',
        item: 'teddy',
        n: 1,
        text: 'Bring Mr. Buttons to Sam',
        say: "You found him! …He says thank you. He says you can have Mum's necklace. For luck.",
      },
    ],
    reward: {
      items: [
        ['necklace', 1],
        ['chocolate', 3],
      ],
    },
    done: 'Sam sleeps a little better.',
  },
  {
    id: 'tags',
    title: 'Bring them home',
    giver: 'ortiz',
    after: 'keep',
    offer:
      "I was 3rd Battalion. My squad held the checkpoints when it started — the Ashford road, the south road — and Reyes flew the bird that went down in the south-west.\n\nI can't leave the gate. Bring me their tags. Somebody should say their names.",
    steps: [
      {
        kind: 'collect',
        targets: ['tags_1', 'tags_2', 'tags_3'],
        gives: [['dogtags', 1]],
        text: 'Take the dog tags: the two checkpoints and the crash site',
      },
      {
        kind: 'fetch',
        npc: 'ortiz',
        item: 'dogtags',
        n: 3,
        text: 'Bring the 3 dog tags to Ortiz',
        say: "Kowalski. Brandt. Reyes.\n\n…Thank you. This was mine. It should be with someone who's still fighting.",
      },
    ],
    reward: {
      items: [
        ['ak47', 1],
        ['ammo762', 60],
      ],
    },
    done: 'Three names, remembered.',
  },
  {
    id: 'seeds',
    title: 'Seeds of tomorrow',
    giver: 'abel',
    offer:
      'You are alive! Bless you, bless you. I have kept the lamps lit. I have buried so many.\n\nThe Abernathys kept seed in their pantry. When this night ends, someone must plant. Bring them, and I will give you what the bishop left under the altar. He was… an unusual man.',
    steps: [
      {
        kind: 'use',
        target: 'farm_pantry',
        text: 'Search the pantry at the Abernathy farm',
        gives: [['seeds', 1]],
        say: 'Tomatoes, beans, squash. Dated last spring.',
      },
      {
        kind: 'fetch',
        npc: 'abel',
        item: 'seeds',
        n: 1,
        text: 'Bring the seeds to Father Abel at the church',
        say: 'A future, in paper envelopes. Here. Go with God — and with this.',
      },
    ],
    reward: { items: [['katana', 1]] },
    done: 'Something will grow again.',
  },
  {
    id: 'rangers',
    title: "Ranger's secrets",
    giver: 'mara',
    after: 'keep',
    offer:
      "One more thing. The forest rangers buried supply caches all over these woods, back when the worst thing out here was a snowstorm. Their maps would be at the three ranger stations. Find them and we'll know where to dig.",
    steps: [
      {
        kind: 'collect',
        targets: ['ranger_map_1', 'ranger_map_2', 'ranger_map_3'],
        gives: [['map_piece', 1]],
        text: 'Take the maps from the three ranger stations',
      },
    ],
    reward: { money: 100, reveals: true },
    done: 'Six stashes, marked on your map.',
  },
]

const BY_ID = new Map(QUESTS.map((q) => [q.id, q]))
export function questById(id: string): QuestDef | undefined {
  return BY_ID.get(id)
}

/** Where a step sends you (for the waypoint), or null (kill anywhere). */
export function stepTargets(def: SurvivalDef, step: QuestStep, done = 0): Vec3[] {
  const poi = (key: string | undefined): Vec3[] => {
    const p = def.pois.find((q) => q.key === key)
    return p ? [[p.x, p.y, p.z]] : []
  }
  const npc = (key: string): Vec3[] => {
    const n = def.npcs.find((q) => q.key === key)
    return n ? [n.pos] : []
  }
  const thing = (key: string): Vec3[] => {
    const t = def.interactables.find((q) => q.key === key)
    return t ? [t.pos] : []
  }
  switch (step.kind) {
    case 'reach':
    case 'hold':
      return poi(step.poi)
    case 'kill':
      return poi(step.poi)
    case 'talk':
    case 'fetch':
      return npc(step.npc)
    case 'use':
      return thing(step.target)
    case 'collect':
      return step.targets.filter((_, i) => !(done & (1 << i))).flatMap(thing)
  }
}

/** What people say when they have nothing to ask of you. */
export const SMALL_TALK: Record<string, string[]> = {
  mara: [
    'Keep the gate in sight when you can. Out there the dark is not empty.',
    'Hollis walked out of here eleven days ago to look for people like you. He found one.',
    "Don't waste bullets on the slow ones. A knife in the back of the skull is quiet, and quiet keeps you alive.",
  ],
  gus: [
    "Everything's for sale. Everything. Except the hat.",
    'Bring me what you find. Scrap, watches, cigarettes — I pay cash, and cash still works here.',
    "A bigger pack is the best gun you'll ever buy.",
  ],
  lena: [
    "If you're bleeding, bandage it. I've watched strong people walk themselves to death.",
    "Eat. Drink. Sleep. You'd be amazed how many forget, and then they stop running fast enough.",
  ],
  ray: [
    'Your torch eats batteries. And they can see it from the next valley. Use it like a match, not like a lamp.',
    "If it's got an engine I can fix it. If it's got teeth, that's your department.",
  ],
  tom: [
    'The fast ones you hear before you see. The ones you never hear… those only move when you look away. Keep your eyes on them.',
    'A gunshot carries a long way at night. Every one is a dinner bell.',
    "If you hear screaming in the woods, it isn't a person. It's calling the others.",
  ],
  dot: [
    "There's always something in the pot, dear. Don't ask what.",
    'You look thin. Everyone looks thin.',
  ],
  sam: [
    "Tom says the red eyes are the slow ones and the yellow eyes are the fast ones. I saw white ones once. Tom says I didn't.",
    'Are you going outside? …Okay.',
  ],
  ortiz: [
    'Gate stays shut after you. Nothing personal.',
    "They don't come near the fires. Not yet.",
  ],
  abel: [
    'I ring the bell for them at midnight. They gather. They listen. Then I stop, and they forget.',
    'She is not in her grave, you know. None of them are, for long.',
  ],
}

/** What Gus always has (he sells at an item's value, and buys at SELL_RATE of it). */
export const TRADER_STOCK: string[] = [
  'ammo9',
  'ammo45',
  'ammo22',
  'ammo12',
  'ammo556',
  'ammo762',
  'ammo308',
  'ammo357',
  'bolts',
  'bandage',
  'medkit',
  'painkillers',
  'water',
  'beans',
  'mre',
  'batteries',
  'planks',
  'cap',
  'hoodie',
  'jacket',
  'boots',
  'sneakers',
  'jeans',
  'cargopants',
  'worktrousers',
  'policevest',
  'pack_school',
  'pack_hiking',
  'bat',
  'machete',
  'axe',
  'm1911',
  'revolver',
  'carbine22',
  'doublebarrel',
  'sks',
  'crossbow',
  'mp5',
]
/** Ammunition is sold in boxes of this many. */
export const AMMO_BOX = 10
