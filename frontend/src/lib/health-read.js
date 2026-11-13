// What openGym takes back from the phone's health hub (#544, #127): Health Connect on Android,
// Apple Health on the iPhone. Two things, each behind its own switch in Settings:
//
//   - the heart rate during a finished workout, per set and for the session (lib/heart-rate.js
//     works out which samples belong to which set), for every watch that saves to the hub;
//   - weigh-ins other apps saved there (a smart scale's, Garmin's, Withings', Samsung's...).
//
// Pure: lib/health-sync.js reads the hub and hands the records over; this decides what goes into
// the log. The rules:
//   - a set that already has a heart rate keeps it (the Apple Watch measured it live);
//   - a day with a weigh-in typed into openGym keeps it: an imported one never replaces it, and
//     one typed in later replaces the imported one (lib/sync-merge.js mergeBodyweight);
//   - openGym's own records in the hub (what it wrote there itself) are never read back as new;
//   - an imported weigh-in carries `src` and is never written back to the hub (no ping-pong:
//     lib/health-connect.js healthRecords leaves it out).
import { hrFromSamples, sanitizeHr } from './heart-rate.js'
import { stampWorkout } from './sync-merge.js'
import { isoOf } from './format.js'
import { DEFAULT_MEASUREMENT_KEYS, HUB_MEASUREMENT_KEYS, emptyMeasurement } from './measurements.js'

export const LB_PER_KG = 2.2046226218
// Weigh-ins outside this are a typo or another person's profile in the hub, not a body weight.
const KG_MIN = 20
const KG_MAX = 400
// Packages and bundle ids that are openGym: the app, its test build, the Apple Watch app.
const OWN = /^ch\.duartesantos\.opengym(\.|$)/

/** Whether a record in the hub is one openGym wrote itself (by its client id or by its origin). */
export function isOwnRecord(rec) {
  if (!rec || typeof rec !== 'object') return false
  if (/^opengym-/.test(String(rec.clientId || ''))) return true
  return OWN.test(String(rec.origin || ''))
}

/**
 * The heart rate read for workout `wid` (`samples`: [ms, bpm] from the hub) put into the log `S`
 * (mutated). Only sets without a reading get one; the session's reading is set when the workout
 * has none, or replaced by a fuller one from the same hub (Garmin and Fitbit sync late, so a
 * read right after the workout can hold only part of it). One the watch took is never replaced.
 * The workout is stamped as edited, so a sync keeps the change. Returns whether anything changed.
 */
export function mergeHeartRate(S, wid, samples, src, now = Date.now()) {
  const w = (S?.workouts || []).find(x => x && x.id === wid)
  if (!w) return false
  const res = hrFromSamples(w, samples)
  let changed = false
  for (const [key, got] of res.sets) {
    const [ei, si] = key.split(':').map(Number)
    const set = w.entries?.[ei]?.sets?.[si]
    if (!set) continue
    if (got.hr && !sanitizeHr(set.hr)) { set.hr = got.hr; changed = true }
    if (got.restHr && !sanitizeHr(set.restHr)) { set.restHr = got.restHr; changed = true }
  }
  if (res.session) {
    const cur = w.hr && typeof w.hr === 'object' ? w.hr : null
    const fuller = !cur || (cur.src === src && res.n > (Number(cur.n) || 0))
    if (fuller && cur?.src !== 'watch') {
      w.hr = { ...res.session, src, n: res.n }
      changed = true
    }
  }
  if (changed) stampWorkout(w, now)
  return changed
}

/** Whether a workout still has sets the hub could fill: one done and without a heart rate. */
export function lacksHeartRate(w) {
  if (!w || typeof w !== 'object') return false
  if (!w.hr) return true
  return (w.entries || []).some(e => (e?.sets || []).some(s => s && (s.done === true || s.sides) && !sanitizeHr(s.hr)))
}

/**
 * Weigh-ins from the hub (`records`: [{ t, kg, id, origin, clientId }]) put into the log `S`
 * (mutated), at most one per day: the latest of that day. `seen` is this phone's memo of what it
 * imported ({ [day]: { id, t } }), updated in place, which makes a second read of the same records
 * a no-op. A day is left alone when it has a weigh-in typed into openGym, when the weigh-in was
 * deleted in openGym after the record was taken, or when the record is not newer than the one
 * already imported for it. Weights go in in the profile's unit. Returns the days changed.
 */
