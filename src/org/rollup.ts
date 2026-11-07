import type { Topic } from '../model/types';
import type { OrgRollupDto } from './org.dto';

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

/** Roll-up of stored topic stats for an org unit (or any set of topics). */
export function rollup(topics: Pick<Topic, 'health' | 'healthScore' | 'stats' | 'budget'>[]): OrgRollupDto {
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
    avgHealthScore: topics.length ? Math.round(topics.reduce((s, t) => s + t.healthScore, 0) / topics.length) : null,
    openGaps,
    coverage: openGaps ? round(covered / openGaps, 3) : 1,
    fte: round(topics.reduce((s, t) => s + t.stats.fte, 0), 1),
    budget: {
      allocated: round(topics.reduce((s, t) => s + t.budget.allocated, 0), 2),
      spent: round(topics.reduce((s, t) => s + t.budget.spent, 0), 2),
    },
    papers,
    collaboration: { unilateral: papers - joint, joint },
  };
}
