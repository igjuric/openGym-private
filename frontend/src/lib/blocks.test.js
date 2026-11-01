import { describe, it, expect } from 'vitest'
import { blockWeeks, blockWeekOf, newBlock, applyBlockPhase } from './blocks.js'
import { buildSessionEntries } from './session-start.js'

describe('blockWeeks', () => {
  it('builds, gets heavy, then deloads, over the length chosen', () => {
    expect(blockWeeks({ kind: 'strength', weeks: 8 })).toEqual(['build', 'build', 'build', 'build', 'strength', 'strength', 'strength', 'deload'])
    expect(blockWeeks({ kind: 'strength', weeks: 6 })).toEqual(['build', 'build', 'build', 'strength', 'strength', 'deload'])
  })

  it('a deload block is the plan, then one easy week', () => {
    expect(blockWeeks({ kind: 'deload', weeks: 5 })).toEqual(['build', 'build', 'build', 'build', 'deload'])
  })

  it('has no weeks without a block, or with one it does not know', () => {
    expect(blockWeeks(null)).toEqual([])
    expect(blockWeeks({ kind: 'nope', weeks: 4 })).toEqual([])
  })
})

describe('blockWeekOf', () => {
  // 2026-11-02 is a Monday.
  const S = { weekStart: 1, block: { kind: 'strength', weeks: 8, start: '2026-11-02', repeat: false } }

  it('counts weeks from the block\'s first week, whatever the weekday', () => {
    expect(blockWeekOf(S, '2026-11-02')).toEqual({ week: 1, of: 8, phase: 'build', round: 1 })
    expect(blockWeekOf(S, '2026-11-08')).toMatchObject({ week: 1 })
    expect(blockWeekOf(S, '2026-11-09')).toMatchObject({ week: 2 })
    expect(blockWeekOf(S, '2026-12-07')).toMatchObject({ week: 6, phase: 'strength' })
    expect(blockWeekOf(S, '2026-12-21')).toMatchObject({ week: 8, phase: 'deload' })
  })

  it('is nothing before the block, without one, and after one that does not repeat', () => {
    expect(blockWeekOf(S, '2026-10-30')).toBe(null)
    expect(blockWeekOf({}, '2026-11-02')).toBe(null)
    expect(blockWeekOf(S, '2026-12-28')).toBe(null)
  })

  it('starts the next round when it repeats', () => {
    const R = { ...S, block: { ...S.block, repeat: true } }
    expect(blockWeekOf(R, '2026-12-28')).toEqual({ week: 1, of: 8, phase: 'build', round: 2 })
  })

  it('follows a Sunday week start', () => {
    const Sun = { weekStart: 0, block: { kind: 'deload', weeks: 4, start: '2026-11-01', repeat: true } }
    expect(blockWeekOf(Sun, '2026-11-07')).toMatchObject({ week: 1 })
    expect(blockWeekOf(Sun, '2026-11-08')).toMatchObject({ week: 2 })
  })
})

describe('newBlock', () => {
  it('starts on the first day of this week', () => {
    expect(newBlock({ weekStart: 1 }, 'strength', 8, true, '2026-11-05')).toEqual({ kind: 'strength', weeks: 8, start: '2026-11-02', repeat: true })
  })
})

describe('applyBlockPhase', () => {
  const entry = () => ({
    id: '0025',
    target: { id: '0025', sets: 3, reps: 8, weight: 80 },
    plan: { kind: 'inc' },
    sets: [{ w: 40, r: 8, phase: 'warmup' }, { w: 80, r: 8 }, { w: 80, r: 8 }, { w: 80, r: 8 }],
  })

  it('a strength week: one set more, fewer reps, heavier, on the plates there are', () => {
    const out = applyBlockPhase(entry(), 'strength', { step: 2.5 })
    expect(out.sets.filter(s => s.phase !== 'warmup')).toEqual([{ w: 87.5, r: 5 }, { w: 87.5, r: 5 }, { w: 87.5, r: 5 }, { w: 87.5, r: 5 }])
    expect(out.target).toMatchObject({ sets: 4, reps: 5, weight: 87.5 })
    expect(out.noProg).toBe(true)
    expect(out.block).toBe('strength')
  })

  it('a deload week: the same sets, half the reps, 60% of the weight, never under the bar', () => {
    const out = applyBlockPhase(entry(), 'deload', { step: 2.5, floor: 20 })
    expect(out.sets).toEqual([{ w: 25, r: 8, phase: 'warmup' }, { w: 47.5, r: 4 }, { w: 47.5, r: 4 }, { w: 47.5, r: 4 }])
    expect(out.noProg).toBe(true)
  })

  it('takes the warm-ups down with the work sets', () => {
    const out = applyBlockPhase(entry(), 'deload', { step: 2.5 })
    expect(out.sets[0].w).toBeLessThan(out.sets[1].w)
  })

  it('leaves a build week, a timed exercise, a bodyweight one and a started one alone', () => {
    expect(applyBlockPhase(entry(), 'build')).toEqual(entry())
    const timed = { ...entry(), target: { id: 'x', mode: 'time', sec: 30 } }
    expect(applyBlockPhase(timed, 'deload')).toBe(timed)
    const bw = { ...entry(), sets: [{ w: 0, r: 10 }] }
    expect(applyBlockPhase(bw, 'deload')).toBe(bw)
    const started = { ...entry(), sets: [{ w: 80, r: 8, done: true }, { w: 80, r: 8 }] }
    expect(applyBlockPhase(started, 'deload')).toBe(started)
  })

  it('never makes fewer than 3 reps', () => {
    const e = { ...entry(), sets: [{ w: 100, r: 3 }], target: { id: '0025', sets: 1, reps: 3, weight: 100 } }
    expect(applyBlockPhase(e, 'deload', { step: 2.5 }).sets[0].r).toBe(3)
  })
})

describe('a session built in a block week', () => {
  const routine = { id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 8, weight: 80, prog: 'off' }] }
  const S = (block, extra = {}) => ({ unit: 'kg', weekStart: 1, workouts: [], routines: [routine], exWeights: {}, block, ...extra })

  it('is the plan in a build week', () => {
    const [e] = buildSessionEntries(S({ kind: 'strength', weeks: 8, start: '2026-11-02', repeat: true }), routine, '2026-11-03')
    expect(e.noProg).toBeUndefined()
    expect(e.block).toBeUndefined()
  })

  it('is light and kept out of progression in the deload week', () => {
    const [e] = buildSessionEntries(S({ kind: 'deload', weeks: 4, start: '2026-11-02', repeat: true }), routine, '2026-11-24')
    expect(e.block).toBe('deload')
    expect(e.noProg).toBe(true)
    expect(Math.max(...e.sets.map(s => s.w))).toBeLessThan(80)
  })

  it('leaves a routine already kept out of progression to its own numbers', () => {
    const rehab = { ...routine, excludeFromProgression: true }
    const [e] = buildSessionEntries(S({ kind: 'deload', weeks: 4, start: '2026-11-02', repeat: true }, { routines: [rehab] }), rehab, '2026-11-24')
    expect(e.block).toBeUndefined()
  })

  it('is the plan with no block at all', () => {
    const [e] = buildSessionEntries(S(null), routine, '2026-11-24')
    expect(e.block).toBeUndefined()
  })
})
