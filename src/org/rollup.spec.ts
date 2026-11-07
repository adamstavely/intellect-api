import type { Topic } from '../model/types';
import { rollup } from './rollup';

const topic = (health: Topic['health'], healthScore: number, openGaps: number, coverage: number, fte = 1): Topic =>
  ({ health, healthScore, budget: { allocated: 1.5, spent: 0.5, fy: 'FY26' }, stats: { openGaps, coverage, fte } }) as Topic;

describe('org rollup', () => {
  it('weights coverage by open gaps and sums the rest', () => {
    const r = rollup([topic('healthy', 90, 2, 1), topic('at-risk', 20, 6, 0.5), topic('watch', 50, 0, 1, 0.25)]);
    expect(r).toEqual({
      topics: 3,
      healthMix: { healthy: 1, watch: 1, atRisk: 1 },
      avgHealthScore: 53,
      openGaps: 8,
      coverage: 0.625,
      fte: 2.3,
      budget: { allocated: 4.5, spent: 1.5 },
    });
  });

  it('handles an empty unit', () => {
    expect(rollup([])).toMatchObject({ topics: 0, avgHealthScore: null, openGaps: 0, coverage: 1, fte: 0 });
  });
});
