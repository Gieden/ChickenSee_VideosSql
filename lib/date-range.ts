/**
 * lib/date-range.ts — date helpers for the Telemetry & Behavior Range Filter.
 *
 * Everything is expressed as local `YYYY-MM-DD` keys. We never round-trip through
 * `new Date().toISOString()` for display, because that converts to UTC first and shifts
 * every date by one day for users east/west of UTC (the "Yesterday (28 Oct)" label that
 * was stuck on a hard-coded day came from exactly this class of bug).
 */

export const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

const MONTH_VIEW_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const DAY_LETTERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

export type IsoDate = string; // YYYY-MM-DD

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Local calendar date of `date` as `YYYY-MM-DD`. */
export function toIsoDate(date: Date): IsoDate {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Today's local calendar date (`YYYY-MM-DD`). */
export function todayIso(): IsoDate {
  return toIsoDate(new Date());
}

/** Parse `YYYY-MM-DD` into a *local* midnight Date (never UTC). */
export function parseIsoDate(value: IsoDate): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
}

export function isIsoDate(value: unknown): value is IsoDate {
  return typeof value === 'string' && parseIsoDate(value) !== null;
}

/** Add (or subtract) whole calendar days without DST drift. */
export function addDays(value: IsoDate, days: number): IsoDate {
  const base = parseIsoDate(value);
  if (!base) return value;
  base.setDate(base.getDate() + days);
  return toIsoDate(base);
}

/** Whole-day difference `to - from` (negative when `to` precedes `from`). */
export function diffDays(from: IsoDate, to: IsoDate): number {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  if (!a || !b) return 0;
  // Compare the two *local* midnights and round to the nearest whole day. Using local
  // timestamps (not Date.UTC) keeps this correct even when the host's tz database cannot
  // agree with the runtime about a DST transition inside the span.
  const aUtc = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const bUtc = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((bUtc - aUtc) / 86_400_000);
}

/** `true` when calendar date `a` is strictly later than `b` (both `YYYY-MM-DD`). */
export function isAfterDate(a: IsoDate, b: IsoDate): boolean {
  // ISO dates sort lexicographically, so no numeric arithmetic (and no rounding) is involved.
  return typeof a === 'string' && typeof b === 'string' && a.length === 10 && b.length === 10 && a > b;
}

/** Inclusive list of dates from `from` to `to`; empty when reversed. */
export function enumerateDates(from: IsoDate, to: IsoDate): IsoDate[] {
  const span = diffDays(from, to);
  if (span < 0) return [];
  const out: IsoDate[] = [];
  for (let offset = 0; offset <= span; offset += 1) out.push(addDays(from, offset));
  return out;
}

/** "28 Oct" */
export function formatShortDay(value: IsoDate): string {
  const date = parseIsoDate(value);
  if (!date) return value;
  return `${date.getDate()} ${MONTH_SHORT[date.getMonth()]}`;
}

/** "28 Oct 2026" */
export function formatLongDay(value: IsoDate): string {
  const date = parseIsoDate(value);
  if (!date) return value;
  return `${date.getDate()} ${MONTH_SHORT[date.getMonth()]} ${date.getFullYear()}`;
}

/** "Wednesday, 28 Oct 2026" */
export function formatWeekdayDay(value: IsoDate): string {
  const date = parseIsoDate(value);
  if (!date) return value;
  const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getDay()];
  return `${weekday}, ${formatLongDay(value)}`;
}

/** "Today", "Yesterday" or the short date (anchored on the provided `today`). */
export function relativeDayLabel(value: IsoDate, today: IsoDate = todayIso()): string {
  const delta = diffDays(value, today);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Yesterday';
  if (delta === -1) return 'Tomorrow';
  if (delta > 1 && delta <= 7) return `${delta} days ago`;
  return formatShortDay(value);
}

/** "28 Oct · Yesterday" (used in compact chips). */
export function dayChipLabel(value: IsoDate, today: IsoDate = todayIso()): string {
  const relative = relativeDayLabel(value, today);
  return relative === formatShortDay(value) ? formatShortDay(value) : `${formatShortDay(value)} · ${relative}`;
}

