// v1.4.6: body composition from the health hub lands in the same measurement fields the user
// types into, and the day merge keeps typed values over imported ones, field by field.
import { describe, expect, it } from 'vitest'
import { mergeBodyComposition } from './health-read.js'
import { mergeDayEntries, mergeStates, typedInDay } from './sync-merge.js'
import {
  normalizeMeasurementsState, measurementUnit, toMeasurementDisplay, fromMeasurementDisplay,
  measurementValue, builtinCsvColumn, MEASUREMENT_FIELDS, isImportedValue, DEFAULT_MEASUREMENT_KEYS,
  builtinFor, adoptCustomMeasurement,
} from './measurements.js'

const at = (d, h) => new Date(2026, 10, d, h).getTime()
const NOW = at(12, 20)
const rec = (type, d, h, value, extra = {}) => ({ type, t: at(d, h), value, id: `${type}${d}${h}`, origin: 'com.fitbit.FitbitMobile', clientId: null, ...extra })
const entry = S => d => S.measurements.find(e => e.d === d)

describe('mergeBodyComposition', () => {
  it('files each reading under its measurement field, the latest of the day, marked imported', () => {
    const S = { measurements: [], measurementEnabled: null }
    const changed = mergeBodyComposition(S, [
      rec('bodyFat', 12, 7, 18.46), rec('bodyFat', 12, 8, 18.2), rec('leanMass', 12, 8, 64.1234), rec('boneMass', 11, 8, 3.2),
    ], { src: 'hc', now: NOW })
    expect(changed.sort()).toEqual(['bodyFat:2026-11-12', 'boneMass:2026-11-11', 'leanMass:2026-11-12'])
    const e = entry(S)('2026-11-12')
    expect(e.bodyFat).toBe(18.2)
    expect(e.leanMass).toBe(64.123)
    expect(e.src).toEqual({ bodyFat: 'hc', leanMass: 'hc' })
    expect(S.measurementEnabled).toEqual([...DEFAULT_MEASUREMENT_KEYS, 'bodyFat', 'leanMass', 'boneMass'])
  })

  it('keeps a value typed into openGym and fills the other fields of that check-in', () => {
    const S = { measurements: [{ d: '2026-11-12', t: 5, waist: 82, bodyFat: 17 }], measurementEnabled: ['waist', 'bodyFat'] }
    mergeBodyComposition(S, [rec('bodyFat', 12, 8, 19), rec('leanMass', 12, 8, 63)], { src: 'hc', now: NOW })
    const e = entry(S)('2026-11-12')
    expect(e).toMatchObject({ waist: 82, bodyFat: 17, leanMass: 63 })
    expect(isImportedValue(e, 'bodyFat')).toBe(false)
    expect(isImportedValue(e, 'leanMass')).toBe(true)
  })

  it('skips openGym’s own records, unknown types and implausible readings', () => {
    const S = { measurements: [] }
    expect(mergeBodyComposition(S, [
      rec('bodyFat', 12, 8, 18, { clientId: 'opengym-x' }), rec('steps', 12, 8, 5), rec('bodyFat', 12, 8, 90), rec('leanMass', 12, 8, 64000),
    ], { src: 'hc', now: NOW })).toEqual([])
  })

  it('takes a reading once: a second read, or one after the user cleared it, changes nothing', () => {
    const S = { measurements: [] }
    const seen = {}
    mergeBodyComposition(S, [rec('bodyFat', 12, 8, 18)], { src: 'hc', seen, now: NOW })
    expect(mergeBodyComposition(S, [rec('bodyFat', 12, 8, 18)], { src: 'hc', seen, now: NOW })).toEqual([])
    entry(S)('2026-11-12').bodyFat = null
    expect(mergeBodyComposition(S, [rec('bodyFat', 12, 8, 18)], { src: 'hc', seen, now: NOW })).toEqual([])
    expect(mergeBodyComposition(S, [rec('bodyFat', 12, 9, 17.8)], { src: 'hc', seen, now: NOW })).toEqual(['bodyFat:2026-11-12'])
  })

  it('does not bring back a check-in deleted after the reading', () => {
    const S = { measurements: [], deleted: { measurements: { '2026-11-12': at(12, 12) } } }
    expect(mergeBodyComposition(S, [rec('bodyFat', 12, 8, 18)], { src: 'hc', now: NOW })).toEqual([])
  })

  it('survives normalizing, which keeps the mark only on fields with a value', () => {
    const S = { measurements: [], customMeasurements: [] }
    mergeBodyComposition(S, [rec('bodyWater', 12, 8, 40.5)], { src: 'hc', now: NOW })
    normalizeMeasurementsState(S)
    expect(entry(S)('2026-11-12')).toMatchObject({ bodyWater: 40.5, src: { bodyWater: 'hc' } })
    entry(S)('2026-11-12').bodyWater = null
    normalizeMeasurementsState(S)
    expect(entry(S)('2026-11-12').src).toBeUndefined()
  })
})

