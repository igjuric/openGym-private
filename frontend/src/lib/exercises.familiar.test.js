import { describe, it, expect } from 'vitest'
import { EXDB, familiarFirst } from './exercises.js'

// The opening list of the Library and the picker: the lifts people know first, not the drills
// that happen to start with a digit.
describe('familiarFirst', () => {
  const ordered = familiarFirst(EXDB)

  it('keeps every exercise exactly once', () => {
    expect(ordered).toHaveLength(EXDB.length)
    expect(new Set(ordered.map(e => e.id)).size).toBe(EXDB.length)
  })

  it('opens on strength work with common kit, not stretches or numbered drills', () => {
    const top = ordered.slice(0, 40)
    expect(top.every(e => ['strength', 'calisthenics', 'olympic'].includes(e.cat))).toBe(true)
    expect(top.some(e => /^\d/.test(e.n))).toBe(false)
  })

  it('keeps the incoming order among equals', () => {
    const a = EXDB.find(e => e.cat === 'stretching')
    const b = EXDB.find(e => e.cat === 'stretching' && e.eq === a.eq && e !== a)
    const out = familiarFirst([b, a])
    expect(out).toEqual([b, a])
  })

  it('leaves your own exercises in front', () => {
    const mine = { id: 'c1', n: 'zz my lift', custom: true, bp: 'back', eq: '' }
    const out = familiarFirst([mine, ...EXDB.slice(0, 50)])
    expect(out[0]).toBe(mine)
  })

  it('does not change the list it was given', () => {
    const list = EXDB.slice(0, 20)
    const copy = [...list]
    familiarFirst(list)
    expect(list).toEqual(copy)
  })
})
