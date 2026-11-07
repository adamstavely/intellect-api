import { Inject, Injectable } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { Clock } from '../common/clock';
import { parsePeriod } from '../common/period';
import { ES_CLIENT } from '../elastic/elastic.module';
import { ALIASES } from '../elastic/indices';
import type { Person } from '../model/types';
import { ScopeService } from '../scope/scope.service';
import { trailingMonths } from '../topic-health/topic-health';
import type { PortfolioQueryDto, PortfolioSummaryDto } from './portfolio.dto';

type Value = { value: number | null };
type Buckets<T = object> = { buckets: ({ key: string | number; key_as_string?: string; doc_count: number } & T)[] };

const num = (a: Value | undefined, places = 0) => Math.round((a?.value ?? 0) * 10 ** places) / 10 ** places;

/** Portfolio-level numbers, computed live with aggregations over the caller's scope. */
@Injectable()
export class PortfolioService {
  constructor(
    @Inject(ES_CLIENT) private readonly es: Client,
    private readonly scope: ScopeService,
    private readonly clock: Clock,
  ) {}

  async summary(user: Person, q: PortfolioQueryDto): Promise<PortfolioSummaryDto> {
    const period = parsePeriod(q.period, this.clock.today());
    const scope = await this.scope.topicScope(user);
    const byTopicId = ScopeService.toFilter(scope, 'topicId');
    const trendMonths = trailingMonths(period.to, 12);

    const [topics, questions, work, papers, reads, trend] = await Promise.all([
      this.es.search({
        index: ALIASES.topics,
        size: 0,
        track_total_hits: true,
        query: { bool: { filter: [ScopeService.toFilter(scope, 'id')] } },
        aggs: {
          health: { terms: { field: 'health', size: 3 } },
          bins: { terms: { field: 'bin', size: 4 }, aggs: { atRisk: { filter: { term: { health: 'at-risk' } } } } },
          openGaps: { sum: { field: 'stats.openGaps' } },
          coverage: { weighted_avg: { value: { field: 'stats.coverage' }, weight: { field: 'stats.openGaps' } } },
          avgHealth: { avg: { field: 'healthScore' } },
          allocated: { sum: { field: 'budget.allocated' } },
          spent: { sum: { field: 'budget.spent' } },
          fte: { sum: { field: 'stats.fte' } },
        },
      }),
      this.es.count({ index: ALIASES.questions, query: { bool: { filter: [byTopicId], must_not: [{ term: { status: 'answered' } }] } } }),
      this.es.count({ index: ALIASES.work, query: { bool: { filter: [byTopicId], must_not: [{ term: { status: 'complete' } }] } } }),
      this.es.count({ index: ALIASES.papers, query: { bool: { filter: [byTopicId, { range: { published: { gte: period.from, lte: period.to } } }] } } }),
      this.es.search({
        index: ALIASES.paperMetrics,
        size: 0,
        query: { bool: { filter: [byTopicId, { range: { month: { gte: period.fromMonth, lte: period.toMonth } } }] } },
        aggs: { views: { sum: { field: 'views' } }, downloads: { sum: { field: 'downloads' } }, citations: { sum: { field: 'citations' } } },
      }),
      this.es.search({
        index: ALIASES.paperMetrics,
        size: 0,
        query: { bool: { filter: [byTopicId, { range: { month: { gte: trendMonths[0], lte: trendMonths[11] } } }] } },
        aggs: {
          months: {
            terms: { field: 'month', size: 12, format: 'yyyy-MM' },
            aggs: { views: { sum: { field: 'views' } }, downloads: { sum: { field: 'downloads' } } },
          },
        },
      }),
    ]);

    const t = topics.aggregations as Record<string, Value & Buckets<{ atRisk: { doc_count: number } }>>;
    const health = new Map(t.health.buckets.map((b) => [b.key, b.doc_count]));
    const openGaps = num(t.openGaps);
    const r = reads.aggregations as Record<string, Value>;
    const months = new Map(
      (trend.aggregations as Record<string, Buckets<{ views: Value; downloads: Value }>>).months.buckets.map((b) => [b.key_as_string ?? String(b.key), b]),
    );

    return {
      period: { label: period.label, from: period.from, to: period.to },
      topics: typeof topics.hits.total === 'number' ? topics.hits.total : (topics.hits.total?.value ?? 0),
      activeQuestions: questions.count,
      openGaps,
      gapsCovered: openGaps ? num(t.coverage, 3) : 1,
      workInFlight: work.count,
      avgHealthScore: t.avgHealth.value === null ? null : Math.round(t.avgHealth.value),
      healthMix: { healthy: health.get('healthy') ?? 0, watch: health.get('watch') ?? 0, atRisk: health.get('at-risk') ?? 0 },
      binMix: [1, 2, 3, 4].map((bin) => {
        const b = t.bins.buckets.find((x) => Number(x.key) === bin);
        return { bin, topics: b?.doc_count ?? 0, atRisk: b?.atRisk.doc_count ?? 0 };
      }),
      papersInPeriod: papers.count,
      readsInPeriod: num(r.views),
      downloadsInPeriod: num(r.downloads),
      citationsInPeriod: num(r.citations),
      readTrend: trendMonths.map((month) => ({ month, views: num(months.get(month)?.views), downloads: num(months.get(month)?.downloads) })),
      budget: { allocated: num(t.allocated, 2), spent: num(t.spent, 2) },
      fte: num(t.fte, 1),
    };
  }
}
