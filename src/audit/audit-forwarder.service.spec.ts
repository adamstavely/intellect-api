import { ConfigService } from '@nestjs/config';
import type { Client } from '@elastic/elasticsearch';
import type { AuditConfig } from '../config/configuration';
import type { AuditEvent } from './audit-event';
import { AuditForwarder } from './audit-forwarder.service';

type Stored = AuditEvent & { indexedAt: string };
type Range = { lte: string; gte?: string };

/** A mock answering asynchronously, as the client does: what `f` returns resolves, and what it throws rejects. */
const answers = <A extends unknown[], R>(f: (...args: A) => R) =>
  jest.fn((...args: A) => new Promise<R>((resolve) => resolve(f(...args))));

/** Just enough of Elasticsearch for forwarding: the audit index, searched the way the forwarder does, and the cursor. */
function fakeEs() {
  const audit = new Map<string, Stored>();
  const cursors = new Map<string, object>();
  const sortOf = (e: Stored) => [Date.parse(e.indexedAt), Date.parse(e.at), e.id];
  const es = {
    get: answers(({ id }: { id: string }) => (cursors.has(id) ? { found: true, _source: cursors.get(id), _seq_no: 1, _primary_term: 1 } : { found: false })),
    index: answers(({ id, document }: { id: string; document: object }) => void cursors.set(id, document)),
    updateByQuery: answers(() => ({})),
    search: answers(({ size, query }: { size: number; query: { bool: { filter: { range: { indexedAt: Range } }[] } } }) => {
      const { lte, gte } = query.bool.filter[0].range.indexedAt;
      const cutOff = Date.now() - Number(/^now-(\d+)s$/.exec(lte)![1]) * 1000;
      const hits = [...audit.values()]
        .filter((e) => !e.forwardedAt && Date.parse(e.indexedAt) <= cutOff && (!gte || Date.parse(e.indexedAt) >= Date.parse(gte)))
        .map((e) => ({ _index: 'audit-v1', _id: e.id, _source: e, sort: sortOf(e) }))
        .sort((a, b) => (a.sort[0] as number) - (b.sort[0] as number) || (a.sort[1] as number) - (b.sort[1] as number) || String(a.sort[2]).localeCompare(String(b.sort[2])))
        .slice(0, size);
      return { hits: { hits } };
    }),
    bulk: answers(({ operations }: { operations: object[] }) => {
      for (let n = 0; n < operations.length; n += 2) {
        const { _id } = (operations[n] as { update: { _id: string } }).update;
        Object.assign(audit.get(_id)!, (operations[n + 1] as { doc: object }).doc);
      }
      return { items: [] };
    }),
  };
  return { es, audit };
}

const config: AuditConfig = { webhookUrl: 'https://siem.example.com/hook', webhookSecret: undefined, intervalMs: 5000, batchSize: 100, timeoutMs: 1000, settleMs: 30_000, shutdownTimeoutMs: 10_000, maxQueue: 10_000 };

describe('AuditForwarder', () => {
  let store: ReturnType<typeof fakeEs>;
  let forwarder: AuditForwarder;
  let sent: string[][];

  beforeEach(() => {
    store = fakeEs();
    forwarder = new AuditForwarder(
      store.es as unknown as Client,
      new ConfigService({ audit: config, elasticsearch: { requestTimeout: 30_000, maxRetries: 3 } }),
    );
    sent = [];
    jest.spyOn(global, 'fetch').mockImplementation((_url, init) => {
      sent.push((JSON.parse(init!.body as string) as { events: AuditEvent[] }).events.map((e) => e.id));
      return Promise.resolve(new Response(null, { status: 200 }));
    });
  });
  afterEach(() => jest.restoreAllMocks());

  const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString();
  const storeEvent = (id: string, indexedSecondsAgo: number) =>
    store.audit.set(id, { id, at: ago(indexedSecondsAgo + 1), indexedAt: ago(indexedSecondsAgo) } as Stored);

  it('sends a write that became visible late, behind the cursor, once and only once', async () => {
    storeEvent('a', 40);
    storeEvent('b', 35);
    expect(await forwarder.forward()).toBe(2);

    // Stamped before a and b, but its request was slow (the client retries for up to 2 minutes): only visible now.
    storeEvent('late', 100);
    expect(await forwarder.forward()).toBe(1);
    expect(await forwarder.forward()).toBe(0);

    expect(sent).toEqual([['a', 'b'], ['late']]);
    expect(store.audit.get('late')!.forwardedAt).toEqual(expect.any(String));
    // The cursor stays at b, the furthest point sent, rather than moving back to the late event.
    expect((store.es.index.mock.calls.at(-1)![0] as { document: { sort: unknown[] } }).document.sort[2]).toBe('b');
    expect(store.es.index).toHaveBeenCalledTimes(2); // the cursor's creation on upgrade, then after a and b
  });

  it('reaches back the longest a write can take, plus the settling time, and no further', async () => {
    storeEvent('a', 40);
    await forwarder.forward();
    const cursorAt = Date.parse(store.audit.get('a')!.indexedAt);
    storeEvent('within', 40 + 30 + 120 - 1);
    storeEvent('beyond', 40 + 30 + 120 + 5);

    await forwarder.forward();
    const { gte } = (store.es.search.mock.calls.at(-1)![0] as { query: { bool: { filter: { range: { indexedAt: Range } }[] } } }).query.bool.filter[0].range.indexedAt;
    expect(cursorAt - Date.parse(gte!)).toBe(30_000 + 30_000 * 4);
    expect(sent.at(-1)).toEqual(['within']);
  });
});
