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

/** Papers published by the end of each month: a running total. Dates are YYYY-MM-DD. */
export function cumulativeByMonth(published: string[], months: string[]): number[] {
  return months.map((month) => {
    const end = monthEnd(month);
    return published.filter((d) => d <= end).length;
  });
}

/** People here at the end of each month: started by then, and not yet left. */
export function headcountByMonth(people: { started: string; ended: string | null }[], months: string[]): number[] {
  return months.map((month) => {
    const end = monthEnd(month);
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

/**
 * A straight-line forecast: least squares through the last `window` months, carried `horizon` months on. The range
 * widens with distance – the residuals' standard deviation times 1.28 (an 80% band) times √(months ahead) – and never
 * goes below zero. A running total can't fall, so with `nonDecreasing` the line and its range stay at or above the last
 * actual value.
 */
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
  const sd = n > 2 ? Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / (n - 2)) : 0;
  const floor = nonDecreasing ? last : 0;
  return Array.from({ length: horizon }, (_, i) => {
    const h = i + 1;
    const value = Math.max(floor, intercept + slope * (n - 1 + h));
    const spread = 1.28 * sd * Math.sqrt(h);
    return { value: round1(value), low: round1(Math.max(floor, value - spread)), high: round1(Math.max(floor, value + spread)) };
  });
}
