// Milestones: the moments worth marking in a training history. The first workout and the 100th,
// a 100 kg bench press, 100 tonnes lifted, a year without missing a week.
//
// Read straight from the logged workouts every time, never stored. A backup, a sync, an edited
// or deleted workout can never leave one behind or award it twice, and the profile document
// (and the sync merge that has to know every field of it) gains nothing.
//
// A milestone is { id, kind, value, d, wid } plus `lift` and `ex` for a lift: `d` and `wid` name
// the workout that crossed it. Weights are in the profile's unit, as the workouts store them,
// and each unit has its own round numbers (the plates of a barbell: 60, 100, 140 kg or 135, 225,
// 315 lb), so a lb lifter is not congratulated on 220.46 lb.
import { workoutAt, sessionVolume } from './history.js'
import { weekKey, weekStartOf, todayISO } from './format.js'

export const COUNTS = [1, 10, 25, 50, 100, 250, 500, 1000]
export const STREAKS = [4, 12, 26, 52]
// Steps close enough together that the bar keeps moving: 331 t lifted is a third of the way to
// 1,000 t, but two thirds of the way to 500 t.
export const VOLUMES = { kg: [10000, 50000, 100000, 250000, 500000, 1000000], lb: [25000, 100000, 250000, 500000, 1000000, 2500000] }
export const PLATES = { kg: [60, 100, 140, 180, 220], lb: [135, 225, 315, 405, 495] }

// The big four, by the catalogue entries people log them as. The first id of each names the lift.
export const LIFTS = {
  squat: ['0043', '1436', '3593'],
  bench: ['0025'],
  deadlift: ['0032'],
  press: ['1162', '0091', '1456', '1457'],
}
const LIFT_OF = Object.fromEntries(Object.entries(LIFTS).flatMap(([lift, ids]) => ids.map(id => [id, lift])))

const unitOf = S => (S?.unit === 'lb' ? 'lb' : 'kg')
// Consecutive weeks have keys 7 days apart; dividing by 7 numbers them.
const weekNo = key => Math.round(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) / 864e5 / 7)

function replay(S) {
  const unit = unitOf(S)
  const ws = weekStartOf(S)
  const list = (Array.isArray(S?.workouts) ? S.workouts : [])
    .filter(w => w && typeof w.d === 'string')
    .map((w, i) => ({ w, i, at: workoutAt(w) }))
    .sort((a, b) => (a.at || 0) - (b.at || 0) || a.i - b.i)
    .map(x => x.w)
  const earned = []
  const seen = new Set()
  const add = (m, w) => {
    if (seen.has(m.id)) return
    seen.add(m.id)
    earned.push({ ...m, d: w.d, wid: w.id ?? null })
  }
  let count = 0, volume = 0, streak = 0, lastWeek = null
  const best = {}
  for (const w of list) {
    count++
    if (COUNTS.includes(count)) add({ id: 'count-' + count, kind: 'count', value: count }, w)

    const before = volume
    volume += sessionVolume(w, S)
    for (const v of VOLUMES[unit]) if (before < v && volume >= v) add({ id: 'volume-' + v + unit, kind: 'volume', value: v }, w)

    const wk = weekNo(weekKey(w.d, ws))
    if (wk !== lastWeek) {
      streak = lastWeek != null && wk === lastWeek + 1 ? streak + 1 : 1
      lastWeek = wk
      if (STREAKS.includes(streak)) add({ id: 'streak-' + streak, kind: 'streak', value: streak }, w)
    }

    for (const e of w.entries || []) {
      const lift = LIFT_OF[e?.id]
      const top = Number(e?.topW) || 0
      if (!lift || top <= 0) continue
      const had = best[lift] || 0
      for (const p of PLATES[unit]) if (had < p && top >= p) add({ id: 'lift-' + lift + '-' + p + unit, kind: 'lift', lift, ex: e.id, value: p }, w)
      if (top > had) best[lift] = top
    }
  }
  return { earned, count, volume, streak, lastWeek, best, unit, ws }
}

/** Every milestone reached so far, oldest first. */
export const milestones = S => replay(S).earned

/** The milestones one workout reached: the finish summary's "New milestone". */
export const milestonesOf = (S, w) => (w?.id == null ? [] : milestones(S).filter(m => m.wid === w.id))

/**
 * The next one of each kind, with how far along it is: { id, kind, value, have, lift? }.
 * A streak only counts while it is alive, so this week or last week has a workout in it.
 */
export function nextMilestones(S, today = todayISO()) {
  const r = replay(S)
  const out = []
  const nextOf = (list, have) => list.find(v => v > have)
  const c = nextOf(COUNTS, r.count)
  if (c) out.push({ id: 'count-' + c, kind: 'count', value: c, have: r.count })
  const thisWeek = weekNo(weekKey(today, r.ws))
  const alive = r.lastWeek != null && thisWeek - r.lastWeek <= 1 ? r.streak : 0
  const s = nextOf(STREAKS, alive)
  if (s) out.push({ id: 'streak-' + s, kind: 'streak', value: s, have: alive })
  const v = nextOf(VOLUMES[r.unit], r.volume)
  if (v) out.push({ id: 'volume-' + v + r.unit, kind: 'volume', value: v, have: r.volume })
  for (const lift of Object.keys(LIFTS)) {
    const have = r.best[lift] || 0
    const p = have > 0 && nextOf(PLATES[r.unit], have)
    if (p) out.push({ id: 'lift-' + lift + '-' + p + r.unit, kind: 'lift', lift, ex: LIFTS[lift][0], value: p, have })
  }
  return out
}

/** The next milestone closest to done, by the share of the way already covered; null before any. */
export function closestMilestone(S, today = todayISO()) {
  const next = nextMilestones(S, today).filter(m => m.have > 0)
  return next.length ? next.reduce((a, b) => (b.have / b.value > a.have / a.value ? b : a)) : null
}
