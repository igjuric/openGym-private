// Home's glance at today's food and water (v1.4.6): calories, protein and water against the daily
// goals, two quick buttons for a glass of water, and a tap through to Nutrition. Home only shows it
// to someone who uses nutrition (lib/nutrition.js nutritionInUse) and has not switched it off.
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { addWater, normalizeNutritionState, nutritionOn, nutritionUnit, toNutritionDisplay, isImportedNutrition, ML_PER_FLOZ } from '../lib/nutrition.js'
import { fmtNum, todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import Icon from './Icon.jsx'

// One line: the label, today's number against the goal, and a bar when there is a goal.
function Line({ S, field, label, today, color }) {
  const value = toNutritionDisplay(field, today?.[field] ?? null, S.unit)
  const goal = toNutritionDisplay(field, S.nutritionTargets?.[field] ?? null, S.unit)
  const unit = nutritionUnit(field, S.unit)
  const pct = goal ? Math.min(100, Math.round((value || 0) / goal * 100)) : null
  return <div className="nc-line">
    <div className="row between small">
      <span className="muted">{label}</span>
      <span><b>{value != null ? fmtNum(value) : '0'}</b>{goal ? <span className="muted"> / {fmtNum(goal)}</span> : null} {unit}</span>
    </div>
    {pct != null && <div className="nc-bar" role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: pct + '%', background: color }} />
    </div>}
  </div>
}

export default function NutritionCard() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const today = nutritionOn(S, todayISO())
  const imported = ['kcal', 'protein', 'water'].some(k => isImportedNutrition(today, k))
  // A glass in the profile's own measure: 250 and 500 ml, or 8 and 16 fl oz.
  const lb = S.unit === 'lb'
  const glasses = lb ? [8, 16].map(oz => ({ ml: oz * ML_PER_FLOZ, label: '+' + oz + ' fl oz' })) : [{ ml: 250, label: '+250 ml' }, { ml: 500, label: '+500 ml' }]
  const drink = ml => {
    let total = 0
    useStore.getState().update(s => { total = addWater(s, todayISO(), ml); normalizeNutritionState(s) })
    useUI.getState().toast(t('Water today: {0}', fmtNum(toNutritionDisplay('water', total, S.unit)) + ' ' + nutritionUnit('water', S.unit)))
  }
  return <div className="card nutrition-card">
    <div className="row between" {...tappable(() => nav('/nutrition'))} style={{ cursor: 'pointer', marginBottom: 8 }}>
      <h2 style={{ margin: 0 }}>{t('Today’s nutrition')}</h2>
      <Icon name="chevronRight" className="chev" />
    </div>
    <Line S={S} field="kcal" label={t('Calories')} today={today} color="var(--green)" />
    <Line S={S} field="protein" label={t('Protein')} today={today} color="var(--green)" />
    <Line S={S} field="water" label={t('Water')} today={today} color="var(--blue)" />
    <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
      {glasses.map(g => <button key={g.label} type="button" className="chip" onClick={() => drink(g.ml)}
        aria-label={t('Add {0} of water', g.label.slice(1))}>{g.label}</button>)}
      {imported && <span className="small dim" style={{ marginInlineStart: 'auto' }}>{t('From Health Connect')}</span>}
    </div>
  </div>
}
