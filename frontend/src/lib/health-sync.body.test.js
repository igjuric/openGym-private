import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// v1.4.6: body composition, nutrition and water read from Health Connect, each behind its own
// switch. The native plugin and the app's data directory are played in memory, as in
// health-sync.read.test.js.
const h = vi.hoisted(() => {
  vi.stubEnv('VITE_MOBILE', '1')
  return { files: new Map(), calls: [], platform: 'android', granted: {}, body: [], days: [], fail: null }
})

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    readFile: async ({ path }) => {
      if (!h.files.has(path)) throw new Error('File does not exist')
      return { data: h.files.get(path) }
    },
    writeFile: async ({ path, data }) => { h.files.set(path, data) },
  },
}))
vi.mock('@capacitor/app', () => ({ App: { addListener: () => ({ remove() {} }) } }))
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => h.platform },
  registerPlugin: () => ({
    status: async () => ({ status: 'available', granted: false, history: false, read: { ...h.granted } }),
    requestPermissions: async arg => { h.calls.push(['request', arg]); return { granted: false, read: { ...h.granted } } },
    readBody: async arg => {
      h.calls.push(['readBody', arg])
      if (h.fail) throw Object.assign(new Error('no'), { code: h.fail })
      return { records: h.body.filter(r => r.t >= arg.since) }
    },
    readNutrition: async arg => {
      h.calls.push(['readNutrition', arg])
      if (h.fail) throw Object.assign(new Error('no'), { code: h.fail })
      const food = arg.nutrition && h.granted.nutrition, water = arg.water && h.granted.hydration
      return { nutrition: !!food, water: !!water, days: h.days.filter(d => d.d >= arg.from && d.d <= arg.to) }
    },
    readHeartRate: async () => ({ samples: [] }),
    readWeights: async () => ({ records: [] }),
    write: async () => {},
    remove: async () => {},
    openSettings: async () => {},
    setEnabled: async () => {},
  }),
}))

const NOW = new Date(2026, 10, 12, 20, 0, 0).getTime()
const reads = kind => h.calls.filter(c => c[0] === kind)
const file = () => JSON.parse(h.files.get('opengym-health.json') || 'null')

let hs, S
const getState = () => S
const apply = fn => { const next = JSON.parse(JSON.stringify(S)); fn(next); S = next }
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.resetModules()
  h.files.clear(); h.calls = []; h.platform = 'android'; h.granted = {}; h.body = []; h.days = []; h.fail = null
  S = { unit: 'kg', workouts: [], bodyweight: [], measurements: [], customMeasurements: [], measurementEnabled: null, nutrition: [] }
  hs = await import('./health-sync.js')
})
afterEach(() => { vi.useRealTimers() })

describe('body composition', () => {
  it('asks for the four body permissions, and fills the measurement fields it was granted', async () => {
    h.granted = { bodyFat: true, leanMass: true, boneMass: false, bodyWater: false }
    h.body = [{ type: 'bodyFat', t: NOW - 3600e3, value: 18.3, id: 'a', origin: 'com.fitbit.FitbitMobile' },
      { type: 'leanMass', t: NOW - 3600e3, value: 63.2, id: 'b', origin: 'com.fitbit.FitbitMobile' }]
    const r = await hs.enableRead('body', getState, { apply })
    expect(r.ok).toBe(true)
    expect(h.calls[0]).toEqual(['request', { read: ['bodyFat', 'leanMass', 'boneMass', 'bodyWater'], write: [] }])
    expect(S.measurements).toHaveLength(1)
    expect(S.measurements[0]).toMatchObject({ d: '2026-11-12', bodyFat: 18.3, leanMass: 63.2, src: { bodyFat: 'hc', leanMass: 'hc' } })
    expect(file()).toMatchObject({ readBody: true, readNutrition: false })
  })

  it('stays off when none of the four is granted', async () => {
    h.granted = { bodyFat: false, leanMass: false, boneMass: false, bodyWater: false }
    expect(await hs.enableRead('body', getState, { apply })).toEqual({ ok: false, reason: 'denied' })
    expect(reads('readBody')).toEqual([])
  })

  it('is Android only for now', async () => {
    h.platform = 'ios'
    expect(await hs.enableRead('body', getState, { apply })).toEqual({ ok: false, reason: 'unsupported' })
    expect(h.calls).toEqual([])
  })
})

describe('nutrition and water', () => {
  it('fills the day totals of the last 30 days the first time, the last week after', async () => {
    h.granted = { nutrition: true, hydration: true }
    h.days = [{ d: '2026-11-12', kcal: 2100, protein: 150, fat: 70, carbs: 230 }, { d: '2026-11-11', kcal: 1900, protein: 140, fat: 60, carbs: 200 }]
    await hs.enableRead('nutrition', getState, { apply })
    expect(reads('readNutrition')[0][1]).toEqual({ from: '2026-10-14', to: '2026-11-12', nutrition: true, water: false })
    expect(S.nutrition.map(e => [e.d, e.kcal])).toEqual([['2026-11-11', 1900], ['2026-11-12', 2100]])
    expect(S.nutrition[1].src).toEqual({ kcal: 'hc', protein: 'hc', fat: 'hc', carbs: 'hc' })

    h.days = [{ d: '2026-11-12', kcal: 2100, protein: 150, fat: 70, carbs: 230, water: 2400 }]
    await hs.enableRead('water', getState, { apply })
    const last = reads('readNutrition').at(-1)[1]
    expect(last).toEqual({ from: '2026-10-14', to: '2026-11-12', nutrition: true, water: true })
    // Later reads take the last week only.
    await hs.readHealth(getState, { force: true, now: NOW + 3 * 60e3, apply })
    expect(reads('readNutrition').at(-1)[1].from).toBe('2026-11-06')
    expect(S.nutrition.find(e => e.d === '2026-11-12')).toMatchObject({ kcal: 2100, water: 2400 })
    // 2026-11-11 is in the window and the hub no longer has it: its imported totals go.
    expect(S.nutrition.find(e => e.d === '2026-11-11')).toBeUndefined()
  })

  it('keeps what the user typed', async () => {
    h.granted = { nutrition: true }
    S.nutrition = [{ d: '2026-11-12', t: 1, kcal: 2500, protein: null, fat: null, carbs: null, water: null }]
    h.days = [{ d: '2026-11-12', kcal: 1800, protein: 120, fat: 60, carbs: 200 }]
    await hs.enableRead('nutrition', getState, { apply })
    expect(S.nutrition[0]).toMatchObject({ kcal: 2500, protein: 120, src: { protein: 'hc', fat: 'hc', carbs: 'hc' } })
  })

  it('a refused read leaves the log alone and says so', async () => {
    h.granted = { nutrition: true }
    await hs.enableRead('nutrition', getState, { apply })
    h.fail = 'permission'
    const out = await hs.readHealth(getState, { force: true, now: NOW + 3 * 60e3, apply })
    expect(out.readError).toBe('permission')
  })

  it('turning a read off keeps what it brought in', async () => {
    h.granted = { hydration: true }
    h.days = [{ d: '2026-11-12', water: 1500 }]
    await hs.enableRead('water', getState, { apply })
    await hs.disableRead('water')
    expect(file().readWater).toBe(false)
    expect(S.nutrition[0].water).toBe(1500)
  })
})
