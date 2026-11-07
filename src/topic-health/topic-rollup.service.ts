import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Client, errors } from '@elastic/elasticsearch';
import { ES_CLIENT } from '../elastic/elastic.module';
import { ALIASES } from '../elastic/indices';
import type { Gap, Paper, Person, Topic, TopicHealthHistory, Work } from '../model/types';
import { healthBand, healthScore, momentum, topicStats, trailingMonths } from './topic-health';

const MAX_ATTEMPTS = 5;

/**
 * Recomputes a topic's stored rollups (`stats`, `healthScore`, `health`, `trend`, `momentum`)
 * from its records. Writes call this after they change a topic's records. The update uses
 * optimistic concurrency, retrying from a fresh read if another write got there first.
 */
@Injectable()
export class TopicRollupService {
  constructor(@Inject(ES_CLIENT) private readonly es: Client) {}

  async recompute(topicId: string, asOf: string = new Date().toISOString().slice(0, 10)): Promise<Topic> {
    for (let attempt = 1; ; attempt++) {
      const current = await this.es.get<Topic>({ index: ALIASES.topics, id: topicId }, { ignore: [404] });
      if (!current.found || !current._source) throw new NotFoundException(`Topic ${topicId} not found`);

      const rollup = await this.compute(topicId, asOf);
      try {
        await this.es.update({
          index: ALIASES.topics,
          id: topicId,
          if_seq_no: current._seq_no,
          if_primary_term: current._primary_term,
          refresh: 'wait_for',
          doc: rollup,
        });
        return { ...current._source, ...rollup };
      } catch (err) {
        const conflict = err instanceof errors.ResponseError && err.statusCode === 409;
        if (!conflict || attempt >= MAX_ATTEMPTS) throw err;
      }
    }
  }

  /** Reads the topic's records and computes its rollups without writing anything. */
  async compute(topicId: string, asOf: string): Promise<Pick<Topic, 'stats' | 'healthScore' | 'health' | 'trend' | 'momentum'>> {
    const byTopic = { term: { topicId } };
    const months = trailingMonths(asOf, 12);
    const { responses } = await this.es.msearch({
      searches: [
        { index: ALIASES.questions },
        { size: 0, track_total_hits: true, query: byTopic },
        { index: ALIASES.gaps },
        { size: 1000, _source: ['id', 'severity', 'status'], query: byTopic },
        { index: ALIASES.work },
        { size: 1000, _source: ['status', 'gapIds', 'due'], query: byTopic },
        { index: ALIASES.papers },
        { size: 1000, _source: ['grade'], query: byTopic },
        { index: ALIASES.people },
        { size: 1000, _source: ['allocations'], query: { nested: { path: 'allocations', query: { term: { 'allocations.topicId': topicId } } } } },
        { index: ALIASES.topicHealthHistory },
        { size: 12, _source: ['month', 'healthScore'], sort: [{ month: 'asc' }], query: { bool: { filter: [byTopic, { range: { month: { gte: months[0], lt: months[months.length - 1] } } }] } } },
      ],
    });
    for (const r of responses) if ('error' in r) throw new Error(`msearch failed for topic ${topicId}: ${JSON.stringify(r.error)}`);
    type Hits = { hits: { total?: { value: number } | number; hits: { _source?: unknown }[] } };
    const [questions, gaps, work, papers, people, history] = responses as unknown as Hits[];
    const total = (r: Hits) => (typeof r.hits.total === 'number' ? r.hits.total : (r.hits.total?.value ?? 0));
    const sources = <T>(r: Hits) => r.hits.hits.map((h) => h._source as T);

    const tGaps = sources<Pick<Gap, 'id' | 'severity' | 'status'>>(gaps);
    const tWork = sources<Pick<Work, 'status' | 'gapIds' | 'due'>>(work);
    const fte = sources<Pick<Person, 'allocations'>>(people)
      .flatMap((p) => p.allocations)
      .filter((a) => a.topicId === topicId)
      .reduce((s, a) => s + a.fte, 0);

    const score = healthScore({ gaps: tGaps, work: tWork, asOf });
    const trend = [...sources<Pick<TopicHealthHistory, 'healthScore'>>(history).map((h) => h.healthScore), score];
    return {
      stats: topicStats({ questions: total(questions), papers: sources<Pick<Paper, 'grade'>>(papers), fte, gaps: tGaps, work: tWork, asOf }),
      healthScore: score,
      health: healthBand(score),
      trend,
      momentum: momentum(trend),
    };
  }
}
