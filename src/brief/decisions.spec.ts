import type { Gap, Topic, Work } from '../model/types';
import type { PersonSummaryDto } from '../people/people.dto';
import { decisions } from './decisions';

const topic = (id: string, bin: Topic['bin'], health: Topic['health'], healthScore: number) =>
  ({ id, name: id.toUpperCase(), bin, health, healthScore, priorityLabel: 'Core', momentum: -4, stats: { coverage: 0.25 } }) as Topic;
const work = (id: string, status: Work['status'], gapIds: string[]) => ({ id, title: `Work ${id}`, topicId: 't1', status, gapIds, note: '' }) as Work;
const gap = (id: string, severity: Gap['severity']) => ({ id, severity, status: 'open', text: `Gap ${id}` }) as Gap;

describe('decisions', () => {
  it('asks to review at-risk topics in bins 1–2, worst first', () => {
    const out = decisions({ topics: [topic('t1', 2, 'at-risk', 30), topic('t2', 1, 'at-risk', 10), topic('t3', 3, 'at-risk', 0), topic('t4', 1, 'watch', 50)], blockedWork: [], allWork: [], gaps: new Map(), people: [] });
    expect(out.map((d) => d.topicId)).toEqual(['t2', 't1']);
    expect(out[0].body).toBe('Core topic is at risk: health 10, 25% gap coverage, momentum -4 over three months.');
  });

  it('asks to unblock work only when it is the sole work against a critical/high gap', () => {
    const blocked = [work('w1', 'blocked', ['g1']), work('w2', 'blocked', ['g2']), work('w3', 'blocked', ['g3'])];
    const allWork = [...blocked, work('w4', 'active', ['g2'])];
    const gaps = new Map([gap('g1', 'critical'), gap('g2', 'high'), gap('g3', 'medium')].map((g) => [g.id, g]));
    const out = decisions({ topics: [], blockedWork: blocked, allWork, gaps, people: [] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ tag: 'Operations', lead: 'Unblock “Work w1”.' });
  });

  it('asks to rebalance over-capacity people and caps the list at five', () => {
    const people = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, load: 1 + i / 10, capacity: 1, overCapacity: i > 0, allocations: [] }) as unknown as PersonSummaryDto);
    const out = decisions({ topics: [], blockedWork: [], allWork: [], gaps: new Map(), people });
    expect(out).toHaveLength(5);
    expect(out[0].lead).toBe("Rebalance P6's allocation.");
  });
});
