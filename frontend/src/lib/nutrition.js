// What you ate and drank, as one entry per day (v1.4.6): calories, protein, fat, carbs and water.
// openGym is not a food diary. It keeps the day's totals, typed in by hand or filled from the
// phone's health hub (Health Connect: a food app, Google Health), and shows them beside training.
//
//   S.nutrition = [{ d: 'YYYY-MM-DD', t, kcal, protein, fat, carbs, water, src? }]
//
// Canonical units whatever the profile: kcal, grams, millilitres. Water is shown in fl oz on a lb
// profile. `src` maps a field to the hub that filled it ('hc' | 'ah'); a field it does not name was
// typed into openGym, and a typed value always wins over an imported one, on this phone
// (mergeNutritionDays) and in a sync (lib/sync-merge.js mergeDayEntries). One metric, two ways
// in: the same field, the same chart, never two copies of the same number.
//
// `S.nutritionTargets` = { kcal, protein, fat, carbs, water } (any may be null): daily goals.
import { isoOf } from './format.js'

export const NUTRITION_FIELDS = [
  { key: 'kcal', label: 'Calories', unit: 'kcal', max: 20000 },
  { key: 'protein', label: 'Protein', unit: 'g', max: 2000 },
  { key: 'fat', label: 'Fat', unit: 'g', max: 2000 },
  { key: 'carbs', label: 'Carbs', unit: 'g', max: 3000 },
  { key: 'water', label: 'Water', unit: 'ml', max: 20000 },
]
export const NUTRITION_KEYS = NUTRITION_FIELDS.map(f => f.key)
export const FOOD_KEYS = ['kcal', 'protein', 'fat', 'carbs']
const FIELD = new Map(NUTRITION_FIELDS.map(f => [f.key, f]))
export const ML_PER_FLOZ = 29.5735295625

const DAY = /^\d{4}-\d{2}-\d{2}$/
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)

/** A value for `key` as stored: a number from 0 up to the field's bound, one decimal; else null. */
export function nutritionValue(key, v) {
  const f = FIELD.get(key)
  if (!f || v == null || v === '' || !Number.isFinite(+v)) return null
  const n = +v
  if (n < 0 || n > f.max) return null
  return Math.round(n * 10) / 10
}

/** The stable shape of one day: every field present (null when empty), `src` only for filled ones. */
export function normalizeNutritionEntry(raw = {}) {
  const out = { d: String(raw?.d || ''), t: Number.isFinite(+raw?.t) ? +raw.t : 0 }
  for (const k of NUTRITION_KEYS) out[k] = nutritionValue(k, raw?.[k])
  if (isMap(raw?.src)) {
    const src = {}
    for (const k of NUTRITION_KEYS) if (out[k] != null && (raw.src[k] === 'hc' || raw.src[k] === 'ah')) src[k] = raw.src[k]
    if (Object.keys(src).length) out.src = src
  }
  return out
}

export const nutritionHasValues = e => NUTRITION_KEYS.some(k => nutritionValue(k, e?.[k]) != null)
/** Whether `key` of `entry` came from the phone's health hub rather than being typed in. */
export const isImportedNutrition = (entry, key) => !!(entry?.src && entry.src[key] && entry[key] != null)

// Two rows for one date are two halves of the same day: the later one wins per field, a field it
// left empty keeps the earlier value (as lib/measurements.js does for a check-in).
function foldDay(a, b) {
  const out = { ...a, t: Math.max(a.t, b.t) }
  const src = {}
  for (const k of NUTRITION_KEYS) {
    const from = b[k] != null ? b : a
    out[k] = from[k]
    if (out[k] != null && from.src?.[k]) src[k] = from.src[k]
  }
  if (Object.keys(src).length) out.src = src; else delete out.src
  return out
}

