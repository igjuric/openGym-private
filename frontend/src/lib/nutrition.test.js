import { describe, expect, it } from 'vitest'
import {
  mergeNutritionDays, normalizeNutritionState, saveNutritionDay, nutritionSeries, nutritionAverage,
  toNutritionDisplay, fromNutritionDisplay, nutritionUnit, isImportedNutrition, nutritionOn, addWater, nutritionInUse,
} from './nutrition.js'

const NOW = new Date('2026-11-12T18:00:00').getTime()
const food = (d, kcal, protein, fat, carbs) => ({ d, kcal, protein, fat, carbs })

describe('normalizeNutritionState', () => {
  it('keeps one valid entry per day and drops nonsense', () => {
    const S = normalizeNutritionState({ nutrition: [
      { d: '2026-11-11', t: 1, kcal: 2000, protein: null, water: 1500 },
      { d: '2026-11-11', t: 2, protein: 140 },
      { d: 'yesterday', kcal: 100 },
      { d: '2026-11-10', t: 1, kcal: -5, water: 'x' },
    ], nutritionTargets: { kcal: 2400, protein: 0, water: 'lots' } })
    expect(S.nutrition).toEqual([{ d: '2026-11-11', t: 2, kcal: 2000, protein: 140, fat: null, carbs: null, water: 1500 }])
    expect(S.nutritionTargets).toEqual({ kcal: 2400 })
  })

  it('keeps the hub mark only on fields that hold a value', () => {
    const S = normalizeNutritionState({ nutrition: [{ d: '2026-11-11', t: 1, kcal: 1800, src: { kcal: 'hc', water: 'hc', fat: 'evil' } }] })
    expect(S.nutrition[0].src).toEqual({ kcal: 'hc' })
  })
})

describe('mergeNutritionDays', () => {
  it('fills the day from the hub and marks each field imported', () => {
    const S = { nutrition: [] }
    const seen = {}
    const days = mergeNutritionDays(S, [{ ...food('2026-11-12', 2100.4, 150, 70, 220), water: 2300 }], { src: 'hc', seen, now: NOW })
    expect(days).toEqual(['2026-11-12'])
    const e = nutritionOn(S, '2026-11-12')
    expect(e).toMatchObject({ kcal: 2100.4, protein: 150, fat: 70, carbs: 220, water: 2300, t: NOW })
    expect(e.src).toEqual({ kcal: 'hc', protein: 'hc', fat: 'hc', carbs: 'hc', water: 'hc' })
  })

  it('never replaces a value typed into openGym, but fills the fields left empty', () => {
    const S = { nutrition: [{ d: '2026-11-12', t: 5, kcal: 2500, protein: null, fat: null, carbs: null, water: null }] }
    mergeNutritionDays(S, [food('2026-11-12', 1900, 120, 60, 200)], { src: 'hc', fields: ['kcal', 'protein', 'fat', 'carbs'], now: NOW })
    const e = nutritionOn(S, '2026-11-12')
    expect(e.kcal).toBe(2500)
    expect(e.protein).toBe(120)
    expect(isImportedNutrition(e, 'kcal')).toBe(false)
    expect(isImportedNutrition(e, 'protein')).toBe(true)
  })

  it('leaves a field the read did not cover alone', () => {
    const S = { nutrition: [{ d: '2026-11-12', t: 5, kcal: 1500, src: { kcal: 'hc' } }] }
    mergeNutritionDays(S, [{ d: '2026-11-12', water: 800 }], { src: 'hc', fields: ['water'], now: NOW })
    expect(nutritionOn(S, '2026-11-12')).toMatchObject({ kcal: 1500, water: 800 })
  })

  it('updates an imported total when the day grows, and clears it when the hub lost it', () => {
    const S = { nutrition: [] }
    const seen = {}
    mergeNutritionDays(S, [food('2026-11-12', 800, 40, 20, 90)], { src: 'hc', fields: ['kcal', 'protein', 'fat', 'carbs'], seen, now: NOW })
    mergeNutritionDays(S, [food('2026-11-12', 1600, 90, 50, 150)], { src: 'hc', fields: ['kcal', 'protein', 'fat', 'carbs'], seen, now: NOW + 1 })
    expect(nutritionOn(S, '2026-11-12').kcal).toBe(1600)
    mergeNutritionDays(S, [food('2026-11-12', 1600, 90, null, 150)], { src: 'hc', fields: ['kcal', 'protein', 'fat', 'carbs'], seen, now: NOW + 2 })
    expect(nutritionOn(S, '2026-11-12').fat).toBeNull()
    expect(nutritionOn(S, '2026-11-12').src.fat).toBeUndefined()
  })

  it('does not bring back a value the user cleared until the hub has something new', () => {
    const S = { nutrition: [] }
    const seen = {}
    const fields = ['water']
    mergeNutritionDays(S, [{ d: '2026-11-12', water: 1000 }], { src: 'hc', fields, seen, now: NOW })
    S.nutrition = []   // deleted in openGym
    S.deleted = { nutrition: { '2026-11-12': NOW + 10 } }
    expect(mergeNutritionDays(S, [{ d: '2026-11-12', water: 1000 }], { src: 'hc', fields, seen, now: NOW + 20 })).toEqual([])
    expect(S.nutrition).toEqual([])
    expect(mergeNutritionDays(S, [{ d: '2026-11-12', water: 1500 }], { src: 'hc', fields, seen, now: NOW + 30 })).toEqual(['2026-11-12'])
  })

  it('does not bring back a day deleted in openGym that this phone never took', () => {
    const S = { nutrition: [], deleted: { nutrition: { '2026-11-01': NOW } } }
    expect(mergeNutritionDays(S, [{ d: '2026-11-01', water: 900 }], { src: 'hc', fields: ['water'], seen: {}, now: NOW })).toEqual([])
  })

  it('drops days the hub had nothing for and bad dates', () => {
    const S = { nutrition: [] }
    expect(mergeNutritionDays(S, [{ d: 'nope', kcal: 5 }, { d: '2026-11-12', kcal: null }], { src: 'hc', now: NOW })).toEqual([])
    expect(S.nutrition).toEqual([])
  })
})

