// Health Connect on the Android app (#200): turning it on, and keeping it in step with the log.
// What gets written is worked out in lib/health-connect.js; this file owns the native plugin
// (HealthConnectPlugin.java) and the phone's own record of what it wrote.
//
// It is a fact about this phone, not about the training log: kept in its own file in the app's
// data directory, never in S, so it does not sync to a server, ride in a backup, or switch on a
// second phone. Off until the user turns it on; nothing is asked of Health Connect before that.
//
// The iPhone app does the same with Apple Health (AppleHealthPlugin.swift): the same calls, the
// same records, the same file. There it also asks to read the heart rate and the body weight, for
// the Apple Watch app (its workout session shows the heart rate per set), and tells the watch
// whether it is on (setEnabled: the App Group's "healthEnabled", which the watch link passes on).
//
// Since v1.4.3 it can also read two things back (#544, #127), each behind a switch of its own and
// off by default: the heart rate during a finished workout (for any watch that saves to the hub,
// not just the Apple Watch), and weigh-ins other apps saved there. Only while the app is open, only
// the workouts of the last day and the weigh-ins since the last read (30 days the first time), so
// no background or history permission is asked for. What it decides is in lib/health-read.js.
//
// Since v1.4.6, on Android, three more reads, each its own switch: body composition (body fat,
// lean, bone and water mass, into the day's measurement check-in), and the day's nutrition and
// water (into S.nutrition). They fill the same fields the user types into, never a copy of them,
// and a typed value always wins (lib/health-read.js mergeBodyComposition, lib/nutrition.js).
//
// The web build never gets here (MOBILE is a build-time flag).
import { mergeHeartRate, mergeWeighIns, lacksHeartRate, mergeBodyComposition } from './health-read.js'
import { mergeNutritionDays, normalizeNutritionState, FOOD_KEYS } from './nutrition.js'
import { normalizeMeasurementsState } from './measurements.js'
import { isoOf } from './format.js'
import { MOBILE, nativePlatform, readJsonFile, writeJsonFile } from './mobile.js'
import { healthRecords, planSync, writtenIds, goneIds } from './health-connect.js'
import { exerciseNameFor } from './i18n-core.js'
import { EXIDX } from './exercises.js'
import { speedUnitOf } from './speed.js'

export const HEALTH_FILE = 'opengym-health.json'
const OFF = {
  on: false, written: {}, at: 0, error: null, readHr: false, readWeight: false, wHistory: false, wCursor: 0, seen: {}, hrTried: {}, readError: null,
  // v1.4.6: body composition (bCursor, bSeen as for weigh-ins), nutrition and water (nSeen: the
  // day totals last taken, lib/nutrition.js mergeNutritionDays), and when each last read.
  readBody: false, bHistory: false, bCursor: 0, bSeen: {}, readNutrition: false, readWater: false, nSeen: {}, nRead: 0, readAt: 0,
}
// The switches, by the name Settings uses, and the field in the file each one is.
export const READ_KINDS = { hr: 'readHr', weight: 'readWeight', body: 'readBody', nutrition: 'readNutrition', water: 'readWater' }
// The reads only the Android plugin has; Apple Health's are a follow-up.
export const ANDROID_ONLY_READS = ['body', 'nutrition', 'water']
// What each switch asks Health Connect for (HealthRead.readPermission names).
const READ_PERMS = { hr: ['heartRate'], weight: ['weight'], body: ['bodyFat', 'leanMass', 'boneMass', 'bodyWater'], nutrition: ['nutrition'], water: ['hydration'] }
const anyRead = h => !!h && Object.values(READ_KINDS).some(k => h[k])

// Wrapped in an object, as in rest-alert.js: a Capacitor plugin proxy answers `then`, so a
// promise resolved with the bare proxy never settles.
let pluginP = null
const plugin = () => pluginP || (pluginP = (async () => {
  const platform = await nativePlatform()
  if (!platform) return null
  const { registerPlugin } = await import('@capacitor/core')
  return { HC: registerPlugin(platform === 'ios' ? 'AppleHealth' : 'HealthConnect'), platform }
})().catch(() => null))

// iPhone: the switch as the watch reads it. Android has no watch to tell.
async function mirrorOn(on) {
  const p = await plugin().catch(() => null)
  if (p?.platform === 'ios') await p.HC.setEnabled({ on: !!on }).catch(() => {})
}

