import { ConflictException, InternalServerErrorException, Logger } from '@nestjs/common';
import { Client, errors } from '@elastic/elasticsearch';
import type { Person, Question, Topic } from '../model/types';
import type { ScopeService } from '../scope/scope.service';
import type { TopicRollupService } from '../topic-health/topic-rollup.service';
import type { CreateTopicDto } from './topics.dto';
import { TopicsService } from './topics.service';

const conflict = () => new errors.ResponseError({ statusCode: 409, body: {}, headers: {}, warnings: null, meta: {} as never });

/** A mock answering asynchronously, as the client does: what `f` returns resolves, and what it throws rejects. */
const answers = <A extends unknown[], R>(f: (...args: A) => R) =>
  jest.fn((...args: A) => new Promise<R>((resolve) => resolve(f(...args))));

/** Just enough of Elasticsearch for the New Topic flow: documents by index and id, created once. */
function fakeEs() {
  const docs = new Map<string, Map<string, object>>();
  const index = (name: string) => docs.get(name) ?? docs.set(name, new Map()).get(name)!;
  const es = {
    mget: answers(({ index: i, ids }: { index: string; ids: string[] }) => ({
      docs: ids.map((id) => (index(i).has(id) ? { _id: id, found: true, _source: index(i).get(id) } : { _id: id, found: false })),
    })),
    search: answers(({ index: i, query }: { index: string; query: { term: { idempotencyKey: string } } }) => ({
      hits: { hits: [...index(i).values()].filter((d) => (d as Topic).idempotencyKey === query.term.idempotencyKey).map((d) => ({ _source: d })) },
    })),
    create: answers(({ index: i, id, document }: { index: string; id: string; document: object }) => {
      if (index(i).has(id)) throw conflict();
      index(i).set(id, document);
    }),
    bulk: answers(({ operations }: { operations: object[] }) => {
      const items = [];
      for (let n = 0; n < operations.length; n += 2) {
        const { _index, _id } = (operations[n] as { create: { _index: string; _id: string } }).create;
        if (index(_index).has(_id)) {
          items.push({ create: { status: 409, error: { type: 'version_conflict_engine_exception' } } });
        } else {
          index(_index).set(_id, operations[n + 1]);
          items.push({ create: { status: 201 } });
        }
      }
      return { items };
    }),
    deleteByQuery: answers(({ index: i, query }: { index: string; query: { term: { topicId: string } } }) => {
      for (const [id, d] of index(i)) if ((d as Question).topicId === query.term.topicId) index(i).delete(id);
      return { failures: [] };
    }),
    delete: answers(({ index: i, id }: { index: string; id: string }) => void index(i).delete(id)),
  };
  return { es, index };
}

const chief = { id: 'hv', role: 'chief' } as Person;
const base: CreateTopicDto = { name: 'Lidar Fusion', bin: 2, teamId: 'team-a', leadId: 'mo', questions: ['Q1'] };

describe('TopicsService.create', () => {
  let store: ReturnType<typeof fakeEs>;
  let topics: TopicsService;

  beforeEach(() => {
    store = fakeEs();
    store.index('people').set('mo', { id: 'mo' });
    store.index('org-units').set('team-a', { id: 'team-a', kind: 'team', parentId: 'c-1' });
    topics = new TopicsService(
      store.es as unknown as Client,
      {} as ScopeService,
      { recompute: jest.fn() } as unknown as TopicRollupService,
      { today: () => '2026-11-08' },
    );
    // The read-back after a create isn't what's under test.
    jest.spyOn(topics, 'get').mockImplementation((_user, id) => Promise.resolve({ id } as never));
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const questions = () => [...store.index('questions').values()] as Question[];
  const stored = (id: string) => store.index('topics').get(id) as Topic;

  it('refuses a replay of the key with different details, and leaves the topic as it was', async () => {
    await topics.create(chief, { ...base, priorityType: 'internal' }, 'k1');

    await expect(topics.create(chief, { ...base, priorityType: 'national', questions: ['Q1', 'Q2'] }, 'k1')).rejects.toThrow(ConflictException);
    await expect(topics.create(chief, { ...base, bin: 1 }, 'k1')).rejects.toThrow(ConflictException);
    expect(stored('t-lidar-fusion').priorityType).toBe('internal');
    expect(questions().map((q) => q.text)).toEqual(['Q1']);
  });

  it('accepts a replay of the same request, however it was spelled, and finishes that topic', async () => {
    await topics.create(chief, base, 'k1');
    store.index('questions').clear(); // as if the first attempt's questions never landed

    const replay = { ...base, name: '  Lidar Fusion ', priorityType: 'internal' as const, priorityLabel: 'Core', questions: ['Q1 ', 'Q1'] };
    await expect(topics.create(chief, replay, 'k1')).resolves.toEqual({ id: 't-lidar-fusion' });
    expect(questions()).toEqual([{ id: 't-lidar-fusion-q1', topicId: 't-lidar-fusion', text: 'Q1', status: 'open', ownerId: 'mo' }]);
    expect(store.index('topics').size).toBe(1);
  });

  it('gives each topic its own question ids, so two topics never share one', async () => {
    await topics.create(chief, { ...base, questions: ['A1', 'A2'] });
    await topics.create(chief, { ...base, name: 'Sonar', questions: ['B1', 'B2'] });
    expect(questions().map((q) => [q.id, q.text])).toEqual([
      ['t-lidar-fusion-q1', 'A1'],
      ['t-lidar-fusion-q2', 'A2'],
      ['t-sonar-q1', 'B1'],
      ['t-sonar-q2', 'B2'],
    ]);
  });

  it('fails rather than counting a question id taken by another record as written', async () => {
    store.index('questions').set('t-sonar-q1', { id: 't-sonar-q1', topicId: 't-other', text: 'Not this one', status: 'open', ownerId: 'mo' });

    await expect(topics.create(chief, { ...base, name: 'Sonar', questions: ['B1'] })).rejects.toThrow(InternalServerErrorException);
    expect(store.index('topics').has('t-sonar')).toBe(false);
    expect(questions()).toEqual([expect.objectContaining({ id: 't-sonar-q1', topicId: 't-other' })]);
  });

  it('finishes a topic created before request hashes with the ids it was created with', async () => {
    store.index('topics').set('t-old', { id: 't-old', name: 'Old', leadId: 'mo', teamId: 'team-a', idempotencyKey: 'hv:k-old' });
    await topics.create(chief, { ...base, name: 'Old', questions: ['Q1'] }, 'k-old');
    expect(questions()).toEqual([expect.objectContaining({ id: expect.stringMatching(/^q-[0-9a-f]{8}$/), topicId: 't-old' })]);
  });
});
