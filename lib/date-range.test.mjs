/**
 * Date-range helpers used by the Telemetry & Behavior Range Filter.
 * Run with: node --test lib/
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addDays,
  buildMonthGrid,
  diffDays,
  enumerateDates,
  formatRange,
  relativeDayLabel,
  todayIso,
  toIsoDate,
} from './date-range.ts';

test('todayIso is the local calendar day, not the UTC day', () => {
  const local = new Date(2026, 10, 2, 23, 30); // 2 Nov 2026, 23:30 local
  assert.equal(toIsoDate(local), '2026-11-02');
  // A late-evening local time would roll to Nov 3 in UTC+ timezones via toISOString().
  const earlyMorning = new Date(2026, 10, 2, 0, 15);
  assert.equal(toIsoDate(earlyMorning), '2026-11-02');
});

test('relativeDayLabel anchors on the supplied today', () => {
  assert.equal(relativeDayLabel('2026-11-01', '2026-11-02'), 'Yesterday');
  assert.equal(relativeDayLabel('2026-11-02', '2026-11-02'), 'Today');
  assert.equal(relativeDayLabel('2026-10-28', '2026-11-02'), '5 days ago');
  assert.equal(relativeDayLabel('2026-10-24', '2026-11-02'), '24 Oct');
});

test('addDays / diffDays survive month and DST boundaries', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-11-01', -1), '2026-10-31');
  assert.equal(addDays('2026-03-08', 1), '2026-03-09'); // US DST spring-forward
  assert.equal(diffDays('2026-10-24', '2026-11-02'), 9);
  assert.equal(diffDays('2026-11-02', '2026-10-24'), -9);
});

test('enumerateDates is inclusive and rejects reversed ranges', () => {
  assert.deepEqual(enumerateDates('2026-10-30', '2026-11-02'), [
    '2026-10-30',
    '2026-10-31',
    '2026-11-01',
    '2026-11-02',
  ]);
  assert.deepEqual(enumerateDates('2026-11-02', '2026-10-30'), []);
});

test('formatRange collapses a same-month range', () => {
  assert.equal(formatRange('2026-10-24', '2026-10-28'), '24 – 28 Oct 2026');
  assert.equal(formatRange('2026-10-28', '2026-10-28'), '28 Oct 2026');
  assert.equal(formatRange('2026-10-30', '2026-11-02'), '30 Oct – 2 Nov 2026');
});

test('calendar disables days with no records and future days', () => {
  const recorded = new Set(['2026-10-24', '2026-10-27', '2026-10-28']);
  const grid = buildMonthGrid('2026-10', {
    hasRecords: (date) => recorded.has(date),
    today: '2026-11-02',
    minSelectable: '2026-10-24',
    maxSelectable: '2026-10-28',
  });
  const selectable = grid.days.filter((day) => !day.disabled).map((day) => day.date);
  assert.deepEqual(selectable, ['2026-10-24', '2026-10-27', '2026-10-28']);
  assert.equal(grid.days.length, 42);
  assert.equal(grid.label, 'October 2026');
});

test('an empty day is disabled even inside the recorded span', () => {
  const grid = buildMonthGrid('2026-11', {
    hasRecords: (date) => date === '2026-11-02',
    today: '2026-11-02',
  });
  const nov1 = grid.days.find((day) => day.date === '2026-11-01');
  const nov2 = grid.days.find((day) => day.date === '2026-11-02');
  assert.equal(nov1?.disabled, true);
  assert.equal(nov1?.hasRecords, false);
  assert.equal(nov2?.disabled, false);
  assert.equal(nov2?.isToday, true);
});

test('todayIso defaults to a real ISO date', () => {
  assert.match(todayIso(), /^\d{4}-\d{2}-\d{2}$/);
});
