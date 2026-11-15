import { fakeEs } from '../../test/unit/fake-es';
import type { Paper, Person } from '../model/types';
import { PartnersService } from '../partners/partners.service';
import { PortfolioService } from '../portfolio/portfolio.service';
import { ScopeService } from '../scope/scope.service';
import type { TopicRollupService } from '../topic-health/topic-rollup.service';
import { PapersService } from './papers.service';

const chief = { id: 'hv', role: 'chief' } as Person;
const clock = { today: () => '2026-11-08' };

const paper = (id: string, published: string, partners: string[] = []) =>
  ({ id, topicId: 't-1', title: id, venue: 'arXiv', published, authorIds: [], partners, initiatedBy: null, grade: null }) as unknown as Paper;
const metrics = (paperId: string, month: string, views: number, citations = 0) => ({
  paperId,
  topicId: 't-1',
  month,
  views,
  downloads: 0,
  citations,
  altmetric: 0,
  mentions: { news: 0, policy: 0, social: 0, patents: 0 },
});

/** 10,001 recent papers read a little, and one older paper read the most – outside the newest 10,000. */
function world() {
  const recent = Array.from({ length: 10_001 }, (_, i) => paper(`p${String(i).padStart(5, '0')}`, '2026-06-01'));
  const store = fakeEs({
    topics: [{ id: 't-1', name: 'One' }],
    papers: [...recent, paper('p-old', '2019-01-01', ['Sandia'])],
    'paper-metrics': [metrics('p00000', '2026-07', 5), metrics('p00001', '2026-07', 3), metrics('p-old', '2019-03', 900, 4)],
  });
  const scope = new ScopeService(store.client);
  const papers = new PapersService(store.client, scope, clock, {} as TopicRollupService);
  return { store, scope, papers };
}

describe('PapersService past one result window', () => {
  it('ranks by reads over every paper, so an older most-read paper comes first', async () => {
    const { papers } = world();
    const list = await papers.list(chief, { sort: 'reads' });
    expect(list).toHaveLength(10_002);
    expect(list.slice(0, 3).map((p) => [p.id, p.totals.views])).toEqual([
      ['p-old', 900],
      ['p00000', 5],
      ['p00001', 3],
    ]);
  });

  it('lists every paper, newest first, by default', async () => {
    const { papers } = world();
    const list = await papers.list(chief, {});
    expect(list).toHaveLength(10_002);
    expect(list.at(-1)!.id).toBe('p-old');
  });

  it('counts every paper in time-to-first-citation', async () => {
    const { papers } = world();
    expect(await papers.firstCitationSummary(chief, {})).toMatchObject({ papers: 10_002, cited: 1, awaiting: 10_001, medianMonths: 2 });
  });

  it('rolls partner labs up from every paper', async () => {
    const { papers } = world();
    expect(await new PartnersService(papers).labs(chief)).toMatchObject({ papers: 10_002, joint: 1, labs: [{ name: 'Sandia', views: 900 }] });
  });

  it('counts every paper in the papers-to-date history', async () => {
    const { store, scope } = world();
    const history = await new PortfolioService(store.client, scope, clock).history(chief, { months: 3, horizon: 1 });
    expect(history.papers.current).toBe(10_002);
  });
});

describe('PapersService attention score', () => {
  /** A month of metrics with the attention score at its end. */
  const attention = (paperId: string, month: string, altmetric: number, views = 1) => ({ ...metrics(paperId, month, views), altmetric });
  const papersOf = (rows: object[]) =>
    new PapersService(
      fakeEs({ topics: [{ id: 't-1', name: 'One' }], papers: [paper('p-down', '2026-01-01'), paper('p-zero', '2026-01-01')], 'paper-metrics': rows }).client,
      new ScopeService(fakeEs().client),
      clock,
      {} as TopicRollupService,
    );
  const rows = [
    attention('p-down', '2026-10', 100),
    attention('p-down', '2026-11', 40),
    // Corrected to zero: the latest score stands, however high it once was.
    attention('p-zero', '2026-09', 70),
    attention('p-zero', '2026-10', 0),
  ];
  const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));

  it('is the latest month’s score, not the highest, when it falls or is corrected to zero', async () => {
    const list = byId(await papersOf(rows).list(chief, {}));
    expect(list.get('p-down')!.totals).toMatchObject({ altmetric: 40, views: 2 });
    expect(list.get('p-zero')!.totals).toMatchObject({ altmetric: 0, views: 2 });
  });

  it('is the score of the period’s last month within a period', async () => {
    const list = byId(await papersOf(rows).list(chief, { period: '2026-10' }));
    expect(list.get('p-down')!.periodTotals).toMatchObject({ altmetric: 100, views: 1 });
    expect(list.get('p-zero')!.periodTotals).toMatchObject({ altmetric: 0, views: 1 });
  });

  it('is the latest month’s in the top papers too, lifetime and in the period', async () => {
    const top = byId(await papersOf(rows).top(chief, { period: 'FY27', limit: 2 }));
    expect(top.get('p-down')).toMatchObject({ totals: { altmetric: 40 }, periodTotals: { altmetric: 40 } });
    expect(top.get('p-zero')).toMatchObject({ totals: { altmetric: 0 }, periodTotals: { altmetric: 0 } });
  });
});

describe('PapersService top papers', () => {
  it('ranks every paper in the period, over more papers than one page of buckets', async () => {
    const many = Array.from({ length: 2500 }, (_, i) => `p${String(i).padStart(4, '0')}`);
    const store = fakeEs({
      topics: [{ id: 't-1', name: 'One' }],
      papers: many.map((id) => paper(id, '2026-01-01')),
      'paper-metrics': [...many.map((id, i) => metrics(id, '2026-10', i % 7)), metrics('p2400', '2026-11', 50), metrics('p0003', '2026-11', 40)],
    });
    const papers = new PapersService(store.client, new ScopeService(store.client), clock, {} as TopicRollupService);
    const top = await papers.top(chief, { period: 'FY27', limit: 3 });
    expect(top.map((p) => [p.id, p.periodTotals.views])).toEqual([
      ['p2400', 50 + (2400 % 7)],
      ['p0003', 43],
      ['p0006', 6],
    ]);
    // Three pages of 1,000 papers each
    expect(store.es.search.mock.calls.filter(([r]) => (r as { aggs?: { page?: object } }).aggs?.page)).toHaveLength(3);
  });
});
