// Nutrition (v1.4.6): each day's calories, protein, fat, carbs and water. Typed in here, or filled
// from the phone's health hub (Settings → Health & integrations): the same fields either way, and
// a value typed in always wins (lib/nutrition.js). Not a food diary: day totals only.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import {
  NUTRITION_FIELDS, normalizeNutritionState, saveNutritionDay, nutritionOn, nutritionSeries,
  nutritionAverage, nutritionUnit, toNutritionDisplay, fromNutritionDisplay, isImportedNutrition, nutritionHasValues,
} from '../lib/nutrition.js'
import { fmtDate, fmtNum, todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import LineChart from '../components/LineChart.jsx'
import Icon from '../components/Icon.jsx'
import { Button, NumberField, Segmented, SelectRow } from '../components/ui.jsx'
import { confirmSheet } from '../sheets.jsx'
import { sourceLabel } from './Measurements.jsx'

// Every write leaves the list in its one-entry-per-day shape.
const update = fn => useStore.getState().update(s => { fn(s); normalizeNutritionState(s) })
const toast = message => useUI.getState().toast(message)
const withUnit = (value, unit) => (unit ? fmtNum(value) + ' ' + unit : fmtNum(value))
const shown = (S, entry, key) => toNutritionDisplay(key, entry?.[key] ?? null, S.unit)

function NutritionLog({ sourceDate, close }) {
  const S = useStore(s => s.S)
  const source = sourceDate ? nutritionOn(S, sourceDate) : null
  const [date, setDate] = useState(sourceDate || todayISO())
  const [initial] = useState(() => Object.fromEntries(NUTRITION_FIELDS.map(f => [f.key, shown(S, source, f.key)])))
  const [values, setValues] = useState(initial)
  const imported = Object.fromEntries(NUTRITION_FIELDS.map(f => [f.key, isImportedNutrition(source, f.key)]))

  const save = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayISO()) { toast(t('Choose a valid date')); return }
    if (date !== sourceDate && nutritionOn(S, date)) { toast(t('That day already has an entry. Edit it instead.')); return }
    for (const f of NUTRITION_FIELDS) {
      if (values[f.key] != null && fromNutritionDisplay(f.key, values[f.key], S.unit) == null) {
        toast(t('{0} is out of range.', t(f.label))); return
      }
    }
    if (!NUTRITION_FIELDS.some(f => values[f.key] != null && values[f.key] !== 0)) { toast(t('Enter at least one value')); return }
    update(s => {
      if (sourceDate && sourceDate !== date) s.nutrition = (s.nutrition || []).filter(e => e?.d !== sourceDate)
      saveNutritionDay(s, date, values, { imported: date === sourceDate ? imported : {}, shown: initial })
    })
    close()
    toast(t('Saved'))
  }

  return <>
    <h3>{source ? t('Edit the day') : t('Log the day')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Totals for the whole day. Empty fields stay empty.')}</div>
    <label className="measure-date">
      <span>{t('Date')}</span>
      <input className="field" type="date" value={date} max={todayISO()} onChange={e => setDate(e.target.value)} />
    </label>
    <div className="measure-form">
      {NUTRITION_FIELDS.map(f => <label className="measure-field" key={f.key}>
        <span>{t(f.label)}{imported[f.key] && values[f.key] === initial[f.key] &&
          <small className="dim" style={{ display: 'block', fontWeight: 400 }}>{sourceLabel(source.src[f.key])}</small>}</span>
        <span className="measure-input">
          <NumberField nullable value={values[f.key]} onChange={value => setValues(v => ({ ...v, [f.key]: value }))} />
          <i>{nutritionUnit(f.key, S.unit)}</i>
        </span>
      </label>)}
    </div>
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

export function nutritionLogSheet(sourceDate = null) {
  return useUI.getState().openSheet(close => <NutritionLog sourceDate={sourceDate} close={close} />)
}

function NutritionGoals({ close }) {
  const S = useStore(s => s.S)
  const [values, setValues] = useState(() => Object.fromEntries(NUTRITION_FIELDS.map(f => [f.key, shown(S, S.nutritionTargets, f.key)])))
  const save = () => {
    update(s => {
      const g = {}
      for (const f of NUTRITION_FIELDS) { const v = fromNutritionDisplay(f.key, values[f.key], s.unit); if (v) g[f.key] = v }
      s.nutritionTargets = Object.keys(g).length ? g : null
    })
    close()
  }
  return <>
    <h3>{t('Daily goals')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Optional. A goal shows how far each day got.')}</div>
    <div className="measure-form">
      {NUTRITION_FIELDS.map(f => <label className="measure-field" key={f.key}>
        <span>{t(f.label)}</span>
        <span className="measure-input">
          <NumberField nullable value={values[f.key]} onChange={value => setValues(v => ({ ...v, [f.key]: value }))} />
          <i>{nutritionUnit(f.key, S.unit)}</i>
        </span>
      </label>)}
    </div>
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

const goalsSheet = () => useUI.getState().openSheet(close => <NutritionGoals close={close} />)

// One number of today against its goal, if it has one.
function Tile({ S, field, today }) {
  const value = shown(S, today, field.key)
  const goal = shown(S, S.nutritionTargets, field.key)
  const unit = nutritionUnit(field.key, S.unit)
  const pct = value != null && goal ? Math.min(100, Math.round(value / goal * 100)) : null
  return <div className="tile">
    <div className="l">{t(field.label)}</div>
    <div className="v" style={{ fontSize: '1.1rem' }}>{value != null ? withUnit(value, unit) : '–'}</div>
    {goal ? <div className="small dim">{t('of {0}', withUnit(goal, unit))}{pct != null ? ` · ${pct}%` : ''}</div> : null}
  </div>
}

export default function Nutrition() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const [key, setKey] = useState('kcal')
  const [range, setRange] = useState(30)
  const list = S.nutrition || []
  const today = nutritionOn(S, todayISO())
  const unit = nutritionUnit(key, S.unit)
  const points = nutritionSeries(S, key, range)
  const avg = nutritionAverage(S, key, 7)
  const recent = useMemo(() => [...list].filter(nutritionHasValues).reverse().slice(0, 60), [list])

  const remove = entry => confirmSheet({
    title: t('Delete this day?'),
    message: t('Deletes what is logged for {0}.', fmtDate(entry.d, true)),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => { update(s => { s.nutrition = (s.nutrition || []).filter(e => e?.d !== entry.d) }); toast(t('Deleted')) },
  })

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" data-back="/stats" onClick={() => nav('/stats')} aria-label={t('Stats')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>{t('Nutrition')}</h1><div className="sub">{t('Calories, macros and water')}</div></div>
      <button className="iconbtn" onClick={goalsSheet} aria-label={t('Daily goals')}><Icon name="target" /></button>
    </div>

    <div className="card">
      <div className="row between" style={{ marginBottom: 10 }}>
        <div className="muted small">{t('Today')}</div>
        <Button size="sm" icon={today ? 'pencil' : 'plus'} onClick={() => nutritionLogSheet(today ? today.d : null)}>{today ? t('Edit') : t('Log')}</Button>
      </div>
      <div className="tiles">{NUTRITION_FIELDS.map(f => <Tile key={f.key} S={S} field={f} today={today} />)}</div>
    </div>

    <div className="card">
      <div className="sect-b measure-select"><SelectRow
        title={t('Show')} sheetTitle={t('Show')} value={key} onChange={setKey}
        options={NUTRITION_FIELDS.map(f => ({ value: f.key, label: t(f.label) }))} />
      </div>
      <div className="muted small" style={{ margin: '8px 2px' }}>
        {avg != null ? t('7-day average: {0}', withUnit(toNutritionDisplay(key, avg, S.unit), unit)) : t('Nothing logged in the last 7 days.')}
      </div>
      <Segmented className="seg-range" value={range} onChange={setRange}
        options={[{ value: 7, label: '1W' }, { value: 30, label: '1M' }, { value: 90, label: '3M' }, { value: 0, label: t('All') }]} />
      <div className="chart"><LineChart points={points} h={170} unit={unit} color="var(--orange)" /></div>
    </div>

    <p className="muted small" style={{ margin: '4px 2px' }}>{t('On the phone app, Settings → Health & integrations reads each day from Health Connect: Google Health, a food diary, a smart water bottle.')}</p>

    <div className="row between" style={{ margin: '18px 2px 10px' }}>
      <h4 className="sec" style={{ margin: 0 }}>{t('History')}</h4>
      <Button size="sm" variant="ghost" icon="plus" onClick={() => nutritionLogSheet()}>{t('Log')}</Button>
    </div>
    {recent.length ? <div className="list">{recent.map(entry => <div className="card measure-history" key={entry.d}>
      <div className="row between">
        <div><b>{fmtDate(entry.d, true)}</b>
          {entry.src && Object.keys(entry.src).length > 0 && <div className="small dim" style={{ marginTop: 2 }}>{sourceLabel(Object.values(entry.src)[0])}</div>}</div>
        <div className="row" style={{ gap: 4 }}>
          <button className="iconbtn" onClick={() => nutritionLogSheet(entry.d)} aria-label={t('Edit')}><Icon name="pencil" /></button>
          <button className="iconbtn" style={{ color: 'var(--red)' }} onClick={() => remove(entry)} aria-label={t('Delete')}><Icon name="trash" /></button>
        </div>
      </div>
      <div className="measure-preview">{NUTRITION_FIELDS.filter(f => entry[f.key] != null).map(f =>
        <span key={f.key}>{t(f.label)} <b>{withUnit(shown(S, entry, f.key), nutritionUnit(f.key, S.unit))}</b></span>)}</div>
    </div>)}</div> : <div className="empty small">{t('Nothing logged yet')}</div>}
  </div>
}
