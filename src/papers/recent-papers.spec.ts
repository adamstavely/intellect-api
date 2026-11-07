import { monthWindows } from './recent-papers';

describe('monthWindows', () => {
  it('takes all of last month and this month up to today', () => {
    expect(monthWindows('2026-11-07')).toEqual({
      lastMonth: { from: '2026-10-01', to: '2026-10-31' },
      thisMonth: { from: '2026-11-01', to: '2026-11-07' },
    });
  });

  it('crosses a year boundary and handles short months', () => {
    expect(monthWindows('2026-01-15').lastMonth).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(monthWindows('2028-03-01').lastMonth).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});
