import type { Gap, GradeCounts, HealthBand, Paper, TopicStats, Work } from '../model/types';

/**
 * Topic health, coverage and momentum: the one place the formula lives (milestone-1 plan §1).
 * Pure functions; the rollup service and the seed both call these.
 */

export const HEALTH_WEIGHTS = {
  uncoveredCritical: 15,
  uncoveredHigh: 8,
  blocked: 10,
  overdue: 5,
} as const;

export const BAND_THRESHOLDS = { healthy: 70, watch: 45 } as const;

/** Months back that momentum compares against. */
export const MOMENTUM_LOOKBACK = 3;

type GapLike = Pick<Gap, 'id' | 'severity' | 'status'>;
type WorkLike = Pick<Work, 'status' | 'gapIds' | 'due'>;

export const isOpenGap = (gap: Pick<Gap, 'status'>): boolean => gap.status !== 'closed';

/** Ids of gaps with at least one `active` work item against them. Other statuses don't count. */
export function coveredGapIds(work: WorkLike[]): Set<string> {
  const covered = new Set<string>();
  for (const w of work) {
    if (w.status === 'active') w.gapIds.forEach((id) => covered.add(id));
  }
  return covered;
}

/**
 * Share of open gaps with at least one active work item. A topic with no open gaps has nothing
 * uncovered, so its coverage is 1.
 */
export function coverage(gaps: GapLike[], work: WorkLike[]): number {
  const open = gaps.filter(isOpenGap);
  if (open.length === 0) return 1;
  const covered = coveredGapIds(work);
  return open.filter((g) => covered.has(g.id)).length / open.length;
}

/** Work is overdue when its due date is before `asOf` (YYYY-MM-DD) and it isn't complete. */
export const isOverdue = (work: Pick<Work, 'status' | 'due'>, asOf: string): boolean =>
  work.status !== 'complete' && work.due < asOf;

export interface HealthInputs {
  gaps: GapLike[];
  work: WorkLike[];
  /** ISO date (YYYY-MM-DD) that "overdue" is judged against. */
  asOf: string;
}

export interface HealthBreakdown {
  coverage: number;
  uncoveredCritical: number;
  uncoveredHigh: number;
  blocked: number;
  overdue: number;
  score: number;
}

/**
 * coverage × 100, minus 15 per uncovered critical gap, 8 per uncovered high gap,
 * 10 per blocked work item and 5 per overdue work item, clamped to 0–100 and rounded.
 */
export function healthBreakdown({ gaps, work, asOf }: HealthInputs): HealthBreakdown {
  const cov = coverage(gaps, work);
  const covered = coveredGapIds(work);
  const uncovered = gaps.filter((g) => isOpenGap(g) && !covered.has(g.id));
  const uncoveredCritical = uncovered.filter((g) => g.severity === 'critical').length;
  const uncoveredHigh = uncovered.filter((g) => g.severity === 'high').length;
  const blocked = work.filter((w) => w.status === 'blocked').length;
  const overdue = work.filter((w) => isOverdue(w, asOf)).length;

  const raw =
    cov * 100 -
    HEALTH_WEIGHTS.uncoveredCritical * uncoveredCritical -
    HEALTH_WEIGHTS.uncoveredHigh * uncoveredHigh -
    HEALTH_WEIGHTS.blocked * blocked -
    HEALTH_WEIGHTS.overdue * overdue;

  return {
    coverage: cov,
    uncoveredCritical,
    uncoveredHigh,
    blocked,
    overdue,
    score: Math.round(Math.min(100, Math.max(0, raw))),
  };
}

export const healthScore = (inputs: HealthInputs): number => healthBreakdown(inputs).score;

export function healthBand(score: number): HealthBand {
  if (score >= BAND_THRESHOLDS.healthy) return 'healthy';
  if (score >= BAND_THRESHOLDS.watch) return 'watch';
  return 'at-risk';
}

/**
 * Current score minus the score three months ago. `trend` is the monthly series, oldest first,
 * ending with the current month. With fewer than four points there's no baseline, so it's 0.
 */
export function momentum(trend: number[]): number {
  if (trend.length <= MOMENTUM_LOOKBACK) return 0;
  return trend[trend.length - 1] - trend[trend.length - 1 - MOMENTUM_LOOKBACK];
}

export interface StatsInputs extends HealthInputs {
  questions: number;
  papers: Pick<Paper, 'grade'>[];
  fte: number;
}

export function gradeCounts(papers: Pick<Paper, 'grade'>[]): GradeCounts {
  const counts: GradeCounts = { outstanding: 0, excellent: 0, satisfactory: 0, dissatisfactory: 0, ungraded: 0 };
  for (const p of papers) counts[p.grade ?? 'ungraded']++;
  return counts;
}

export function topicStats(inputs: StatsInputs): TopicStats {
  return {
    questions: inputs.questions,
    gaps: inputs.gaps.length,
    openGaps: inputs.gaps.filter(isOpenGap).length,
    coverage: Math.round(coverage(inputs.gaps, inputs.work) * 1000) / 1000,
    work: inputs.work.length,
    papers: inputs.papers.length,
    fte: Math.round(inputs.fte * 10) / 10,
    grades: gradeCounts(inputs.papers),
  };
}

/** The last `count` months ending at `asOf`'s month, oldest first, as YYYY-MM. */
export function trailingMonths(asOf: string, count = 12): string[] {
  const [y, m] = asOf.split('-').map(Number);
  const months: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

/** The date a monthly snapshot is taken: the month's last day, or `asOf` for the current month. */
export function snapshotDate(month: string, asOf: string): string {
  if (asOf.startsWith(month)) return asOf;
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
