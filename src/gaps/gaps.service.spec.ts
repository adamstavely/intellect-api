import { fakeEs } from '../../test/unit/fake-es';
import type { Gap, Person, Work } from '../model/types';
import { ScopeService } from '../scope/scope.service';
import { byAttention, GapsService } from './gaps.service';

const gap = (id: string, severity: Gap['severity'], topicId: string) => ({ id, severity, topicId }) as Gap;

describe('byAttention', () => {
  it('orders by severity, then least healthy topic, then id', () => {
    const health: Record<string, number> = { a: 80, b: 10 };
    const gaps = [gap('g4', 'medium', 'b'), gap('g3', 'critical', 'a'), gap('g2', 'critical', 'b'), gap('g1', 'high', 'a'), gap('g0', 'critical', 'b')];
    expect(gaps.sort(byAttention((t) => health[t])).map((g) => g.id)).toEqual(['g0', 'g2', 'g3', 'g1', 'g4']);
  });
});

describe('GapsService past one result window', () => {
  const chief = { id: 'hv', role: 'chief' } as Person;
  const gap = (id: string, severity: Gap['severity'], status: Gap['status'] = 'open') =>
    ({ id, topicId: 't-1', text: id, severity, status, ownerId: 'mo', questionIds: [] }) as Gap;
  const work = (id: string, gapId: string, status: Work['status'] = 'active') =>
    ({ id, topicId: 't-1', gapIds: [gapId], status, budget: { allocated: 0.01 }, fte: 0.1 }) as unknown as Work;

  const service = (indices: Record<string, object[]>) => {
    const { client } = fakeEs({ topics: [{ id: 't-1', name: 'One', health: 'watch', healthScore: 50, bin: 1 }], people: [{ id: 'mo', name: 'Mo', initials: 'MO' }], ...indices });
    return new GapsService(client, new ScopeService(client));
  };

  it('counts a critical gap covered by the 10,001st work item in flight as covered', async () => {
    // 10,000 items on other gaps come first; the one covering g-crit is the last.
    const inFlight = [...Array.from({ length: 10_000 }, (_, i) => work(`w${i}`, `g-other-${i}`, 'blocked')), work('w-cover', 'g-crit')];
    const gaps = service({ work: inFlight, gaps: [gap('g-crit', 'critical'), gap('g-medium', 'medium')] });

    const { gaps: attention, total } = await gaps.list(chief, { attention: true });
    expect(attention.map((g) => g.id)).toEqual(['g-medium']);
    expect(total).toBe(1);
    const { gaps: all } = await gaps.list(chief, { topicId: 't-1' });
    expect(all.find((g) => g.id === 'g-crit')).toMatchObject({ covered: true, activeWork: 1 });
  });

  it('ranks over every matching gap before cutting to the limit, and reports how many matched', async () => {
    // The one critical gap is the 10,002nd stored.
    const many = [...Array.from({ length: 10_001 }, (_, i) => gap(`g${String(i).padStart(5, '0')}`, 'medium')), gap('g-crit', 'critical')];
    const gaps = service({ work: [], gaps: many });

    const { gaps: top, total } = await gaps.list(chief, { attention: true, limit: 3 });
    expect(top.map((g) => g.id)).toEqual(['g-crit', 'g00000', 'g00001']);
    expect(total).toBe(10_002);
    expect((await gaps.ranked(chief, { attention: true })).gaps).toHaveLength(10_002);
  });
});
