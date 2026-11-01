// Training blocks (lib/blocks.js) on the Plan screen: a card that says where you are, and the
// sheet that starts, changes or stops a block. Off by default; the weekly plan then repeats.
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { BLOCK_KINDS, blockWeeks, blockWeekOf, newBlock } from '../lib/blocks.js'
import { t, tn } from '../lib/i18n.js'
import { Button, Row, Section, Segmented, Switch } from './ui.jsx'

const PHASE_NAME = { build: 'Build phase', strength: 'Strength phase', deload: 'Deload week' }
const PHASE_TEXT = { build: 'Your plan as it is', strength: 'Heavier, fewer reps, one set more', deload: 'Light and easy: half the reps at 60% of the weight' }

/** "Week 3 of 8 · Strength phase", or null with no block running. */
export function blockLabel(S) {
  const w = blockWeekOf(S)
  return w ? t('Week {0} of {1}', w.week, w.of) + ' · ' + t(PHASE_NAME[w.phase]) : null
}

// A row under Plan's "How you train": where this week sits, or that there is no block.
export function BlockRow({ S }) {
  const label = blockLabel(S)
  const ended = S.block && !label
  return <Row icon="calendar" iconTint="var(--indigo)" title={t('Training block')} accessory="chevron" onClick={blockSheet}
    subtitle={label || (ended ? t('Your block is over. Your weekly plan repeats.') : t('Off. Your weekly plan repeats.'))} />
}

// Consecutive weeks of one phase as one line: "Weeks 1-4: Your plan as it is".
function phaseRuns(weeks) {
  const runs = []
  weeks.forEach((p, i) => {
    const last = runs[runs.length - 1]
    if (last && last.phase === p) last.to = i + 1
    else runs.push({ phase: p, from: i + 1, to: i + 1 })
  })
  return runs
}

function BlockSheet({ close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const cur = S.block && BLOCK_KINDS[S.block.kind] ? S.block : null
  const [kind, setKind] = useState(cur?.kind || 'strength')
  const [weeks, setWeeks] = useState(cur?.weeks || BLOCK_KINDS[kind].weeks)
  const [repeat, setRepeat] = useState(cur ? !!cur.repeat : true)
  const pickKind = k => { setKind(k); if (!BLOCK_KINDS[k].lengths.includes(weeks)) setWeeks(BLOCK_KINDS[k].weeks) }
  const plan = blockWeeks({ kind, weeks })
  const same = cur && cur.kind === kind && cur.weeks === weeks
  const save = () => {
    // The same kind and length keeps the block's start (only "start again" changed); anything
    // else starts a new block this week.
    update(s => { s.block = same ? { ...cur, repeat } : newBlock(s, kind, weeks, repeat) })
    useUI.getState().toast(same ? t('Saved') : t('Your block starts this week'))
    close()
  }
  const stop = () => { update(s => { s.block = null }); useUI.getState().toast(t('Back to your weekly plan')); close() }

  return <>
    <h3 style={{ marginTop: 0 }}>{t('Training block')}</h3>
    <p className="muted small" style={{ marginTop: 0 }}>{t('Your routines stay the same. A block changes the weights and reps week by week. Heavy and deload weeks do not count for progression.')}</p>
    <Segmented value={kind} onChange={pickKind}
      options={[{ value: 'strength', label: t('Strength block') }, { value: 'deload', label: t('Regular deload') }]} />
    <div style={{ height: 12 }} />
    <div className="chips" role="group" aria-label={t('Length')}>
      {BLOCK_KINDS[kind].lengths.map(n => <button key={n} type="button" className={'chip nocap' + (n === weeks ? ' on' : '')} onClick={() => setWeeks(n)}>{tn('{0} week', '{0} weeks', n)}</button>)}
    </div>
    <Section title={t('Week by week')}>
      {phaseRuns(plan).map(r => <Row key={r.from} icon={r.phase === 'deload' ? 'moon' : r.phase === 'strength' ? 'bolt' : 'chartLine'}
        iconTint={r.phase === 'deload' ? 'var(--indigo)' : r.phase === 'strength' ? 'var(--orange)' : 'var(--green)'}
        title={r.from === r.to ? t('Week {0}', r.from) : t('Weeks {0} to {1}', r.from, r.to)} subtitle={t(PHASE_TEXT[r.phase])} />)}
    </Section>
    <Section>
      <Row icon="repeat" iconTint="var(--blue)" title={t('Start again when it ends')} subtitle={repeat ? null : t('Then back to your weekly plan')}>
        <Switch checked={repeat} aria-label={t('Start again when it ends')} onChange={setRepeat} />
      </Row>
    </Section>
    <Button variant="primary" onClick={save}>{same ? t('Save') : cur ? t('Start the new block this week') : t('Start this week')}</Button>
    {cur && <><div style={{ height: 8 }} /><Button variant="danger" icon="xmark" onClick={stop}>{t('Stop the block')}</Button></>}
  </>
}

export const blockSheet = () => useUI.getState().openSheet(close => <BlockSheet close={close} />)