// The file's content, read once and then kept here: a save while it is off (the usual case) must
// not cost a file read, and every change to it goes through saveHealth anyway.
let cached = null
export async function loadHealth() {
  if (cached) return cached
  const f = await readJsonFile(HEALTH_FILE)
  const map = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
  cached = f && typeof f === 'object'
    ? { ...OFF, ...f, written: map(f.written), seen: map(f.seen), hrTried: map(f.hrTried), bSeen: map(f.bSeen), nSeen: map(f.nSeen) }
    : { ...OFF }
  return cached
}
const saveHealth = h => { cached = h; return writeJsonFile(HEALTH_FILE, h) }

/** { status: 'available' | 'update' | 'missing' | 'unsupported', granted, platform } */
export async function healthStatus() {
  if (!MOBILE) return { status: 'unsupported', granted: false, platform: null }
  try {
    const p = await plugin()
    if (!p) return { status: 'unsupported', granted: false, platform: null }
    return { ...(await p.HC.status()), platform: p.platform }
  } catch { return { status: 'unsupported', granted: false, platform: null } }
}

/** Health Connect's own screen for what apps wrote, or its store page where it is missing. */
export async function openHealthConnect() {
  const p = await plugin()
  if (p) await p.HC.openSettings()
}

const nameOf = e => (EXIDX[e.id] ? exerciseNameFor(EXIDX[e.id]) : (e.n || e.id))

// One sync at a time. A change that comes in while one runs is not lost: the running one is
// followed by a single further pass with the newest state.
let running = null
let again = null
const listeners = new Set()
/** Called with the file's new content after every sync, for the Settings row. */
export function onHealthChange(cb) { listeners.add(cb); return () => listeners.delete(cb) }
const told = h => { listeners.forEach(cb => { try { cb(h) } catch { /* a closed screen */ } }) }

/**
 * Writes what changed since the last sync and removes what was deleted from openGym. A no-op
 * while it is off. Resolves with the file's content afterwards; `error` is 'permission' when
 * Health Connect refused (the user took the permission back), 'unavailable' when it is gone.
 */
export function syncHealth(S) {
  if (!MOBILE) return Promise.resolve(null)
  // Not read yet: initHealthSync reads it at launch and syncs then, which covers a save made
  // before that; the save path itself never waits on the file.
  if (!cached || !cached.on) return Promise.resolve(cached)
  if (running) { again = S; return running }
  again = null
  running = (async () => {
    let h = await loadHealth()
    let next = S
    while (next) {
      if (h.on) h = await syncOnce(next, h)
      // A state that came in meanwhile, taken only now: cleared before a pass, it would lose a
      // change made while the pass was starting.
      next = again
      again = null
    }
    return h
  })().finally(() => { running = null })
  return running
}

async function syncOnce(S, h) {
  const p = await plugin()
  if (!p) return h
  const plan = planSync(healthRecords(S, { nameOf, speedUnit: speedUnitOf(S) }), h.written, goneIds(S))
  const nothing = !plan.sessions.length && !plan.weights.length && !plan.remove.sessions.length && !plan.remove.weights.length
  if (nothing) {
    if (!h.error) return h
    // Nothing to write, but the last attempt failed: clear it once Health Connect says yes again.
    const st = await p.HC.status().catch(() => null)
    if (!(st?.status === 'available' && st.granted)) return h
    const out = { ...h, error: null }
    await saveHealth(out)
    told(out)
    return out
  }
  let out = { ...h }
  try {
    if (plan.sessions.length || plan.weights.length) {
      await p.HC.write({ sessions: plan.sessions, weights: plan.weights })
      // Written but not yet removed: kept as written, so a failed remove is tried again.
      const kept = Object.fromEntries(Object.entries(h.written).filter(([id]) => !plan.written[id]))
      out.written = { ...kept, ...plan.written }
    }
    let written = plan.written
    if (plan.remove.sessions.length || plan.remove.weights.length) {
      // Apple Health answers what it could not take out (`left`: one the watch saved that the
      // phone may not delete): kept as written, so the next sync tries again.
      const res = await p.HC.remove(plan.remove)
      const left = Array.isArray(res?.left) ? res.left : []
      if (left.length) written = { ...written, ...Object.fromEntries(left.filter(id => h.written[id]).map(id => [id, h.written[id]])) }
    }
    out = { ...out, written, at: Date.now(), error: null }
  } catch (e) {
    out.error = e?.code === 'permission' ? 'permission' : e?.code === 'unavailable' ? 'unavailable' : 'failed'
  }
  await saveHealth(out)
  told(out)
  return out
}

/**
 * Turning it on: asks for the two write permissions, then writes the whole log once. Resolves
 * with { ok, reason } — reason 'denied' when the user did not grant both, or the status when
 * Health Connect is not there to ask.
 */
