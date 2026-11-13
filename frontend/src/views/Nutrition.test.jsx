// @vitest-environment happy-dom
// v1.4.6: the Nutrition screen. A day typed in by hand and a day from Health Connect are the same
// fields; editing an imported value makes it yours.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Nutrition, { nutritionLogSheet } from './Nutrition.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { bindUI } from '../components/ui.jsx'

const mounted = []
function render(node) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push([root, host])
  act(() => root.render(node))
  return host
}
function topSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  return render(sheet.render(() => useUI.getState().closeSheet(sheet.id)))
}
const button = (host, text) => [...host.querySelectorAll('button')].find(el => el.textContent.trim() === text)
const field = (host, name) => [...host.querySelectorAll('.measure-field')].find(el => el.firstElementChild.firstChild.textContent === name)
const type = (input, value) => act(() => {
  Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value').set.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
const install = patch => useStore.setState({ S: { ...structuredClone(DEF), ...patch }, user: null })
const S = () => useStore.getState().S

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-12T12:00:00') })
  bindUI(useUI)
  useUI.setState({ sheets: [], toast: vi.fn() })
  install({})
})
afterEach(() => {
  act(() => mounted.splice(0).forEach(([root, host]) => { root.unmount(); host.remove() }))
  vi.useRealTimers()
})

describe('Nutrition', () => {
  it('logs a day by hand', () => {
    nutritionLogSheet()
    const host = topSheet()
    type(field(host, 'Calories').querySelector('input'), '2200')
    type(field(host, 'Protein').querySelector('input'), '150')
    type(field(host, 'Water').querySelector('input'), '2500')
    act(() => button(host, 'Save').click())
    expect(S().nutrition).toEqual([expect.objectContaining({ d: '2026-11-12', kcal: 2200, protein: 150, water: 2500, fat: null })])
    expect(S().nutrition[0].src).toBeUndefined()
  })

  it('shows water in fl oz on a lb profile', () => {
    install({ unit: 'lb' })
    nutritionLogSheet()
    const host = topSheet()
    expect(field(host, 'Water').querySelector('i').textContent).toBe('fl oz')
  })

  it('names where an imported value came from, and an edit makes it yours', () => {
    install({ nutrition: [{ d: '2026-11-12', t: 1, kcal: 1800, protein: 120, fat: null, carbs: null, water: null, src: { kcal: 'hc', protein: 'hc' } }] })
    nutritionLogSheet('2026-11-12')
    const host = topSheet()
    expect(field(host, 'Calories').textContent).toContain('From Health Connect')
    type(field(host, 'Calories').querySelector('input'), '2000')
    act(() => button(host, 'Save').click())
    expect(S().nutrition[0]).toMatchObject({ kcal: 2000, protein: 120, src: { protein: 'hc' } })
  })

  it('shows today and the history', () => {
    install({ nutrition: [{ d: '2026-11-11', t: 1, kcal: 2100 }, { d: '2026-11-12', t: 2, kcal: 1500, water: 1200 }] })
    const host = render(<MemoryRouter><Nutrition /></MemoryRouter>)
    expect(host.textContent).toContain('1,500 kcal')
    expect(host.querySelectorAll('.measure-history')).toHaveLength(2)
    expect(host.textContent).toContain('7-day average: 1,800 kcal')
  })
})
