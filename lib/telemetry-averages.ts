export function averageAvailableSensorValues(values: readonly unknown[]): number | null {
  let total = 0;
  let count = 0;

  for (const value of values) {
    if (typeof value !== 'number' && typeof value !== 'string') continue;
    if (typeof value === 'string' && value.trim() === '') continue;

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) continue;
    total += parsed;
    count += 1;
  }

  return count ? total / count : null;
}