export function mergeWeighIns(S, records, { src, seen = {} } = {}) {
  const unit = S?.unit === 'lb' ? 'lb' : 'kg'
  const latest = new Map()
  for (const r of Array.isArray(records) ? records : []) {
    if (!r || isOwnRecord(r)) continue
    const t = Number(r.t), kg = Number(r.kg)
    if (!(t > 0) || !(kg >= KG_MIN && kg <= KG_MAX)) continue
    const d = isoOf(new Date(t))
    const cur = latest.get(d)
    if (!cur || t > cur.t) latest.set(d, { t, kg, id: r.id || null })
  }
  if (!latest.size) return []
  if (!Array.isArray(S.bodyweight)) S.bodyweight = []
  const deleted = S.deleted?.bodyweight && typeof S.deleted.bodyweight === 'object' ? S.deleted.bodyweight : {}
  const days = []
  for (const [d, r] of latest) {
    const ex = S.bodyweight.find(b => b && b.d === d)
    if (ex && !ex.src) continue                           // typed in: it wins
    if (Number(deleted[d]) > r.t && !ex) continue         // removed in openGym after it was taken
    const before = seen[d] ? Number(seen[d].t) : ex ? Number(ex.t) || 0 : 0
    if (ex && !(r.t > before)) continue
    if (!ex && seen[d] && !(r.t > Number(seen[d].t))) continue
    const w = Math.round((unit === 'lb' ? r.kg * LB_PER_KG : r.kg) * 10) / 10
    if (ex) { ex.w = w; ex.t = r.t; ex.src = src }
    else S.bodyweight.push({ d, w, t: r.t, src })
    seen[d] = { id: r.id, t: r.t }
    days.push(d)
  }
  if (days.length) S.bodyweight.sort((a, b) => (a.d < b.d ? -1 : 1))
  return days
}

// Readings outside these are a typo, a child's profile on a shared scale, or a scale that sent
// grams: body fat in percent, the masses in kg.
const BODY_BOUNDS = { bodyFat: [1, 75], leanMass: [10, 200], boneMass: [0.5, 15], bodyWater: [5, 150] }

/**
 * Body composition from the hub (`records`: [{ type, t, value, id, origin, clientId }], `type` one
 * of HUB_MEASUREMENT_KEYS) put into the day's measurement check-in of `S` (mutated): body fat, lean
 * mass, bone mass and body water are the same fields the user types into Measurements, never a
 * second copy of them. Per field and day the latest reading of that day; `src` marks it imported.
 * A field typed into openGym keeps its value. `seen` ({ 'bodyFat:2026-11-12': { id, t } }) is this
 * phone's memo, updated in place: a reading already taken, or one the user then cleared, is not
 * taken again; only a newer one is. A day deleted in openGym after the reading stays deleted. A
 * field that gets a value is switched on in the logging form, so it can be corrected by hand.
 * Returns the `field:day` keys changed.
 */
export function mergeBodyComposition(S, records, { src, seen = {}, now = Date.now() } = {}) {
  const latest = new Map()
  for (const r of Array.isArray(records) ? records : []) {
    if (!r || isOwnRecord(r) || !HUB_MEASUREMENT_KEYS.includes(r.type)) continue
    const t = Number(r.t), v = Number(r.value)
    const [lo, hi] = BODY_BOUNDS[r.type]
    if (!(t > 0) || !(v >= lo && v <= hi)) continue
    const key = `${r.type}:${isoOf(new Date(t))}`
    const cur = latest.get(key)
    if (!cur || t > cur.t) latest.set(key, { t, v, id: r.id || null, type: r.type, d: key.slice(r.type.length + 1) })
  }
  if (!latest.size) return []
  if (!Array.isArray(S.measurements)) S.measurements = []
  const deleted = S.deleted?.measurements && typeof S.deleted.measurements === 'object' ? S.deleted.measurements : {}
  const changed = []
  for (const [key, r] of latest) {
    if (seen[key] && !(r.t > Number(seen[key].t))) continue
    let ex = S.measurements.find(e => e && e.d === r.d)
    if (ex && ex[r.type] != null && !ex.src?.[r.type]) { seen[key] = { id: r.id, t: r.t }; continue }   // typed in: it wins
    if (!ex && Number(deleted[r.d]) > r.t) continue                                                       // removed after it was taken
    const value = r.type === 'bodyFat' ? Math.round(r.v * 10) / 10 : Math.round(r.v * 1000) / 1000
    seen[key] = { id: r.id, t: r.t }
    if (ex && ex[r.type] === value) continue
    if (!ex) {
      ex = emptyMeasurement(r.d, S.customMeasurements || [])
      S.measurements.push(ex)
    }
    ex[r.type] = value
    ex.src = { ...(ex.src && typeof ex.src === 'object' ? ex.src : {}), [r.type]: src }
    ex.t = Math.max(Number(ex.t) || 0, now)
    const on = Array.isArray(S.measurementEnabled) ? S.measurementEnabled : [...DEFAULT_MEASUREMENT_KEYS]
    if (!on.includes(r.type)) S.measurementEnabled = [...on, r.type]
    changed.push(key)
  }
  if (changed.length) S.measurements.sort((a, b) => (a.d < b.d ? -1 : 1))
  return changed
}