/** `S.nutrition` in its one-entry-per-day, sorted, valid shape; `S.nutritionTargets` cleaned. Mutates `S`. */
export function normalizeNutritionState(S) {
  if (!S || typeof S !== 'object') return S
  const byDay = new Map()
  const rows = (Array.isArray(S.nutrition) ? S.nutrition : [])
    .filter(e => e && DAY.test(e.d || ''))
    .map(normalizeNutritionEntry)
    .sort((a, b) => a.d.localeCompare(b.d) || a.t - b.t)
  for (const e of rows) {
    if (!nutritionHasValues(e)) continue
    byDay.set(e.d, byDay.has(e.d) ? foldDay(byDay.get(e.d), e) : e)
  }
  S.nutrition = [...byDay.values()]
  if (S.nutritionTargets != null) {
    const g = {}
    for (const k of NUTRITION_KEYS) { const v = nutritionValue(k, S.nutritionTargets?.[k]); if (v) g[k] = v }
    S.nutritionTargets = Object.keys(g).length ? g : null
  }
  return S
}

/* ------------------------------------------------------------------------------- display -- */

/** The unit a field is shown in: water in fl oz on a lb profile, everything else as stored. */
export const nutritionUnit = (key, profileUnit) => key === 'water' && profileUnit === 'lb' ? 'fl oz' : FIELD.get(key)?.unit || ''
/** A stored value in the unit it is shown in. */
export function toNutritionDisplay(key, v, profileUnit) {
  if (v == null) return null
  if (key === 'water' && profileUnit === 'lb') return Math.round(v / ML_PER_FLOZ * 10) / 10
  return Math.round(v * 10) / 10
}
/** A value as typed, in the unit it is shown in, back to storage (or null when not a value). */
export function fromNutritionDisplay(key, v, profileUnit) {
  if (v == null || v === '') return null
  return nutritionValue(key, key === 'water' && profileUnit === 'lb' ? +v * ML_PER_FLOZ : +v)
}

/** The day's entry, or null. */
export const nutritionOn = (S, d) => (Array.isArray(S?.nutrition) ? S.nutrition : []).find(e => e && e.d === d) || null

/** The days with a value for `key`, oldest first, in its display unit: [{ t, d, y }]. `range` in days, 0 for all. */
export function nutritionSeries(S, key, range = 0, now = Date.now()) {
  const cutoff = range ? now - range * 86400000 : -Infinity
  return (Array.isArray(S?.nutrition) ? S.nutrition : []).map(e => {
    const v = nutritionValue(key, e?.[key])
    const at = new Date(e?.d + 'T12:00:00').getTime()
    if (v == null || !(at >= cutoff)) return null
    return { t: at, d: e.d, y: toNutritionDisplay(key, v, S.unit) }
  }).filter(Boolean)
}

/** The average of `key` over the days of the last `days` (today included) that have one, or null. */
export function nutritionAverage(S, key, days = 7, now = Date.now()) {
  const from = isoOf(new Date(now - (days - 1) * 86400000))
  const to = isoOf(new Date(now))
  const vals = (Array.isArray(S?.nutrition) ? S.nutrition : [])
    .filter(e => e && e.d >= from && e.d <= to)
    .map(e => nutritionValue(key, e[key])).filter(v => v != null)
  if (!vals.length) return null
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10
}

/**
 * The day `d` saved from the form (`values`: field → number as shown, or null), into `S`
 * (mutated). A field the user left as the hub filled it keeps its mark; one changed or typed is
 * the user's own from now on. `imported` is what the form showed as imported. An emptied day is
 * removed. Returns the saved entry, or null when it was removed.
 */
export function saveNutritionDay(S, d, values, { imported = {}, shown = {}, now = Date.now() } = {}) {
  if (!Array.isArray(S.nutrition)) S.nutrition = []
  const prev = nutritionOn(S, d)
  const entry = { d, t: now }
  const src = {}
  for (const k of NUTRITION_KEYS) {
    entry[k] = fromNutritionDisplay(k, values?.[k], S.unit)
    if (entry[k] != null && imported[k] && prev?.src?.[k] && values?.[k] === shown[k]) {
      entry[k] = prev[k]
      src[k] = prev.src[k]
    }
  }
  if (Object.keys(src).length) entry.src = src
  S.nutrition = S.nutrition.filter(e => e?.d !== d)
  if (!nutritionHasValues(entry)) return null
  S.nutrition.push(entry)
  S.nutrition.sort((a, b) => (a.d < b.d ? -1 : 1))
  return entry
}

