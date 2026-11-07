import { firstCitation, median, monthsBetween } from './first-citation';

describe('time to first citation', () => {
  it('counts whole months from the publication month, across years', () => {
    expect(monthsBetween('2025-11-01', '2026-02')).toBe(3);
    expect(monthsBetween('2026-03-15', '2026-03')).toBe(0);
    expect(monthsBetween('2026-03-15', '2026-02')).toBe(0);
  });

  it('is null while a paper has not been cited', () => {
    expect(firstCitation('2026-01-01', undefined)).toEqual({ month: null, monthsAfterPublication: null });
    expect(firstCitation('2026-01-01', '2026-04')).toEqual({ month: '2026-04', monthsAfterPublication: 3 });
  });

  it('takes the median of odd and even counts', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
