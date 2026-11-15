import {
  type CampSave,
  DEFAULT_WORLD_ID,
  type Retired,
  type Stored,
  type SurvivalSelf,
  type WeaponId,
} from '@office-fps/shared'

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
// Additive fields with defaults (e.g. SurvivalSelf.needs, filled in by restoreSelf) need no new
// version: older saves simply load without them.
export const SAVE_VERSION = 2

/** Upgrades one saved value from version `from` to `from + 1` (kind: 'character' | 'world'). */
export type Migration = (kind: SaveKind, data: Record<string, unknown>) => Record<string, unknown>
export const MIGRATIONS: Record<number, Migration> = {
  // 1 → 2: characters got a locker at Haven (empty to begin with).
  1: (kind, d) => (kind === 'character' ? { ...d, locker: d.locker ?? [] } : d),
}

export type SaveKind = 'character' | 'world' | 'account'

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
  /** What's in their locker at Haven: it belongs to the account, so dying doesn't empty it. */
  locker: Stored[]
  /** The world (worlds.ts) this was last saved in; missing = the original world. */
  world?: string
  /** The world they're playing in right now, if any (see Saves.claim). */
  live?: string
  /** When this was last saved (ms since 1970). */
  at?: number
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
  /** Characters who got out on the evacuation helicopter: they live at Haven now (evac.ts). */
  retired?: Retired[]
  /** Haven's record: days, Red Nights, morale, who left, graves (camp.ts). Absent in old saves. */
  camp?: CampSave
}

export const freshWorld = (epoch = 0): WorldSave => ({
  epoch,
  done: [],
  unlocks: [],
  found: [],
  gates: 0,
  boards: [],
})

/**
 * Where a world's save is kept: the original world keeps the old key ("world"), so the save from
 * before there were several worlds carries on there; the others are "world:<id>".
 */
export const worldKey = (worldId: string) =>
  worldId === DEFAULT_WORLD_ID ? 'world' : `world:${worldId}`
/** Characters belong to the account, not a world: the same key whichever world they play in. */
export const characterKey = (account: string) => `char:${account}`

/**
 * A character saved while playing in another world counts as still there for this long after
 * its last save (saves come every 2 minutes while playing; a crashed room's claim runs out).
 */
export const LIVE_MS = 5 * 60 * 1000

/**
 * What an account remembers whatever happens to its characters and worlds: a loose object in
 * which each feature keeps its own part (evac, legacy, notes, cosmetics…). Never versioned as a
 * whole: each feature reads its part defensively.
 */
export type AccountSave = Record<string, unknown>

const ACCOUNT_PREFIX = 'account:'
const accountKey = (account: string) => `${ACCOUNT_PREFIX}${account}`

/**
 * Saves behind a store: keeps the world and the characters it has loaded, and writes what
 * changed when asked to (flush). Characters are keyed by account (a hash of the browser's
 * secret token, see identity.ts), never by name.
 */
export class Saves {
  readonly store: SaveStore
  /** Which world (worlds.ts) this is: its own world save, everybody's characters. */
  readonly worldId: string
  world: WorldSave = freshWorld()
  private readonly characters = new Map<string, CharacterSave>()
  private readonly accounts = new Map<string, AccountSave>()
  /** Keys waiting to be written (the world key, char:… or account:…). */
  private readonly dirty = new Set<string>()
  private writing: Promise<void> = Promise.resolve()
  /** Accounts playing in this world right now (claim / release). */
  private readonly online = new Set<string>()
  private readonly worldKey: string

  constructor(
    store: SaveStore = new MemoryStore(),
    worldId: string = DEFAULT_WORLD_ID,
    private readonly now: () => number = Date.now,
  ) {
    this.store = store
    this.worldId = worldId
    this.worldKey = worldKey(worldId)
  }

  /** Reads the world (call once before anybody plays). */
  async loadWorld(): Promise<void> {
    const data = await this.read(this.worldKey, 'world')
    this.world = data ? { ...freshWorld(), ...(data as Partial<WorldSave>) } : freshWorld()
  }

  /**
   * Reads an account's character into memory (before they join). Read afresh each time unless
   * they're playing here: they may have played in another world since this one last saw them.
   */
  async loadCharacter(account: string): Promise<void> {
    if (this.online.has(account) || this.dirty.has(characterKey(account))) return
    await this.writing // our own last save of them lands first
    const data = await this.read(characterKey(account), 'character')
    if (data && !this.online.has(account)) this.characters.set(account, data as never)
  }

