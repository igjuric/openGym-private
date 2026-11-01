// The weekly summary, the server's side. A hand copy of frontend/src/lib/weekly-summary.js (and
// of the few lines of lib/blocks.js and lib/format.js it needs), as nudge.js is of lib/nudge.js:
// the api image carries no frontend. test/weekly-summary.test.js runs the frontend's cases.
// The one difference: the volume is the total saved with each workout (`w.vol`), since the
// server has no copy of the app's volume rules.

export const SUMMARY_FROM = '19:00';
export const SUMMARY_UNTIL = '21:30';

const MONDAY = 1, SUNDAY = 0;
const weekStartOf = S => (S?.weekStart === SUNDAY ? SUNDAY : MONDAY);
const dayNo = iso => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5);
const weekDay = iso => new Date(iso + 'T12:00:00Z').getUTCDay();
// The first day of the week `iso` falls in, as a day number (days since 1970-01-01).
const weekStartNo = (iso, ws) => dayNo(iso) - ((weekDay(iso) - ws + 7) % 7);

/** Whether a date is the last day of the profile's week. */
export const isLastDayOfWeek = (S, iso) => (weekDay(iso) - weekStartOf(S) + 7) % 7 === 6;

/** Open from 19:00 until 21:30 on the user's clock, so a restart in the evening still sends it. */
export const summaryWindowOpen = hhmm => typeof hhmm === 'string' && hhmm >= SUMMARY_FROM && hhmm <= SUMMARY_UNTIL;

// lib/blocks.js blockWeeks and blockWeekOf, reduced to the week number and length.
function blockWeekOf(S, iso) {
  const b = S?.block;
  if (!b || (b.kind !== 'strength' && b.kind !== 'deload') || typeof b.start !== 'string') return null;
  const of = Math.max(2, Math.min(16, Math.round(Number(b.weeks)) || (b.kind === 'deload' ? 6 : 8)));
  const ws = weekStartOf(S);
  const k = Math.round((weekStartNo(iso, ws) - weekStartNo(b.start, ws)) / 7);
  if (k < 0 || (k >= of && !b.repeat)) return null;
  return { week: (k % of) + 1, of };
}

/** The week `iso` falls in: { workouts, volume, prs, block: { week, of } | null }. */
export function weekSummary(S, iso) {
  const ws = weekStartOf(S);
  const key = weekStartNo(iso, ws);
  const week = (Array.isArray(S?.workouts) ? S.workouts : [])
    .filter(w => w && typeof w.d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(w.d) && weekStartNo(w.d, ws) === key);
  return {
    workouts: week.length,
    volume: Math.round(week.reduce((n, w) => n + (Number.isFinite(Number(w.vol)) ? Math.max(0, Number(w.vol)) : 0), 0)),
    prs: week.reduce((n, w) => n + (Array.isArray(w.prs) ? w.prs.length : 0), 0),
    block: blockWeekOf(S, iso),
  };
}
