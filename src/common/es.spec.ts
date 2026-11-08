import type { Client } from '@elastic/elasticsearch';
import { getMany } from './es';

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
