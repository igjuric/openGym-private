import { describe, it, expect } from 'vitest'
import { milestones, milestonesOf, nextMilestones, closestMilestone } from './milestones.js'

// A workout on a day, with entries [exerciseId, top weight, reps]; one set each.
let n = 0
const wo = (d, entries = [], extra = {}) => ({
  id: 'w' + (++n), d, start: new Date(d + 'T10:00:00').getTime(),
  entries: entries.map(([id, w, r = 5]) => ({ id, topW: w, sets: [{ w, r, done: true }] })),
  ...extra,
})
const ids = list => list.map(m => m.id)
// Mondays, a week apart, from 2026-01-05.
const monday = k => new Date(Date.UTC(2026, 0, 5 + 7 * k)).toISOString().slice(0, 10)

describe('milestones', () => {
  it('has none without workouts', () => {
    expect(milestones({ workouts: [] })).toEqual([])
    expect(milestones({})).toEqual([])
  })

  it('marks the first workout, the 10th and the 25th, each on the workout that reached it', () => {
    const workouts = Array.from({ length: 25 }, (_, i) => wo(monday(i * 2)))
    const got = milestones({ workouts }).filter(m => m.kind === 'count')
    expect(ids(got)).toEqual(['count-1', 'count-10', 'count-25'])
    expect(got[1].wid).toBe(workouts[9].id)
    expect(got[1].d).toBe(workouts[9].d)
  })

  it('counts in date order, whatever order the list is in', () => {
    const a = wo('2026-03-01'), b = wo('2026-02-01')
    expect(milestones({ workouts: [a, b] })[0].wid).toBe(b.id)
  })

  it('awards a plate milestone once, on the first workout at or past it', () => {
    const S = { unit: 'kg', workouts: [wo('2026-01-05', [['0025', 95]]), wo('2026-01-12', [['0025', 100]]), wo('2026-01-19', [['0025', 102.5]])] }
    const lifts = milestones(S).filter(m => m.kind === 'lift')
    expect(ids(lifts)).toEqual(['lift-bench-60kg', 'lift-bench-100kg'])
    expect(lifts[1].wid).toBe(S.workouts[1].id)
  })

  it('reads any of a lift\'s variants as that lift, and skips others', () => {
    const S = { unit: 'kg', workouts: [wo('2026-01-05', [['1436', 140], ['0047', 200]])] }
    expect(ids(milestones(S).filter(m => m.kind === 'lift'))).toEqual(['lift-squat-60kg', 'lift-squat-100kg', 'lift-squat-140kg'])
  })

  it('uses the round numbers of pounds for a lb profile', () => {
    const S = { unit: 'lb', workouts: [wo('2026-01-05', [['0032', 230]])] }
    expect(ids(milestones(S).filter(m => m.kind === 'lift'))).toEqual(['lift-deadlift-135lb', 'lift-deadlift-225lb'])
  })

  it('adds up the volume across workouts', () => {
    // 2000 kg × 5 reps = 10 000 kg over the two sessions
    const S = { unit: 'kg', workouts: [wo('2026-01-05', [['0025', 1000]]), wo('2026-01-12', [['0025', 1000]])] }
    const vol = milestones(S).filter(m => m.kind === 'volume')
    expect(ids(vol)).toEqual(['volume-10000kg'])
    expect(vol[0].wid).toBe(S.workouts[1].id)
  })

  it('counts weeks in a row, and a missed week starts over', () => {
    const run = k => Array.from({ length: k }, (_, i) => i)
    const S = { workouts: [...run(3).map(i => wo(monday(i))), ...run(4).map(i => wo(monday(5 + i)))] }
    const s = milestones(S).filter(m => m.kind === 'streak')
    expect(ids(s)).toEqual(['streak-4'])
    expect(s[0].wid).toBe(S.workouts[6].id)
  })

  it('counts two workouts in one week as one week', () => {
    const S = { workouts: [wo(monday(0)), wo(monday(0).replace(/05$/, '07')), wo(monday(1)), wo(monday(2))] }
    expect(milestones(S).some(m => m.kind === 'streak')).toBe(false)
  })

  it('names what one workout reached', () => {
    const S = { unit: 'kg', workouts: [wo('2026-01-05', [['0025', 50]]), wo('2026-01-12', [['0025', 60]])] }
    expect(ids(milestonesOf(S, S.workouts[1]))).toEqual(['lift-bench-60kg'])
    expect(ids(milestonesOf(S, S.workouts[0]))).toEqual(['count-1'])
    expect(milestonesOf(S, {})).toEqual([])
  })
})

describe('nextMilestones', () => {
  it('starts with the first workout to log', () => {
    expect(nextMilestones({ workouts: [] }, '2026-01-05')).toEqual([
      { id: 'count-1', kind: 'count', value: 1, have: 0 },
      { id: 'streak-4', kind: 'streak', value: 4, have: 0 },
      { id: 'volume-10000kg', kind: 'volume', value: 10000, have: 0 },
    ])
  })

  it('offers the next plate for each lift already logged', () => {
    const S = { unit: 'kg', workouts: [wo('2026-01-05', [['0025', 85]])] }
    const bench = nextMilestones(S, '2026-01-05').find(m => m.kind === 'lift')
    expect(bench).toEqual({ id: 'lift-bench-100kg', kind: 'lift', lift: 'bench', ex: '0025', value: 100, have: 85 })
  })

  it('keeps a streak alive through the week after, and drops it after a missed week', () => {
    const S = { workouts: [wo(monday(0)), wo(monday(1))] }
    expect(nextMilestones(S, monday(2)).find(m => m.kind === 'streak').have).toBe(2)
    expect(nextMilestones(S, monday(3)).find(m => m.kind === 'streak').have).toBe(0)
  })
})

describe('closestMilestone', () => {
  it('is nothing before any workout', () => {
    expect(closestMilestone({ workouts: [] }, '2026-01-05')).toBe(null)
  })

  it('picks the one with the largest share of the way covered', () => {
    // 85 of 100 kg on the bench beats 1 of 10 workouts and 1 of 4 weeks
    const S = { unit: 'kg', workouts: [wo('2026-01-05', [['0025', 85]])] }
    expect(closestMilestone(S, '2026-01-05')).toMatchObject({ id: 'lift-bench-100kg', have: 85 })
  })

  it('has a step between 100 t and 1,000 t, so a big total still moves', () => {
    const S = { unit: 'kg', workouts: [wo('2026-01-05', [['0032', 66200]])] }   // × 5 reps = 331 t
    expect(nextMilestones(S, '2026-01-05').find(m => m.kind === 'volume').value).toBe(500000)
  })
})
