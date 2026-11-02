'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';

import {
  IsoDate,
  WEEKDAY_LETTERS,
  buildMonthGrid,
  formatLongDay,
  monthKey,
  monthLabelFromKey,
  relativeDayLabel,
  shiftMonthKey,
  todayIso,
} from '@/lib/date-range';

interface RangeAwareDatePickerProps {
  /** Currently selected value (`YYYY-MM-DD`). */
  value: IsoDate;
  onChange: (value: IsoDate) => void;
  /** Dates that actually contain telemetry records. Only these are selectable. */
  selectableDates: IsoDate[];
  /** Optional inclusive window (e.g. the other end of a From/To pair). */
  minSelectable?: IsoDate | null;
  maxSelectable?: IsoDate | null;
  label?: string;
  disabled?: boolean;
  /** Extra footer hint, e.g. "3 recorded days in this range". */
  hint?: string;
  className?: string;
}

/**
 * Calendar trigger + popover that disables every day without telemetry records.
 *
 * `recordedDates` can be any size (it is turned into a Set once per change), so the calendar
 * stays O(42) per render regardless of how long the edge device has been recording.
 */
export default function RangeAwareDatePicker({
  value,
  onChange,
  selectableDates,
  minSelectable = null,
  maxSelectable = null,
  label,
  disabled = false,
  hint,
  className = '',
}: RangeAwareDatePickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState<string>(() => (value ? value.slice(0, 7) : monthKey(new Date().getFullYear(), new Date().getMonth())));

  const recorded = useMemo(() => new Set(selectableDates), [selectableDates]);
  const today = todayIso();

  const hasRecords = (date: IsoDate) => recorded.has(date);

  const ordered = useMemo(() => Array.from(recorded).sort(), [recorded]);
  const latestRecorded = ordered.length ? ordered[ordered.length - 1] : null;
  const earliestRecorded = ordered.length ? ordered[0] : null;

  // Allowed navigation window: never scroll away from the recorded period by more than
  // one month on either side, so the user cannot get lost in empty calendars.
  const minMonth = earliestRecorded ? shiftMonthKey(earliestRecorded.slice(0, 7), -1) : null;
  const maxMonth = shiftMonthKey((latestRecorded ?? today).slice(0, 7), 1);

  const canGoPrev = !minMonth || viewMonth > minMonth;
  const canGoNext = viewMonth < maxMonth;

  useEffect(() => {
    if (open && value) setViewMonth(value.slice(0, 7));
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const grid = useMemo(
    () =>
    buildMonthGrid(viewMonth, {
      hasRecords,
      today,
      minSelectable: minSelectable ?? earliestRecorded,
      maxSelectable: maxSelectable ?? latestRecorded,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewMonth, recorded, today, minSelectable, maxSelectable, earliestRecorded, latestRecorded]
  );

  const select = (date: IsoDate) => {
    onChange(date);
    setOpen(false);
  };

  const jumpToNearestRecord = () => {
    if (!latestRecorded) return;
    // Prefer the closest recorded day to the current value, else the latest one.
    const closest = ordered.reduce((best, candidate) =>
      Math.abs(Date.parse(candidate) - Date.parse(value)) < Math.abs(Date.parse(best) - Date.parse(value))
        ? candidate
        : best
      , latestRecorded);
    select(closest);
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {label && (
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          {label}
        </span>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex w-full min-w-[11.5rem] items-center justify-between gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold shadow-sm transition ${disabled
            ? 'cursor-not-allowed border-slate-100 bg-slate-50 text-slate-400'
            : 'border-slate-200 bg-white text-slate-800 hover:border-orange-400 hover:text-orange-600'
          } ${open ? 'border-orange-500 ring-2 ring-orange-100' : ''}`}
      >
        <span className="flex items-center gap-1.5">
          <CalendarDays className="h-3.5 w-3.5 text-orange-500" />
          {value ? formatLongDay(value) : 'Select date'}
        </span>
        <span className="text-[10px] font-medium text-slate-400">
          {value ? relativeDayLabel(value, today) : ''}
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose a date"
          className="absolute left-0 top-full z-50 mt-2 w-[19.5rem] rounded-2xl border border-slate-200 bg-white p-3 shadow-xl"
        >
          <div className="flex items-center justify-between pb-2">
            <button
              type="button"
              disabled={!canGoPrev}
              onClick={() => setViewMonth((current) => shiftMonthKey(current, -1))}
              className="rounded-lg p-1 text-slate-500 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs font-bold text-slate-800">{monthLabelFromKey(viewMonth)}</span>
            <button
              type="button"
              disabled={!canGoNext}
              onClick={() => setViewMonth((current) => shiftMonthKey(current, 1))}
              className="rounded-lg p-1 text-slate-500 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 pb-1">
            {WEEKDAY_LETTERS.map((letter) => (
              <span key={letter} className="py-1 text-center text-[10px] font-bold text-slate-400">
                {letter}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {grid.days.map((day) => {
              const isSelected = day.date === value;
              const base = 'relative flex h-8 items-center justify-center rounded-lg text-[11px] font-semibold transition';
              const style = isSelected
                ? 'bg-orange-600 text-white shadow-sm'
                : day.disabled
                  ? 'cursor-not-allowed text-slate-300'
                  : day.inMonth
                    ? 'text-slate-700 hover:bg-orange-50 hover:text-orange-700'
                    : 'text-slate-400 hover:bg-slate-50';
              return (
                <button
                  key={day.date}
                  type="button"
                  disabled={day.disabled}
                  onClick={() => select(day.date)}
                  aria-label={
                    day.disabled
                      ? `${formatLongDay(day.date)} — no telemetry recorded`
                      : formatLongDay(day.date)
                  }
                  aria-current={isSelected ? 'date' : undefined}
                  title={day.disabled ? 'No telemetry recorded' : undefined}
                  className={`${base} ${style} ${day.isToday && !isSelected ? 'ring-1 ring-orange-300' : ''}`}
                >
                  {day.dayOfMonth}
                  {day.hasRecords && !isSelected && (
                    <span className="absolute bottom-[3px] h-1 w-1 rounded-full bg-emerald-500" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 text-[10px] text-slate-500">
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {recorded.size} recorded {recorded.size === 1 ? 'day' : 'days'}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={jumpToNearestRecord}
                disabled={!latestRecorded}
                className="inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 font-semibold text-orange-600 transition hover:bg-orange-50 disabled:opacity-40"
              >
                <RotateCcw className="h-3 w-3" /> Nearest recorded
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-1.5 py-0.5 font-semibold text-slate-500 transition hover:bg-slate-100"
              >
                Close
              </button>
            </div>
          </div>

          {hint && <p className="mt-1.5 text-[10px] leading-relaxed text-slate-400">{hint}</p>}
        </div>
      )}
    </div>
  );
}
