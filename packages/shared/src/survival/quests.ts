import type { Vec3 } from '../maps/types.ts'
import { ZombieKind } from '../modes.ts'
import type { Journal, QuestState, WalkerState } from './protocol.ts'
import type { SurvivalDef } from './types.ts'
import { poiAt } from './world.ts'

/**
 * The story of Deadwood ("The Long Night") and the jobs the people of Haven hand out. Every
 * survivor has a journal of their own (protocol.ts Journal): what one of you does, you do for
 * yourself. Only what the world gains (UNLOCKS: a cure, a workshop, the radio) is everyone's.
 */

export const STORY_TITLE = 'The Long Night'

interface StepBase {
  /** What the tracker says to do. */
  text: string
  /**
   * The waypoint shows only once you've read this (a note, a letter, a clue: Journal.notes);
   * until then you have the words of the step and nothing else.
   */
  clue?: string
  /** The waypoint marks the place around the target (a search area), not the thing itself. */
  rough?: boolean
  /** Only on this branch of the quest's choice (QuestState.pick) / never on this one. */
  only?: string
  not?: string
  /** A lore entry (LORE key) that goes in your journal when the step is done. */
  learn?: string
}

export type QuestStep = StepBase &
  (
    | /** Get to a place. */ { kind: 'reach'; poi: string }
    | /** Talk to somebody; `say` is what they tell you (and `gives`, what they hand over). */ {
        kind: 'talk'
        npc: string
        say: string
        gives?: [string, number][]
      }
    | /** Bring `n` of an item to somebody (it is handed over). */ {
        kind: 'fetch'
        npc: string
        item: string
        n: number
        say: string
      }
    | /**
     * Use something in the world. `needs` must be on you (used up unless `keeps`); `gives`
     * comes to you; `opens` unlocks a gate; `wakes` stirs up the dead of a place.
     */ {
        kind: 'use'
        target: string
        needs?: [string, number][]
        keeps?: boolean
        gives?: [string, number][]
        opens?: number
        wakes?: string
        say?: string
      }
    | /** Read a note lying somewhere (its words are the clue to what comes next). */ {
        kind: 'read'
        note: string
      }
    | /** Use every one of these, in any order (each hands over `gives`). */ {
        kind: 'collect'
        targets: string[]
        gives: [string, number][]
      }
    | /**
     * Kill `n` of the dead — at a place, or of one kind, if given. With `boss` (BOSSES), one
     * particular dead thing that turns up when you come near.
     */ {
        kind: 'kill'
        n: number
        poi?: string
        zombie?: number
        boss?: string
      }
    | /** Stay at a place for `seconds` while `horde` of the dead keep coming. */ {
        kind: 'hold'
        poi: string
        seconds: number
        horde: number
      }
    | /**
     * A world event: tell `npc` you're ready (`ready` is the answer) and the dead come at
     * `poi`'s gate in waves for `seconds`. Everyone near is in it; it fails if they get in and
     * stay in long enough (and can be tried again).
     */ {
        kind: 'defend'
        npc: string
        poi: string
        seconds: number
        ready: string
        go: string
      }
    | /** Find somebody (WALKERS) where they hide and talk to them: they come with you. */ {
        kind: 'meet'
        who: string
        say: string
      }
    | /**
     * Get them to `to` alive. If they die, the quest takes the `fails` branch: you get `gives`
     * off them and the story says `say`.
     */ {
        kind: 'escort'
        who: string
        to: string
        fails: { pick: string; say: string; gives?: [string, number][] }
      }
    | /** Somebody asks you to decide: each option sets the quest's branch (QuestState.pick). */ {
        kind: 'choose'
        npc: string
        say: string
        options: { id: string; label: string; reply: string }[]
      }
  )

export interface Reward {
  money?: number
  items?: [string, number][]
  /** Every hidden place goes on your map. */
  reveals?: boolean
  /** Something the world gains for good (UNLOCKS). */
  unlock?: string
  /** Something people do for you from now on (a Journal flag, see PERKS). */
  perk?: string
}

export interface QuestDef {
  id: string
  title: string
  /** A chapter of the main story (starts by itself when the one before is done). */
  story?: boolean
  /** What it's about, for the journal. */
  summary: string
  /** Who hands it out (side jobs), and what they say when they offer it. */
  giver?: string
  offer?: string
  /** Only once you've finished this quest. */
  after?: string
  steps: QuestStep[]
  reward?: Reward
  /** Shown when it is finished. */
  done: string
  /** A quest with a choice: how it ends (and pays) on each branch, instead of done/reward. */
  endings?: Record<string, { done: string; reward?: Reward }>
}

/** What the world can gain for good (SurvivalShared.unlocks), and what it means. */
export const UNLOCKS: Record<string, string> = {
  radio: 'The radio tower is on the air: supply drops come.',
  held: "Haven held against the herd. The gate's been rebuilt stronger.",
  nell: 'Nell Ashby lives at Haven, in the infirmary.',
  workshop: "Ray's workshop sells tools, planks, fuel and car parts.",
  armoury: "Gus stocks the army's leftovers.",
  cure: 'Lena makes the cure at Haven.',
  evac: 'Raven took the serum. The helicopters come more often.',
}

/** What people do for you once you've earned it (Journal flags). */
export const PERKS: Record<string, string> = {
  gus_discount: 'Gus: friends-and-family prices (20% off).',
  lena_free: 'Lena patches you up for nothing.',
  dot_meals: 'Dot feeds you once a day.',
}

/** Somebody who walks with you: who they are, and where they wait to be found. */
export interface WalkerDef {
  name: string
  /** Shirt colour index (PLAYER_COLORS). */
  color: number
  /** What they wear (gear.ts ids). */
  gear: string[]
  hp: number
  /** Where they hide: the place, and the interactable they're by (the nearest spot of its dead). */
  hides: { poi: string; near: string }
  /** Where they live once they're safe (UNLOCKS of the same key): place and its local x/z, yaw°. */
  home: { poi: string; x: number; z: number; yaw: number }
}

export const WALKERS: Record<string, WalkerDef> = {
  nell: {
    name: 'Nell',
    color: 7,
    gear: ['raincoat', 'jeans', 'sneakers'],
    hp: 100,
    hides: { poi: 'motel', near: 'motel_note' },
    home: { poi: 'haven', x: -18.3, z: -1.9, yaw: 0 },
  },
}

