// The weekly summary, the server's side (weekly-summary.js) and its push text (push-messages.js).
// The cases mirror frontend/src/lib/weekly-summary.test.js, so the two copies answer alike.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLastDayOfWeek, summaryWindowOpen, weekSummary } from '../weekly-summary.js';
import { summaryPush } from '../push-messages.js';

const wo = (d, vol = 1000, prs = []) => ({ id: d, d, vol, prs });

test('the last day of the week is Sunday for a Monday week and Saturday for a Sunday week', () => {
  // 2026-11-01 is a Sunday, 2026-10-31 a Saturday.
  assert.equal(isLastDayOfWeek({ weekStart: 1 }, '2026-11-01'), true);
  assert.equal(isLastDayOfWeek({ weekStart: 1 }, '2026-10-31'), false);
  assert.equal(isLastDayOfWeek({ weekStart: 0 }, '2026-10-31'), true);
  assert.equal(isLastDayOfWeek({}, '2026-11-01'), true);
});

test('the window is 19:00 to 21:30', () => {
  assert.equal(summaryWindowOpen('18:59'), false);
  assert.equal(summaryWindowOpen('19:00'), true);
  assert.equal(summaryWindowOpen('21:30'), true);
  assert.equal(summaryWindowOpen('21:31'), false);
  assert.equal(summaryWindowOpen(undefined), false);
});

test('a week counts its own workouts, volume and records, not the week before', () => {
  const S = { weekStart: 1, workouts: [wo('2026-10-25', 999, ['x']), wo('2026-10-26', 1200, ['0025']), wo('2026-10-28', 800), wo('2026-11-01', 1000, ['a', 'b'])] };
  assert.deepEqual(weekSummary(S, '2026-11-01'), { workouts: 3, volume: 3000, prs: 3, block: null });
  assert.deepEqual(weekSummary(S, '2026-10-25'), { workouts: 1, volume: 999, prs: 1, block: null });
});

test('a training block says where it stands, and nothing once one that does not repeat is over', () => {
  const S = { weekStart: 1, workouts: [], block: { kind: 'strength', weeks: 8, start: '2026-09-14', repeat: true } };
  assert.deepEqual(weekSummary(S, '2026-11-01').block, { week: 7, of: 8 });
  assert.deepEqual(weekSummary({ ...S, block: { ...S.block, repeat: true } }, '2026-11-15').block, { week: 1, of: 8 });
  assert.equal(weekSummary({ ...S, block: { ...S.block, repeat: false } }, '2026-11-15').block, null);
});

test('the push lists what the week had, without the zeros', () => {
  assert.deepEqual(summaryPush('en', { workouts: 3, volume: 12400, prs: 2, block: { week: 6, of: 8 } }, 'kg'),
    { title: 'Your week', body: '3 workouts · 12,400 kg lifted · 2 PRs · Week 6 of 8', tag: 'weekly-summary' });
  assert.equal(summaryPush('en', { workouts: 1, volume: 0, prs: 0, block: null }, 'lb').body, '1 workout');
  assert.equal(summaryPush('en', { workouts: 0, volume: 0, prs: 0, block: null }, 'kg').body, 'No workouts this week. A new week starts tomorrow.');
});

test('the push speaks the profile language, plural forms included', () => {
  assert.equal(summaryPush('de', { workouts: 2, volume: 0, prs: 0, block: null }, 'kg').title, 'Deine Woche');
  assert.match(summaryPush('ru', { workouts: 5, volume: 0, prs: 0, block: null }, 'kg').body, /^5 тренировок/);
  assert.match(summaryPush('ru', { workouts: 2, volume: 0, prs: 0, block: null }, 'kg').body, /^2 тренировки/);
});
