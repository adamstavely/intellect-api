import { errors, type Client } from '@elastic/elasticsearch';
import { fakeEs } from '../../test/unit/fake-es';
import { chunks, count, getMany, msearch, readAll, search, searchAll, SearchUnavailableError } from './es';

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

describe('readAll', () => {
  const docs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `w${String(i).padStart(5, '0')}`, due: `2026-${String((i % 12) + 1).padStart(2, '0')}` }));

  it('reads a result that fits one window with one search and no point in time', async () => {
    const { es, client } = fakeEs({ work: docs(10_000) });
    expect(await readAll(client, 'work', {})).toHaveLength(10_000);
    expect(es.search).toHaveBeenCalledTimes(1);
    expect(es.openPointInTime).not.toHaveBeenCalled();
  });

  it('reads every hit past the window, in the order asked for', async () => {
    const { es, client } = fakeEs({ work: docs(10_001) });
    const all = await readAll<{ id: string; due: string }>(client, 'work', { sort: [{ due: 'desc' }, { id: 'asc' }] });
    expect(all).toHaveLength(10_001);
    expect(all[0]).toEqual({ id: 'w00011', due: '2026-12' });
    expect(all.at(-1)).toEqual({ id: 'w09996', due: '2026-01' });
    expect(es.closePointInTime).toHaveBeenCalled();
  });
});

/** Partial successes Elasticsearch can return with a 200: a timeout, or shards that failed. */
const TIMED_OUT = { timed_out: true, _shards: { total: 2, successful: 2, failed: 0 } };
const SHARD_FAILED = {
  timed_out: false,
  _shards: { total: 2, successful: 1, failed: 1, failures: [{ shard: 1, index: 'gaps-v1', reason: { type: 'node_not_connected_exception', reason: 'gone' } }] },
};
const empty = { hits: { total: { value: 0, relation: 'eq' }, hits: [] } };

describe('partial results', () => {
  it.each([
    ['timed out', TIMED_OUT, /search timed out/],
    ['shards failed', SHARD_FAILED, /search failed on 1 of 2 shards \(node_not_connected_exception: gone\)/],
  ])('readAll rejects a first search that %s, rather than calling it empty', async (_, partial, message) => {
    const es = { search: jest.fn().mockResolvedValue({ ...empty, ...partial }) };
    const read = readAll(es as unknown as Client, 'gaps', {});
    await expect(read).rejects.toThrow(SearchUnavailableError);
    await expect(read).rejects.toThrow(message);
    expect(es.search.mock.calls[0][0]).toMatchObject({ allow_partial_search_results: false });
  });

  it('searchAll rejects a partial later page, closing the point in time, and refuses partial pages up front', async () => {
    const page = (n: number) => Array.from({ length: n }, (_, i) => ({ _source: { id: `g${i}` }, sort: [i] }));
    const es = {
      openPointInTime: jest.fn().mockResolvedValue({ id: 'pit-1', _shards: { total: 2, successful: 2, failed: 0 } }),
      closePointInTime: jest.fn().mockResolvedValue({}),
      search: jest
        .fn()
        .mockResolvedValueOnce({ pit_id: 'pit-2', hits: { hits: page(1000) }, _shards: { total: 2, successful: 2, failed: 0 } })
        .mockResolvedValueOnce({ pit_id: 'pit-3', hits: { hits: [] }, ...SHARD_FAILED }),
    };
    await expect(searchAll(es as unknown as Client, 'gaps', {})).rejects.toThrow(SearchUnavailableError);
    expect(es.search).toHaveBeenCalledTimes(2);
    for (const [req] of es.search.mock.calls) expect(req).toMatchObject({ allow_partial_search_results: false });
    expect(es.closePointInTime).toHaveBeenCalledWith({ id: 'pit-2' });
  });

  it('searchAll rejects a point in time opened on only some shards', async () => {
    const es = { openPointInTime: jest.fn().mockResolvedValue({ id: 'pit-1', ...SHARD_FAILED }), search: jest.fn(), closePointInTime: jest.fn() };
    await expect(searchAll(es as unknown as Client, 'gaps', {})).rejects.toThrow(/open point in time failed on 1 of 2 shards/);
    expect(es.search).not.toHaveBeenCalled();
  });

  it('rejects a count or an aggregation that missed shards', async () => {
    const es = {
      count: jest.fn().mockResolvedValue({ count: 0, ...SHARD_FAILED }),
      search: jest.fn().mockResolvedValue({ ...empty, aggregations: { papers: { buckets: [] } }, ...TIMED_OUT }),
    };
    await expect(count(es as unknown as Client, { index: 'questions' })).rejects.toThrow(/count failed on 1 of 2 shards/);
    await expect(search(es as unknown as Client, { index: 'paper-metrics', size: 0, aggs: {} })).rejects.toThrow(SearchUnavailableError);
  });

  it('rejects a multi-search when any one search is partial or failed, and refuses partial results in each', async () => {
    const ok = { ...empty, timed_out: false, _shards: { total: 1, successful: 1, failed: 0 } };
    const es = { msearch: jest.fn().mockResolvedValueOnce({ responses: [ok, { ...empty, ...SHARD_FAILED }] }) };
    const req = { searches: [{ index: 'topics' }, {}, { index: 'gaps' }, {}] };
    await expect(msearch(es as unknown as Client, req)).rejects.toThrow(/search 1 failed on 1 of 2 shards/);
    expect(es.msearch.mock.calls[0][0].searches).toEqual([{ index: 'topics', allow_partial_search_results: false }, {}, { index: 'gaps', allow_partial_search_results: false }, {}]);

    es.msearch.mockResolvedValueOnce({ responses: [ok, { status: 503, error: { type: 'search_phase_execution_exception', reason: 'all shards failed' } }] });
    await expect(msearch(es as unknown as Client, req)).rejects.toThrow(SearchUnavailableError);
  });

  it('turns an unavailable or overloaded cluster into a retriable 503, and leaves other errors alone', async () => {
    const fail = (statusCode: number, type: string) => new errors.ResponseError({ statusCode, body: { error: { type } }, warnings: null, meta: {} } as never);
    const es = { search: jest.fn() };
    es.search.mockRejectedValueOnce(fail(503, 'search_phase_execution_exception'));
    const err = await search(es as unknown as Client, {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SearchUnavailableError);
    expect((err as SearchUnavailableError).getStatus()).toBe(503);

    es.search.mockRejectedValueOnce(fail(400, 'parsing_exception'));
    await expect(search(es as unknown as Client, {})).rejects.toBeInstanceOf(errors.ResponseError);
  });
});

describe('chunks', () => {
  it('slices without losing or repeating anything', () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunks([], 2)).toEqual([]);
  });
});