describe('the mass fields', () => {
  it('show in the profile’s kg or lb and store kg', () => {
    const lean = MEASUREMENT_FIELDS.find(f => f.key === 'leanMass')
    expect(measurementUnit('kg', lean)).toBe('kg')
    expect(measurementUnit('lb', { key: 'leanMass' })).toBe('lb')
    expect(toMeasurementDisplay(60, 'lb', lean)).toBe(132.3)
    expect(fromMeasurementDisplay(132.3, 'lb', lean)).toBeCloseTo(60.01, 3)
    expect(measurementValue({ leanMass: 60.0114 }, 'leanMass')).toBe(60.011)
    expect(builtinCsvColumn(lean)).toBe('lean_mass_kg')
  })
})

describe('a custom field that duplicates a built-in one', () => {
  it('is recognised by name and kind', () => {
    expect(builtinFor({ name: 'Muscle mass', unit: 'kg' })).toBe('leanMass')
    expect(builtinFor({ name: 'Muskelmasse', unit: 'lb' })).toBe('leanMass')
    expect(builtinFor({ name: 'Body fat %', unit: '%' })).toBe('bodyFat')
    expect(builtinFor({ name: 'Muscle ratio', unit: '%' })).toBeNull()
    expect(builtinFor({ name: 'Water intake', unit: 'none' })).toBeNull()
    expect(builtinFor({ name: 'Bicep', unit: 'cm' })).toBeNull()
  })

  it('moves its readings into the built-in field, keeping a day that has one, and goes away', () => {
    const S = normalizeMeasurementsState({
      customMeasurements: [{ id: 'mm', name: 'Muscle mass', unit: 'kg' }],
      measurementEnabled: ['waist'],
      measurements: [
        { d: '2026-11-01', t: 1, other: [{ id: 'mm', value: 61.5, unit: 'kg' }] },
        { d: '2026-11-02', t: 1, leanMass: 62, other: [{ id: 'mm', value: 99, unit: 'kg' }] },
      ],
    })
    expect(adoptCustomMeasurement(S, 'mm', 'leanMass', NOW)).toBe(1)
    normalizeMeasurementsState(S)
    expect(S.measurements.map(e => e.leanMass)).toEqual([61.5, 62])
    expect(S.measurements.every(e => e.other.length === 0 && e.t === NOW)).toBe(true)
    expect(S.customMeasurements).toEqual([])
    expect(S.measurementEnabled).toEqual(['waist', 'leanMass'])
  })
})

describe('mergeDayEntries', () => {
  it('folds the hub’s fields from one device into the check-in typed on the other', () => {
    const typed = { d: '2026-11-12', t: 10, waist: 82, bodyFat: null }
    const imported = { d: '2026-11-12', t: 20, waist: null, bodyFat: 18, src: { bodyFat: 'hc' } }
    for (const [a, b] of [[[typed], [imported]], [[imported], [typed]]]) {
      const [out] = mergeDayEntries(a, b)
      expect(out).toMatchObject({ waist: 82, bodyFat: 18, t: 10, src: { bodyFat: 'hc' } })
    }
    expect(typed.src).toBeUndefined()   // inputs untouched
  })

  it('never lets an imported value replace a typed one, whichever is newer', () => {
    const [out] = mergeDayEntries([{ d: '2026-11-12', t: 1, kcal: 2500 }], [{ d: '2026-11-12', t: 9, kcal: 1800, src: { kcal: 'hc' } }])
    expect(out.kcal).toBe(2500)
    expect(out.src).toBeUndefined()
  })

  it('takes the later of two typed entries, as before', () => {
    const [out] = mergeDayEntries([{ d: '2026-11-12', t: 1, waist: 80 }], [{ d: '2026-11-12', t: 2, waist: 81 }])
    expect(out.waist).toBe(81)
  })

  it('knows typed from imported, custom fields counting as typed', () => {
    expect(typedInDay({ d: 'x', t: 1, bodyFat: 18, src: { bodyFat: 'hc' } })).toBe(false)
    expect(typedInDay({ d: 'x', t: 1, bodyFat: 18 })).toBe(true)
    expect(typedInDay({ d: 'x', t: 1, other: [{ id: 'a', value: 3 }] })).toBe(true)
  })

  it('mergeStates merges nutrition per field and keeps a deleted day deleted', () => {
    const a = { _ts: 5, nutrition: [{ d: '2026-11-12', t: 4, kcal: 2200 }, { d: '2026-11-10', t: 1, water: 900 }], deleted: {} }
    const b = { _ts: 6, nutrition: [{ d: '2026-11-12', t: 6, kcal: 1500, protein: 120, src: { kcal: 'hc', protein: 'hc' } }], deleted: { nutrition: { '2026-11-10': 3 } } }
    const out = mergeStates(a, b)
    expect(out.nutrition).toEqual([{ d: '2026-11-12', t: 4, kcal: 2200, protein: 120, src: { protein: 'hc' } }])
  })
})