export async function enableHealth(S) {
  const p = await plugin()
  if (!p) return { ok: false, reason: 'unsupported' }
  const st = await p.HC.status().catch(() => ({ status: 'unsupported' }))
  if (st.status !== 'available') return { ok: false, reason: st.status }
  const granted = st.granted || (await p.HC.requestPermissions().catch(() => ({ granted: false }))).granted
  if (!granted) return { ok: false, reason: 'denied' }
  const h = await loadHealth()
  await saveHealth({ ...h, on: true, error: null })
  await mirrorOn(true)
  const after = await syncHealth(S)
  return { ok: !after?.error, reason: after?.error || null, health: after }
}

/**
 * Turning it off stops the writing. With `removeWritten`, what openGym wrote is taken out of
 * Health Connect too; without it, it stays there as the user's own data. Rejects when the
 * removal fails, and then stays on, so nothing is left behind that the phone forgot it wrote.
 */
export async function disableHealth({ removeWritten = false } = {}) {
  if (running) await running.catch(() => {})
  const h = await loadHealth()
  if (removeWritten) {
    const ids = writtenIds(h.written)
    if (ids.sessions.length || ids.weights.length) {
      const p = await plugin()
      if (!p) throw new Error('unavailable')
      await p.HC.remove(ids)
    }
  }
  const out = { ...h, on: false, error: null, written: removeWritten ? {} : h.written }
  await saveHealth(out)
  await mirrorOn(false)
  told(out)
  return out
}

// Back in the foreground: a change synced from another device while the phone was away, or a
// permission the user granted again in Health Connect's own settings, is picked up then.
let started = false
export function initHealthSync(getState, apply = null) {
  if (!MOBILE || started) return
  started = true
  applyRef = apply
  import('@capacitor/app').then(({ App }) => {
    App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) return
      syncHealth(getState()).catch(() => {})
      readHealth(getState, { force: true }).catch(() => {})
    })
  }).catch(() => {})
  // Once at launch, for a workout finished just before the app was closed. Reading the file here
  // also settles whether it is on, which the saves wait for (syncHealth).
  setTimeout(() => loadHealth().then(h => {
    mirrorOn(h.on)
    readHealth(getState, { force: true }).catch(() => {})
    return syncHealth(getState())
  }).catch(() => {}), 3000)
}

/* ------------------------------------------------------------------ reading back (v1.4.3) -- */

// How long after a workout its heart rate is still looked for: Garmin and Fitbit hand theirs to
// the hub when the watch next syncs, which can be hours later.
export const HR_WINDOW_MS = 24 * 3600e3
// Between two reads of the same thing, at most this often while the app is in use, and this often
// when it comes back to the foreground.
const READ_EVERY_MS = 10 * 60e3
const RESUME_EVERY_MS = 2 * 60e3
// The first read of weigh-ins goes this far back (what Health Connect gives without the history
// permission); later ones from the newest seen, minus a margin for a scale that syncs late.
export const WEIGHT_FIRST_MS = 30 * 24 * 3600e3
// With Health Connect's history permission (Android, idea from #801) the first read goes back a
// year instead, so a scale's weigh-ins from before openGym arrive too. Asked for with the weight;
// refused, the read simply stays at 30 days.
export const WEIGHT_HISTORY_MS = 365 * 24 * 3600e3
const WEIGHT_MARGIN_MS = 2 * 24 * 3600e3
const SEEN_KEEP_MS = 60 * 24 * 3600e3
// The days of nutrition and water each read covers: the first time, then every time after.
export const NUTRITION_FIRST_DAYS = 30
export const NUTRITION_AGAIN_DAYS = 7

const srcOf = platform => (platform === 'ios' ? 'ah' : 'hc')

// The store's update, given at launch (initHealthSync): a read result goes into the log the way any
// other change does, so it is saved, stamped and synced.
let applyRef = null
let readRunning = null
let lastWeightRead = 0

/**
 * Turns one read on (`kind`: one of READ_KINDS): asks for that read's permissions only, then reads
 * once. Resolves with { ok, reason }; reason 'denied' when none was granted. Body composition is
 * four permissions; granting any of them is enough, the others simply read nothing.
 */
