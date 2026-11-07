import { BadRequestException } from '@nestjs/common';
import { parsePeriod } from './period';

describe('parsePeriod', () => {
  it('defaults to calendar year to date', () => {
    expect(parsePeriod(undefined, '2026-11-06')).toEqual({ label: 'ytd', from: '2026-01-01', to: '2026-11-06', fromMonth: '2026-01', toMonth: '2026-11' });
  });

  it('uses the US federal fiscal year (FY26 = Oct 2025 – Sep 2026)', () => {
    expect(parsePeriod('FY26', '2026-11-06')).toMatchObject({ label: 'FY26', from: '2025-10-01', to: '2026-09-30' });
    expect(parsePeriod('fy26', '2026-11-06').label).toBe('FY26');
  });

  it.each([
    ['FY26-Q1', '2025-10-01', '2025-12-31'],
    ['FY26-Q2', '2026-01-01', '2026-03-31'],
    ['FY26-Q3', '2026-04-01', '2026-06-30'],
    ['FY26-Q4', '2026-07-01', '2026-09-30'],
  ])('%s runs %s to %s', (raw, from, to) => {
    expect(parsePeriod(raw, '2026-11-06')).toMatchObject({ from, to });
  });

  it('caps a period that is still running at asOf', () => {
    expect(parsePeriod('FY27', '2026-11-06')).toMatchObject({ from: '2026-10-01', to: '2026-11-06', toMonth: '2026-11' });
  });

  it('rejects unknown and future periods', () => {
    expect(() => parsePeriod('last-week', '2026-11-06')).toThrow(BadRequestException);
    expect(() => parsePeriod('FY28', '2026-11-06')).toThrow(BadRequestException);
  });
});
