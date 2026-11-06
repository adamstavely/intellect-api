import { loadPrototype } from '../seed/prototype';
import { distribute, SeedMetricsSource } from './seed-metrics-source';

describe('distribute', () => {
  it('splits proportionally and sums to the total', () => {
    expect(distribute(10, [1, 1, 2])).toEqual([2, 2, 6]);
    const parts = distribute(18420, [200, 420, 690, 1100]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(18420);
  });

  it('puts everything in the last bucket when weights are all zero', () => {
    expect(distribute(5, [0, 0])).toEqual([0, 5]);
  });
});

describe('SeedMetricsSource', () => {
  const source = new SeedMetricsSource(loadPrototype().papers);

  it('returns one document per month from publication through asOf', async () => {
    const docs = await source.monthly({ paperId: 'p4', topicId: 't-neuro', published: '2026-03-01' }, '2026-11-06');
    expect(docs.map((d) => d.month)).toEqual(['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    expect(docs.every((d) => d.paperId === 'p4' && d.topicId === 't-neuro')).toBe(true);
  });

  it('caps at 12 months', async () => {
    const docs = await source.monthly({ paperId: 'p1', topicId: 't-neuro', published: '2025-11-01' }, '2026-11-06');
    expect(docs).toHaveLength(12);
  });

  it('returns nothing for unknown papers or future publication', async () => {
    expect(await source.monthly({ paperId: 'nope', topicId: 't', published: '2026-01-01' }, '2026-11-06')).toEqual([]);
    expect(await source.monthly({ paperId: 'p1', topicId: 't', published: '2027-01-01' }, '2026-11-06')).toEqual([]);
  });
});