export async function enableRead(kind, getState, { apply = null } = {}) {
  if (!READ_KINDS[kind]) return { ok: false, reason: 'unsupported' }
  const p = await plugin()
  if (!p) return { ok: false, reason: 'unsupported' }
  if (p.platform === 'ios' && ANDROID_ONLY_READS.includes(kind)) return { ok: false, reason: 'unsupported' }
  const st = await p.HC.status().catch(() => ({ status: 'unsupported' }))
  if (st.status !== 'available') return { ok: false, reason: st.status }
  const perms = READ_PERMS[kind]
  // The history permission only where Health Connect has it (status says so); Apple Health has none.
  const history = (kind === 'weight' || kind === 'body') && p.platform !== 'ios' && st.history === true
  const res = await p.HC.requestPermissions({ read: history ? [...perms, 'history'] : perms, write: [] }).catch(() => null)
  // Apple Health never says whether reading was allowed (that it was refused is itself private):
  // `read` is then missing, and a refusal just reads nothing.
  const ok = res && (res.read ? perms.some(perm => res.read[perm] === true || (res.read[perm] !== false && perms.length === 1)) : true)
  if (!ok) return { ok: false, reason: 'denied' }
  const h = await loadHealth()
  const out = { ...h, [READ_KINDS[kind]]: true, readError: null }
  if (kind === 'weight') out.wHistory = history && res.read?.history === true
  if (kind === 'body') out.bHistory = history && res.read?.history === true
  // Read at once, whatever the last read of the others was; a new nutrition or water switch
  // takes the first read's 30 days (what was taken before is in the memo, so nothing doubles).
  if (ANDROID_ONLY_READS.includes(kind)) out.readAt = 0
  if (kind === 'nutrition' || kind === 'water') out.nRead = 0
  await saveHealth(out)
  told(out)
  if (getState) await readHealth(getState, { force: true, apply }).catch(() => {})
  return { ok: true, reason: null, health: cached }
}

/** Turns a read off. What it already brought in stays in the log, as the user's data. */
export async function disableRead(kind) {
  if (!READ_KINDS[kind]) return loadHealth()
  if (readRunning) await readRunning.catch(() => {})
  const h = await loadHealth()
  const out = { ...h, [READ_KINDS[kind]]: false }
  if (kind === 'hr') out.hrTried = {}
  if (!anyRead(out)) out.readError = null
  await saveHealth(out)
  told(out)
  return out
}

/**
 * One read pass: the heart rate of every workout finished in the last day that still lacks some,
 * and the weigh-ins since the last read. A no-op while both switches are off; never runs twice at
 * once; reads the same thing at most every ten minutes (two after coming back to the foreground,
 * `force`). The log changes only when something new came in.
 */
export function readHealth(getState, { force = false, now = Date.now(), apply = null } = {}) {
  if (!MOBILE || !cached || !anyRead(cached)) return Promise.resolve(cached)
  if (readRunning) return readRunning
  readRunning = readOnce(getState, force, now, apply || applyRef).finally(() => { readRunning = null })
  return readRunning
}

