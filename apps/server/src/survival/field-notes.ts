import {
  type CosmeticKind,
  cleanNotes,
  dressedLooks,
  type FieldNotes,
  type NoteEvent,
  type Notice,
  recordNote,
  rollWeek,
  type SurvivalSelf,
  wearCosmetic,
} from '@office-fps/shared'
import type { Saves } from '../saves.ts'

/** The account record's key for Field Notes and the journal (saves.ts AccountSave). */
export const NOTES_KEY = 'notes'

/** What the keeper needs of a survivor. */
export interface NotesSurvivor {
  player: { id: number; account?: string | null }
  self: SurvivalSelf
  dirty: boolean
}

export interface NotesHost {
  /** The game's saves (asked each time: the game swaps them in when it loads). */
  saves(): Saves
  notice(sv: NotesSurvivor, kind: Notice['kind'], text: string): void
  /** Wall-clock time (ms): which week it is. */
  now?(): number
}

/**
 * Field Notes and the Survival Journal on the server (see field-notes.ts in shared): counts what
 * people do, ticks off the week's notes, hands out cosmetics and achievements, and keeps it all
 * in the account record so it outlives the character. Guests keep theirs until they leave.
 */
export class FieldNotesKeeper {
  private readonly host: NotesHost
  private readonly notes = new Map<number, FieldNotes>()

  constructor(host: NotesHost) {
    this.host = host
  }

  private now(): number {
    return this.host.now?.() ?? Date.now()
  }

  /** Their record: read from the account on first sight (loadAccount ran before they joined). */
  of(sv: NotesSurvivor): FieldNotes {
    let notes = this.notes.get(sv.player.id)
    if (!notes) {
      const account = sv.player.account
      const raw = account ? this.host.saves().account(account)[NOTES_KEY] : undefined
      notes = cleanNotes(raw, this.now())
      this.notes.set(sv.player.id, notes)
    }
    return notes
  }

  /** Makes sure what's sent to them carries their record (a new character starts without). */
  attach(sv: NotesSurvivor): void {
    const notes = this.of(sv)
    if (sv.self.notes !== notes) {
      sv.self.notes = notes
      sv.dirty = true
    }
    if (rollWeek(notes, this.now())) {
      sv.dirty = true
      this.keep(sv)
    }
  }

  /** Something happened: counted, and whatever it finished is told. */
  record(sv: NotesSurvivor, event: NoteEvent, n = 1): void {
    const notes = this.of(sv)
    const done = recordNote(notes, event, n, this.now())
    this.attach(sv)
    sv.dirty = true
    for (const note of done.notes)
      this.host.notice(sv, 'quest', `Field note done: ${note.text}. + ${note.reward.name}`)
    for (const a of done.achievements)
      this.host.notice(sv, 'quest', `Journal: ${a.title}. ${a.story}`)
    // Driving counts every second: written with everybody else's save, not each time.
    this.keep(sv, done.notes.length + done.achievements.length > 0)
  }

  /** Puts on or takes off a cosmetic they own. */
  wear(sv: NotesSurvivor, kind: CosmeticKind, id: string | null): boolean {
    const ok = wearCosmetic(this.of(sv), kind, id)
    if (ok) {
      sv.dirty = true
      this.attach(sv)
      this.keep(sv, true)
    }
    return ok
  }

  /** What they look like with their cosmetics on (gear.ts packing). */
  looks(sv: NotesSurvivor, gear: number): number {
    return dressedLooks(gear, this.notes.get(sv.player.id)?.wear)
  }

  /** Into the account record (written on the next flush; now, with `flush`). */
  keep(sv: NotesSurvivor, flush = false): void {
    const account = sv.player.account
    const notes = this.notes.get(sv.player.id)
    if (!account || !notes) return
    this.host.saves().putAccount(account, NOTES_KEY, structuredClone(notes))
    if (flush) void this.host.saves().flush()
  }

  /** They left: saved, and forgotten here. */
  forget(sv: NotesSurvivor): void {
    this.keep(sv)
    this.notes.delete(sv.player.id)
  }
}
