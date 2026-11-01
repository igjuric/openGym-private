// How a milestone (lib/milestones.js) reads and looks: its title, its icon, its row, and the
// picture you can share. The finish summary and the Milestones page both draw them from here.
import { EXIDX } from '../lib/exercises.js'
import { fmtNum, fmtVol, fmtDate } from '../lib/format.js'
import { t, tn, exerciseNameFor, exerciseNameClass } from '../lib/i18n.js'
import { CARD_FONT } from '../lib/workout-card.js'
import Icon from './Icon.jsx'
import { shareImage } from './share-image.js'

const ICON = { count: 'checkCircle', streak: 'flame', volume: 'barbell', lift: 'trophy' }
export const milestoneIcon = m => ICON[m.kind] || 'medal'

const liftName = m => (EXIDX[m.ex] ? exerciseNameFor(EXIDX[m.ex]) : m.ex)

/** The title as plain text (the share card, a screen reader). */
export function milestoneText(m, unit) {
  if (m.kind === 'count') return m.value === 1 ? t('First workout logged') : tn('{0} workout logged', '{0} workouts logged', m.value)
  if (m.kind === 'streak') return tn('{0} week in a row', '{0} weeks in a row', m.value)
  if (m.kind === 'volume') return t('{0} lifted in total', fmtVol(m.value, unit))
  const name = liftName(m)
  return name.charAt(0).toUpperCase() + name.slice(1) + ' · ' + fmtNum(m.value) + ' ' + unit
}

/** The title on screen: an exercise name keeps the class that styles it. */
export function MilestoneTitle({ m, unit }) {
  if (m.kind !== 'lift') return milestoneText(m, unit)
  return <><span className={exerciseNameClass(EXIDX[m.ex])}>{liftName(m)}</span> · {fmtNum(m.value)} {unit}</>
}

/** A reached milestone: what, when, and a button to share it. */
export function MilestoneRow({ m, unit }) {
  return <div className="item">
    <div className="ms-ico"><Icon name={milestoneIcon(m)} /></div>
    <div className="grow"><div className="tt"><MilestoneTitle m={m} unit={unit} /></div><div className="ss">{fmtDate(m.d, true, true)}</div></div>
    <button type="button" className="iconbtn" aria-label={t('Share')} onClick={() => shareMilestone(m, unit)}><Icon name="share" /></button>
  </div>
}

// The picture: a square card in the app's own colours, the milestone large, the date and the
// app's name small. Drawn on a canvas so it needs nothing the app does not already have.
export async function milestoneImage(m, unit) {
  const root = getComputedStyle(document.documentElement)
  const css = (name, fallback) => root.getPropertyValue(name).trim() || fallback
  const c = { bg: css('--bg', '#000'), surface: css('--surface', '#1c1c1e'), label: css('--label', '#fff'), label2: css('--label-2', '#999'), acc: css('--acc', '#30d158') }
  const S = 1080
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = S
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = c.bg
  ctx.fillRect(0, 0, S, S)
  ctx.fillStyle = c.surface
  ctx.beginPath()
  ctx.roundRect ? ctx.roundRect(60, 60, S - 120, S - 120, 56) : ctx.rect(60, 60, S - 120, S - 120)
  ctx.fill()
  ctx.textAlign = 'center'
  ctx.direction = document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr'
  ctx.fillStyle = c.acc
  ctx.font = `700 44px ${CARD_FONT}`
  ctx.fillText(t('New milestone').toUpperCase(), S / 2, 300)
  // The title, as large as fits, over two lines if it has to.
  ctx.fillStyle = c.label
  const text = milestoneText(m, unit)
  let size = 104, lines = [text]
  for (; size >= 56; size -= 8) {
    ctx.font = `800 ${size}px ${CARD_FONT}`
    if (ctx.measureText(text).width <= S - 220) { lines = [text]; break }
    const words = text.split(' ')
    const cut = words.reduce((best, _, i) => {
      const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ')
      const wd = Math.max(ctx.measureText(a).width, ctx.measureText(b).width)
      return wd < best.wd ? { wd, i } : best
    }, { wd: Infinity, i: 1 })
    lines = [words.slice(0, cut.i).join(' '), words.slice(cut.i).join(' ')]
    if (cut.wd <= S - 220) break
  }
  const top = lines.length === 1 ? 560 : 520
  lines.forEach((l, i) => ctx.fillText(l, S / 2, top + i * size * 1.15))
  ctx.fillStyle = c.label2
  ctx.font = `500 40px ${CARD_FONT}`
  ctx.fillText(fmtDate(m.d, true, true), S / 2, 760)
  ctx.font = `700 40px ${CARD_FONT}`
  ctx.fillText('openGym', S / 2, 920)
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
}

export async function shareMilestone(m, unit) {
  const blob = await milestoneImage(m, unit)
  if (blob) await shareImage(blob, `opengym-${m.id}.png`, milestoneText(m, unit))
}
