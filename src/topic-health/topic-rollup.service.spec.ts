import type { Client } from '@elastic/elasticsearch';
import type { Gap, Work } from '../model/types';
import { TopicRollupService } from './topic-rollup.service';

/** Elasticsearch holding `docs` per index, read through points in time a page at a time, as `searchAll` does. */
function pagedEs(docs: Record<string, object[]>) {
  return {
    count: jest.fn(({ index }: { index: string }) => Promise.resolve({ count: docs[index]?.length ?? 0 })),
    openPointInTime: jest.fn(({ index }: { index: string }) => Promise.resolve({ id: index })),
    closePointInTime: jest.fn().mockResolvedValue({}),
    search: jest.fn(({ pit, index, size, search_after }: { pit?: { id: string }; index?: string; size: number; search_after?: [number] }) => {
      const all = docs[pit?.id ?? index!] ?? [];
      const from = search_after ? search_after[0] + 1 : 0;
      return Promise.resolve({ hits: { hits: all.slice(from, from + size).map((d, i) => ({ _source: d, sort: [from + i] })) } });
    }),
  };
}

describe('TopicRollupService.compute', () => {
  const asOf = '2026-11-08';
  const closedGap = (i: number): Gap => ({ id: `g${i}`, topicId: 't', text: '', severity: 'medium', status: 'closed', ownerId: 'mo', questionIds: [] });
  const doneWork = (i: number): Work => ({ id: `w${i}`, topicId: 't', title: '', status: 'complete', leadId: 'mo', memberIds: [], progress: 1, due: '2026-01-01', budget: { allocated: 0, spent: 0 }, fte: 0, gapIds: [], note: '' });

  it('counts every record past the first thousand, so a gap on a later page still counts', async () => {
    const gaps = [...Array.from({ length: 2400 }, (_, i) => closedGap(i)), { ...closedGap(2400), severity: 'critical' as const, status: 'open' as const }];
    const es = pagedEs({
      questions: Array.from({ length: 1500 }, () => ({})),
      gaps,
      work: Array.from({ length: 1200 }, (_, i) => doneWork(i)),
      papers: Array.from({ length: 1100 }, () => ({ grade: null, partners: [] })),
      people: Array.from({ length: 1300 }, () => ({ allocations: [{ topicId: 't', fte: 0.1 }] })),
    });

    const rollup = await new TopicRollupService(es as unknown as Client).compute('t', asOf);

    expect(rollup.stats).toMatchObject({ questions: 1500, gaps: 2401, openGaps: 1, coverage: 0, work: 1200, papers: 1100, fte: 130 });
    expect(rollup.health).not.toBe('healthy');
    expect(rollup.healthScore).toBe(0);
    expect(es.closePointInTime).toHaveBeenCalledTimes(4);
  });
});
