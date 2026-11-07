import type { Gap, Work, WorkStatus } from '../model/types';
import {
  coverage,
  healthBand,
  healthBreakdown,
  healthScore,
  isOverdue,
  momentum,
  snapshotDate,
  topicStats,
  trailingMonths,
} from './topic-health';

const AS_OF = '2026-06-15';
const gap = (id: string, severity: Gap['severity'] = 'medium', status: Gap['status'] = 'open') => ({
  id,
  severity,
  status,
});
const work = (gapIds: string[], status: WorkStatus = 'active', due = '2026-12-31'): Pick<Work, 'status' | 'gapIds' | 'due'> => ({
  gapIds,
  status,
  due,
});

describe('coverage', () => {
  it('is the share of open gaps with at least one active work item', () => {
    const gaps = [gap('a'), gap('b'), gap('c'), gap('d')];
    expect(coverage(gaps, [work(['a']), work(['b', 'a'])])).toBe(0.5);
  });

  it.each<WorkStatus>(['planning', 'blocked', 'review', 'complete'])('does not count %s work', (status) => {
    expect(coverage([gap('a')], [work(['a'], status)])).toBe(0);
  });

  it('ignores closed gaps', () => {
    expect(coverage([gap('a'), gap('b', 'high', 'closed')], [work(['a'])])).toBe(1);
  });

  it('treats addressing and closing gaps as open', () => {
    expect(coverage([gap('a', 'high', 'addressing'), gap('b', 'high', 'closing')], [work(['a'])])).toBe(0.5);
  });

  it('is 1 when there are no open gaps', () => {
    expect(coverage([], [])).toBe(1);
    expect(coverage([gap('a', 'critical', 'closed')], [])).toBe(1);
  });
});

describe('isOverdue', () => {
  it('is overdue when due before asOf and not complete', () => {
    expect(isOverdue({ status: 'active', due: '2026-06-14' }, AS_OF)).toBe(true);
    expect(isOverdue({ status: 'review', due: '2026-01-01' }, AS_OF)).toBe(true);
  });

  it('is not overdue on the due date, after asOf, or when complete', () => {
    expect(isOverdue({ status: 'active', due: AS_OF }, AS_OF)).toBe(false);
    expect(isOverdue({ status: 'active', due: '2026-07-01' }, AS_OF)).toBe(false);
    expect(isOverdue({ status: 'complete', due: '2026-01-01' }, AS_OF)).toBe(false);
  });
});

describe('healthScore', () => {
  it('starts from coverage × 100', () => {
    expect(healthScore({ gaps: [gap('a'), gap('b')], work: [work(['a'])], asOf: AS_OF })).toBe(50);
  });

  it('is 100 with full coverage and no penalties', () => {
    expect(healthScore({ gaps: [gap('a', 'critical')], work: [work(['a'])], asOf: AS_OF })).toBe(100);
  });

  it('subtracts 15 per uncovered critical gap and 8 per uncovered high gap', () => {
    // 4 open gaps, 2 covered → 50; minus 15 (critical) and 8 (high).
    const gaps = [gap('a'), gap('b'), gap('c', 'critical'), gap('d', 'high')];
    const b = healthBreakdown({ gaps, work: [work(['a', 'b'])], asOf: AS_OF });
    expect(b).toMatchObject({ uncoveredCritical: 1, uncoveredHigh: 1, score: 27 });
  });

  it('does not penalise covered or closed critical/high gaps', () => {
    const gaps = [gap('a', 'critical'), gap('b', 'high'), gap('c', 'critical', 'closed')];
    expect(healthScore({ gaps, work: [work(['a', 'b'])], asOf: AS_OF })).toBe(100);
  });

  it('subtracts 10 per blocked work item', () => {
    const w = [work(['a']), work([], 'blocked'), work([], 'blocked')];
    expect(healthScore({ gaps: [gap('a')], work: w, asOf: AS_OF })).toBe(80);
  });

  it('subtracts 5 per overdue work item', () => {
    const w = [work(['a'], 'active', '2026-01-01'), work([], 'review', '2026-02-01'), work([], 'complete', '2026-01-01')];
    expect(healthScore({ gaps: [gap('a')], work: w, asOf: AS_OF })).toBe(90);
  });

  it('counts blocked and overdue penalties together for a blocked, overdue item', () => {
    const w = [work(['a']), work([], 'blocked', '2026-01-01')];
    expect(healthScore({ gaps: [gap('a')], work: w, asOf: AS_OF })).toBe(85);
  });

  it('clamps to 0', () => {
    const gaps = [gap('a', 'critical'), gap('b', 'critical'), gap('c', 'critical'), gap('d', 'high')];
    expect(healthScore({ gaps, work: [work([], 'blocked')], asOf: AS_OF })).toBe(0);
  });

  it('rounds to an integer', () => {
    expect(healthScore({ gaps: [gap('a'), gap('b'), gap('c')], work: [work(['a'])], asOf: AS_OF })).toBe(33);
  });
});

describe('healthBand', () => {
  it.each([
    [100, 'healthy'],
    [70, 'healthy'],
    [69, 'watch'],
    [45, 'watch'],
    [44, 'at-risk'],
    [0, 'at-risk'],
  ])('%i → %s', (score, band) => {
    expect(healthBand(score)).toBe(band);
  });
});

describe('momentum', () => {
  it('is the current score minus the score three months ago', () => {
    expect(momentum([10, 20, 30, 40, 50, 60, 70, 80, 90, 55, 60, 72])).toBe(72 - 90);
    expect(momentum([40, 41, 42, 50])).toBe(10);
  });

  it('is 0 without a baseline three months back', () => {
    expect(momentum([])).toBe(0);
    expect(momentum([10, 20, 30])).toBe(0);
  });
});

describe('topicStats', () => {
  it('rolls up counts, open gaps, coverage and fte', () => {
    const stats = topicStats({
      questions: 4,
      papers: [{ grade: 'excellent' }, { grade: null }],
      fte: 1.2999999,
      gaps: [gap('a'), gap('b'), gap('c'), gap('d', 'high', 'closed')],
      work: [work(['a']), work(['b'], 'review')],
      asOf: AS_OF,
    });
    expect(stats).toEqual({
      questions: 4,
      gaps: 4,
      openGaps: 3,
      coverage: 0.333,
      work: 2,
      papers: 2,
      fte: 1.3,
      grades: { outstanding: 0, excellent: 1, satisfactory: 0, dissatisfactory: 0, ungraded: 1 },
    });
  });
});

describe('trailingMonths / snapshotDate', () => {
  it('lists 12 months ending at asOf, across a year boundary', () => {
    const months = trailingMonths('2026-03-09');
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('2025-04');
    expect(months[11]).toBe('2026-03');
  });

  it('snapshots past months at month end and the current month at asOf', () => {
    expect(snapshotDate('2026-02', '2026-03-09')).toBe('2026-02-28');
    expect(snapshotDate('2025-12', '2026-03-09')).toBe('2025-12-31');
    expect(snapshotDate('2026-03', '2026-03-09')).toBe('2026-03-09');
  });
});
