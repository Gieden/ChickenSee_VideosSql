'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

export interface InactivityOptions {
  /** Total inactivity window in milliseconds before force-logout. Default: 60 000 (1 min) */
  timeoutMs?: number;
  /** How many ms before logout to show the warning countdown. Default: 20 000 (20 s) */
  warningMs?: number;
  /** Called when the inactivity timeout is reached – should perform the actual logout. */
  onTimeout: () => void;
}

export interface InactivityState {
  /** Whether the "session about to expire" warning modal should be shown. */
  showWarning: boolean;
  /** Seconds remaining until force-logout (only meaningful when showWarning is true). */
  secondsLeft: number;
  /** Call this to dismiss the warning and reset the inactivity timer. */
  resetTimer: () => void;
}

// Activity events that prove the user is present (all on window)
const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  'mousemove',
  'mousedown',
  'keydown',
  'touchstart',
  'scroll',
  'wheel',
  'click',
  'focus',
];

export function useInactivityLogout({
  timeoutMs = 60_000,
  warningMs = 20_000,
  onTimeout,
}: InactivityOptions): InactivityState {
  const [showWarning, setShowWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  // Stable ref to the timeout callback so we don't re-register listeners
  const onTimeoutRef = useRef(onTimeout);
  useEffect(() => { onTimeoutRef.current = onTimeout; }, [onTimeout]);

  const logoutTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const warningShownAt   = useRef<number>(0);

  const clearAllTimers = useCallback(() => {
    if (logoutTimerRef.current)  clearTimeout(logoutTimerRef.current);
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    if (countdownRef.current)    clearInterval(countdownRef.current);
  }, []);

  const startCountdown = useCallback((msRemaining: number) => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    warningShownAt.current = Date.now();
    const totalSecs = Math.ceil(msRemaining / 1000);
    setSecondsLeft(totalSecs);

    countdownRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - warningShownAt.current) / 1000);
      const remaining = totalSecs - elapsed;
      if (remaining <= 0) {
        if (countdownRef.current) clearInterval(countdownRef.current);
        setSecondsLeft(0);
      } else {
        setSecondsLeft(remaining);
      }
    }, 1000);
  }, []);

  const resetTimer = useCallback(() => {
    clearAllTimers();
    setShowWarning(false);

    // Schedule the warning
    const warningDelay = timeoutMs - warningMs;
    warningTimerRef.current = setTimeout(() => {
      setShowWarning(true);
      startCountdown(warningMs);
    }, warningDelay);

    // Schedule the force-logout
    logoutTimerRef.current = setTimeout(() => {
      clearAllTimers();
      setShowWarning(false);
      onTimeoutRef.current();
    }, timeoutMs);
  }, [timeoutMs, warningMs, clearAllTimers, startCountdown]);

  useEffect(() => {
    // Kick off the initial timer
    resetTimer();

    // Listen for any user activity
    const handleActivity = () => {
      // Only reset if the warning isn't already showing – once the warning
      // appears the user must explicitly click "Stay Signed In".
      if (!showWarning) resetTimer();
    };

    ACTIVITY_EVENTS.forEach((evt) =>
      window.addEventListener(evt, handleActivity, { passive: true }),
    );

    return () => {
      clearAllTimers();
      ACTIVITY_EVENTS.forEach((evt) =>
        window.removeEventListener(evt, handleActivity),
      );
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount-only – resetTimer is stable via useCallback

  return { showWarning, secondsLeft, resetTimer };
}