/**
 * Compact human label for an inclusive range.
 * Same day → "28 Oct 2026"; same year → "24 – 28 Oct 2026"; else both years.
 */
export function formatRange(from: IsoDate, to: IsoDate): string {
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  if (!start || !end) return `${from} to ${to}`;
  if (from === to) return formatLongDay(from);
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return `${start.getDate()} – ${formatLongDay(to)}`;
  }
  if (start.getFullYear() === end.getFullYear()) {
    return `${formatShortDay(from)} – ${formatLongDay(to)}`;
  }
  return `${formatLongDay(from)} – ${formatLongDay(to)}`;
}

/** Inclusive day count (0 for an invalid range). */
export function rangeLength(from: IsoDate, to: IsoDate): number {
  const span = diffDays(from, to);
  return span < 0 ? 0 : span + 1;
}

// ── Calendar grid ────────────────────────────────────────────────────────────

export interface CalendarDay {
  date: IsoDate;
  dayOfMonth: number;
  inMonth: boolean;
  isToday: boolean;
  isFuture: boolean;
  /** Days before the first recorded date (outside the recorded span). */
  isBeforeRange: boolean;
  hasRecords: boolean;
  disabled: boolean;
}

export interface CalendarMonth {
  /** `YYYY-MM` key. */
  key: string;
  year: number;
  month: number; // 0-based
  label: string; // "October 2026"
  days: CalendarDay[];
}

export function monthKey(year: number, month: number): string {
  return `${year}-${pad(month + 1)}`;
}

export function monthLabelFromKey(key: string): string {
  const [year, month] = key.split('-').map(Number);
  const validMonth = Number.isInteger(month) && month >= 1 && month <= 12;
  const validYear = Number.isInteger(year);
  if (!validYear || !validMonth) return key;
  return `${MONTH_VIEW_LONG[month - 1]} ${year}`;
}

export function shiftMonthKey(key: string, delta: number): string {
  const [year, month] = key.split('-').map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return key;
  const shifted = new Date(year, month - 1 + delta, 1);
  return monthKey(shifted.getFullYear(), shifted.getMonth());
}

export interface MonthGridOptions {
  hasRecords: (date: IsoDate) => boolean;
  today?: IsoDate;
  /** Earliest / latest date the filter may ever address (defaults: none). */
  minSelectable?: IsoDate | null;
  maxSelectable?: IsoDate | null;
}

/**
 * Build a Sunday-first 6-week grid for one month.
 * A cell is disabled when it is future, has no recorded intervals, or falls outside
 * the selectable span — those cells are rendered but cannot be selected.
 */
export function buildMonthGrid(month: string, options: MonthGridOptions): CalendarMonth {
  const [year, monthIndex] = month.split('-').map(Number);
  const first = new Date(year, monthIndex - 1, 1);
  const gridStart = addDays(toIsoDate(first), -first.getDay());
  const today = options.today ?? todayIso();
  const days: CalendarDay[] = [];

  for (let index = 0; index < 42; index += 1) {
    const date = addDays(gridStart, index);
    const parsed = parseIsoDate(date)!;
    const inMonth = parsed.getMonth() === monthIndex - 1;
    const hasRecords = options.hasRecords(date);
    const isFuture = isAfterDate(date, today);
    const isBeforeRange = options.minSelectable ? isAfterDate(options.minSelectable, date) : false;
    const isAfterRange = options.maxSelectable ? isAfterDate(date, options.maxSelectable) : false;
    days.push({
      date,
      dayOfMonth: parsed.getDate(),
      inMonth,
      isToday: date === today,
      isFuture,
      isBeforeRange,
      hasRecords,
      disabled: isFuture || !hasRecords || isBeforeRange || isAfterRange,
    });
  }

  return {
    key: month,
    year,
    month: monthIndex - 1,
    label: `${MONTH_VIEW_LONG[monthIndex - 1]} ${year}`,
    days,
  };
}

export const WEEKDAY_LETTERS = DAY_LETTERS;