/** One particular dead thing a quest sends you after (QuestStep 'kill' boss). */
export const BOSSES: Record<string, { name: string; kind: number; poi: string; near: string }> = {
  hollis: { name: 'Hollis', kind: ZombieKind.Brute, poi: 'site7', near: 'site7_safe' },
}

/** Who the people of Deadwood are (the journal's "People"). */
export const PEOPLE: Record<string, { name: string; bio: string }> = {
  mara: {
    name: 'Mara Quill',
    bio: 'Ran the county 911 desk for nineteen years. Took the last call on the first night, and has been answering for everyone since. Runs Haven.',
  },
  gus: {
    name: 'Gus Petrakis',
    bio: "Sold used cars in Ashford, and anything else that wasn't nailed down. Haven's trader. Says he's in it for the money. Mostly is.",
  },
  lena: {
    name: 'Lena Marsh',
    bio: "A vet nurse, not a doctor, and she will tell you so. The infirmary is hers. She keeps a list of everyone she couldn't save.",
  },
  ray: {
    name: 'Ray Dunn',
    bio: "Ran the garage in Pinewatch. Talks to engines; they listen. Keeps Haven's lights on and its radio warm.",
  },
  tom: {
    name: 'Tom Archer',
    bio: 'Game warden, once a Marine. Watches the north road from the east wall. Says about ten words a day.',
  },
  dot: {
    name: "Dorothy 'Dot' Pike",
    bio: 'Ran the diner in Mill Creek for thirty years. Feeds forty people out of one pot and will not say how.',
  },
  sam: {
    name: 'Sam',
    bio: 'Nine. From the Shady Acres trailer park. His mum went out for medicine on the fourth day.',
  },
  ortiz: {
    name: 'Cpl. Luis Ortiz',
    bio: "3rd Battalion. Held the Ashford road checkpoint until the night he refused an order. Holds Haven's gate now.",
  },
  abel: {
    name: 'Father Abel',
    bio: "Priest of St. Agnes'. Stayed with his church and his dead. Rings the bell at midnight.",
  },
  nell: {
    name: 'Nell Ashby',
    bio: 'Lab technician at Site 7, under Dr. Voss. Got out the night it fell, with Hollis.',
  },
  hollis: {
    name: 'Sgt. Dan Hollis',
    bio: 'Head of security at Site 7. Founded Haven with Mara. Walked out eleven days before you woke in his cabin.',
  },
}

/**
 * Notes and letters in the journal: a title for each, and their words where the world's own
 * text isn't it (things placed with no text, or what a story search turns up).
 */
export const LORE: Record<string, { title: string; text?: string }> = {
  start_note: { title: 'Note on the cabin table' },
  hollis_locker: {
    title: "Hollis' letter",
    text: "An army ID card: SGT. D. HOLLIS — SITE 7 SECURITY. Under it, a letter.\n\nMara —\nI was on the door the night it went wrong at Site 7. I sealed it with nineteen people still inside. Some of them were still people.\nVoss gave me something that keeps the bite from finishing. A week a dose. It's running out.\nThere were spares at Bunker 12, on the western ridge. I'm going.\nDon't send anyone after me.\n— Dan",
  },
  radio_note: { title: 'Transmitter log' },
  bunker_note_1: {
    title: 'Orders, Bunker 12',
    text: 'ORDERS, 3rd night: hold the bunker, admit nobody. Bitten personnel are to be "processed".\n\nWe processed Hayes at 0400. He got up at 0410.\n\nUnderneath, newer, in pencil:\nThe spare doses are gone. Somebody got here first.\nVoss kept his own. He went home to Mill Creek at the end — his name is still on the house. — D.H.',
  },
  voss_desk: { title: "Voss's letter, never sent" },
  church_grave: { title: "Agnes Voss's grave" },
  site7_security_note: {
    title: 'Security log, Site 7',
    text: "SECURITY LOG — SITE 7\n\n0200 Containment breach, lab B. Opened from INSIDE. General Kessler's code.\n0214 Lockdown. Blast door sealed. Kessler and his staff still in the hall.\n0230 Power to the lab cut from the generator room. Lab door will not open without power AND a level 2 card.\n0300 Still hear them in the hall.\n0340 I am going to try for the generator room. — Sgt. D. Hollis",
  },
  site7_note: { title: 'E.V. — personal' },
  site7_safe: { title: "The last page of Voss's notes" },
  hollis_last: {
    title: "Hollis' last words",
    text: "In his breast pocket, a photo of the fire at Haven. On the back, in shaking pencil:\n\nThe serum works. Raven is Kessler. He got out.\nDon't give it to him.\n— D.",
  },
  sam_mum_note: {
    title: "Carol's note",
    text: "To whoever finds this — my boy is Sam, he's nine, he's at the camp they call Haven.\n\nI got the medicine. I also got bit, getting it.\n\nI'm going down to the lake. Don't let him come looking. Tell him whatever you have to.\n— Carol",
  },
  checkpoint_tent: { title: 'Checkpoint duty log' },
}