/**
 * A glass of water from Home's quick buttons: `ml` more on day `d`, in `S` (mutated). The day's
 * water becomes a typed value (what was there, imported or not, plus the glass), so a later read
 * from the hub never takes the glass away; from then on that day's water is the user's to keep.
 * Returns the day's water in ml.
 */
export function addWater(S, d, ml, now = Date.now()) {
  if (!Array.isArray(S.nutrition)) S.nutrition = []
  let e = nutritionOn(S, d)
  if (!e) {
    e = normalizeNutritionEntry({ d, t: now })
    S.nutrition.push(e)
    S.nutrition.sort((a, b) => (a.d < b.d ? -1 : 1))
  }
  e.water = nutritionValue('water', (Number(e.water) || 0) + ml) ?? e.water
  if (isMap(e.src)) { delete e.src.water; if (!Object.keys(e.src).length) delete e.src }
  e.t = Math.max(Number(e.t) || 0, now)
  return e.water
}

/** Whether Home has anything to show about food: goals set, or a day logged in the last two weeks. */
export function nutritionInUse(S, now = Date.now()) {
  if (S?.nutritionTargets && Object.keys(S.nutritionTargets).length) return true
  const since = isoOf(new Date(now - 13 * 86400000))
  return (Array.isArray(S?.nutrition) ? S.nutrition : []).some(e => e && e.d >= since && nutritionHasValues(e))
}

/* ---------------------------------------------------------------- from the health hub -- */

/**
 * Day totals from the hub (`days`: [{ d, kcal, protein, fat, carbs, water }], each a number or
 * null; Health Connect's aggregate, so a meal two apps saved counts once) put into `S.nutrition`
 * (mutated). `fields` are the ones this read covered (the food four, water, or both): a field it
 * did not cover is left alone. Per field and day:
 *   - a value typed into openGym is never replaced;
 *   - a total the same as this phone last took (`seen`, its memo, updated in place) changes
 *     nothing, so a day the user cleared or deleted stays so until food is added to it in the hub;
 *   - a day deleted in openGym that this phone never took before is not brought back;
 *   - an imported total the hub no longer has (the meal deleted there) is cleared.
 * A day left with nothing is removed. Returns the days changed.
 */
export function mergeNutritionDays(S, days, { src, fields = NUTRITION_KEYS, seen = {}, now = Date.now() } = {}) {
  if (!Array.isArray(S.nutrition)) S.nutrition = []
  const deleted = isMap(S.deleted?.nutrition) ? S.deleted.nutrition : {}
  const keys = fields.filter(k => FIELD.has(k))
  const changed = new Set()
  for (const day of Array.isArray(days) ? days : []) {
    const d = String(day?.d || '')
    if (!DAY.test(d)) continue
    const memo = isMap(seen[d]) ? { ...seen[d] } : {}
    const known = isMap(seen[d])
    let ex = nutritionOn(S, d)
    for (const k of keys) {
      const v = nutritionValue(k, day[k]) || null
      if (k in memo && memo[k] === v) continue
      memo[k] = v
      if (ex && ex[k] != null && !ex.src?.[k]) continue            // typed in: it wins
      if (v == null) {
        if (ex?.src?.[k]) { ex[k] = null; delete ex.src[k]; ex.t = Math.max(ex.t || 0, now); changed.add(d) }
        continue
      }
      if (!ex && Number(deleted[d]) > 0 && !known) continue         // deleted here, never taken by this phone
      if (ex && ex[k] === v) continue
      if (!ex) {
        ex = normalizeNutritionEntry({ d, t: now })
        S.nutrition.push(ex)
      }
      ex[k] = v
      ex.src = { ...(isMap(ex.src) ? ex.src : {}), [k]: src }
      ex.t = Math.max(Number(ex.t) || 0, now)
      changed.add(d)
    }
    seen[d] = memo
    if (ex && isMap(ex.src) && !Object.keys(ex.src).length) delete ex.src
  }
  if (changed.size) {
    S.nutrition = S.nutrition.filter(e => nutritionHasValues(e))
    S.nutrition.sort((a, b) => (a.d < b.d ? -1 : 1))
  }
  return [...changed]
}
