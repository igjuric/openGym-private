import { describe, it, expect } from 'vitest'
import { isLastDayOfWeek, weekSummary, summaryText } from './weekly-summary.js'
import { buildSummaryNotification } from './mobile.js'

// One workout on a day, logged with a saved volume and a list of records.
const wo = (d, vol = 1000, prs = []) => ({ id: d, d, start: new Date(d + 'T10:00:00').getTime(), vol, prs })
const tr = {
  t: (s, ...a) => a.reduce((v, x, i) => v.replaceAll('{' + i + '}', x), s),
  tn: (one, other, n) => (n === 1 ? one : other).replaceAll('{0}', n),
  num: n => String(n),
}

describe('isLastDayOfWeek', () => {
  // 2026-11-01 is a Sunday, 2026-10-31 a Saturday.
  it('is Sunday for a Monday week and Saturday for a Sunday week', () => {
    expect(isLastDayOfWeek({ weekStart: 1 }, '2026-11-01')).toBe(true)
    expect(isLastDayOfWeek({ weekStart: 1 }, '2026-10-31')).toBe(false)
    expect(isLastDayOfWeek({ weekStart: 0 }, '2026-10-31')).toBe(true)
    expect(isLastDayOfWeek({}, '2026-11-01')).toBe(true)
  })
})

describe('weekSummary', () => {
  const S = { weekStart: 1, workouts: [wo('2026-10-25', 999, ['x']), wo('2026-10-26', 1200, ['0025']), wo('2026-10-28', 800), wo('2026-11-01', 1000, ['a', 'b'])] }

  it('counts the workouts, volume and records of the week the day is in', () => {
    expect(weekSummary(S, '2026-11-01')).toEqual({ workouts: 3, volume: 3000, prs: 3, block: null })
  })

  it('leaves out the week before', () => {
    expect(weekSummary(S, '2026-10-25')).toEqual({ workouts: 1, volume: 999, prs: 1, block: null })
  })

  it('says where a training block stands', () => {
    const B = { ...S, block: { kind: 'strength', weeks: 8, start: '2026-09-14', repeat: true } }
    expect(weekSummary(B, '2026-11-01').block).toEqual({ week: 7, of: 8 })
  })
})

describe('summaryText', () => {
  it('lists what the week had', () => {
    expect(summaryText({ workouts: 3, volume: 12400, prs: 2, block: { week: 6, of: 8 } }, 'kg', tr))
      .toEqual({ title: 'Your week', body: '3 workouts · 12400 kg lifted · 2 PRs · Week 6 of 8' })
  })

  it('leaves out what is zero, and uses the singular for one', () => {
    expect(summaryText({ workouts: 1, volume: 0, prs: 0, block: null }, 'lb', tr).body).toBe('1 workout')
  })

  it('still says something about a week with no workouts', () => {
    expect(summaryText({ workouts: 0, volume: 0, prs: 0, block: null }, 'kg', tr).body).toBe('No workouts this week. A new week starts tomorrow.')
  })
})

describe('buildSummaryNotification', () => {
  const S = { weekStart: 1, unit: 'kg', reminder: { on: true, summary: true }, workouts: [wo('2026-10-27', 500)] }

  it('goes off at 19:00 on the next last day of the week', () => {
    const [n] = buildSummaryNotification(S, new Date(2026, 9, 28, 9, 0))   // a Wednesday morning
    expect(n.schedule.at).toEqual(new Date(2026, 10, 1, 19, 0))
    expect(n.body).toContain('1')
  })

  it('moves to the next week once this week\'s has gone', () => {
    const [n] = buildSummaryNotification(S, new Date(2026, 10, 1, 20, 0))
    expect(n.schedule.at).toEqual(new Date(2026, 10, 8, 19, 0))
  })

  it('is not scheduled when it, or the reminder, is off', () => {
    expect(buildSummaryNotification({ ...S, reminder: { on: true } })).toEqual([])
    expect(buildSummaryNotification({ ...S, reminder: { on: false, summary: true } })).toEqual([])
  })
})
