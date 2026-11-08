/** One forecast month: the trend line's value and a range around it. */
export interface ForecastPoint {
  value: number;
  low: number;
  high: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The last day of a YYYY-MM month, as YYYY-MM-DD. */
export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** The date a month is counted at: its last day, or `asOf` if that's sooner, so the current month stops at today. */
const countedAt = (month: string, asOf: string) => {
  const end = monthEnd(month);
  return asOf < end ? asOf : end;
};

/** Papers published by the end of each month (or by `asOf`): a running total. Dates are YYYY-MM-DD. */
export function cumulativeByMonth(published: string[], months: string[], asOf: string): number[] {
  return months.map((month) => {
    const end = countedAt(month, asOf);
    return published.filter((d) => d <= end).length;
  });
}

/** People here at the end of each month (or on `asOf`): started by then, and not yet left. */
export function headcountByMonth(people: { started: string; ended: string | null }[], months: string[], asOf: string): number[] {
  return months.map((month) => {
    const end = countedAt(month, asOf);
    return people.filter((p) => p.started <= end && (p.ended === null || p.ended > end)).length;
  });
}

/** The months after `last` (YYYY-MM), `count` of them. */
export function nextMonths(last: string, count: number): string[] {
  const [y, m] = last.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

/** Counts move in whole units, so even a history that never moved can't promise less than half a unit a month. */
const MIN_SPREAD = 0.5;

/**
 * A straight-line forecast: least squares through the last `window` months, carried `horizon` months on. The range
 * widens with distance – a spread times 1.28 (an 80% band) times √(months ahead) – and never goes below zero. The
 * spread is the larger of how far the window strays from its line and how much the whole history moves month to month,
 * so a stretch that happens to be flat still has a range; never under MIN_SPREAD. A running total can't fall, so with
 * `nonDecreasing` the line and its range stay at or above the last actual value.
 */
/** The standard deviation of the month-to-month changes over the whole history. */
function stepSd(values: number[]): number {
  const steps = values.slice(1).map((v, i) => v - values[i]);
  if (steps.length < 2) return 0;
  const mean = steps.reduce((s, d) => s + d, 0) / steps.length;
  return Math.sqrt(steps.reduce((s, d) => s + (d - mean) ** 2, 0) / (steps.length - 1));
}

export function linearForecast(values: number[], horizon: number, { window = 12, nonDecreasing = false } = {}): ForecastPoint[] {
  if (!values.length || horizon <= 0) return [];
  const ys = values.slice(-window);
  const n = ys.length;
  const last = ys[n - 1];
  const meanX = (n - 1) / 2;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;
  const sxx = ys.reduce((s, _, x) => s + (x - meanX) ** 2, 0);
  const slope = sxx ? ys.reduce((s, y, x) => s + (x - meanX) * (y - meanY), 0) / sxx : 0;
  const intercept = meanY - slope * meanX;
  const residuals = ys.map((y, x) => y - (intercept + slope * x));
  const residualSd = n > 2 ? Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / (n - 2)) : 0;
  const sd = Math.max(residualSd, stepSd(values), MIN_SPREAD);
  const floor = nonDecreasing ? last : 0;
  return Array.from({ length: horizon }, (_, i) => {
    const h = i + 1;
    const value = Math.max(floor, intercept + slope * (n - 1 + h));
    const spread = 1.28 * sd * Math.sqrt(h);
    return { value: round1(value), low: round1(Math.max(floor, value - spread)), high: round1(Math.max(floor, value + spread)) };
  });
}
