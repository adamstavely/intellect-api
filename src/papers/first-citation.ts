import type { Client } from '@elastic/elasticsearch';
import { ALIASES } from '../elastic/indices';

/**
 * Time to first citation. Citing works only carry a year, so the first month whose paper-metrics row counts a citation
 * stands for "first cited", and the lag is in whole months from the month of publication.
 */
export interface FirstCitation {
  /** YYYY-MM of the first month with a citation; null while the paper hasn't been cited. */
  month: string | null;
  /** Months from the publication month to that month (0 = cited the month it came out); null while uncited. */
  monthsAfterPublication: number | null;
}

export const NOT_YET_CITED: FirstCitation = { month: null, monthsAfterPublication: null };

/** Whole months from `published` (YYYY-MM-DD) to `month` (YYYY-MM); never negative. */
export function monthsBetween(published: string, month: string): number {
  const [py, pm] = published.split('-').map(Number);
  const [y, m] = month.split('-').map(Number);
  return Math.max(0, y * 12 + m - (py * 12 + pm));
}

/** The middle value, or the mean of the two middle values; null for none. */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The first month each paper was cited in. Papers never cited are absent from the map. */
export async function firstCitedMonths(es: Client, paperIds: string[]): Promise<Map<string, string>> {
  if (paperIds.length === 0) return new Map();
  const res = await es.search({
    index: ALIASES.paperMetrics,
    size: 0,
    query: { bool: { filter: [{ terms: { paperId: paperIds } }, { range: { citations: { gt: 0 } } }] } },
    aggs: { papers: { terms: { field: 'paperId', size: paperIds.length }, aggs: { first: { min: { field: 'month', format: 'yyyy-MM' } } } } },
  });
  type Bucket = { key: string; first: { value_as_string?: string } };
  const buckets = (res.aggregations?.papers as { buckets: Bucket[] } | undefined)?.buckets ?? [];
  return new Map(buckets.filter((b) => b.first.value_as_string).map((b) => [b.key, b.first.value_as_string!]));
}

export function firstCitation(published: string, month: string | undefined): FirstCitation {
  return month ? { month, monthsAfterPublication: monthsBetween(published, month) } : NOT_YET_CITED;
}