async function readOnce(getState, force, now, applyFn) {
  const p = await plugin()
  if (!p) return cached
  const src = srcOf(p.platform)
  const every = force ? RESUME_EVERY_MS : READ_EVERY_MS
  let h = { ...(await loadHealth()) }
  let error = null
  // `decide` runs on a copy first: an update that changes nothing would still stamp and push.
  const apply = (decide, fn = decide) => {
    const probe = JSON.parse(JSON.stringify(getState() || {}))
    if (!decide(probe)) return false
    if (applyFn) applyFn(s => { fn(s) })
    return true
  }
  const fail = e => { error = e?.code === 'permission' ? 'permission' : e?.code === 'unavailable' ? 'unavailable' : 'failed' }

  if (h.readHr) {
    const S = getState()
    const tried = {}
    for (const [wid, at] of Object.entries(h.hrTried || {})) if (now - Number(at) < HR_WINDOW_MS * 2) tried[wid] = at
    for (const w of S?.workouts || []) {
      const end = Number(w?.end), start = Number(w?.start)
      if (!w?.id || !(start > 0) || !(end > start) || now - end > HR_WINDOW_MS || end > now) continue
      if (!lacksHeartRate(w) && w.hr?.src !== src) continue
      if (tried[w.id] && now - Number(tried[w.id]) < every) continue
      try {
        const res = await p.HC.readHeartRate({ from: start, to: end + 5 * 60e3 })
        tried[w.id] = now
        const samples = Array.isArray(res?.samples) ? res.samples : []
        if (samples.length) apply(s => mergeHeartRate(s, w.id, samples, src, now))
      } catch (e) { fail(e); break }
    }
    h.hrTried = tried
  }

  if (h.readWeight && (force ? now - lastWeightRead >= RESUME_EVERY_MS : now - lastWeightRead >= READ_EVERY_MS)) {
    const sinceFor = back => (h.wCursor > 0 ? Math.max(h.wCursor - WEIGHT_MARGIN_MS, now - back) : now - back)
    try {
      let res
      try {
        res = await p.HC.readWeights({ since: sinceFor(h.wHistory ? WEIGHT_HISTORY_MS : WEIGHT_FIRST_MS) })
      } catch (e) {
        // The history permission taken back in Health Connect's settings: the 30 days still read.
        if (!(h.wHistory && e?.code === 'permission')) throw e
        h.wHistory = false
        res = await p.HC.readWeights({ since: sinceFor(WEIGHT_FIRST_MS) })
      }
      lastWeightRead = now
      const records = Array.isArray(res?.records) ? res.records : []
      // The memo is filled in on the copy that decides; the store's update replays the same merge.
      const seen = { ...(h.seen || {}) }
      const before = { ...seen }
      if (records.length) apply(probe => mergeWeighIns(probe, records, { src, seen }).length > 0,
        s => { mergeWeighIns(s, records, { src, seen: { ...before } }) })
      for (const [d, v] of Object.entries(seen)) if (now - Number(v?.t) > SEEN_KEEP_MS) delete seen[d]
      h.seen = seen
      const newest = records.reduce((m, r) => Math.max(m, Number(r?.t) || 0), 0)
      if (newest > h.wCursor) h.wCursor = newest
    } catch (e) { fail(e) }
  }

  // v1.4.6, Android: body composition, nutrition and water, on the weigh-ins' schedule.
  const due = force ? now - (h.readAt || 0) >= RESUME_EVERY_MS : now - (h.readAt || 0) >= READ_EVERY_MS
  if (p.platform !== 'ios' && due && (h.readBody || h.readNutrition || h.readWater)) {
    h.readAt = now
    if (h.readBody) {
      const sinceFor = back => (h.bCursor > 0 ? Math.max(h.bCursor - WEIGHT_MARGIN_MS, now - back) : now - back)
      try {
        let res
        try {
          res = await p.HC.readBody({ since: sinceFor(h.bHistory ? WEIGHT_HISTORY_MS : WEIGHT_FIRST_MS) })
        } catch (e) {
          if (!(h.bHistory && e?.code === 'permission')) throw e
          h.bHistory = false
          res = await p.HC.readBody({ since: sinceFor(WEIGHT_FIRST_MS) })
        }
        const records = Array.isArray(res?.records) ? res.records : []
        const seen = { ...(h.bSeen || {}) }
        const before = { ...seen }
        if (records.length) apply(probe => mergeBodyComposition(probe, records, { src, seen, now }).length > 0,
          s => { mergeBodyComposition(s, records, { src, seen: { ...before }, now }); normalizeMeasurementsState(s) })
        for (const [k, v] of Object.entries(seen)) if (now - Number(v?.t) > SEEN_KEEP_MS) delete seen[k]
        h.bSeen = seen
        const newest = records.reduce((m, r) => Math.max(m, Number(r?.t) || 0), 0)
        if (newest > h.bCursor) h.bCursor = newest
      } catch (e) { fail(e) }
    }
    if (h.readNutrition || h.readWater) {
      // The first read takes the last 30 days, later ones the last week: a meal is often logged
      // the next morning, and a food app may correct a day after that.
      const back = h.nRead > 0 ? NUTRITION_AGAIN_DAYS : NUTRITION_FIRST_DAYS
      const from = isoOf(new Date(now - (back - 1) * 86400000)), to = isoOf(new Date(now))
      try {
        const res = await p.HC.readNutrition({ from, to, nutrition: !!h.readNutrition, water: !!h.readWater })
        const days = Array.isArray(res?.days) ? res.days : []
        // Only what the read covered: a permission taken back leaves those fields as they are.
        const fields = [...(res?.nutrition ? FOOD_KEYS : []), ...(res?.water ? ['water'] : [])]
        // A day in the window the hub had nothing for at all: its imported totals are cleared too.
        const all = []
        for (let x = new Date(from + 'T12:00:00'); isoOf(x) <= to; x = new Date(x.getTime() + 86400000)) {
          const d = isoOf(x)
          all.push(days.find(r => r?.d === d) || { d })
        }
        const seen = { ...(h.nSeen || {}) }
        const before = JSON.parse(JSON.stringify(seen))
        if (fields.length) apply(probe => mergeNutritionDays(probe, all, { src, fields, seen, now }).length > 0,
          s => { mergeNutritionDays(s, all, { src, fields, seen: JSON.parse(JSON.stringify(before)), now }); normalizeNutritionState(s) })
        const keep = isoOf(new Date(now - SEEN_KEEP_MS))
        for (const d of Object.keys(seen)) if (d < keep) delete seen[d]
        h.nSeen = seen
        h.nRead = now
      } catch (e) { fail(e) }
    }
  }

  h.readError = error
  await saveHealth(h)
  told(h)
  return h
}
