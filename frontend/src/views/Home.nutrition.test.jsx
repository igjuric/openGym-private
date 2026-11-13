// @vitest-environment happy-dom
// v1.4.6: Home's order (Today, streak, nutrition, body weight), the Today's nutrition card for
// someone who uses nutrition, its quick water, and the body fat line under the weight.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { todayISO, isoOf } from '../lib/format.js'
import Home from './Home.jsx'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), bwSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(),
  calendarSheet: vi.fn(), startFlow: vi.fn(), bwDeltaColor: () => '', weighInsSheet: vi.fn(),
}))

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ toast: vi.fn() })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const ago = n => isoOf(new Date(Date.now() - n * 86400000))
const mountWith = patch => {
  useStore.setState(s => ({
    S: { ...s.S, routines: [], workouts: [], bodyweight: [], measurements: [], nutrition: [], nutritionTargets: null,
      dayPlan: {}, week: {}, active: null, showWeightCard: true, showNutritionCard: true, unit: 'kg', ...patch },
    user: null,
  }))
  act(() => root.render(<Home />))
}
const card = () => host.querySelector('.nutrition-card')
const S = () => useStore.getState().S

describe('Home', () => {
  it('puts the streak above nutrition, and nutrition above body weight', () => {
    mountWith({ nutritionTargets: { kcal: 2400 } })
    const cards = [...host.querySelectorAll('.card')]
    const at = pick => cards.findIndex(pick)
    const streak = at(c => c.textContent.includes('week streak'))
    const food = at(c => c.classList.contains('nutrition-card'))
    const weight = at(c => c.querySelector('h2')?.textContent === 'Body weight')
    expect(streak).toBeGreaterThan(-1)
    expect(streak).toBeLessThan(food)
    expect(food).toBeLessThan(weight)
  })

  it('shows no nutrition card to someone who never logged food or set a goal', () => {
    mountWith({ nutrition: [{ d: ago(40), kcal: 2000 }] })
    expect(card()).toBeNull()
  })

  it('shows today against the goals, and hides when switched off', () => {
    mountWith({ nutritionTargets: { kcal: 2000, protein: 150, water: 2500 },
      nutrition: [{ d: todayISO(), t: 1, kcal: 1500, protein: 90, water: 1000, src: { kcal: 'hc' } }] })
    expect(card().textContent).toContain('1,500 / 2,000 kcal')
    expect(card().querySelectorAll('[role="progressbar"]')).toHaveLength(3)
    expect(card().querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('75')
    expect(card().textContent).toContain('From Health Connect')
    mountWith({ nutritionTargets: { kcal: 2000 }, showNutritionCard: false })
    expect(card()).toBeNull()
  })

  it('adds a glass of water in one tap', () => {
    mountWith({ nutritionTargets: { water: 2500 } })
    const glass = [...card().querySelectorAll('button')].find(b => b.textContent === '+250 ml')
    act(() => glass.click())
    expect(S().nutrition.find(e => e.d === todayISO()).water).toBe(250)
    expect(useUI.getState().toast).toHaveBeenCalledWith('Water today: 250 ml')
  })

  it('offers fl oz glasses on a lb profile', () => {
    mountWith({ unit: 'lb', nutritionTargets: { water: 2500 } })
    expect([...card().querySelectorAll('button')].map(b => b.textContent)).toEqual(['+8 fl oz', '+16 fl oz'])
  })

  it('shows the latest body fat under the weight, with how it moved', () => {
    mountWith({
      bodyweight: [{ d: ago(1), w: 82.4, t: 1 }],
      measurements: [{ d: ago(9), t: 1, bodyFat: 18.5 }, { d: ago(2), t: 2, bodyFat: 18.2 }],
    })
    const line = host.querySelector('.bw-fat')
    expect(line.textContent).toContain('Body fat')
    expect(line.textContent).toContain('18.2%')
    expect(line.textContent).toContain('0.3')
  })

  it('leaves the body fat line out when the last reading is over a month old', () => {
    mountWith({ bodyweight: [{ d: ago(1), w: 82.4, t: 1 }], measurements: [{ d: ago(45), t: 1, bodyFat: 18 }] })
    expect(host.querySelector('.bw-fat')).toBeNull()
  })
})
