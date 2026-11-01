// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))

import { DEF, useStore } from './useStore.js'

const clone = value => JSON.parse(JSON.stringify(value))

beforeEach(() => {
  localStorage.clear()
  useStore.setState({ S: clone(DEF), user: null, ready: false })
})

afterEach(() => {
  localStorage.clear()
  useStore.setState({ S: clone(DEF), user: null, ready: false })
})

// gymCards is plain profile data from the removed gym check-in screen. It is kept so profiles that
// already hold cards still sync and back up unchanged; these pin that it mutates and persists like
// any other field.

describe('gymCards state', () => {
  it('defaults to an empty array on a fresh profile', () => {
    expect(useStore.getState().S.gymCards).toEqual([])
  })

  it('adds a card via update and persists it to localStorage', () => {
    useStore.getState().update(s => {
      s.gymCards.push({ id: 'c1', label: 'FitZone', value: 'ABC123', fmt: 'qrcode' })
    }, false)

    const cards = useStore.getState().S.gymCards
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ id: 'c1', label: 'FitZone', value: 'ABC123', fmt: 'qrcode' })

    // persist() writes the whole state under the app's storage key — the card must be in it.
    const saved = JSON.parse(localStorage.getItem('gym_state_v1'))
    expect(saved.gymCards).toHaveLength(1)
    expect(saved.gymCards[0].value).toBe('ABC123')
  })

  it('removes a card by id, leaving the others', () => {
    useStore.getState().update(s => {
      s.gymCards.push({ id: 'a', label: 'A', value: '1', fmt: 'qrcode' })
      s.gymCards.push({ id: 'b', label: 'B', value: '2', fmt: 'qrcode' })
    }, false)

    useStore.getState().update(s => {
      s.gymCards = s.gymCards.filter(c => c.id !== 'a')
    }, false)

    const cards = useStore.getState().S.gymCards
    expect(cards).toHaveLength(1)
    expect(cards[0].id).toBe('b')
  })

  it('keeps multiple cards in insertion order', () => {
    useStore.getState().update(s => {
      s.gymCards.push({ id: '1', label: 'One', value: 'x', fmt: 'qrcode' })
      s.gymCards.push({ id: '2', label: 'Two', value: 'y', fmt: 'qrcode' })
      s.gymCards.push({ id: '3', label: 'Three', value: 'z', fmt: 'qrcode' })
    }, false)

    expect(useStore.getState().S.gymCards.map(c => c.id)).toEqual(['1', '2', '3'])
  })
})

// Editing a card (rename / re-scan) updates that entry in place — same id, same slot, other cards
// untouched. Mirrors CardSheet's edit branch, which finds the card by id and overwrites its label
// and value only.
describe('editing a card in place', () => {
  it('updates label and value of the matching card, leaving order and siblings intact', () => {
    useStore.getState().update(s => {
      s.gymCards.push({ id: 'a', label: 'A', value: '1', fmt: 'qrcode' })
      s.gymCards.push({ id: 'b', label: 'B', value: '2', fmt: 'qrcode' })
    }, false)

    useStore.getState().update(s => {
      const c = s.gymCards.find(x => x.id === 'b')
      c.label = 'B renamed'
      c.value = 'rescanned'
    }, false)

    const cards = useStore.getState().S.gymCards
    expect(cards.map(c => c.id)).toEqual(['a', 'b'])          // order + count unchanged
    expect(cards[0]).toMatchObject({ label: 'A', value: '1' }) // sibling untouched
    expect(cards[1]).toMatchObject({ id: 'b', label: 'B renamed', value: 'rescanned', fmt: 'qrcode' })
  })
})

