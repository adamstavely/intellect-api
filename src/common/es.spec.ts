import type { Client } from '@elastic/elasticsearch';
import { getMany, searchAll } from './es';

const client = (docs: unknown[]) => ({ mget: jest.fn().mockResolvedValue({ docs }) }) as unknown as Client;

describe('getMany', () => {
  it('leaves out ids that do not exist', async () => {
    const es = client([
      { _index: 'people', _id: 'hv', found: true, _source: { id: 'hv' } },
      { _index: 'people', _id: 'zz', found: false },
    ]);
    expect([...(await getMany(es, 'people', ['hv', 'zz', 'hv'])).keys()]).toEqual(['hv']);
  });

  it('throws when a doc could not be read, rather than calling it missing', async () => {
    const es = client([
      { _index: 'people', _id: 'hv', found: true, _source: { id: 'hv' } },
      { _index: 'people', _id: 'mo', error: { type: 'no_shard_available_action_exception', reason: 'No shard available' } },
    ]);
    await expect(getMany(es, 'people', ['hv', 'mo'])).rejects.toThrow('Could not read people/mo: no_shard_available_action_exception');
  });
});

describe('searchAll', () => {
  /** A point in time over `docs`, paged by search_after on each hit's position. */
  const paged = (docs: object[]) => {
    let pages = 0;
    return {
      openPointInTime: jest.fn().mockResolvedValue({ id: 'pit-1' }),
      closePointInTime: jest.fn().mockResolvedValue({}),
      search: jest.fn(({ size, search_after }: { size: number; search_after?: [number] }) => {
        const from = search_after ? search_after[0] + 1 : 0;
        const hits = docs.slice(from, from + size).map((d, i) => ({ _source: d, sort: [from + i] }));
        return Promise.resolve({ pit_id: `pit-${++pages + 1}`, hits: { hits } });
      }),
    };
  };

  it('reads every page, past the page size, and closes the point in time', async () => {
    const docs = Array.from({ length: 2501 }, (_, i) => ({ id: `g${i}` }));
    const es = paged(docs);
    const all = await searchAll<{ id: string }>(es as unknown as Client, 'gaps', { query: { term: { topicId: 't' } } });

    expect(all).toHaveLength(2501);
    expect(all.at(-1)).toEqual({ id: 'g2500' });
    expect(es.search).toHaveBeenCalledTimes(3);
    // Each page goes through the point in time Elasticsearch last returned, after the previous page's last hit.
    expect(es.search.mock.calls[2][0]).toMatchObject({ pit: { id: 'pit-3' }, search_after: [1999], sort: [{ _shard_doc: 'asc' }], size: 1000 });
    expect(es.closePointInTime).toHaveBeenCalledWith({ id: 'pit-4' });
  });

  it('asks for one more page when the last one is exactly full', async () => {
    const es = paged(Array.from({ length: 2000 }, (_, i) => ({ id: `g${i}` })));
    expect(await searchAll(es as unknown as Client, 'gaps', {})).toHaveLength(2000);
    expect(es.search).toHaveBeenCalledTimes(3);
  });

  it('closes the point in time when a page fails', async () => {
    const es = paged([]);
    es.search.mockRejectedValueOnce(new Error('search_phase_execution_exception'));
    await expect(searchAll(es as unknown as Client, 'gaps', {})).rejects.toThrow('search_phase_execution_exception');
    expect(es.closePointInTime).toHaveBeenCalledWith({ id: 'pit-1' });
  });
});