describe('saveNutritionDay', () => {
  it('keeps the hub mark on a value left as it was, and takes a changed one as typed', () => {
    const S = { unit: 'kg', nutrition: [{ d: '2026-11-12', t: 1, kcal: 2000, protein: 150, fat: null, carbs: null, water: null, src: { kcal: 'hc', protein: 'hc' } }] }
    const shown = { kcal: 2000, protein: 150 }
    saveNutritionDay(S, '2026-11-12', { kcal: 2000, protein: 160, water: 500 }, { imported: { kcal: true, protein: true }, shown, now: NOW })
    const e = nutritionOn(S, '2026-11-12')
    expect(e).toMatchObject({ kcal: 2000, protein: 160, water: 500, t: NOW })
    expect(e.src).toEqual({ kcal: 'hc' })
  })

  it('removes a day emptied in the form', () => {
    const S = { unit: 'kg', nutrition: [{ d: '2026-11-12', t: 1, kcal: 2000 }] }
    expect(saveNutritionDay(S, '2026-11-12', { kcal: null })).toBeNull()
    expect(S.nutrition).toEqual([])
  })

  it('stores water typed in fl oz as millilitres on a lb profile', () => {
    const S = { unit: 'lb', nutrition: [] }
    saveNutritionDay(S, '2026-11-12', { water: 64 }, { now: NOW })
    expect(nutritionOn(S, '2026-11-12').water).toBeCloseTo(1892.7, 1)
  })
})

describe('display', () => {
  it('shows water in fl oz on a lb profile and everything else as stored', () => {
    expect(nutritionUnit('water', 'lb')).toBe('fl oz')
    expect(nutritionUnit('water', 'kg')).toBe('ml')
    expect(nutritionUnit('protein', 'lb')).toBe('g')
    expect(toNutritionDisplay('water', 2000, 'lb')).toBe(67.6)
    expect(fromNutritionDisplay('water', 67.6, 'lb')).toBeCloseTo(1999.2, 0)
    expect(fromNutritionDisplay('kcal', '', 'kg')).toBeNull()
  })

  it('series and averages read the days in range', () => {
    const S = { unit: 'kg', nutrition: [
      { d: '2026-11-01', kcal: 3000 }, { d: '2026-11-10', kcal: 2000 }, { d: '2026-11-12', kcal: 2400, water: 2000 },
    ] }
    expect(nutritionSeries(S, 'kcal', 7, NOW).map(p => p.y)).toEqual([2000, 2400])
    expect(nutritionSeries(S, 'water', 0, NOW)).toHaveLength(1)
    expect(nutritionAverage(S, 'kcal', 7, NOW)).toBe(2200)
    expect(nutritionAverage(S, 'fat', 7, NOW)).toBeNull()
  })
})

describe('quick water from Home', () => {
  it('adds a glass to the day, creating it when needed', () => {
    const S = { nutrition: [] }
    expect(addWater(S, '2026-11-12', 250, NOW)).toBe(250)
    expect(addWater(S, '2026-11-12', 500, NOW + 1)).toBe(750)
    expect(nutritionOn(S, '2026-11-12')).toMatchObject({ water: 750, t: NOW + 1 })
  })

  it('makes an imported day of water typed, so a later read keeps the glass', () => {
    const S = { nutrition: [{ d: '2026-11-12', t: 1, kcal: 1800, water: 1000, src: { kcal: 'hc', water: 'hc' } }] }
    addWater(S, '2026-11-12', 250, NOW)
    expect(nutritionOn(S, '2026-11-12')).toMatchObject({ water: 1250, src: { kcal: 'hc' } })
    mergeNutritionDays(S, [{ d: '2026-11-12', water: 1100 }], { src: 'hc', fields: ['water'], now: NOW + 5 })
    expect(nutritionOn(S, '2026-11-12').water).toBe(1250)
  })

  it('knows when Home has anything to say about food', () => {
    expect(nutritionInUse({ nutrition: [] }, NOW)).toBe(false)
    expect(nutritionInUse({ nutrition: [], nutritionTargets: { kcal: 2400 } }, NOW)).toBe(true)
    expect(nutritionInUse({ nutrition: [{ d: '2026-11-10', water: 500 }] }, NOW)).toBe(true)
    expect(nutritionInUse({ nutrition: [{ d: '2026-10-01', water: 500 }] }, NOW)).toBe(false)
  })
})
