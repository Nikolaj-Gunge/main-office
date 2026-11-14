import type { SurvivalSelf, WeaponId } from '@office-fps/shared'

/**
 * Where saves live: a key → JSON value store. In memory for tests, JSON files for the Bun server
 * (file-store.ts), Durable Object storage on Cloudflare (apps/cloudflare/src/vault.ts).
 */
export interface SaveStore {
  get(key: string): Promise<unknown>
  put(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
}

/** Keeps everything in a Map (tests, or a server that shouldn't remember anything). */
export class MemoryStore implements SaveStore {
  readonly data = new Map<string, string>()

  async get(key: string): Promise<unknown> {
    const raw = this.data.get(key)
    return raw === undefined ? undefined : JSON.parse(raw)
  }

  async put(key: string, value: unknown): Promise<void> {
    this.data.set(key, JSON.stringify(value))
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key)
  }
}

// --- Schema ----------------------------------------------------------------------------------

/**
 * The saved schema's version. Raise it when the shape of CharacterSave or WorldSave changes and
 * add a step to MIGRATIONS that turns version N - 1 into N, so old saves still load.
 */
export const SAVE_VERSION = 1

/** Upgrades one saved value from version `from` to `from + 1` (kind: 'character' | 'world'). */
export type Migration = (kind: SaveKind, data: Record<string, unknown>) => Record<string, unknown>
export const MIGRATIONS: Record<number, Migration> = {}

export type SaveKind = 'character' | 'world'

/** How every save is stored: the schema version, and the data. */
interface Envelope {
  v: number
  data: Record<string, unknown>
}

/**
 * The data inside a stored envelope, brought up to `version`; null if it isn't a save, is from
 * a newer server than this one, or a step is missing.
 */
export function upgrade(
  raw: unknown,
  kind: SaveKind,
  migrations: Record<number, Migration> = MIGRATIONS,
  version: number = SAVE_VERSION,
): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null
  const env = raw as Partial<Envelope>
  if (typeof env.v !== 'number' || !env.data || typeof env.data !== 'object') return null
  if (env.v > version) return null
  let data = env.data
  for (let v = env.v; v < version; v++) {
    const step = migrations[v]
    if (!step) return null
    data = step(kind, data)
  }
  return data
}

/** One character: what they carry and how they are, where they stood, their journal. */
export interface CharacterSave {
  /** The world (WorldSave.epoch) they lived in: a world reset starts everybody over. */
  epoch: number
  name: string
  self: SurvivalSelf
  kit: { id: WeaponId; ammo: number }[]
  reborn: boolean
  /** Which of the cabin's starter things they haven't taken yet. */
  waiting: number[]
  health: number
  /** Where they logged off, if it was somewhere to come back to; otherwise they wake at Haven. */
  pos?: { x: number; y: number; z: number; yaw: number }
}

/** What the world remembers: the story's progress and what people did to the place. */
export interface WorldSave {
  /** Raised every time the world starts over (the story ends, or the admin starts anew). */
  epoch: number
  /** Quests somebody finished, and what they unlocked (radio, workshop, cure, Nell…). */
  done: string[]
  unlocks: string[]
  /** Places on everyone's map (Poi keys). */
  found: string[]
  /** Gates opened (bits by gate index). */
  gates: number
  /** Boarded-up gaps: [spot index, planks]. */
  boards: [number, number][]
}

export const freshWorld = (epoch = 0): WorldSave => ({
  epoch,
  done: [],
  unlocks: [],
  found: [],
  gates: 0,
  boards: [],
})

const WORLD_KEY = 'world'
const characterKey = (account: string) => `char:${account}`

/**
 * Saves behind a store: keeps the world and the characters it has loaded, and writes what
 * changed when asked to (flush). Characters are keyed by account (a hash of the browser's
 * secret token, see identity.ts), never by name.
 */
export class Saves {
  readonly store: SaveStore
  world: WorldSave = freshWorld()
  private readonly characters = new Map<string, CharacterSave>()
  /** Keys waiting to be written ('world' or char:…). */
  private readonly dirty = new Set<string>()
  private writing: Promise<void> = Promise.resolve()

  constructor(store: SaveStore = new MemoryStore()) {
    this.store = store
  }

  /** Reads the world (call once before anybody plays). */
  async loadWorld(): Promise<void> {
    const data = await this.read(WORLD_KEY, 'world')
    this.world = data ? { ...freshWorld(), ...(data as Partial<WorldSave>) } : freshWorld()
  }

  /** Reads an account's character into memory, if it isn't already (before they join). */
  async loadCharacter(account: string): Promise<void> {
    if (this.characters.has(account)) return
    const data = await this.read(characterKey(account), 'character')
    if (data && !this.characters.has(account)) this.characters.set(account, data as never)
  }

  /** An account's character in this world, if it has one (loaded with loadCharacter). */
  character(account: string): CharacterSave | undefined {
    const save = this.characters.get(account)
    return save && save.epoch === this.world.epoch ? save : undefined
  }

  putCharacter(account: string, save: Omit<CharacterSave, 'epoch'>): void {
    this.characters.set(account, { ...save, epoch: this.world.epoch })
    this.dirty.add(characterKey(account))
  }

  /** Forgets an account's character (an admin's "start over"): the next one is fresh. */
  forgetCharacter(account: string): void {
    this.characters.delete(account)
    this.dirty.delete(characterKey(account))
    void this.store.delete(characterKey(account))
  }

  putWorld(world: Omit<WorldSave, 'epoch'>): void {
    this.world = { ...world, epoch: this.world.epoch }
    this.dirty.add(WORLD_KEY)
  }

  /**
   * The world starts over: nothing done, nothing found, and every character from before is
   * gone (their saves belong to the old epoch and are ignored, then overwritten).
   */
  newWorld(): void {
    this.world = freshWorld(this.world.epoch + 1)
    this.characters.clear()
    this.dirty.clear()
    this.dirty.add(WORLD_KEY)
  }

  /** Writes everything that changed (one write at a time; resolves once it's all stored). */
  flush(): Promise<void> {
    const keys = [...this.dirty]
    this.dirty.clear()
    if (keys.length === 0) return this.writing
    const values = keys.map((key) => [key, this.envelope(key)] as const)
    this.writing = this.writing.then(async () => {
      for (const [key, value] of values) {
        try {
          if (value) await this.store.put(key, value)
        } catch (err) {
          console.warn(`[saves] writing ${key} failed:`, (err as Error).message)
        }
      }
    })
    return this.writing
  }

  private envelope(key: string): Envelope | null {
    const data = key === WORLD_KEY ? this.world : this.characters.get(key.slice(5))
    return data ? { v: SAVE_VERSION, data: structuredClone(data) as never } : null
  }

  private async read(key: string, kind: SaveKind): Promise<Record<string, unknown> | null> {
    try {
      return upgrade(await this.store.get(key), kind)
    } catch (err) {
      console.warn(`[saves] reading ${key} failed:`, (err as Error).message)
      return null
    }
  }
}