  /**
   * An account's character, if it has one (loaded with loadCharacter). One last saved in this
   * world must be from its current epoch (a world reset starts its people over); one from
   * another world walks in from the road, so it wakes at Haven rather than where it stood there.
   */
  character(account: string): CharacterSave | undefined {
    const save = this.characters.get(account)
    if (!save) return undefined
    if ((save.world ?? DEFAULT_WORLD_ID) !== this.worldId) {
      const { pos: _elsewhere, ...rest } = save
      return rest
    }
    return save.epoch === this.world.epoch ? save : undefined
  }

  /** True if the account's character is being played in another world right now. */
  busyElsewhere(account: string): boolean {
    const save = this.characters.get(account)
    if (!save?.live || save.live === this.worldId) return false
    return this.now() - (save.at ?? 0) < LIVE_MS
  }

  /** They're playing here now: their save says so (other worlds turn a second tab into a guest). */
  claim(account: string): void {
    this.online.add(account)
    const save = this.characters.get(account)
    if (!save) return // nobody yet: their first save says so
    this.characters.set(account, { ...save, live: this.worldId, at: this.now() })
    this.dirty.add(characterKey(account))
    void this.flush()
  }

  /** They've left: the next save (written as they leave) no longer says they're here. */
  release(account: string): void {
    this.online.delete(account)
    const save = this.characters.get(account)
    if (!save?.live) return
    const { live: _gone, ...rest } = save
    this.characters.set(account, rest)
    this.dirty.add(characterKey(account))
  }

  putCharacter(account: string, save: Omit<CharacterSave, 'epoch'>): void {
    const { live: _old, ...rest } = save
    this.characters.set(account, {
      ...rest,
      epoch: this.world.epoch,
      world: this.worldId,
      at: this.now(),
      ...(this.online.has(account) ? { live: this.worldId } : {}),
    })
    this.dirty.add(characterKey(account))
  }

  /** Forgets an account's character (an admin's "start over"): the next one is fresh. */
  forgetCharacter(account: string): void {
    this.characters.delete(account)
    this.dirty.delete(characterKey(account))
    void this.store.delete(characterKey(account))
  }

  /** Reads an account's own record into memory, if it isn't already (before they join). */
  async loadAccount(account: string): Promise<AccountSave> {
    const have = this.accounts.get(account)
    if (have) return have
    let data: AccountSave = {}
    try {
      const raw = await this.store.get(accountKey(account))
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) data = raw as AccountSave
    } catch (err) {
      console.warn(`[saves] reading ${accountKey(account)} failed:`, (err as Error).message)
    }
    // Somebody may have put to it while it was being read.
    const now = this.accounts.get(account)
    if (now) return now
    this.accounts.set(account, data)
    return data
  }

  /** An account's record (empty if it has none, or it wasn't loaded with loadAccount). */
  account(account: string): AccountSave {
    return this.accounts.get(account) ?? {}
  }

  /** Sets one feature's part of an account's record (written on the next flush). */
  putAccount(account: string, key: string, value: unknown): void {
    this.accounts.set(account, { ...this.account(account), [key]: value })
    this.dirty.add(accountKey(account))
  }

  putWorld(world: Omit<WorldSave, 'epoch'>): void {
    this.world = { ...world, epoch: this.world.epoch }
    this.dirty.add(this.worldKey)
  }

  /**
   * The world starts over: nothing done, nothing found, and every character from before is
   * gone (their saves belong to the old epoch and are ignored, then overwritten).
   */
  newWorld(): void {
    this.world = freshWorld(this.world.epoch + 1)
    this.characters.clear()
    // Accounts outlive worlds: their unwritten changes stay to be written.
    for (const key of this.dirty) if (!key.startsWith(ACCOUNT_PREFIX)) this.dirty.delete(key)
    this.dirty.add(this.worldKey)
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

  private envelope(key: string): Envelope | AccountSave | null {
    // Account records are stored as they are (no envelope: they outlive any schema version).
    if (key.startsWith(ACCOUNT_PREFIX)) {
      const data = this.accounts.get(key.slice(ACCOUNT_PREFIX.length))
      return data ? structuredClone(data) : null
    }
    const data = key === this.worldKey ? this.world : this.characters.get(key.slice(5))
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
