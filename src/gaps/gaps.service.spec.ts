import type { Gap } from '../model/types';
import { byAttention } from './gaps.service';

const gap = (id: string, severity: Gap['severity'], topicId: string) => ({ id, severity, topicId }) as Gap;

describe('byAttention', () => {
  it('orders by severity, then least healthy topic, then id', () => {
    const health: Record<string, number> = { a: 80, b: 10 };
    const gaps = [gap('g4', 'medium', 'b'), gap('g3', 'critical', 'a'), gap('g2', 'critical', 'b'), gap('g1', 'high', 'a'), gap('g0', 'critical', 'b')];
    expect(gaps.sort(byAttention((t) => health[t])).map((g) => g.id)).toEqual(['g0', 'g2', 'g3', 'g1', 'g4']);
  });
});
