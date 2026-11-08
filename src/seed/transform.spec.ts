import { buildSeed } from './seed';
import { loadPrototype } from './prototype';

const AS_OF = '2026-11-06';

describe('seed transform', () => {
  let docs: Awaited<ReturnType<typeof buildSeed>>['docs'];
  let warnings: string[];

  beforeAll(async () => {
    ({ docs, warnings } = await buildSeed(AS_OF));
  });

  it('converts all 12 prototype topics and their records', () => {
    expect(docs.topics).toHaveLength(12);
    expect(docs.people).toHaveLength(11);
    expect(docs.questions).toHaveLength(8);
    expect(docs.gaps).toHaveLength(11);
    expect(docs.work).toHaveLength(8);
    expect(docs.papers).toHaveLength(3);
    expect(docs.citations).toHaveLength(8);
    expect(warnings).toEqual([]);
    expect(new Set(docs.topics.map((t) => t.doc.priorityType))).toEqual(new Set(['internal', 'national', 'external']));
  });

  it('gives every topic-owned record a topicId that exists', () => {
    const topicIds = new Set(docs.topics.map((t) => t.id));
    for (const index of ['questions', 'gaps', 'work', 'papers', 'paper-metrics', 'citations', 'topic-health-history'] as const) {
      for (const { doc } of docs[index]) expect(topicIds).toContain(doc.topicId);
    }
  });

  it('stores each link once, on the child', () => {
    const q = docs.questions[0].doc as unknown as Record<string, unknown>;
    expect(q).not.toHaveProperty('gapIds');
    expect(docs.gaps.find((g) => g.id === 'g2')!.doc.questionIds).toEqual(['q1', 'q3']);
    expect(docs.work.find((w) => w.id === 'w3')!.doc.gapIds).toEqual(['g5']);
    expect(docs.papers.find((p) => p.id === 'p4')!.doc.workIds).toEqual(['w3']);
    expect(docs.citations.find((c) => c.id === 'c4')!.doc.paperId).toBe('p5');
    for (const { doc } of docs.gaps) expect(doc).not.toHaveProperty('work');
  });

  it('ignores the hand-set health, coverage and momentum and recomputes them', () => {
    const neuro = docs.topics.find((t) => t.id === 't-neuro')!.doc;
    // Prototype said at-risk / 0.42 / -8. Recomputed: 2 of 5 open gaps covered by active work.
    expect(neuro.stats).toMatchObject({ questions: 4, gaps: 5, openGaps: 5, coverage: 0.4, work: 4, papers: 2, fte: 2 });
    expect(neuro.stats.grades).toEqual({ outstanding: 0, excellent: 0, satisfactory: 0, dissatisfactory: 0, ungraded: 2 });
    // 40 − 15 (g2 critical) − 8 (g3 high) − 10 (w2 blocked) − 4×5 overdue → clamped to 0.
    expect(neuro.healthScore).toBe(0);
    expect(neuro.health).toBe('at-risk');
    expect(neuro.trend).toHaveLength(12);
    expect(neuro.momentum).toBe(neuro.trend[11] - neuro.trend[8]);
  });

  it('backfills 12 months of topic-health-history per topic ending at asOf', () => {
    expect(docs['topic-health-history']).toHaveLength(12 * 12);
    const neuro = docs['topic-health-history'].filter((h) => h.doc.topicId === 't-neuro').map((h) => h.doc);
    expect(neuro[0].month).toBe('2025-12');
    expect(neuro[11].month).toBe('2026-11');
    expect(neuro.map((h) => h.healthScore)).toEqual(docs.topics.find((t) => t.id === 't-neuro')!.doc.trend);
  });

  it('derives org units: the eleven mission centers and their teams', () => {
    const units = docs['org-units'].map((u) => u.doc);
    expect(units.filter((u) => u.kind === 'center')).toHaveLength(11);
    expect(units.find((u) => u.id === 'team-cognitive-systems')).toMatchObject({ parentId: 'c-cci', leadId: 'mo' });
    expect(docs.topics.find((t) => t.id === 't-grid')!.doc).toMatchObject({ teamId: 'team-energy-and-materials', centerId: 'c-nemc' });
  });

  it('writes paper metrics that sum back to the prototype totals', () => {
    const proto = loadPrototype().papers;
    for (const p of proto) {
      const months = docs['paper-metrics'].filter((m) => m.doc.paperId === p.id).map((m) => m.doc);
      expect(months.length).toBeGreaterThan(0);
      expect(months.reduce((s, m) => s + m.downloads, 0)).toBe(p.reads.downloads);
      expect(months.reduce((s, m) => s + m.citations, 0)).toBe(p.reads.citations);
      expect(months[months.length - 1].altmetric).toBe(p.reads.altmetric);
    }
  });
});
