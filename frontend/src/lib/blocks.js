// Training blocks: a few weeks with a shape, on top of the weekly plan you already have.
//
// The plan itself never changes. The same routines come up on the same days; a block only says,
// week by week, what today's targets are:
//   build     the plan as it is, the progression rules raising the weights as usual
//   strength  heavier and fewer reps: one set more, about 60% of the reps, 10% more weight
//   deload    light and easy: the same sets, half the reps, 60% of the weight
// The strength and deload weeks are kept out of progression (entry.noProg), so the working weight
// the build weeks reached is where the next block starts, and the next session never seeds from
// a light day (history.js lastEntryFor skips an entry that does not count).
//
// S.block is { kind, weeks, start, repeat } or null (no block: the plan repeats as it always has).
//   kind    'strength' (build, then strength, then a deload week) or 'deload' (the plan, then a
//           deload week)
//   weeks   the length, deload week included
//   start   the first day of the block's first week (format.js weekKey)
//   repeat  true: a new block starts when one ends. false: back to the plain plan.
import { weekKey, weekStartOf, todayISO } from './format.js'
import { isWarmupRow, isSideSet } from './workout-model.js'
import { modeOf } from './history.js'

export const BLOCK_KINDS = {
  strength: { lengths: [6, 8, 12], weeks: 8 },
  deload: { lengths: [4, 5, 6, 8], weeks: 6 },
}

export const PHASE = {
  strength: { sets: 1, reps: 0.6, weight: 1.1, minReps: 3 },
  deload: { sets: 0, reps: 0.5, weight: 0.6, minReps: 3 },
}

/** The phase of every week of a block, in order. */
export function blockWeeks(block) {
  const kind = BLOCK_KINDS[block?.kind] ? block.kind : null
  if (!kind) return []
  const n = Math.max(2, Math.min(16, Math.round(Number(block.weeks)) || BLOCK_KINDS[kind].weeks))
  if (kind === 'deload') return [...Array(n - 1).fill('build'), 'deload']
  const build = Math.ceil((n - 1) / 2)
  return [...Array(build).fill('build'), ...Array(n - 1 - build).fill('strength'), 'deload']
}

const dayNo = iso => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5)

/**
 * Where a day falls in the profile's block: { week (1-based), of, phase, round } or null when
 * there is no block, the day is before it, or a block that does not repeat is over.
 */
export function blockWeekOf(S, iso = todayISO()) {
  const block = S?.block
  const weeks = blockWeeks(block)
  if (!weeks.length || typeof block.start !== 'string' || typeof iso !== 'string') return null
  const ws = weekStartOf(S)
  const k = Math.round((dayNo(weekKey(iso, ws)) - dayNo(weekKey(block.start, ws))) / 7)
  if (k < 0) return null
  if (k >= weeks.length && !block.repeat) return null
  const i = k % weeks.length
  return { week: i + 1, of: weeks.length, phase: weeks[i], round: Math.floor(k / weeks.length) + 1 }
}

/** A new block that starts this week. */
export function newBlock(S, kind, weeks, repeat = true, iso = todayISO()) {
  return { kind, weeks, start: weekKey(iso, weekStartOf(S)), repeat: !!repeat }
}

const snap = (w, step, floor) => {
  if (!(w > 0)) return w
  const s = step > 0 ? step : 0
  const v = s ? Math.round(w / s) * s : w
  return Math.max(floor || 0, Number(v.toFixed(3)))
}

/**
 * One built session entry (session-start.js buildPlannedEntry) with a block week's targets.
 * A build week, an exercise logged by time, one without weight, and one whose rows are split per
 * side or carry drop sets come back as they were: the block only reshapes plain weight × reps.
 * The rows already ticked off are never touched.
 */
export function applyBlockPhase(entry, phase, { step = 0, floor = 0 } = {}) {
  const p = PHASE[phase]
  const cfg = entry?.target
  if (!p || !cfg || modeOf(cfg) !== 'reps' || !Array.isArray(entry.sets)) return entry
  const work = entry.sets.filter(s => !isWarmupRow(s))
  if (!work.length || entry.sets.some(s => s.done || isSideSet(s) || (Array.isArray(s.drops) && s.drops.length))) return entry
  if (!work.some(s => s.w > 0)) return entry
  const reps = r => (r > 0 ? Math.max(p.minReps, Math.round(r * p.reps)) : r)
  let sets = entry.sets.map(s => isWarmupRow(s)
    ? { ...s, w: snap(s.w * p.weight, step, floor) }
    : { ...s, w: snap(s.w * p.weight, step, floor), r: reps(s.r) })
  if (p.sets > 0) {
    const last = sets[sets.length - 1]
    sets = [...sets, ...Array(p.sets).fill(0).map(() => ({ ...last }))]
  }
  const target = { ...cfg }
  if (target.weight > 0) target.weight = snap(target.weight * p.weight, step, floor)
  if (target.reps > 0) target.reps = reps(target.reps)
  if (target.sets > 0) target.sets = target.sets + p.sets
  delete target.repsMin
  delete target.rowReps
  // No prescription to explain: the numbers are the block's, not the progression rule's.
  return { ...entry, sets, target, plan: null, noProg: true, block: phase }
}
