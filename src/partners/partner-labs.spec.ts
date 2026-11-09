import { partnerLabId, partnerLabs } from './partner-labs';

const paper = (id: string, published: string, partners: string[], initiatedBy: string | null, citations = 0, topic = 't-neuro') => ({
  id,
  title: id,
  venue: 'arXiv',
  published,
  topic: { id: topic, name: topic === 't-neuro' ? 'Neuromorphic' : 'Carbon', health: 'healthy', bin: 1 } as never,
  partners,
  initiatedBy,
  totals: { downloads: 0, views: citations * 10, citations, altmetric: 0, mentions: { news: 0, policy: 0, social: 0, patents: 0 } },
});

describe('partnerLabs', () => {
  const papers = [
    paper('p1', '2025-11-01', ['Sandia'], 'Sandia', 70),
    paper('p2', '2026-03-01', [], null),
    paper('p3', '2026-02-01', ['NREL', 'Scripps'], null, 5, 't-carbon'),
    paper('p4', '2026-04-01', ['Sandia', 'NREL'], 'NREL', 1, 't-carbon'),
  ];

  it('counts joint papers and who started them across the scope', () => {
    expect(partnerLabs(papers)).toMatchObject({ papers: 4, joint: 3, initiatedByUs: 1, initiatedByPartners: 2 });
  });

  it('makes a lab per partner, most joint papers first', () => {
    expect(partnerLabs(papers).labs.map((l) => [l.name, l.joint])).toEqual([
      ['NREL', 2],
      ['Sandia', 2],
      ['Scripps', 1],
    ]);
  });

  it('splits a lab’s papers by who started them, from that lab’s side', () => {
    const nrel = partnerLabs(papers).labs.find((l) => l.name === 'NREL')!;
    expect(nrel).toMatchObject({ initiatedByUs: 1, initiatedByThem: 1, initiatedByOthers: 0, citations: 6, views: 60, lastPublished: '2026-04-01' });
    const sandia = partnerLabs(papers).labs.find((l) => l.name === 'Sandia')!;
    expect(sandia).toMatchObject({ initiatedByUs: 0, initiatedByThem: 1, initiatedByOthers: 1 });
    expect(sandia.papers.map((p) => [p.id, p.initiatedBy, p.initiator, p.otherPartners])).toEqual([
      ['p4', 'other-partner', 'NREL', ['NREL']],
      ['p1', 'partner', 'Sandia', []],
    ]);
  });

  it('lists a lab’s topics once each, by name', () => {
    const sandia = partnerLabs(papers).labs.find((l) => l.name === 'Sandia')!;
    expect(sandia.topics).toEqual([
      { id: 't-carbon', name: 'Carbon' },
      { id: 't-neuro', name: 'Neuromorphic' },
    ]);
  });

  it('has no labs without joint papers', () => {
    expect(partnerLabs([paper('p2', '2026-03-01', [], null)])).toEqual({ papers: 1, joint: 0, initiatedByUs: 0, initiatedByPartners: 0, labs: [] });
  });

  it('gives each lab a stable id, distinct for names a slug would merge', () => {
    const labs = partnerLabs([paper('p5', '2026-05-01', ['A+B Research', 'A B Research'], null), ...papers]).labs;
    const ids = labs.map((l) => l.id);
    expect(new Set(ids).size).toBe(labs.length);
    expect(ids.every((id) => /^lab-[0-9a-f]{16}$/.test(id))).toBe(true);
    expect(labs.find((l) => l.name === 'NREL')!.id).toBe(partnerLabs(papers).labs.find((l) => l.name === 'NREL')!.id);
    expect(partnerLabId('A+B Research')).not.toBe(partnerLabId('A B Research'));
    // Pinned: the frontend keeps these in URLs.
    expect(partnerLabId('Sandia')).toBe('lab-59f7fbed1a6eaf5d');
  });
});
