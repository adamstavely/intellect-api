import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Client, errors } from '@elastic/elasticsearch';
import { count, search, searchAll, sources } from '../common/es';
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

  /**
   * Reads the topic's records and computes its rollups without writing anything. Every record is read, page by page
   * (see `searchAll`): a topic past any one result window still gets every gap, work item, paper and allocation counted.
   */
  async compute(topicId: string, asOf: string): Promise<Pick<Topic, 'stats' | 'healthScore' | 'health' | 'trend' | 'momentum'>> {
    const byTopic = { term: { topicId } };
    const months = trailingMonths(asOf, 12);
    const [questions, tGaps, tWork, papers, people, history] = await Promise.all([
      count(this.es, { index: ALIASES.questions, query: byTopic }),
      searchAll<Pick<Gap, 'id' | 'severity' | 'status'>>(this.es, ALIASES.gaps, { _source: ['id', 'severity', 'status'], query: byTopic }),
      searchAll<Pick<Work, 'status' | 'gapIds' | 'due'>>(this.es, ALIASES.work, { _source: ['status', 'gapIds', 'due'], query: byTopic }),
      searchAll<Pick<Paper, 'grade' | 'partners'>>(this.es, ALIASES.papers, { _source: ['grade', 'partners'], query: byTopic }),
      searchAll<Pick<Person, 'allocations'>>(this.es, ALIASES.people, {
        _source: ['allocations'],
        query: { nested: { path: 'allocations', query: { term: { 'allocations.topicId': topicId } } } },
      }),
      // One snapshot per month, so at most the 11 months before this one.
      search<Pick<TopicHealthHistory, 'month' | 'healthScore'>>(this.es, {
        index: ALIASES.topicHealthHistory,
        size: months.length,
        _source: ['month', 'healthScore'],
        sort: [{ month: 'asc' }],
        query: { bool: { filter: [byTopic, { range: { month: { gte: months[0], lt: months[months.length - 1] } } }] } },
      }),
    ]);

    const fte = people
      .flatMap((p) => p.allocations)
      .filter((a) => a.topicId === topicId)
      .reduce((s, a) => s + a.fte, 0);

    const score = healthScore({ gaps: tGaps, work: tWork, asOf });
    const trend = [...sources(history).map((h) => h.healthScore), score];
    return {
      stats: topicStats({ questions: questions.count, papers, fte, gaps: tGaps, work: tWork, asOf }),
      healthScore: score,
      health: healthBand(score),
      trend,
      momentum: momentum(trend),
    };
  }
}
