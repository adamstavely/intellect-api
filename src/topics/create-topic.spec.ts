import { fiscalYear, tidy, topicIdFor } from './create-topic';

describe('create-topic helpers', () => {
  it('uses the US federal fiscal year', () => {
    expect(fiscalYear('2026-09-30')).toBe('FY26');
    expect(fiscalYear('2026-10-01')).toBe('FY27');
    expect(fiscalYear('2099-12-31')).toBe('FY00');
  });

  it('slugs names into topic ids', () => {
    expect(topicIdFor('Grid-Scale Energy Storage')).toBe('t-grid-scale-energy-storage');
    expect(topicIdFor('  Café & Crème!! ')).toBe('t-cafe-and-creme');
    expect(topicIdFor('???')).toBe('t-topic');
    expect(topicIdFor('a'.repeat(80)).length).toBeLessThanOrEqual(50);
  });

  it('trims and de-duplicates lists', () => {
    expect(tidy([' edge', 'edge', '', 'ml '])).toEqual(['edge', 'ml']);
    expect(tidy(undefined)).toEqual([]);
  });
});
