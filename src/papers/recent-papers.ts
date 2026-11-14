import type { Client } from '@elastic/elasticsearch';
import { ALIASES } from '../elastic/indices';
import type { RecentPapers } from '../model/types';
import { search } from '../common/es';

export const NO_RECENT_PAPERS: RecentPapers = { lastMonth: 0, thisMonth: 0 };

/** Last calendar month in full, and this month up to `today` (both inclusive, YYYY-MM-DD). */
export function monthWindows(today: string) {
  const [y, m] = today.split('-').map(Number);
  const day = (year: number, month: number, d: number) => new Date(Date.UTC(year, month - 1, d)).toISOString().slice(0, 10);
  return {
    lastMonth: { from: day(y, m - 1, 1), to: day(y, m, 0) },
    thisMonth: { from: day(y, m, 1), to: today },
  };
}

/** Papers published last month and this month, per topic. Topics with none are absent from the map. */
export async function recentPaperCounts(es: Client, topicIds: string[], today: string): Promise<Map<string, RecentPapers>> {
  if (topicIds.length === 0) return new Map();
  const { lastMonth, thisMonth } = monthWindows(today);
  const res = await search(es, {
    index: ALIASES.papers,
    size: 0,
    query: { bool: { filter: [{ terms: { topicId: topicIds } }, { range: { published: { gte: lastMonth.from, lte: thisMonth.to } } }] } },
    aggs: {
      topics: {
        terms: { field: 'topicId', size: topicIds.length },
        aggs: {
          lastMonth: { filter: { range: { published: { gte: lastMonth.from, lte: lastMonth.to } } } },
          thisMonth: { filter: { range: { published: { gte: thisMonth.from, lte: thisMonth.to } } } },
        },
      },
    },
  });
  type Bucket = { key: string; lastMonth: { doc_count: number }; thisMonth: { doc_count: number } };
  const buckets = (res.aggregations?.topics as { buckets: Bucket[] } | undefined)?.buckets ?? [];
  return new Map(buckets.map((b) => [b.key, { lastMonth: b.lastMonth.doc_count, thisMonth: b.thisMonth.doc_count }]));
}
