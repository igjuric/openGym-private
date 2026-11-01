import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { milestones, nextMilestones } from '../lib/milestones.js'
import { fmtNum } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { MilestoneRow, MilestoneTitle, milestoneIcon } from '../components/Milestones.jsx'

// Milestones: what is next, with how far along it is, then everything reached, newest first.
// All of it read from the workouts (lib/milestones.js), so there is nothing to set up or reset.
export default function Milestones() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const unit = S.unit === 'lb' ? 'lb' : 'kg'
  const reached = useMemo(() => milestones(S).slice().reverse(), [S.workouts, S.unit, S.weekStart])
  const next = useMemo(() => nextMilestones(S), [S.workouts, S.unit, S.weekStart])

  return <>
    <div className="hdr"><button className="iconbtn" data-back="/stats" onClick={() => nav('/stats')} aria-label={t('Stats')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>{t('Milestones')}</h1>
        <div className="sub">{t('Workouts, weeks in a row, total volume and your big lifts.')}</div></div></div>

    {next.length > 0 && <>
      <h4 className="sec">{t('Next up')}</h4>
      <div className="list">
        {next.map(m => <div key={m.id} className="item ms-next">
          <div className="ms-ico dim"><Icon name={milestoneIcon(m)} /></div>
          <div className="grow">
            <div className="tt"><MilestoneTitle m={m} unit={unit} /></div>
            <div className="wprog ms-bar" role="progressbar" aria-valuemin={0} aria-valuemax={m.value} aria-valuenow={Math.min(m.have, m.value)}>
              <i style={{ width: Math.min(100, (m.have / m.value) * 100) + '%' }} /></div>
            <div className="ss">{fmtNum(Math.round(m.have))} / {fmtNum(m.value)}{m.kind === 'volume' || m.kind === 'lift' ? ' ' + unit : ''}</div>
          </div>
        </div>)}
      </div>
    </>}

    <h4 className="sec">{t('Reached')}</h4>
    {reached.length
      ? <div className="list">{reached.map(m => <MilestoneRow key={m.id} m={m} unit={unit} />)}</div>
      : <div className="empty"><div className="ico"><Icon name="medal" /></div>{t('Your first workout is your first milestone.')}</div>}
  </>
}
