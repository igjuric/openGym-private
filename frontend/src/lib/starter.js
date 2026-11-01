// The starter-plan catalog. Training data only: the chooser's plan names and descriptions are
// written as string literals inside t() calls in sheets.jsx, because check-source-strings.mjs
// only finds them there — copy parked in here would silently ship English in every language.
//
// A routine is [key, name, emoji, [[exerciseId, sets, reps], …]]. The key is what a plan's
// schedule points at, so a weekday never depends on the position of a routine in the array.
// Names stay canonical English — they become ordinary user routines, which are not translated.
import { uid } from './format.js'
import { EXIDX } from './exercises.js'
import { eqAvailable, ALL_EQUIPMENT } from './equipment.js'

const PPL = [
  ['push', 'Push Day', 'barbell', [['0025', 4, 8], ['0047', 3, 10], ['0426', 3, 10], ['0334', 3, 12], ['0241', 3, 12], ['0251', 3, 10]]],
  ['pull', 'Pull Day', 'pullup', [['2330', 4, 10], ['0027', 4, 8], ['1323', 3, 10], ['0031', 3, 10], ['0313', 3, 12]]],
  ['legs', 'Leg Day', 'legs', [['0043', 4, 8], ['0085', 3, 10], ['0739', 3, 12], ['0585', 3, 12], ['0586', 3, 12], ['0605', 4, 15]]]
]

const UPPER_LOWER = [
  ['upper-a', 'Upper A', 'barbell', [['0025', 3, 8], ['2330', 3, 10], ['0047', 2, 10], ['1323', 2, 10], ['0334', 2, 12], ['0241', 2, 12], ['0031', 2, 12]]],
  ['lower-a', 'Lower A', 'legs', [['0043', 3, 8], ['0085', 3, 8], ['0739', 2, 10], ['0586', 2, 12], ['0605', 3, 15]]],
  ['upper-b', 'Upper B', 'barbell', [['0047', 3, 8], ['0027', 3, 8], ['0426', 2, 10], ['2330', 2, 10], ['0334', 2, 12], ['0241', 2, 12], ['0313', 2, 12]]],
  ['lower-b', 'Lower B', 'legs', [['0739', 3, 10], ['0085', 2, 10], ['0585', 2, 12], ['0586', 3, 12], ['0605', 3, 15]]]
]

const FULL_BODY = [
  ['fb-a', 'Full Body A', 'figureStrength', [['0043', 3, 8], ['0025', 3, 8], ['2330', 3, 10], ['0586', 3, 12], ['0334', 2, 12], ['0031', 2, 12]]],
  ['fb-b', 'Full Body B', 'figureStrength', [['0085', 3, 8], ['0047', 3, 10], ['1323', 3, 10], ['0585', 3, 12], ['0334', 2, 12], ['0241', 2, 12]]],
  ['fb-c', 'Full Body C', 'figureStrength', [['0739', 3, 10], ['0025', 2, 10], ['0027', 3, 10], ['0426', 2, 10], ['0586', 3, 12], ['0605', 3, 15]]]
]

const FIVE_BY_FIVE = [
  ['5x5-a', '5×5 A', 'barbell', [['0043', 5, 5], ['0025', 5, 5], ['0027', 5, 5]]],
  ['5x5-b', '5×5 B', 'barbell', [['0085', 5, 5], ['0426', 5, 5], ['2330', 5, 5]]],
  ['5x5-c', '5×5 C', 'barbell', [['0739', 5, 5], ['0047', 5, 5], ['1323', 5, 5]]]
]

// The main barbell lifts, the A/B way: squat every session, the rest taking turns.
const BEGINNER_AB = [
  ['ab-a', 'Beginner A', 'barbell', [['0043', 3, 5], ['0025', 3, 5], ['0027', 3, 8]]],
  ['ab-b', 'Beginner B', 'barbell', [['0043', 3, 5], ['1162', 3, 5], ['0032', 2, 5], ['2330', 3, 8]]]
]

// Two sessions that cover everything, for a week with little time in it.
const TWO_DAY = [
  ['2d-a', 'Full Body 1', 'figureStrength', [['0043', 3, 8], ['0025', 3, 8], ['0027', 3, 10], ['0334', 2, 12], ['0294', 2, 12]]],
  ['2d-b', 'Full Body 2', 'figureStrength', [['0085', 3, 8], ['0426', 3, 10], ['2330', 3, 10], ['0739', 2, 12], ['0241', 2, 12]]]
]

