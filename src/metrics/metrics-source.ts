import type { PaperMetrics } from '../model/types';

export interface MetricsPaperRef {
  paperId: string;
  topicId: string;
  /** ISO date, YYYY-MM-DD. */
  published: string;
}

/**
 * Where `paper-metrics` documents come from: one document per paper per month.
 * Milestone 1 ships `SeedMetricsSource`; the internal paper-metrics API becomes a second
 * implementation later and nothing else changes.
 */
export interface MetricsSource {
  /** Monthly metrics for `paper` for each month from publication through `asOf`'s month (at most 12). */
  monthly(paper: MetricsPaperRef, asOf: string): Promise<PaperMetrics[]>;
}

export const METRICS_SOURCE = Symbol('METRICS_SOURCE');
