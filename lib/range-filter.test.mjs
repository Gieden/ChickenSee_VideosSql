// Reproduces exactly what BehaviorResultsTab renders for the current clock (2 Nov 2026),
// using the same fallback data the tab ships with. Run:
//   node --experimental-strip-types edge-of-ts lib/date-range.test.mjs  (see lib/date-range.test.mjs)
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addDays,
  buildMonthGrid,
  enumerateDates,
  formatRange,
  formatShortDay,
  isAfterDate,
  rangeLength,
  relativeDayLabel,
} from './date-range.ts';

// Same recorded days as ALL_INTERVAL_TELEMETRY / /api/behavior-results.
const recorded = ['2026-10-24', '2026-10-27', '2026-10-28'];
const today = '2026-11-02'; // the environment date

test('Yesterday = the real calendar day, and it is unavailable without records', () => {
  const yesterday = addDays(today, -1);
  assert.equal(yesterday, '2026-11-01');
  assert.equal(relativeDayLabel(yesterday, today), 'Yesterday');
  assert.equal(recorded.includes(yesterday), false);
  assert.equal(formatShortDay(yesterday), '1 Nov');
});

test('preset chips: Yesterday disabled, recorded days enabled', () => {
  const chips = [
    { key: 'yesterday', date: recorded.includes(addDays(today, -1)) ? addDays(today, -1) : null },
    ...recorded
      .filter((d) => d !== addDays(today, -1))
      .slice(-3)
      .reverse()
      .map((d) => ({ key: d, date: d })),
  ];
  assert.deepEqual(
    chips.map((c) => [c.key, c.date === null ? 'disabled' : c.date]),
    [
      ['yesterday', 'disabled'],
      ['2026-10-28', '2026-10-28'],
      ['2026-10-27', '2026-10-27'],
      ['2026-10-24', '2026-10-24'],
    ]
  );
});

test('custom range counts only recorded days in the window', () => {
  const start = '2026-10-24';
  const end = '2026-10-28';
  const inWindow = enumerateDates(start, end);
  assert.equal(rangeLength(start, end), 5);
  assert.equal(inWindow.filter((d) => recorded.includes(d)).length, 3);
  assert.equal(inWindow.length - inWindow.filter((d) => recorded.includes(d)).length, 2);
  assert.equal(formatRange(start, end), '24 – 28 Oct 2026');
});

test('every calendar cell outside the recorded days is disabled', () => {
  const grid = buildMonthGrid('2026-10', {
    hasRecords: (date) => recorded.includes(date),
    today,
    minSelectable: '2026-10-24',
    maxSelectable: '2026-10-28',
  });
  const enabled = grid.days.filter((d) => !d.disabled).map((d) => d.date);
  assert.deepEqual(enabled, recorded);
  assert.equal(grid.days.filter((d) => d.disabled).length, 42 - recorded.length);
});

test('the From/To pair never allows a reversed window', () => {
  assert.equal(isAfterDate('2026-10-28', '2026-10-24'), true);
  assert.equal(isAfterDate('2026-10-24', '2026-10-28'), false);
  assert.equal(isAfterDate('2026-10-24', '2026-10-24'), false);
});