// A pair of dumbbells and the floor: nothing a home gym is unlikely to have.
const DUMBBELL_HOME = [
  ['db-a', 'Dumbbells A', 'dumbbell', [['1760', 3, 10], ['0289', 3, 10], ['0292', 3, 10], ['0334', 2, 12], ['0294', 2, 12]]],
  ['db-b', 'Dumbbells B', 'dumbbell', [['1459', 3, 10], ['0405', 3, 10], ['0381', 3, 10], ['0662', 3, 12], ['0313', 2, 12], ['0351', 2, 12]]]
]

// One main lift a day, heavy, with the work that helps it.
const STRENGTH_4 = [
  ['st-sq', 'Squat Day', 'legs', [['0043', 5, 5], ['0085', 3, 8], ['0739', 3, 10], ['0605', 3, 12]]],
  ['st-bp', 'Bench Day', 'barbell', [['0025', 5, 5], ['0027', 4, 8], ['0314', 3, 10], ['0241', 3, 12]]],
  ['st-dl', 'Deadlift Day', 'barbell', [['0032', 3, 5], ['0042', 3, 6], ['0586', 3, 10], ['2330', 3, 10]]],
  ['st-oh', 'Press Day', 'barbell', [['1162', 5, 5], ['0652', 4, 6], ['0289', 3, 10], ['0031', 3, 10]]]
]

// [weekday, routineKey] — weekday is a DAYN index, so 1 is Monday. Fixed weeks only: every
// plan repeats the same seven days, which is all the weekly plan model can represent.
// level and goal sort and label the chooser; block is the training block (lib/blocks.js) the
// chooser offers to start with the plan.
const DELOAD_6 = { kind: 'deload', weeks: 6 }
const PLANS = {
  'beginner-ab': { level: 'beginner', goal: 'strength', block: DELOAD_6, routines: BEGINNER_AB, schedule: [[1, 'ab-a'], [3, 'ab-b'], [5, 'ab-a']] },
  'full-body': { level: 'beginner', goal: 'general', block: DELOAD_6, routines: FULL_BODY, schedule: [[1, 'fb-a'], [3, 'fb-b'], [5, 'fb-c']] },
  'two-day': { level: 'beginner', goal: 'general', block: DELOAD_6, routines: TWO_DAY, schedule: [[1, '2d-a'], [4, '2d-b']] },
  'dumbbell-home': { level: 'beginner', goal: 'general', block: DELOAD_6, routines: DUMBBELL_HOME, schedule: [[1, 'db-a'], [3, 'db-b'], [5, 'db-a']] },
  ppl: { level: 'beginner', goal: 'muscle', block: DELOAD_6, routines: PPL, schedule: [[1, 'push'], [3, 'pull'], [5, 'legs']] },
  '5x5': { level: 'beginner', goal: 'strength', block: DELOAD_6, routines: FIVE_BY_FIVE, schedule: [[1, '5x5-a'], [3, '5x5-b'], [5, '5x5-c']] },
  'upper-lower': { level: 'intermediate', goal: 'muscle', block: DELOAD_6, routines: UPPER_LOWER, schedule: [[1, 'upper-a'], [2, 'lower-a'], [4, 'upper-b'], [5, 'lower-b']] },
  'ppl-6': { level: 'intermediate', goal: 'muscle', block: { kind: 'deload', weeks: 5 }, routines: PPL, schedule: [[1, 'push'], [2, 'pull'], [3, 'legs'], [4, 'push'], [5, 'pull'], [6, 'legs']] },
  'strength-4': { level: 'intermediate', goal: 'strength', block: { kind: 'strength', weeks: 8 }, routines: STRENGTH_4, schedule: [[1, 'st-sq'], [2, 'st-bp'], [4, 'st-dl'], [5, 'st-oh']] }
}

const build = routines =>
  routines.map(([, name, emoji, list]) => ({ id: uid(), name, emoji, ex: list.map(([id, sets, reps]) => ({ id, sets, reps, weight: 0 })) }))

// Fresh routine objects (new ids) — [push, pull, legs]. The demo build seeds a history on
// top of exactly these three, so this entry point keeps its shape.
export const starterRoutines = () => build(PPL)

// [{ id, days }] for the chooser. The day count is read off the schedule rather than stored
// beside it, so the two can never disagree.
export const starterPlanOptions = () =>
  Object.entries(PLANS).map(([id, { schedule, level, goal, block }]) => ({ id, days: schedule.length, level, goal, block: { ...block } }))

// The weekdays a plan would claim, or null for an unknown id.
export const starterPlanDays = id => PLANS[id]?.schedule.map(([day]) => day) ?? null

