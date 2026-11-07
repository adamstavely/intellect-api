import type { RecentPapers, Topic } from '../model/types';
import { NO_RECENT_PAPERS } from '../papers/recent-papers';
import { healthBand, momentum } from '../topic-health/topic-health';
import type { OrgRollupDto } from './org.dto';

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

/** Roll-up of stored topic stats for an org unit (or any set of topics). */
export function rollup(
  topics: Pick<Topic, 'id' | 'health' | 'healthScore' | 'stats' | 'budget' | 'trend'>[],
  recent: Map<string, RecentPapers> = new Map(),
): OrgRollupDto {
  const trend = meanTrend(topics.map((t) => t.trend ?? []));
  const avgHealthScore = topics.length ? Math.round(topics.reduce((s, t) => s + t.healthScore, 0) / topics.length) : null;
  // Topics stored before collaboration counts existed have none until their next recompute.
  const joint = topics.reduce((s, t) => s + (t.stats.collaboration?.joint ?? 0), 0);
  const papers = topics.reduce((s, t) => s + (t.stats.papers ?? 0), 0);
  const openGaps = topics.reduce((s, t) => s + t.stats.openGaps, 0);
  const covered = topics.reduce((s, t) => s + t.stats.openGaps * t.stats.coverage, 0);
  return {
    topics: topics.length,
    healthMix: {
      healthy: topics.filter((t) => t.health === 'healthy').length,
      watch: topics.filter((t) => t.health === 'watch').length,
      atRisk: topics.filter((t) => t.health === 'at-risk').length,
    },
    avgHealthScore,
    health: avgHealthScore === null ? null : healthBand(avgHealthScore),
    openGaps,
    coverage: openGaps ? round(covered / openGaps, 3) : 1,
    fte: round(topics.reduce((s, t) => s + t.stats.fte, 0), 1),
    budget: {
      allocated: round(topics.reduce((s, t) => s + t.budget.allocated, 0), 2),
      spent: round(topics.reduce((s, t) => s + t.budget.spent, 0), 2),
    },
    papers,
    collaboration: { unilateral: papers - joint, joint },
    recentPapers: topics.reduce(
      (s, t) => {
        const r = recent.get(t.id) ?? NO_RECENT_PAPERS;
        return { lastMonth: s.lastMonth + r.lastMonth, thisMonth: s.thisMonth + r.thisMonth };
      },
      { ...NO_RECENT_PAPERS },
    ),
    work: topics.reduce((s, t) => s + (t.stats.work ?? 0), 0),
    trend,
    momentum: momentum(trend),
  };
}

/** Month-by-month mean of several trends, lined up on their latest month; each month averages the trends that reach it. */
export function meanTrend(trends: number[][]): number[] {
  const length = Math.max(0, ...trends.map((t) => t.length));
  return Array.from({ length }, (_, i) => {
    const values = trends.map((t) => t[t.length - length + i]).filter((v): v is number => v !== undefined);
    return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
  });
}
