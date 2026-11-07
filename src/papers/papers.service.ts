import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Client, estypes } from '@elastic/elasticsearch';
import { Clock } from '../common/clock';
import { getMany, MAX_DOCS, sources } from '../common/es';
import { parsePeriod } from '../common/period';
import { ES_CLIENT } from '../elastic/elastic.module';
import { ALIASES } from '../elastic/indices';
import type { Citation, Paper, PaperMetrics, Person, Topic } from '../model/types';
import { ScopeService } from '../scope/scope.service';
import { TopicRollupService } from '../topic-health/topic-rollup.service';
import type { GradePaperDto, MetricTotalsDto, PaperDetailDto, PaperListItemDto, PapersQueryDto, TopPaperDto, TopPapersQueryDto } from './papers.dto';

const EMPTY_TOTALS: MetricTotalsDto = { downloads: 0, views: 0, citations: 0, altmetric: 0, mentions: { news: 0, policy: 0, social: 0, patents: 0 } };

type SumAgg = { value: number | null };
type TotalsBucket = {
  key: string;
  downloads: SumAgg;
  views: SumAgg;
  citations: SumAgg;
  altmetric: SumAgg;
  news: SumAgg;
  policy: SumAgg;
  social: SumAgg;
  patents: SumAgg;
};

const TOTALS_AGGS: Record<string, estypes.AggregationsAggregationContainer> = {
  downloads: { sum: { field: 'downloads' } },
  views: { sum: { field: 'views' } },
  citations: { sum: { field: 'citations' } },
  altmetric: { max: { field: 'altmetric' } },
  news: { sum: { field: 'mentions.news' } },
  policy: { sum: { field: 'mentions.policy' } },
  social: { sum: { field: 'mentions.social' } },
  patents: { sum: { field: 'mentions.patents' } },
};

const toTotals = (b: TotalsBucket): MetricTotalsDto => {
  const v = (a: SumAgg) => Math.round(a.value ?? 0);
  return {
    downloads: v(b.downloads),
    views: v(b.views),
    citations: v(b.citations),
    altmetric: v(b.altmetric),
    mentions: { news: v(b.news), policy: v(b.policy), social: v(b.social), patents: v(b.patents) },
  };
};

@Injectable()
export class PapersService {
  constructor(
    @Inject(ES_CLIENT) private readonly es: Client,
    private readonly scope: ScopeService,
    private readonly clock: Clock,
    private readonly rollups: TopicRollupService,
  ) {}

  /**
   * Sets (or clears) a paper's grade, records who graded it and when, then recomputes the topic's
   * grade roll-up. Chief only; the controller enforces the role.
   */
  async grade(user: Person, id: string, { grade }: GradePaperDto): Promise<PaperDetailDto> {
    const paper = (await getMany<Paper>(this.es, ALIASES.papers, [id], ['topicId'])).get(id);
    if (!paper) throw new NotFoundException('Paper not found');
    const graded = grade === null ? { grade: null, gradedBy: null, gradedAt: null } : { grade, gradedBy: user.id, gradedAt: new Date().toISOString() };
    await this.es.update({ index: ALIASES.papers, id, doc: graded, refresh: 'wait_for', retry_on_conflict: 3 });
    await this.rollups.recompute(paper.topicId, this.clock.today());
    return this.get(user, id);
  }

  async list(user: Person, q: PapersQueryDto): Promise<PaperListItemDto[]> {
    const filter: estypes.QueryDslQueryContainer[] = [await this.scope.filter(user)];
    const mustNot: estypes.QueryDslQueryContainer[] = [];
    if (q.topicId) filter.push({ term: { topicId: q.topicId } });
    if (q.grade === 'ungraded') mustNot.push({ exists: { field: 'grade' } });
    else if (q.grade) filter.push({ term: { grade: q.grade } });

    const papers = sources(
      await this.es.search<Paper>({
        index: ALIASES.papers,
        size: MAX_DOCS,
        query: { bool: { filter, must_not: mustNot } },
        sort: [{ published: 'desc' }, { id: 'asc' }],
      }),
    );
    const items = await this.decorate(papers, await this.totals(papers.map((p) => p.id)));
    if (q.sort === 'reads') items.sort((a, b) => b.totals.views - a.totals.views || a.id.localeCompare(b.id));
    return items;
  }

