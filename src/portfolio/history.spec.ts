import { cumulativeByMonth, headcountByMonth, linearForecast, monthEnd, nextMonths } from './history';

describe('history', () => {
  it('finds a month’s last day', () => {
    expect(monthEnd('2026-02')).toBe('2026-02-28');
    expect(monthEnd('2024-02')).toBe('2024-02-29');
    expect(monthEnd('2026-12')).toBe('2026-12-31');
  });

  it('counts papers published by the end of each month', () => {
    expect(cumulativeByMonth(['2026-01-15', '2026-03-01', '2026-03-31'], ['2025-12', '2026-01', '2026-02', '2026-03'], '2026-06-01')).toEqual([0, 1, 1, 3]);
  });

  it('counts the current month only up to today', () => {
    // On 8 November, a paper due out on the 20th isn't published yet; a start on the 15th hasn't happened.
    expect(cumulativeByMonth(['2026-10-02', '2026-11-03', '2026-11-20'], ['2026-10', '2026-11'], '2026-11-08')).toEqual([1, 2]);
    const people = [
      { started: '2026-01-05', ended: '2026-11-30' },
      { started: '2026-11-15', ended: null },
    ];
    expect(headcountByMonth(people, ['2026-10', '2026-11'], '2026-11-08')).toEqual([1, 1]);
  });

  it('counts people here at the end of each month', () => {
    const people = [
      { started: '2025-01-10', ended: null },
      { started: '2025-02-01', ended: '2025-03-15' },
      { started: '2025-04-01', ended: null },
    ];
    expect(headcountByMonth(people, ['2024-12', '2025-01', '2025-02', '2025-03', '2025-04'], '2025-06-01')).toEqual([0, 1, 2, 1, 2]);
  });

  it('lists the months after a month, across a year', () => {
    expect(nextMonths('2026-11', 3)).toEqual(['2026-12', '2027-01', '2027-02']);
  });

  it('carries a straight line on, with a range that widens', () => {
    const f = linearForecast([1, 2, 3, 4, 5, 6], 2);
    expect(f.map((p) => p.value)).toEqual([7, 8]);
    // A perfect line has no spread
    expect(f[0]).toEqual({ value: 7, low: 7, high: 7 });
    const noisy = linearForecast([2, 4, 3, 6, 5, 7], 3);
    expect(noisy[2].high - noisy[2].low).toBeGreaterThan(noisy[0].high - noisy[0].low);
  });

  it('keeps a running total from falling, and anything from going below zero', () => {
    expect(linearForecast([5, 5, 4, 4, 3, 3], 2, { nonDecreasing: true }).every((p) => p.value >= 3 && p.low >= 3)).toBe(true);
    expect(linearForecast([3, 2, 1], 4).every((p) => p.value >= 0 && p.low >= 0)).toBe(true);
  });

  it('uses only the last `window` months', () => {
    expect(linearForecast([100, 100, 1, 2, 3], 1, { window: 3 })[0].value).toBe(4);
  });

  it('forecasts nothing from nothing', () => {
    expect(linearForecast([], 3)).toEqual([]);
  });
});