// Words that name the equipment, not the movement ("barbell", "lever", "machine"…), so that
// "barbell bench press" and "dumbbell bench press" read as the same lift.
const EQ_WORDS = new Set(ALL_EQUIPMENT.flatMap(e => e.split(/[^a-z0-9]+/)).concat(['lever', 'leverage', 'machine', 'sled']))
const words = ex => new Set(ex.n.toLowerCase().split(/[^a-z0-9]+/).filter(w => w && !EQ_WORDS.has(w)))
const jaccard = (a, b) => {
  const inter = [...a].filter(x => b.has(x)).length
  return inter ? inter / (a.size + b.size - inter) : 0
}

// Names that are not working sets: stretches, holds, mobility and warm-up drills. Never a
// stand-in for a lift, whatever body part and muscle they share with it.
const NOT_A_LIFT = /stretch|isometric|squeeze|yoga|\bpose\b|toe touch|\broll(er)?\b|mobility|circles|warm-?up|boxing|against wall/i
// "… on exercise ball" is tagged with its weight (dumbbell), but needs a ball nobody ticked.
const NEEDS_BALL = /exercise ball|stability ball|swiss ball|bosu/i

// The best stand-in for `ex` among exercises the equipment list allows. Same body part, and it
// has to share the target muscle, the main muscle or a helper muscle with `ex`. Closest wins:
// same target muscle, then the movement by name, then helper muscles. When `ex` is a loaded
// lift, one that is loaded too beats a body-weight drill — a push-up is not a bench press.
// `taken` keeps a routine from ending up with the same exercise twice. null when nothing fits.
export const substituteFor = (ex, equipment, taken) => {
  const hasBall = equipment.includes('stability ball') || equipment.includes('bosu ball')
  const exWords = words(ex), exSm = new Set([ex.mg, ...(ex.sm || [])])
  const loaded = ex.eq !== 'body weight'
  let best = null, bestScore = -Infinity
  for (const c of Object.values(EXIDX)) {
    if (c.bp !== ex.bp || taken.has(c.id) || !eqAvailable(equipment, c)) continue
    if (NOT_A_LIFT.test(c.n) || (!hasBall && NEEDS_BALL.test(c.n))) continue
    const sm = jaccard(exSm, new Set([c.mg, ...(c.sm || [])]))
    if (c.tg !== ex.tg && c.mg !== ex.mg && !sm) continue
    const score = 2 * (c.tg === ex.tg) + (c.mg === ex.mg) + 3 * jaccard(exWords, words(c)) + 2 * sm
      - (loaded && c.eq === 'body weight' ? 3 : 0)
    // id as the last key: the same equipment always gives the same plan
    if (score > bestScore || (score === bestScore && c.id < best.id)) { best = c; bestScore = score }
  }
  return best
}

// Re-cuts a routine list for an equipment list: what you can already do stays, what you can't
// is swapped for its closest match, and what has no match is dropped (with its routine, when
// that leaves it empty). Sets and reps carry over unchanged.
const fitRoutines = (routines, equipment) => {
  let swapped = 0, dropped = 0
  const fitted = routines.map(([key, name, emoji, list]) => {
    const taken = new Set(list.map(([id]) => id))
    const out = []
    for (const [id, sets, reps] of list) {
      const ex = EXIDX[id]
      if (!ex || eqAvailable(equipment, ex)) { out.push([id, sets, reps]); continue }
      const sub = substituteFor(ex, equipment, taken)
      if (!sub) { dropped++; continue }
      taken.add(sub.id)
      swapped++
      out.push([sub.id, sets, reps])
    }
    return [key, name, emoji, out]
  }).filter(([, , , list]) => list.length)
  return { routines: fitted, swapped, dropped }
}

// Fresh routines plus the weekdays to put them on, or null for an unknown id — a caller that
// treats null as "change nothing" can never half-apply a plan. With an equipment list the
// plan is fitted to it first, and `fit` reports how many exercises that swapped or dropped.
export const buildStarterPlan = (id, equipment) => {
  const plan = PLANS[id]
  if (!plan) return null
  const fit = equipment ? fitRoutines(plan.routines, equipment) : null
  const source = fit ? fit.routines : plan.routines
  const routines = build(source)
  // key → the id just minted for it, so the schedule below names its routine
  const byKey = Object.fromEntries(source.map(([key], i) => [key, routines[i].id]))
  return {
    routines,
    schedule: plan.schedule.filter(([, key]) => byKey[key]).map(([day, key]) => ({ day, routineId: byKey[key] })),
    block: { ...plan.block },
    ...(fit && { fit: { swapped: fit.swapped, dropped: fit.dropped } })
  }
}
