import { fakeEs } from '../../test/unit/fake-es';
import type { Person } from '../model/types';
import { ScopeService } from '../scope/scope.service';
import { PeopleService } from './people.service';

const person = (id: string, role: Person['role'], allocations: Person['allocations'], capacity = 1): Person => ({
  id,
  name: id.toUpperCase(),
  initials: id.slice(0, 2).toUpperCase(),
  role,
  title: 'Researcher',
  team: 'team-a',
  allocations,
  capacity,
  started: '2024-01-01',
  ended: null,
});

describe('PeopleService scoping of allocations', () => {
  const chief = person('hv', 'chief', []);
  const pi = person('mo', 'pi', [{ topicId: 't-shared', fte: 0.5 }]);
  // Shares t-shared with the PI, and works on a topic the PI can't see.
  const ann = person('ann', 'staff', [
    { topicId: 't-shared', fte: 0.3 },
    { topicId: 't-secret', fte: 0.9 },
  ]);
  const people = () => {
    const { client } = fakeEs({
      people: [pi, ann, chief],
      topics: [
        { id: 't-shared', name: 'Shared', leadId: 'mo' },
        { id: 't-secret', name: 'Secret', leadId: 'hv' },
      ],
    });
    return new PeopleService(client, new ScopeService(client));
  };

  it('lists, for a PI, only the shared topic’s allocation and the rest as one total', async () => {
    const listed = (await people().list(pi)).find((p) => p.id === 'ann')!;
    expect(listed.allocations).toEqual([{ topicId: 't-shared', fte: 0.3 }]);
    expect(listed).toMatchObject({ load: 1.2, otherFte: 0.9, overCapacity: true });
    expect(JSON.stringify(listed)).not.toContain('t-secret');
  });

  it('shows a PI the same in the detail', async () => {
    const detail = await people().get(pi, 'ann');
    expect(detail.allocations).toEqual([{ topicId: 't-shared', fte: 0.3 }]);
    expect(detail.topics).toEqual([{ topic: { id: 't-shared', name: 'Shared' }, fte: 0.3 }]);
    expect(detail).toMatchObject({ load: 1.2, otherFte: 0.9 });
    expect(JSON.stringify(detail)).not.toContain('t-secret');
  });

  it('returns only the fields of a person, not whatever else the stored document holds', async () => {
    const { client } = fakeEs({ people: [{ ...ann, internalNote: 'x' }], topics: [] });
    const [listed] = await new PeopleService(client, new ScopeService(client)).list(chief);
    expect(Object.keys(listed).sort()).toEqual(
      ['allocations', 'capacity', 'ended', 'id', 'initials', 'load', 'name', 'otherFte', 'overCapacity', 'role', 'started', 'team', 'title'].sort(),
    );
  });

  it('shows the Chief every allocation, in the list and the detail', async () => {
    const all = [
      { topicId: 't-shared', fte: 0.3 },
      { topicId: 't-secret', fte: 0.9 },
    ];
    const listed = (await people().list(chief)).find((p) => p.id === 'ann')!;
    expect(listed).toMatchObject({ allocations: all, load: 1.2, otherFte: 0 });
    const detail = await people().get(chief, 'ann');
    expect(detail).toMatchObject({ allocations: all, otherFte: 0 });
    expect(detail.topics.map((t) => t.topic.id)).toEqual(['t-shared', 't-secret']);
  });
});
