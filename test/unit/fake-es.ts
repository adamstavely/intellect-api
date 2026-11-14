import type { Client } from '@elastic/elasticsearch';

/**
 * An in-memory Elasticsearch for unit tests that need more records than one result window: documents per index, and
 * just enough of the query DSL, sorting, points in time, search_after and terms aggregations for the services' reads.
 * Like Elasticsearch, an ordinary search returns at most `size` hits (10 by default) and reports the total.
 */
export function fakeEs(indices: Record<string, object[]> = {}) {
  const docs = new Map<string, object[]>(Object.entries(indices));
  const pits = new Map<string, string>();
  let pitSeq = 0;
  const index = (name: string) => docs.get(name) ?? docs.set(name, []).get(name)!;

  const es = {
    search: jest.fn((req: SearchRequest) => Promise.resolve(search(req.pit ? pits.get(req.pit.id)! : req.index!, req))),
    openPointInTime: jest.fn(({ index: i }: { index: string }) => {
      const id = `pit-${++pitSeq}`;
      pits.set(id, i);
      return Promise.resolve({ id });
    }),
    closePointInTime: jest.fn(({ id }: { id: string }) => Promise.resolve({ succeeded: pits.delete(id) })),
    mget: jest.fn(({ index: i, ids }: { index: string; ids: string[] }) => {
      const byId = new Map(index(i).map((d) => [(d as { id: string }).id, d]));
      return Promise.resolve({ docs: ids.map((id) => (byId.has(id) ? { _id: id, found: true, _source: byId.get(id) } : { _id: id, found: false })) });
    }),
  };

  function search(i: string, req: SearchRequest) {
    const matching = index(i)
      .map((d, n) => ({ d, n }))
      .filter(({ d }) => matches(d, req.query));
    const sort = (req.sort ?? []).map<[string, unknown]>((s) => (typeof s === 'string' ? [s, 'asc'] : Object.entries(s)[0]));
    const keyOf = ({ d, n }: { d: object; n: number }) => sort.map(([f]) => (f === '_shard_doc' ? n : get(d, f)));
    const order = sort.map(([, o]) => ((typeof o === 'string' ? o : (o as { order: string }).order) === 'desc' ? -1 : 1));
    const cmp = (a: unknown[], b: unknown[]) => {
      for (let k = 0; k < a.length; k++) {
        const c = compare(a[k], b[k]) * order[k];
        if (c) return c;
      }
      return 0;
    };
    let hits = matching.map((h) => ({ ...h, key: keyOf(h) }));
    if (sort.length) hits.sort((a, b) => cmp(a.key, b.key) || a.n - b.n);
    if (req.search_after) hits = hits.filter((h) => cmp(h.key, req.search_after!) > 0);
    const size = req.size ?? 10;
    const page = hits.slice(0, size).map((h) => ({ _id: (h.d as { id?: string }).id, _source: project(h.d, req._source), sort: h.key }));
    return {
      ...(req.pit ? { pit_id: req.pit.id } : {}),
      hits: { total: { value: matching.length, relation: 'eq' }, hits: page },
      ...(req.aggs ? { aggregations: aggregate(matching.map((h) => h.d), req.aggs) } : {}),
    };
  }

  return { es, client: es as unknown as Client, index };
}

type Query = Record<string, any> | undefined;
interface SearchRequest {
  index?: string;
  pit?: { id: string };
  query?: Query;
  sort?: (string | Record<string, unknown>)[];
  size?: number;
  search_after?: unknown[];
  _source?: string[];
  aggs?: Record<string, any>;
}

const get = (d: object, path: string): unknown => path.split('.').reduce<any>((v, k) => (v == null ? undefined : v[k]), d);
const values = (d: object, path: string): unknown[] => {
  const v = get(d, path);
  return Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
};
const compare = (a: unknown, b: unknown) => (a === b ? 0 : a === undefined ? 1 : b === undefined ? -1 : (a as number) < (b as number) ? -1 : 1);
const project = (d: object, fields?: string[]) => (fields ? Object.fromEntries(fields.map((f) => [f, get(d, f)])) : d);

function matches(d: object, q: Query): boolean {
  if (!q) return true;
  const [kind, body] = Object.entries(q)[0];
  switch (kind) {
    case 'match_all':
      return true;
    case 'term': {
      const [f, v] = Object.entries(body)[0];
      const want = typeof v === 'object' && v !== null ? (v as { value: unknown }).value : v;
      return values(d, f).includes(want);
    }
    case 'terms': {
      const [f, vs] = Object.entries(body)[0] as [string, unknown[]];
      return values(d, f).some((v) => vs.includes(v));
    }
    case 'exists':
      return values(d, body.field).length > 0;
    case 'range': {
      const [f, r] = Object.entries(body)[0] as [string, Record<string, unknown>];
      return values(d, f).some(
        (v) => (r.gte === undefined || compare(v, r.gte) >= 0) && (r.lte === undefined || compare(v, r.lte) <= 0) && (r.gt === undefined || compare(v, r.gt) > 0),
      );
    }
    case 'nested': {
      // Nested fields are queried by full path (`allocations.topicId`), as each element of the array.
      const prefix = `${body.path}.`;
      return values(d, body.path).some((el) => matches(el as object, strip(body.query, prefix)));
    }
    case 'bool': {
      const all = (qs: Query[] | Query = []) => ([] as Query[]).concat(qs);
      const should = all(body.should);
      return (
        all(body.filter).every((x) => matches(d, x)) &&
        all(body.must).every((x) => matches(d, x)) &&
        !all(body.must_not).some((x) => matches(d, x)) &&
        (!should.length || should.filter((x) => matches(d, x)).length >= (body.minimum_should_match ?? 1))
      );
    }
    default:
      throw new Error(`fakeEs: unsupported query ${kind}`);
  }
}

/** A nested query with the path taken off its field names, to run against one element. */
const strip = (q: Query, prefix: string): Query => JSON.parse(JSON.stringify(q).replaceAll(`"${prefix}`, '"'));

function aggregate(docs: object[], aggs: Record<string, any>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(aggs).map(([name, def]) => {
      const { aggs: sub, ...rest } = def;
      const [kind, body] = Object.entries(rest)[0] as [string, any];
      const nums = () => docs.flatMap((d) => values(d, body.field));
      switch (kind) {
        case 'sum':
          return [name, { value: nums().reduce<number>((s, v) => s + (v as number), 0) }];
        case 'max':
        case 'min': {
          const vs = nums().sort(compare);
          const v = kind === 'max' ? vs.at(-1) : vs[0];
          return [name, typeof v === 'string' ? { value: v === undefined ? null : 0, value_as_string: v } : { value: v ?? null }];
        }
        case 'terms': {
          const groups = new Map<unknown, object[]>();
          for (const d of docs) for (const v of values(d, body.field)) (groups.get(v) ?? groups.set(v, []).get(v)!).push(d);
          const buckets = [...groups].slice(0, body.size ?? 10).map(([key, ds]) => ({ key, doc_count: ds.length, ...(sub ? aggregate(ds, sub) : {}) }));
          return [name, { buckets }];
        }
        default:
          throw new Error(`fakeEs: unsupported aggregation ${kind}`);
      }
    }),
  );
}