export const QUESTS: QuestDef[] = [
  // ── The Long Night ─────────────────────────────────────────────────────────────────────
  {
    id: 'wake',
    title: "Hollis' cabin",
    story: true,
    summary:
      "You woke in a cabin that isn't yours, with a stranger's pistol and a note telling you where to go.",
    steps: [
      { kind: 'read', note: 'start_note', text: 'Read the note on the table' },
      {
        kind: 'reach',
        poi: 'haven',
        text: 'Follow the track north-east to the road, and the road north to Haven',
      },
    ],
    done: "Haven. Walls, a fire, and people with guns who aren't pointing them at you. Yet.",
  },
  {
    id: 'keep',
    title: "A stranger's bunk",
    story: true,
    after: 'wake',
    summary:
      'Hollis sent you to Haven. Nobody there has seen him in eleven days, and nobody wants to say why.',
    steps: [
      {
        kind: 'talk',
        npc: 'mara',
        text: 'Talk to Mara, by the fire',
        say: "Hollis sent you? …Then he was alive. That's more than I knew this morning.\n\nHe walked out eleven days ago. Didn't say where. He left a footlocker in the bunkhouse, and nobody has had the stomach to open it.\n\nYou open it. You're the last one who saw him.",
      },
      {
        kind: 'read',
        note: 'hollis_locker',
        text: "Open Hollis' footlocker in the bunkhouse",
      },
      {
        kind: 'talk',
        npc: 'ortiz',
        text: 'Show Ortiz the army ID',
        say: "Site 7 security. …Huh.\n\nThe second night, the order came down from Site 7: nobody comes down the Ashford road. Nobody. Sick or not. Kids or not. I didn't fire. That's why I'm here and not in a ditch.\n\nI don't know whose order it was. I know Hollis carried something heavy. Now I know what.\n\nTom's been watching the north road. Go and see him. Something's coming.",
      },
    ],
    reward: { money: 40 },
    done: 'Hollis was there when it started. Whatever happened at Site 7, he has been running from it ever since.',
  },
  {
    id: 'gate',
    title: 'The herd',
    story: true,
    after: 'keep',
    summary: 'A herd is coming down the north road. Haven has one gate, and it has to hold.',
    steps: [
      {
        kind: 'talk',
        npc: 'tom',
        text: 'Talk to Tom on the east wall',
        say: "Couple hundred of them, strung out along the north road. They follow the generator. Ours.\n\nThey'll come for the gate. It's the only way in. Tell Ortiz when you're ready, and bring every round you have.",
      },
      {
        kind: 'defend',
        npc: 'ortiz',
        poi: 'haven',
        seconds: 120,
        ready: "I'm ready. Let them come.",
        go: "Here — 9 mil, a box. Make them count.\n\nThey're on the road. Everyone to the gate!",
        text: "Tell Ortiz you're ready, then hold Haven's gate",
      },
    ],
    reward: { money: 80, items: [['pack_school', 1]], unlock: 'held' },
    done: "The last of them goes down in the gateway. Somebody starts laughing and can't stop.\n\nMara gives you a bunk. Nobody calls you new any more.",
  },
  {
    id: 'tower',
    title: 'Dead air',
    story: true,
    after: 'gate',
    summary:
      'Hollis sat up nights listening to the radio, waiting for somebody to call. Ray thinks the forestry transmitter can still reach them.',
    steps: [
      {
        kind: 'talk',
        npc: 'ray',
        text: 'Talk to Ray in the workshop',
        say: "Hollis used to sit up with me, listening to the static. Waiting for somebody. Never said who.\n\nThe forestry transmitter on the north-west hill still has its set. What it hasn't got is power: its generator blew the main fuse. The sawmill east of Mill Creek ran the same model.\n\nFuse. A jerry can. Then you call out.\n\nA generator is LOUD. Everything in those woods will come and see.",
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
        text: "Start the tower's generator, north-west (needs the fuse and a jerry can)",
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
        say: '"…any station, any station, this is Haven…"\n\nStatic. Then a voice, very clear:\n\n"Haven, Raven Actual. Keep this channel open."',
      },
      {
        kind: 'hold',
        poi: 'radio',
        seconds: 90,
        horde: 9,
        text: 'Keep the transmitter running',
      },
    ],
    reward: { money: 150, unlock: 'radio' },
    done: '"Haven, Raven Actual. Dr. Elias Voss finished his serum before Site 7 fell. One case. Recover it and bring it to the square at Ashford. Light a flare. One bird, one pass.\n\nSergeant Hollis is not to be trusted. Raven out."',
  },
  {
    id: 'voss',
    title: "Hollis' trail",
    story: true,
    after: 'tower',
    summary:
      "Raven wants Voss's serum, and says Hollis can't be trusted. Hollis went west looking for something.",
    steps: [
      {
        kind: 'read',
        note: 'bunker_note_1',
        clue: 'hollis_locker',
        rough: true,
        text: 'Find what Hollis left at Bunker 12, on the western ridge',
      },
      {
        kind: 'use',
        target: 'voss_desk',
        clue: 'bunker_note_1',
        rough: true,
        text: "Find Dr. Voss's house in Mill Creek and search it",
        say: 'A letter, never sent:\n\n"Agnes is gone. I buried her at St. Agnes\' with my own hands, and my card with her. Let it stay there. Let all of it stay buried."',
      },
      {
        kind: 'use',
        target: 'church_grave',
        clue: 'voss_desk',
        rough: true,
        text: "Dig at Agnes Voss's grave",
        gives: [['keycard_red', 1]],
        wakes: 'church',
        say: "A hand's depth down: a red keycard in a plastic bag.\n\nAnd below it, something scratching back.",
      },
      {
        kind: 'talk',
        npc: 'abel',
        text: 'Ask Father Abel about Hollis',
        say: "Hollis. Yes. He came four nights ago with a fever in him and asked me to hear his confession. I did. I won't tell you what he said.\n\nI'll tell you this: a woman came through after him. Young. A lab coat under her parka. She was going to hide at the motel on the east road until he came back for her.\n\nHe hasn't come back.",
      },
    ],
    reward: { money: 60 },
    done: "Voss's card, out of his wife's grave. And somebody else from Site 7, still alive.",
  },
  {
    id: 'nell',
    title: 'The woman from the lab',
    story: true,
    after: 'voss',
    summary:
      "One of Voss's people is hiding at the Pine Rest motel. She knows what happened at Site 7.",
    steps: [
      {
        kind: 'meet',
        who: 'nell',
        rough: true,
        text: 'Find the woman from the lab at the Pine Rest motel',
        say: "Don't — don't shoot. Did Dan send you?\n\n…He said three days. It's been six.\n\nI'm Nell. I worked for Dr. Voss. Get me to Haven and I'll tell you everything. Please. I can't do another night in here.",
      },
      {
        kind: 'escort',
        who: 'nell',
        to: 'haven',
        text: "Get Nell to Haven alive. Don't run: she can't keep up",
        fails: {
          pick: 'dead',
          gives: [['keycard_blue', 1]],
          say: "Nell goes down and doesn't get up.\n\nIn her coat: a blue keycard, SITE 7 — LEVEL 1. You never find out what she wanted to tell you.",
        },
      },
      {
        kind: 'talk',
        npc: 'nell',
        not: 'dead',
        text: 'Talk to Nell in the infirmary',
        gives: [['keycard_blue', 1]],
        say: "Voss made the serum to keep wounded soldiers alive. It worked. Then it worked on the dead too. General Kessler wanted that part. Soldiers you don't have to feed.\n\nThe breach wasn't an accident. Kessler opened lab B to see what they'd do. Dan sealed the door on him.\n\nDan was bitten getting me out. Voss gave him the early batch — it only holds the turn. The finished case is still in the lab safe.\n\nHe went up there to get it. For you. Take my card.",
      },
    ],
    reward: { money: 60 },
    done: 'Hollis went back to Site 7 to finish what he started. Somebody has to go after him.',
  },
  {
    id: 'site7',
    title: 'Site 7',
    story: true,
    after: 'nell',
    summary: 'The serum is in the lab safe at Site 7. So, probably, is Hollis.',
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
        say: 'The lights stutter on.\n\nDeep in the bunker, something that was a man turns its head.',
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
        kind: 'kill',
        n: 1,
        poi: 'site7',
        boss: 'hollis',
        text: 'Put Hollis to rest',
        learn: 'hollis_last',
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
    done: "You have the serum. Hollis' war is over. Yours isn't.",
  },
  {
    id: 'lastlight',
    title: 'Last light',
    story: true,
    after: 'site7',
    summary:
      'One case of serum. Raven wants it at Ashford. Lena thinks she can make more of it, here.',
    steps: [
      {
        kind: 'choose',
        npc: 'lena',
        text: 'Talk to Lena about the serum',
        say: "Voss's notes… this is a recipe. Not a miracle. A recipe. Give me the case and a month, and nobody at Haven ever has to turn again.\n\nOr take it to Ashford. Raven has labs and helicopters. Maybe they'd make enough for everyone. Maybe they'd do what Kessler wanted.\n\nIt's your choice. It was always going to be somebody's.",
        options: [
          {
            id: 'haven',
            label: 'Keep it here. Make the cure.',
            reply:
              "…Thank you. I'll start tonight. Don't let anything through that gate while I work.",
          },
          {
            id: 'raven',
            label: "Raven can make more. I'm taking it to Ashford.",
            reply: 'Then go, before I change your mind for you. Ask Tom about flares.',
          },
        ],
      },
      {
        kind: 'defend',
        only: 'haven',
        npc: 'ortiz',
        poi: 'haven',
        seconds: 150,
        ready: "Lena's working. Nothing gets through.",
        go: "Raven's bird has been circling all day. Now the dead are coming up the road behind it. Funny, that.\n\nTo the gate!",
        text: 'Tell Ortiz, then hold Haven while Lena works',
      },
      {
        kind: 'talk',
        only: 'raven',
        npc: 'tom',
        text: 'Ask Tom about flares',
        say: "Flares? An army bird went down in the south-west, past the trailer park. I watched it burn.\n\nIf the crew carried signal flares, they're still in the cockpit. So is the crew.",
      },
      {
        kind: 'use',
        only: 'raven',
        target: 'crash_cockpit',
        text: 'Search the cockpit of the crashed helicopter, far in the south-west',
        gives: [['flare', 1]],
        say: 'One flare left in the survival kit. The pilot is still strapped in. He watches you take it.',
      },
      {
        kind: 'reach',
        only: 'raven',
        poi: 'ashford',
        text: 'Take the serum to Ashford, in the north',
      },
      {
        kind: 'use',
        only: 'raven',
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
        only: 'raven',
        poi: 'ashford',
        seconds: 150,
        horde: 14,
        text: 'Stay alive until the helicopter comes',
      },
    ],
    done: '',
    endings: {
      haven: {
        done: 'Dawn. Lena comes out of the infirmary grey with tiredness, holding up a syringe.\n\n"It works."\n\nThe night is still long. But now it has an end.',
        reward: { money: 300, unlock: 'cure' },
      },
      raven: {
        done: 'Rotors. A searchlight. Hands pull you up out of the red smoke.\n\nThe officer who takes the case doesn\'t look at you. "General Kessler sends his thanks."\n\nBelow you, Deadwood goes dark.',
        reward: { money: 500, unlock: 'evac' },
      },
    },
  },

  // ── Mara ───────────────────────────────────────────────────────────────────────────────
  {
    id: 'rangers',
    title: "Ranger's secrets",
    giver: 'mara',
    after: 'keep',
    summary:
      'The forest rangers buried supply caches all over the woods. Their maps are at the stations.',
    offer:
      "The rangers buried supply caches all over these woods, back when the worst thing out here was a snowstorm. Their maps will be at the three ranger stations. Find them and we'll know where to dig.",
    steps: [
      {
        kind: 'collect',
        targets: ['ranger_map_1', 'ranger_map_2', 'ranger_map_3'],
        gives: [['map_piece', 1]],
        text: 'Take the maps from the three ranger stations',
      },
      {
        kind: 'fetch',
        npc: 'mara',
        item: 'map_piece',
        n: 3,
        text: 'Bring the maps to Mara',
        say: "Six caches. Six chances. Keep what you find in them — you earned it.\n\nAnd… thank you. For going out there when you didn't have to.",
      },
    ],
    reward: { money: 100, reveals: true },
    done: 'Six stashes, marked on your map.',
  },

  // ── Gus ────────────────────────────────────────────────────────────────────────────────
  {
    id: 'whiskey',
    title: 'Liquid assets',
    giver: 'gus',
    after: 'wake',
    summary: 'Gus wants two sealed bottles of whiskey. He says it is business.',
    offer:
      "Business proposition. Two bottles of whiskey — real ones, sealed — and I'll make it worth your while. Houses, the motel, the diner in Mill Creek. People hid the good stuff.",
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
    id: 'cashbox',
    title: 'Retirement plan',
    giver: 'gus',
    after: 'whiskey',
    summary:
      "Gus left his life's savings under a gun-shop counter in Mill Creek. Mill Creek is crawling.",
    offer:
      "You're reliable. I like reliable. Here's the thing: everything I own is in a cash box under the counter at Guns & Ammo, Mill Creek. I fenced through them. Don't ask.\n\nBring it back unopened and you'll never pay full price at this stall again.",
    steps: [
      {
        kind: 'use',
        target: 'gus_cashbox',
        text: 'Take the cash box from the gun shop in Mill Creek',
        gives: [['cashbox', 1]],
        say: 'Heavy, locked, and something inside rattles. Not money.',
      },
      {
        kind: 'fetch',
        npc: 'gus',
        item: 'cashbox',
        n: 1,
        text: 'Bring the cash box to Gus, unopened',
        say: "…\n\nIt's not money. It's my wife's rings, and my daughter's teeth, the baby ones. I couldn't leave them.\n\nDon't look at me like that. Friends-and-family prices, from now on. Go away.",
      },
    ],
    reward: { money: 150, perk: 'gus_discount' },
    done: "Gus doesn't mention it again. His prices drop for you.",
  },

  // ── Lena ───────────────────────────────────────────────────────────────────────────────
  {
    id: 'insulin',
    title: 'Cold chain',
    giver: 'lena',
    after: 'keep',
    summary: 'Old Peter is diabetic. Lena has four days of insulin left.',
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
        say: "You have no idea what this means. From now on, if you're bleeding, you don't pay at my door.",
      },
    ],
    reward: { items: [['medkit', 2]], perk: 'lena_free' },
    done: 'Peter has a few more months. Lena patches you up for nothing now.',
  },
  {
    id: 'vial',
    title: 'The last vial',
    giver: 'lena',
    after: 'insulin',
    summary:
      'Two people at Haven have infections that will kill them. There may be one vial of penicillin left.',
    offer:
      "Sam cut his arm on the wire and it's gone bad. And Ortiz has been hiding a wound under that vest for a week — I can smell it.\n\nThe army kept penicillin at Bunker 4, in the south. If there's one vial, that's one. Not two.",
    steps: [
      {
        kind: 'use',
        target: 'bunker4_medbay',
        text: 'Search the medical crate in Bunker 4, in the south',
        gives: [['vial', 1]],
        wakes: 'bunker_south',
        say: 'One vial, rattling in an empty crate. Behind you, the bunker wakes up.',
      },
      {
        kind: 'choose',
        npc: 'lena',
        text: 'Decide with Lena who gets the penicillin',
        say: "One vial. Sam is nine. Ortiz is the only one who can hold that gate.\n\nDon't make me choose. Please.",
        options: [
          {
            id: 'sam',
            label: 'Give it to Sam.',
            reply: "…Yes. Of course. I'll tell Ortiz. He'd say the same. I think.",
          },
          {
            id: 'ortiz',
            label: 'Give it to Ortiz. Haven needs the gate.',
            reply: "…All right. I'll do what I can for the boy. Willow bark and prayer.",
          },
        ],
      },
    ],
    done: '',
    endings: {
      sam: {
        done: 'The fever breaks by morning. Sam asks for pancakes. There are no pancakes.\n\nOrtiz is greyer, slower, and still at the gate.',
        reward: { items: [['adrenaline', 1]] },
      },
      ortiz: {
        done: "Ortiz is back on the wall in two days. Sam pulls through on willow bark, barely, and won't look at you.\n\nOrtiz has words with Gus about the army's leftovers.",
        reward: { items: [['militaryvest', 1]], unlock: 'armoury' },
      },
    },
  },

  // ── Ray ────────────────────────────────────────────────────────────────────────────────
  {
    id: 'toolbox',
    title: 'Tools of the trade',
    giver: 'ray',
    after: 'keep',
    summary: 'Ray is fixing a camp with a butter knife. Old Abernathy had a real toolbox.',
    offer:
      "I'm fixing a camp with a butter knife and bad language. The Abernathy farm, west of here — old man Abernathy had a proper toolbox on his workbench in the barn. Bring it and my good rucksack is yours.",
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
    id: 'workshop',
    title: 'Open for business',
    giver: 'ray',
    after: 'toolbox',
    summary: 'With fuel and batteries, Ray can run the workshop for everyone.',
    offer:
      "With proper tools I could make planks, fix torches, cut keys. What I can't make is power. A jerry can and some batteries, and the workbench is open to everybody.",
    steps: [
      {
        kind: 'fetch',
        npc: 'ray',
        item: 'gasoline',
        n: 1,
        text: 'Bring Ray a jerry can',
        say: "That'll run her a week. Now the batteries.",
      },
      {
        kind: 'fetch',
        npc: 'ray',
        item: 'batteries',
        n: 2,
        text: 'Bring Ray 2 batteries',
        say: "Hear that? That's a workshop. Spread the word: Ray's open.",
      },
    ],
    reward: { money: 60, unlock: 'workshop' },
    done: "Ray's workshop is open to everyone at Haven.",
  },

  // ── Tom ────────────────────────────────────────────────────────────────────────────────
  {
    id: 'herd',
    title: 'Thin the herd',
    giver: 'tom',
    after: 'gate',
    summary: 'More of the dead gather at the sawmill every night, and they drift towards Haven.',
    offer:
      "The sawmill past Mill Creek. More of them there every night, and they wander this way. Put ten down. Use something quiet, or you'll be putting down thirty.",
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
    summary: 'Something huge lives in the quarry. Tom put four rounds in it. It looked at him.',
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

  // ── Dot ────────────────────────────────────────────────────────────────────────────────
  {
    id: 'soup',
    title: 'Stone soup',
    giver: 'dot',
    after: 'wake',
    summary: 'Forty mouths and a pot of hot water.',
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
    id: 'recipes',
    title: "Dot's diner",
    giver: 'dot',
    after: 'soup',
    summary: "Dot's recipes are still in the kitchen of her diner in Mill Creek.",
    offer:
      "Thirty years I ran the diner in Mill Creek. My recipes are in a tin in the kitchen — my mother's, and hers. I don't need them. I know them.\n\nI just can't stand that they're in there with… them. Would you?",
    steps: [
      {
        kind: 'use',
        target: 'dot_recipes',
        text: "Take the recipe tin from Dot's diner in Mill Creek",
        gives: [['recipes', 1]],
        say: 'The tin is dented. The cards inside are soft with grease and pencil.',
      },
      {
        kind: 'fetch',
        npc: 'dot',
        item: 'recipes',
        n: 1,
        text: 'Bring the tin to Dot',
        say: "Oh. Oh, there's Mum's writing.\n\nYou come and see me every day, you hear? There'll be a bowl with your name on it.",
      },
    ],
    reward: { perk: 'dot_meals' },
    done: 'Dot feeds you once a day. Ask her.',
  },

  // ── Sam ────────────────────────────────────────────────────────────────────────────────
  {
    id: 'teddy',
    title: 'Mr. Buttons',
    giver: 'sam',
    after: 'wake',
    summary: 'Sam left his bear under his bed at the Shady Acres trailer park.',
    offer:
      "I left Mr. Buttons under my bed. At Shady Acres. Mum said we'd go back for him.\n\nMum went to get medicine. She's coming back.",
    steps: [
      {
        kind: 'use',
        target: 'trailer_bed',
        text: "Look under Sam's bed at the Shady Acres trailer park, in the south-west",
        gives: [['teddy', 1]],
        say: 'A bear with one eye, and a drawing: three stick people and a dog, holding hands.',
      },
      {
        kind: 'fetch',
        npc: 'sam',
        item: 'teddy',
        n: 1,
        text: 'Bring Mr. Buttons to Sam',
        say: "You found him! …He says thank you. He says you can have Mum's necklace. For luck. She'll want it back.",
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
    id: 'mum',
    title: "Sam's mum",
    giver: 'sam',
    after: 'teddy',
    summary: "Sam's mum went to the clinic in Pinewatch for medicine on the fourth day.",
    offer:
      'Mum went to the clinic in Pinewatch. For my medicine. That was ages ago.\n\nCan you look? Just look. She has a red coat.',
    steps: [
      {
        kind: 'read',
        note: 'sam_mum_note',
        text: "Search the clinic in Pinewatch for Sam's mum",
      },
      {
        kind: 'choose',
        npc: 'sam',
        text: 'Tell Sam',
        say: 'Did you find her? Is she coming?',
        options: [
          {
            id: 'truth',
            label: 'Tell him the truth.',
            reply: '…\n\nOkay.\n\nCan I have the necklace back? Just to hold.',
          },
          {
            id: 'lie',
            label: "She's safe, at another camp. Over the mountain.",
            reply: "I KNEW it! I knew it. When it's spring we'll go and see her. Mr. Buttons too.",
          },
        ],
      },
    ],
    done: '',
    endings: {
      truth: {
        done: "Sam doesn't cry. That's the worst part. Later Dot finds him asleep by the fire, holding the bear.",
        reward: { money: 50 },
      },
      lie: {
        done: 'Sam tells everyone his mum is at the camp over the mountain. Lena looks at you for a long time and says nothing.',
        reward: { money: 50 },
      },
    },
  },

  // ── Ortiz ──────────────────────────────────────────────────────────────────────────────
  {
    id: 'tags',
    title: 'Bring them home',
    giver: 'ortiz',
    after: 'keep',
    summary: "Ortiz's squad held the checkpoints when it started. He wants their tags.",
    offer:
      "My squad held the checkpoints when it started — the Ashford road, the south road — and Reyes flew the bird that went down in the south-west.\n\nI can't leave the gate. Bring me their tags. Somebody should say their names.",
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
        say: "Kowalski. Brandt. Reyes.\n\n…They did fire, that night. I didn't. I don't know which of us was right any more.\n\nThis was mine. It should be with somebody who's still fighting.",
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

  // ── Father Abel ────────────────────────────────────────────────────────────────────────
  {
    id: 'seeds',
    title: 'Seeds of tomorrow',
    giver: 'abel',
    summary: 'Father Abel wants seed for the spring. The Abernathys kept some.',
    offer:
      'You are alive! Bless you. I have kept the lamps lit. I have buried so many.\n\nThe Abernathys kept seed in their pantry. When this night ends, someone must plant. Bring them, and I will give you what the bishop left under the altar. He was… an unusual man.',
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
]

const BY_ID = new Map(QUESTS.map((q) => [q.id, q]))
export function questById(id: string): QuestDef | undefined {
  return BY_ID.get(id)
}

export function freshJournal(): Journal {
  return { quests: [], done: [], notes: [], flags: [] }
}

/** Is this step on the quest's branch? */
export function stepApplies(step: QuestStep, pick: string | undefined): boolean {
  if (step.only !== undefined && step.only !== pick) return false
  if (step.not !== undefined && step.not === pick) return false
  return true
}

/** The first step at or after `from` that is on the branch (or steps.length: finished). */
export function nextStep(def: QuestDef, from: number, pick: string | undefined): number {
  let i = from
  while (i < def.steps.length && !stepApplies(def.steps[i] as QuestStep, pick)) i++
  return i
}

/** What a quest has given you for good, when it ends on this branch. */
export function endingOf(
  def: QuestDef,
  pick: string | undefined,
): { done: string; reward?: Reward } {
  const e = pick !== undefined ? def.endings?.[pick] : undefined
  if (e) return e
  return { done: def.done, ...(def.reward ? { reward: def.reward } : {}) }
}

/** A note's heading in the journal. */
export function noteTitle(def: SurvivalDef, key: string): string {
  const lore = LORE[key]
  if (lore) return lore.title
  const text = noteText(def, key)
  const first = text.split('\n')[0] ?? ''
  return first.length > 34 ? `${first.slice(0, 32)}…` : first || 'A note'
}

/** What a note (or a letter a quest turns up) says. */
export function noteText(def: SurvivalDef, key: string): string {
  const lore = LORE[key]?.text
  if (lore) return lore
  const thing = def.interactables.find((t) => t.key === key)
  if (thing?.text) return thing.text
  for (const q of QUESTS)
    for (const s of q.steps) if (s.kind === 'use' && s.target === key && s.say) return s.say
  return ''
}

/** Where a walker waits to be found: the spot of their place's dead nearest what they hide by. */
export function walkerHideout(def: SurvivalDef, who: string): Vec3 | null {
  const w = WALKERS[who]
  if (!w) return null
  const i = def.pois.findIndex((p) => p.key === w.hides.poi)
  const near = def.interactables.find((t) => t.key === w.hides.near)
  if (i < 0 || !near) return null
  let best: Vec3 | null = null
  let bestD = Number.POSITIVE_INFINITY
  for (const s of def.zombieSpots) {
    if (s.poi !== i) continue
    const d = Math.hypot(s.pos[0] - near.pos[0], s.pos[2] - near.pos[2])
    if (d < bestD) {
      bestD = d
      best = s.pos
    }
  }
  return best
}

/** Where a walker lives once they're safe (world x/y/z and yaw). */
export function walkerHome(def: SurvivalDef, who: string): { pos: Vec3; yaw: number } | null {
  const w = WALKERS[who]
  const poi = w && def.pois.find((p) => p.key === w.home.poi)
  if (!w || !poi) return null
  return {
    pos: [poi.x + w.home.x, poi.y + 0.12, poi.z + w.home.z],
    yaw: (w.home.yaw * Math.PI) / 180,
  }
}

/** Where a boss turns up: the spot of its place's dead nearest what it guards. */
export function bossSpot(def: SurvivalDef, key: string): Vec3 | null {
  const b = BOSSES[key]
  if (!b) return null
  const i = def.pois.findIndex((p) => p.key === b.poi)
  const near = def.interactables.find((t) => t.key === b.near)
  if (i < 0 || !near) return null
  let best: Vec3 | null = null
  let bestD = Number.POSITIVE_INFINITY
  for (const s of def.zombieSpots) {
    if (s.poi !== i) continue
    const d = Math.hypot(s.pos[0] - near.pos[0], s.pos[2] - near.pos[2], s.pos[1] - near.pos[1])
    if (d < bestD) {
      bestD = d
      best = s.pos
    }
  }
  return best
}

/**
 * Where a step sends you, for the waypoint: `points` (the nearest is the one to go to), and
 * `area` > 0 when it's only a search area of that radius around them. `hidden`: there is a
 * target, but you haven't found the clue that points to it yet.
 */
export interface StepGoal {
  points: Vec3[]
  area: number
  hidden: boolean
}

export function stepGoal(
  def: SurvivalDef,
  step: QuestStep,
  state: Pick<QuestState, 'count'>,
  journal: Pick<Journal, 'notes'>,
  walkers: readonly WalkerState[] = [],
  meId = 0,
): StepGoal {
  if (step.clue && !journal.notes.includes(step.clue)) return { points: [], area: 0, hidden: true }
  const poi = (key: string | undefined): Vec3[] => {
    const p = def.pois.find((q) => q.key === key)
    return p ? [[p.x, p.y, p.z]] : []
  }
  const npc = (key: string): Vec3[] => {
    const n = def.npcs.find((q) => q.key === key)
    if (n) return [n.pos]
    // Somebody who walks: where they are, or where they live.
    const w = walkers.find((q) => q.who === key && q.key === key)
    if (w) return [[w.x, w.y, w.z]]
    const home = walkerHome(def, key)
    return home ? [home.pos] : []
  }
  const thing = (key: string): Vec3[] => {
    const t = def.interactables.find((q) => q.key === key)
    return t ? [t.pos] : []
  }
  let points: Vec3[] = []
  switch (step.kind) {
    case 'reach':
    case 'hold':
      points = poi(step.poi)
      break
    case 'kill':
      points = poi(step.poi)
      break
    case 'talk':
    case 'fetch':
    case 'choose':
      points = npc(step.npc)
      break
    case 'defend':
      points = npc(step.npc)
      break
    case 'use':
      points = thing(step.target)
      break
    case 'read':
      points = thing(step.note)
      break
    case 'collect':
      points = step.targets.filter((_, i) => !(state.count & (1 << i))).flatMap(thing)
      break
    case 'meet': {
      const hide = walkerHideout(def, step.who)
      points = hide ? [hide] : []
      break
    }
    case 'escort': {
      // Back to them if they've stopped following; otherwise where you're taking them.
      const w = walkers.find((q) => q.who === step.who && q.key === `${step.who}@${meId}`)
      points = w && w.follow !== meId ? [[w.x, w.y, w.z]] : poi(step.to)
      break
    }
  }
  if (!step.rough) return { points, area: 0, hidden: false }
  // Only the place around it: its middle, and how far to search.
  let area = 0
  const rough = points.map((p): Vec3 => {
    const i = poiAt(def, p[0], p[2], 8)
    const place = i === null ? undefined : def.pois[i]
    if (!place) {
      area = Math.max(area, 60)
      return p
    }
    area = Math.max(area, place.r + 15)
    return [place.x, place.y, place.z]
  })
  return { points: rough, area, hidden: false }
}

/** "done:quest", "flag:x", "unlock:x", "active:quest", "!…": does it hold? */
export function holds(cond: string, journal: Journal, unlocks: readonly string[]): boolean {
  if (cond.startsWith('!')) return !holds(cond.slice(1), journal, unlocks)
  const [kind, what = ''] = cond.split(':', 2) as [string, string]
  const rest = cond.slice(kind.length + 1)
  if (kind === 'done') return journal.done.includes(what)
  if (kind === 'flag') return journal.flags.includes(rest)
  if (kind === 'unlock') return unlocks.includes(what)
  if (kind === 'active') return journal.quests.some((q) => q.id === what)
  return false
}

/**
 * What people say when they have nothing to ask of you. Lines with `when` (all of a comma list
 * must hold, see holds) say how things stand, and are said before the plain ones.
 */
export const TALK: Record<string, { when?: string; text: string }[]> = {
  mara: [
    { text: 'Keep the gate in sight when you can. Out there the dark is not empty.' },
    {
      text: "Don't waste bullets on the slow ones. A knife in the back of the skull is quiet, and quiet keeps you alive.",
    },
    {
      when: '!done:keep',
      text: 'Hollis walked out of here eleven days ago. He found you. I hope that was worth it.',
    },
    {
      when: 'done:gate',
      text: 'You held the gate. People here will remember that. People here remember everything.',
    },
    {
      when: 'done:voss,!done:site7',
      text: 'Site 7. He never once said Site 7 to me. Not in two years.',
    },
    {
      when: 'done:site7',
      text: 'I knew, about Hollis. Not all of it. Enough. I let him stay anyway. I would again.',
    },
    {
      when: 'flag:lastlight:haven',
      text: "Lena hasn't slept in three days. I've never seen her happier.",
    },
    { when: 'flag:lastlight:raven', text: "You gave it to them. I hope you're right about them." },
  ],
  gus: [
    { text: "Everything's for sale. Everything. Except the hat." },
    {
      text: 'Bring me what you find. Scrap, watches, cigarettes — I pay cash, and cash still works here.',
    },
    { text: "A bigger pack is the best gun you'll ever buy." },
    {
      when: 'flag:gus_discount',
      text: "For you? Friends-and-family prices. Don't tell the family.",
    },
    {
      when: 'unlock:armoury',
      text: 'Ortiz brought me the army surplus. Helmets, vests, the good rifles. Mind the prices.',
    },
  ],
  lena: [
    {
      text: "If you're bleeding, bandage it. I've watched strong people walk themselves to death.",
    },
    {
      text: "Eat. Drink. Sleep. You'd be amazed how many forget, and then they stop running fast enough.",
    },
    {
      when: 'flag:vial:sam',
      text: 'Sam ate two bowls this morning. Ortiz is on his feet. Just. Ask me again in a week.',
    },
    {
      when: 'flag:vial:ortiz',
      text: "Sam's fever broke last night. Willow bark. Luck. I'm not taking the credit.",
    },
    {
      when: 'unlock:cure',
      text: "Three doses a day, if Ray keeps the burner going. It isn't enough. It's something.",
    },
  ],
  ray: [
    {
      text: 'Your torch eats batteries. And they can see it from the next valley. Use it like a match, not a lamp.',
    },
    { text: "If it's got an engine I can fix it. If it's got teeth, that's your department." },
    {
      when: 'unlock:radio',
      text: "Raven calls every night at eleven. Same message. I've stopped writing it down.",
    },
    { when: 'unlock:workshop', text: 'Workbench is open. Bring cash, take planks.' },
  ],
  tom: [
    {
      text: 'The fast ones you hear before you see. The ones you never hear… only move when you look away.',
    },
    { text: 'A gunshot carries a long way at night. Every one is a dinner bell.' },
    { text: "If you hear screaming in the woods, it isn't a person. It's calling the others." },
    { when: 'done:gate', text: "You didn't run. Most do." },
  ],
  dot: [
    { text: "There's always something in the pot, dear. Don't ask what." },
    { text: 'You look thin. Everyone looks thin.' },
    {
      when: 'flag:dot_meals',
      text: "There's a bowl with your name on it. Literally — Sam wrote it on.",
    },
  ],
  sam: [
    {
      text: "Tom says red eyes are slow ones and yellow eyes are fast ones. I saw white ones once. Tom says I didn't.",
    },
    { text: 'Are you going outside? …Okay.' },
    { when: 'flag:mum:truth', text: 'I drew Mum. In the red coat. Do you want to see?' },
    {
      when: 'flag:mum:lie',
      text: "When it's spring, can you take me to the other camp? Mum'll be there.",
    },
    {
      when: 'flag:vial:ortiz',
      text: "My arm hurts. Lena says it's getting better. Lena says a lot of things.",
    },
  ],
  ortiz: [
    { text: 'Gate stays shut after you. Nothing personal.' },
    { text: "They don't come near the fires. Not yet." },
    {
      when: 'flag:vial:ortiz',
      text: "I'm told a kid went without so I could stand here. So I'm going to stand here very well.",
    },
    { when: 'done:tags', text: 'Kowalski. Brandt. Reyes. I say them at night. Somebody should.' },
  ],
  abel: [
    {
      text: 'I ring the bell for them at midnight. They gather. They listen. Then I stop, and they forget.',
    },
    { text: 'She is not in her grave, you know. None of them are, for long.' },
    {
      when: 'done:voss',
      text: "You opened Agnes' grave. I said the words over it again. It is getting to be a habit.",
    },
  ],
  nell: [
    {
      text: "Lena lets me help. I'm better with centrifuges than people, but people don't need calibrating.",
    },
    { text: 'Dan used to say the dead are honest. They want one thing and they tell you.' },
    { when: 'done:site7', text: 'You found him. …Thank you for not leaving him like that.' },
  ],
}

/** Something a person says now (a fitting line if any holds, else a plain one). */
export function smallTalk(
  npc: string,
  journal: Journal,
  unlocks: readonly string[],
  random: () => number,
): string {
  const lines = TALK[npc] ?? []
  const fitting = lines.filter((l) =>
    l.when?.split(',').every((c) => holds(c.trim(), journal, unlocks)),
  )
  const pool = fitting.length > 0 && random() < 0.75 ? fitting : lines.filter((l) => !l.when)
  const pick = pool[Math.floor(random() * pool.length)]
  return pick?.text ?? '…'
}

/** What a shop sells besides Gus' usual (by who, once the world has `unlock`). */
export const SHOPS: Record<string, { unlock: string; stock: [string, number][]; say: string }[]> = {
  gus: [
    {
      unlock: 'armoury',
      stock: [
        ['helmet', 0],
        ['militaryvest', 0],
        ['camopants', 0],
        ['militaryboots', 0],
        ['m4', 0],
        ['ammo556', 0],
      ],
      say: 'Army surplus, courtesy of Ortiz.',
    },
  ],
  ray: [
    {
      unlock: 'workshop',
      stock: [
        ['planks', 0],
        ['batteries', 0],
        ['gasoline', 0],
        ['bolts', 0],
        ['ducttape', 0],
        ['toolkit', 0],
        ['crowbar', 0],
        ['carbattery', 0],
        ['sparkplugs', 0],
        ['tyre', 0],
        ['radiatorhose', 0],
      ],
      say: 'Made it, fixed it or found it. Cash.',
    },
  ],
  lena: [
    {
      unlock: 'cure',
      stock: [
        ['cure', 900],
        ['adrenaline', 450],
      ],
      say: "It costs what the burner costs to run. Don't thank me.",
    },
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
  'adrenaline',
  'water',
  'coffee',
  'apple',
  'chocolate',
  'jerky',
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
  'knife',
  'bat',
  'crowbar',
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

/**
 * What Gus has only now and then, and dear: each dawn he either has one or he doesn't (chance),
 * at his own price. Once it's sold it's gone until he turns up another.
 */
export const RARE_STOCK: { item: string; chance: number; price: number }[] = [
  { item: 'cure', chance: 0.05, price: 4000 },
]

/** Rolls what rare things Gus has today: item → how many (one each, if any). */
export function rollRareStock(random: () => number): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of RARE_STOCK) if (random() < r.chance) out.set(r.item, 1)
  return out
}
