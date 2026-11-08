import type { Client } from '@elastic/elasticsearch';
import type { Person } from '../model/types';
import { ScopeService } from './scope.service';

const person = (over: Partial<Person>): Person => ({
  id: 'x',
  name: 'X',
  initials: 'X',
  role: 'pi',
  title: 'PI',
  team: null,
  allocations: [],
  capacity: 1,
  started: '2024-01-01',
  ended: null,
  ...over,
});

describe('ScopeService', () => {
  const search = jest.fn();
  const service = new ScopeService({ search } as unknown as Client);

  beforeEach(() => search.mockReset());

  it('gives the Chief every topic without querying', async () => {
    expect(await service.filter(person({ role: 'chief' }))).toEqual({ match_all: {} });
    expect(search).not.toHaveBeenCalled();
  });

  it('gives a PI the topics they lead plus the ones they have FTE on', async () => {
    search.mockResolvedValue({ hits: { hits: [{ _source: { id: 't-led' } }] } });
    const pi = person({ id: 'mo', allocations: [{ topicId: 't-alloc', fte: 0.3 }, { topicId: 't-zero', fte: 0 }] });
    expect(await service.filter(pi)).toEqual({ terms: { topicId: ['t-alloc', 't-led'] } });
    expect(await service.filter(pi, 'id')).toEqual({ terms: { id: ['t-alloc', 't-led'] } });
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ index: 'topics', query: { term: { leadId: 'mo' } } }));
  });

  it('gives a user with no topics an empty terms filter (matches nothing)', async () => {
    search.mockResolvedValue({ hits: { hits: [] } });
    expect(await service.filter(person({ role: 'staff' }))).toEqual({ terms: { topicId: [] } });
  });
});
