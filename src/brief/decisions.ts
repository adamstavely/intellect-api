import type { Gap, Topic, Work } from '../model/types';
import type { PersonSummaryDto } from '../people/people.dto';
import type { DecisionDto } from './brief.dto';

export const MAX_DECISIONS = 5;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/**
 * Rule-based decision prompts, most urgent first:
 * 1. at-risk topics in bins 1–2 → review resourcing;
 * 2. blocked work that is the only work against a critical/high gap → unblock it;
 * 3. people allocated past capacity → rebalance.
 */
export function decisions(input: {
  topics: Topic[];
  blockedWork: Work[];
  allWork: Pick<Work, 'id' | 'gapIds' | 'status'>[];
  gaps: Map<string, Gap>;
  people: PersonSummaryDto[];
}): DecisionDto[] {
  const topicName = new Map(input.topics.map((t) => [t.id, t.name]));
  const out: DecisionDto[] = [];

  for (const t of input.topics.filter((t) => t.health === 'at-risk' && t.bin <= 2).sort((a, b) => a.healthScore - b.healthScore || a.bin - b.bin)) {
    out.push({
      tag: 'Resourcing',
      lead: `Review resourcing for ${t.name}.`,
      body: `${t.priorityLabel} topic is at risk: health ${t.healthScore}, ${pct(t.stats.coverage)} gap coverage, momentum ${signed(t.momentum)} over three months.`,
      topicId: t.id,
    });
  }

  for (const w of input.blockedWork) {
    const gap = w.gapIds
      .map((id) => input.gaps.get(id))
      .find((g) => g && g.status !== 'closed' && (g.severity === 'critical' || g.severity === 'high') && !input.allWork.some((o) => o.id !== w.id && o.status !== 'complete' && o.gapIds.includes(g.id)));
    if (!gap) continue;
    out.push({
      tag: 'Operations',
      lead: `Unblock “${w.title}”.`,
      body: `It is the only work against the ${gap.severity} gap “${gap.text}” in ${topicName.get(w.topicId) ?? w.topicId}.${w.note ? ` ${w.note}` : ''}`,
      topicId: w.topicId,
    });
  }

  for (const p of input.people.filter((p) => p.overCapacity).sort((a, b) => b.load - a.load)) {
    out.push({
      tag: 'Resourcing',
      lead: `Rebalance ${p.name}'s allocation.`,
      body: `Allocated ${p.load} FTE against a capacity of ${p.capacity} across ${p.allocations.length} topics.`,
      topicId: null,
    });
  }

  return out.slice(0, MAX_DECISIONS);
}
