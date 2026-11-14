import { Inject, Injectable } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { Clock } from '../common/clock';
import { parsePeriod } from '../common/period';
import { ES_CLIENT } from '../elastic/elastic.module';
import { ALIASES } from '../elastic/indices';
import { count, readAll, search } from '../common/es';
import type { Paper, Person } from '../model/types';
import { ScopeService } from '../scope/scope.service';
import { trailingMonths } from '../topic-health/topic-health';
import { cumulativeByMonth, headcountByMonth, linearForecast, nextMonths } from './history';
import type { HistoryQueryDto, PortfolioHistoryDto, PortfolioQueryDto, PortfolioSummaryDto } from './portfolio.dto';

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
      search(this.es, {
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
      count(this.es, { index: ALIASES.questions, query: { bool: { filter: [byTopicId], must_not: [{ term: { status: 'answered' } }] } } }),
      count(this.es, { index: ALIASES.work, query: { bool: { filter: [byTopicId], must_not: [{ term: { status: 'complete' } }] } } }),
      search(this.es, {
        index: ALIASES.papers,
        size: 0,
        track_total_hits: true,
        query: { bool: { filter: [byTopicId, { range: { published: { gte: period.from, lte: period.to } } }] } },
        // An empty partners list isn't indexed, so `exists` matches exactly the joint papers.
        aggs: { joint: { filter: { exists: { field: 'partners' } } } },
      }),
      search(this.es, {
        index: ALIASES.paperMetrics,
        size: 0,
        query: { bool: { filter: [byTopicId, { range: { month: { gte: period.fromMonth, lte: period.toMonth } } }] } },
        aggs: { views: { sum: { field: 'views' } }, downloads: { sum: { field: 'downloads' } }, citations: { sum: { field: 'citations' } } },
      }),
      search(this.es, {
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
    const total = (r: { hits: { total?: number | { value: number } } }) => (typeof r.hits.total === 'number' ? r.hits.total : (r.hits.total?.value ?? 0));
    const papersInPeriod = total(papers);
    const joint = (papers.aggregations as { joint: { doc_count: number } }).joint.doc_count;
    const r = reads.aggregations as Record<string, Value>;
    const months = new Map(
      (trend.aggregations as Record<string, Buckets<{ views: Value; downloads: Value }>>).months.buckets.map((b) => [b.key_as_string ?? String(b.key), b]),
    );

    return {
      period: { label: period.label, from: period.from, to: period.to },
      topics: total(topics),
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
      papersInPeriod,
      collaborationInPeriod: { unilateral: papersInPeriod - joint, joint },
      readsInPeriod: num(r.views),
      downloadsInPeriod: num(r.downloads),
      citationsInPeriod: num(r.citations),
      readTrend: trendMonths.map((month) => ({ month, views: num(months.get(month)?.views), downloads: num(months.get(month)?.downloads) })),
      budget: { allocated: num(t.allocated, 2), spent: num(t.spent, 2) },
      fte: num(t.fte, 1),
    };
  }

  /**
   * Papers to date and headcount, month by month, with a straight-line forecast of each – the Summary's Papers and
   * People cards. Scoped like everything else: a PI sees their topics' papers and their teams' people.
   */
  async history(user: Person, q: HistoryQueryDto): Promise<PortfolioHistoryDto> {
    const today = this.clock.today();
    const months = trailingMonths(today, q.months ?? 24);
    const forecastMonths = nextMonths(months[months.length - 1], q.horizon ?? 6);
    const scope = await this.scope.topicScope(user);
    const [papers, people] = await Promise.all([
      // Every paper and person in scope: the series count all of them.
      readAll<Pick<Paper, 'published'>>(this.es, ALIASES.papers, {
        _source: ['published'],
        query: { bool: { filter: [ScopeService.toFilter(scope, 'topicId')] } },
      }),
      readAll<Pick<Person, 'started' | 'ended'>>(this.es, ALIASES.people, {
        _source: ['started', 'ended'],
        query: { bool: { filter: [ScopeService.peopleFilter(scope, user)] } },
      }),
    ]);
    const series = (actual: number[], nonDecreasing: boolean) => ({
      current: actual[actual.length - 1] ?? 0,
      actual,
      forecast: linearForecast(actual, forecastMonths.length, { nonDecreasing }),
    });
    return {
      months,
      forecastMonths,
      papers: series(cumulativeByMonth(papers.map((p) => p.published), months, today), true),
      people: series(headcountByMonth(people.filter((p) => p.started), months, today), false),
    };
  }
}