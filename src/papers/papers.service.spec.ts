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
