import type { Topic } from '../model/types';
import { meanTrend, rollup } from './rollup';

const topic = (health: Topic['health'], healthScore: number, openGaps: number, coverage: number, fte = 1, papers = 0, joint = 0): Topic =>
  ({
    id: `t-${healthScore}`,
    trend: [healthScore - 6, healthScore - 3, healthScore, healthScore],
    health,
    healthScore,
    budget: { allocated: 1.5, spent: 0.5, fy: 'FY26' },
    stats: { openGaps, coverage, fte, papers, work: 2, collaboration: { unilateral: papers - joint, joint } },
  }) as Topic;

describe('meanTrend', () => {
  it('lines trends up on their latest month and averages what reaches each month', () => {
    expect(meanTrend([[10, 20, 30], [40, 50]])).toEqual([10, 30, 40]);
    expect(meanTrend([])).toEqual([]);
  });
});

describe('org rollup', () => {
  it('weights coverage by open gaps and sums the rest', () => {
    const r = rollup([topic('healthy', 90, 2, 1, 1, 4, 1), topic('at-risk', 20, 6, 0.5, 1, 2, 2), topic('watch', 50, 0, 1, 0.25)], new Map([['t-90', { lastMonth: 2, thisMonth: 1 }], ['t-20', { lastMonth: 1, thisMonth: 0 }]]));
    expect(r).toEqual({
      topics: 3,
      healthMix: { healthy: 1, watch: 1, atRisk: 1 },
      avgHealthScore: 53,
      openGaps: 8,
      coverage: 0.625,
      fte: 2.3,
      budget: { allocated: 4.5, spent: 1.5 },
      papers: 6,
      collaboration: { unilateral: 3, joint: 3 },
      recentPapers: { lastMonth: 3, thisMonth: 1 },
      work: 6,
      trend: [47, 50, 53, 53],
      momentum: 6,
    });
  });

  it('handles an empty unit', () => {
    expect(rollup([])).toMatchObject({ topics: 0, avgHealthScore: null, openGaps: 0, coverage: 1, fte: 0, papers: 0, collaboration: { unilateral: 0, joint: 0 }, recentPapers: { lastMonth: 0, thisMonth: 0 }, trend: [], momentum: 0 });
  });
});
