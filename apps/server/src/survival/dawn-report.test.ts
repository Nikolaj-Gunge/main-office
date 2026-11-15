import { describe, expect, test } from 'bun:test'
import { composeDawnReport, emptyNight, type NightLog } from '@office-fps/shared'
import { DawnDesk } from './dawn-report.ts'

const night = (over: Partial<NightLog>): NightLog => ({ ...emptyNight(), ...over })

describe('Dawn Report', () => {
  test('a bad night: the dead, who got out, the dead put down and by whom', () => {
    const r = composeDawnReport(
      night({
        deaths: [
          { name: 'Ellen Voss', cause: 'Turned', turned: true },
          { name: 'Mark Hale', cause: 'Taken by the dead', turned: false },
          { name: 'June Park', cause: 'Bled out', turned: false },
        ],
        out: ['Ruth Ames'],
        putDown: 41,
        kills: { 'Jonah Pike': 12, 'Ruth Ames': 3 },
        turnedDown: [{ name: 'Ellen Voss', by: 'Jonah Pike' }],
        present: ['Ellen Voss', 'Mark Hale', 'June Park', 'Ruth Ames', 'Jonah Pike'],
      }),
      { world: 'Deadwood 2', night: 23, mood: 'fog' },
    )
    expect(r.title).toBe('Deadwood 2 · Night 23')
    expect(r.share).toBe('Deadwood 2 · Night 23 🌲🌫\n🟥🟥🟥🟩\n3 lost, 1 got out, 41 dead put down')
    const page = r.lines.join('\n')
    expect(page).toContain('Fog all night.')
    expect(page).toContain("3 of us didn't see the sun:")
    expect(page).toContain('Ellen Voss: turned.')
    expect(page).toContain('Got out on the helicopter: Ruth Ames.')
    expect(page).toContain('Jonah Pike put down what was left of Ellen Voss.')
    expect(page).toContain('41 of the dead put down, 12 of them by Jonah Pike.')
    // The paste-anywhere line spoils nobody.
    expect(r.share).not.toContain('Ellen')
  })

  test('a quiet night: nobody died, no squares', () => {
    const r = composeDawnReport(night({ putDown: 2, kills: { Ann: 1, Bo: 1 }, present: ['Ann'] }), {
      world: 'Deadwood 1',
      night: 1,
    })
    expect(r.share).toBe('Deadwood 1 · Night 1 🌲🧟\n0 lost, 2 dead put down')
    expect(r.lines).toContain('Nobody died. Write that down somewhere.')
    expect(r.lines).toContain('2 of the dead put down.')
    expect(r.lines).toContain('Ann was out there alone.')
  })

  test('the strip stops at ten squares', () => {
    const deaths = Array.from({ length: 14 }, (_, i) => ({
      name: `P${i}`,
      cause: 'Starved',
      turned: false,
    }))
    const r = composeDawnReport(night({ deaths, out: ['X'] }), { world: 'Deadwood', night: 4 })
    expect(r.share.split('\n')[1]).toBe('🟥'.repeat(10))
    expect(r.lines).toContain('  …and 6 more.')
  })

  test('the desk: nights counted, empty nights unwritten, the board shows it once', () => {
    const desk = new DawnDesk()
    expect(desk.night).toBe(1)
    expect(desk.dawn('Deadwood 1', null)).toBeNull()
    expect(desk.night).toBe(2)
    desk.seen('Ann')
    desk.seen('Ann')
    desk.putDown('Ann')
    desk.died('Bo', 'Starved', false)
    const r = desk.dawn('Deadwood 1', 'calm')
    expect(r?.title).toBe('Deadwood 1 · Night 2')
    expect(r?.lines).toContain('Ann was out there alone.')
    expect(desk.unread(7)).toBe(r)
    expect(desk.unread(7)).toBeNull()
    desk.markRead(8)
    expect(desk.unread(8)).toBeNull()
    // Saved and back: the count and the pinned report.
    const again = new DawnDesk()
    again.restore(desk.nights, JSON.parse(JSON.stringify(desk.report)))
    expect(again.night).toBe(3)
    expect(again.report).toEqual(r)
    again.restore(undefined, 'junk')
    expect(again.night).toBe(1)
    expect(again.report).toBeNull()
  })
})
