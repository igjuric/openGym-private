// The first-run tour: four cards, one per tab, the first time Home opens on a profile with no
// workouts yet. Skippable at any card, shown once per device (a convenience kept in this
// browser's storage, not in the profile), and again on request from Settings > About.
import { useState } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

const SEEN = 'opengym_tour_v1'

export const TOUR_STEPS = [
  { icon: 'house', title: 'Welcome to openGym', text: 'Home shows your week: the next workout, the days you trained and your body weight.' },
  { icon: 'calendar', title: 'Plan your training', text: 'In Plan, set up a routine for each training day. openGym raises the weights as you get stronger.' },
  { icon: 'dumbbell', title: 'Log as you lift', text: 'Tap Start, tick off each set, and the rest timer starts on its own.' },
  { icon: 'chart', title: 'See your progress', text: 'Stats shows your records, volume, body weight and milestones.' },
]

export function tourSeen() {
  try { return localStorage.getItem(SEEN) === '1' } catch { return true }
}
function markSeen() {
  try { localStorage.setItem(SEEN, '1') } catch { /* private window: shown again next time */ }
}

export function Tour({ close }) {
  const [i, setI] = useState(0)
  const step = TOUR_STEPS[i]
  const last = i === TOUR_STEPS.length - 1
  const done = () => { markSeen(); close() }
  return <div className="tour">
    <div className="tour-ico"><Icon name={step.icon} /></div>
    <h3>{t(step.title)}</h3>
    <p className="muted">{t(step.text)}</p>
    <div className="tour-dots" aria-label={t('Step {0} of {1}', i + 1, TOUR_STEPS.length)} role="img">
      {TOUR_STEPS.map((_, k) => <i key={k} className={k === i ? 'on' : ''} />)}
    </div>
    <Button variant="primary" onClick={() => (last ? done() : setI(i + 1))}>{last ? t('Get started') : t('Next')}</Button>
    <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
      {i > 0 ? <Button size="sm" variant="ghost" onClick={() => setI(i - 1)}>{t('Back')}</Button> : <span />}
      {!last && <Button size="sm" variant="ghost" onClick={done}>{t('Skip')}</Button>}
    </div>
  </div>
}

export const openTour = () => useUI.getState().openSheet(close => <Tour close={close} />, { kind: 'center', locked: true })