  /** Most-read papers (by views) within the period: the dashboard's "Impact pulse". */
  async top(user: Person, q: TopPapersQueryDto): Promise<TopPaperDto[]> {
    const period = parsePeriod(q.period, this.clock.today());
    const res = await this.es.search({
      index: ALIASES.paperMetrics,
      size: 0,
      query: { bool: { filter: [await this.scope.filter(user), { range: { month: { gte: period.fromMonth, lte: period.toMonth } } }] } },
      aggs: { papers: { terms: { field: 'paperId', size: q.limit ?? 3, order: { views: 'desc' } }, aggs: TOTALS_AGGS } },
    });
    const buckets = (res.aggregations?.papers as { buckets: TotalsBucket[] } | undefined)?.buckets ?? [];
    const ids = buckets.map((b) => b.key);
    const papers = await getMany<Paper>(this.es, ALIASES.papers, ids);
    const items = await this.decorate(ids.map((id) => papers.get(id)).filter((p): p is Paper => !!p), await this.totals(ids));
    const periodTotals = new Map(buckets.map((b) => [b.key, toTotals(b)]));
    return items.map((p) => ({ ...p, periodTotals: periodTotals.get(p.id) ?? EMPTY_TOTALS }));
  }

  async get(user: Person, id: string): Promise<PaperDetailDto> {
    const paper = (await getMany<Paper>(this.es, ALIASES.papers, [id])).get(id);
    if (!paper || !ScopeService.inScope(await this.scope.topicScope(user), paper.topicId)) throw new NotFoundException('Paper not found');

    const [[item], metricsRes, citationsRes] = await Promise.all([
      this.totals([id]).then((t) => this.decorate([paper], t)),
      this.es.search<PaperMetrics>({ index: ALIASES.paperMetrics, size: MAX_DOCS, query: { term: { paperId: id } }, sort: [{ month: 'asc' }] }),
      this.es.search<Citation>({ index: ALIASES.citations, size: MAX_DOCS, query: { term: { paperId: id } }, sort: [{ year: 'desc' }, { id: 'asc' }] }),
    ]);
    const metrics = sources(metricsRes);
    const latest = metrics[metrics.length - 1];
    return {
      ...item,
      metrics,
      audience: latest?.audience ?? null,
      geo: latest?.geo ?? [],
      split: latest?.split ?? null,
      citations: sources(citationsRes),
    };
  }

  /** Lifetime metric totals per paper, from paper-metrics. */
  private async totals(paperIds: string[]): Promise<Map<string, MetricTotalsDto>> {
    if (paperIds.length === 0) return new Map();
    const res = await this.es.search({
      index: ALIASES.paperMetrics,
      size: 0,
      query: { terms: { paperId: paperIds } },
      aggs: { papers: { terms: { field: 'paperId', size: paperIds.length }, aggs: TOTALS_AGGS } },
    });
    const buckets = (res.aggregations?.papers as { buckets: TotalsBucket[] } | undefined)?.buckets ?? [];
    return new Map(buckets.map((b) => [b.key, toTotals(b)]));
  }

  private async decorate(papers: Paper[], totals: Map<string, MetricTotalsDto>): Promise<PaperListItemDto[]> {
    const [topics, people] = await Promise.all([
      getMany<Topic>(this.es, ALIASES.topics, papers.map((p) => p.topicId), ['id', 'name']),
      getMany<Person>(this.es, ALIASES.people, papers.flatMap((p) => p.authorIds), ['id', 'name', 'initials']),
    ]);
    return papers.map((p) => ({
      ...p,
      topic: { id: p.topicId, name: topics.get(p.topicId)?.name ?? p.topicId },
      authors: p.authorIds.map((a) => people.get(a)).filter((a): a is Person => !!a).map((a) => ({ id: a.id, name: a.name, initials: a.initials })),
      totals: totals.get(p.id) ?? EMPTY_TOTALS,
    }));
  }
}
