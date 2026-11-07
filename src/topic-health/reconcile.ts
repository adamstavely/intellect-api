import type { Client } from '@elastic/elasticsearch';
import { ALIASES } from '../elastic/indices';
import type { Topic, TopicHealthHistory } from '../model/types';
import { TopicRollupService } from './topic-rollup.service';

const ROLLUP_FIELDS = ['stats', 'healthScore', 'health', 'trend', 'momentum'] as const;

export interface TopicDrift {
  topicId: string;
  /** Rollup fields whose stored value differed from the recomputed one. */
  fields: string[];
}

export interface ReconcileReport {
  asOf: string;
  month: string;
  topics: number;
  drift: TopicDrift[];
}

/**
 * Nightly job (plan §1): recomputes every topic's rollups from its records, logs any drift from
 * what was stored, writes the fresh values, and records this month's health snapshot in
 * topic-health-history. Running it more than once a month overwrites the month's snapshot, so the
 * last run of the month is the one that sticks.
 */
export async function reconcile(es: Client, asOf: string): Promise<ReconcileReport> {
  const rollups = new TopicRollupService(es);
  const month = asOf.slice(0, 7);
  const drift: TopicDrift[] = [];
  let count = 0;

  for await (const topic of allTopics(es)) {
    count++;
    const fresh = await rollups.compute(topic.id, asOf);
    const fields = ROLLUP_FIELDS.filter((f) => JSON.stringify(topic[f]) !== JSON.stringify(fresh[f]));
    if (fields.length) drift.push({ topicId: topic.id, fields });

    const updated = await rollups.recompute(topic.id, asOf);
    const snapshot: TopicHealthHistory = { topicId: topic.id, month, healthScore: updated.healthScore, coverage: updated.stats.coverage };
    await es.index({ index: ALIASES.topicHealthHistory, id: `${topic.id}:${month}`, document: snapshot });
  }
  await es.indices.refresh({ index: ALIASES.topicHealthHistory });
  return { asOf, month, topics: count, drift };
}

async function* allTopics(es: Client): AsyncGenerator<Topic> {
  let after: (string | number)[] | undefined;
  for (;;) {
    const res = await es.search<Topic>({ index: ALIASES.topics, size: 500, sort: [{ id: 'asc' }], ...(after ? { search_after: after } : {}) });
    const hits = res.hits.hits;
    for (const h of hits) if (h._source) yield h._source;
    if (hits.length < 500) return;
    after = hits[hits.length - 1].sort as (string | number)[];
  }
}
