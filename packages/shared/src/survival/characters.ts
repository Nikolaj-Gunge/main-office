import { seeded } from './noise.ts'

/**
 * Who a new character was before (ROADMAP 2.2): a name, an age and a past life, rolled from a
 * seed when the character starts (first join, or after dying or turning) and kept in their save.
 * The player's typed name stays their player name; this is the person they play this time.
 */
export interface Bio {
  /** What it was rolled from (the client shows the card once per seed). */
  seed: number
  name: string
  age: number
  /** "postal worker from Ashford". */
  past: string
  /** Build chosen in the creator (appearance.ts): 0 masculine, 1 feminine; picks the pronoun. */
  body: number
}

const FIRST: readonly (readonly string[])[] = [
  [
    'Walt',
    'Carl',
    'Dennis',
    'Frank',
    'Lou',
    'Marty',
    'Owen',
    'Pete',
    'Russ',
    'Stan',
    'Wade',
    'Eli',
    'Hank',
    'Jesse',
    'Joel',
    'Lyle',
    'Neil',
    'Roy',
    'Theo',
    'Vince',
  ],
  [
    'Ellen',
    'Ada',
    'Carol',
    'Doris',
    'Faye',
    'Grace',
    'Irene',
    'June',
    'Kate',
    'Lorna',
    'Maggie',
    'Nora',
    'Pam',
    'Rita',
    'Ruth',
    'Sue',
    'Tess',
    'Vera',
    'Wendy',
    'Jo',
  ],
]

// None of the names the story already uses (Hollis, Voss, Ashby…).
const LAST = [
  'Brandt',
  'Calloway',
  'Decker',
  'Ewing',
  'Farrow',
  'Garner',
  'Haskell',
  'Ingram',
  'Kessler',
  'Lund',
  'Novak',
  'Orr',
  'Pruitt',
  'Quinlan',
  'Rourke',
  'Sutter',
  'Tolliver',
  'Varga',
  'Whitlock',
  'Yates',
  'Ambrose',
  'Birch',
  'Crane',
] as const

const JOBS = [
  'postal worker',
  'school bus driver',
  'night nurse',
  'dental hygienist',
  'line cook',
  'tow truck driver',
  'insurance clerk',
  'forestry worker',
  'high-school chemistry teacher',
  'church organist',
  'pharmacy assistant',
  'hardware store owner',
  'trucker',
  'motel night clerk',
  'retired machinist',
  'veterinarian',
  'county surveyor',
  'logger',
  'bartender',
  'librarian',
  'paramedic',
  'dairy farmer',
  'car salesman',
  'sawmill foreman',
] as const

const TOWNS = [
  'Ashford',
  'Millbrook',
  'Cedar Falls',
  'Harlow',
  'Pine Hollow',
  'Redcliff',
  'Stillwater',
  'Brennan',
  'Fairmont',
  'Gorse Hill',
  'Kettle Creek',
  'Lowell',
] as const

const pick = <T>(list: readonly T[], r: () => number): T =>
  list[Math.floor(r() * list.length) % list.length] as T

/** The person behind a seed (the same seed and build always give the same person). */
export function makeBio(seed: number, body: number): Bio {
  const r = seeded(seed >>> 0 || 1)
  const build = body === 1 ? 1 : 0
  const name = `${pick(FIRST[build] as readonly string[], r)} ${pick(LAST, r)}`
  const age = 19 + Math.floor(r() * 49)
  const job = pick(JOBS, r)
  const town = pick(TOWNS, r)
  return { seed: seed >>> 0, name, age, past: `${job} from ${town}`, body: build }
}

/** "Ellen Brandt, 41 — postal worker from Ashford". */
export function bioLine(bio: Bio): string {
  return `${bio.name}, ${bio.age} — ${bio.past}`
}

/** The card's last line: "This is how she died." (by name if the build isn't one of the two). */
export function bioDeathLine(bio: Bio): string {
  const who = bio.body === 1 ? 'she' : bio.body === 0 ? 'he' : (bio.name.split(' ')[0] ?? bio.name)
  return `This is how ${who} died.`
}
