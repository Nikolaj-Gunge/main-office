import { describe, expect, test } from 'bun:test'
import { bioDeathLine, bioLine, makeBio } from './characters.ts'

describe('character cards', () => {
  test('the same seed and build always make the same person', () => {
    for (const seed of [1, 42, 123456, 0x7fffffff]) {
      expect(makeBio(seed, 0)).toEqual(makeBio(seed, 0))
      expect(makeBio(seed, 1)).toEqual(makeBio(seed, 1))
    }
  })

  test('different seeds make different people', () => {
    const names = new Set<string>()
    for (let seed = 1; seed <= 200; seed++) names.add(bioLine(makeBio(seed, seed % 2)))
    expect(names.size).toBeGreaterThan(190)
  })

  test('a name, an age between 19 and 67, and where they came from', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const bio = makeBio(seed, seed % 2)
      expect(bio.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/)
      expect(bio.age).toBeGreaterThanOrEqual(19)
      expect(bio.age).toBeLessThanOrEqual(67)
      expect(bio.past).toMatch(/ from [A-Z]/)
      expect(bioLine(bio)).toBe(`${bio.name}, ${bio.age} — ${bio.past}`)
      // None of the story's own people.
      expect(bio.name).not.toMatch(/Voss|Hollis|Ashby|Quill|Petrakis|Marsh|Dunn|Pike|Ortiz/)
    }
  })

  test('the last line follows the build, or uses the name', () => {
    expect(bioDeathLine(makeBio(7, 1))).toBe('This is how she died.')
    expect(bioDeathLine(makeBio(7, 0))).toBe('This is how he died.')
    const odd = { ...makeBio(7, 0), body: 5 }
    expect(bioDeathLine(odd)).toBe(`This is how ${odd.name.split(' ')[0]} died.`)
  })
})
