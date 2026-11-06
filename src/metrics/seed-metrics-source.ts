import type { PaperMetrics } from '../model/types';
import type { ProtoPaper } from '../seed/prototype';
import { trailingMonths } from '../topic-health/topic-health';
import type { MetricsPaperRef, MetricsSource } from './metrics-source';

/**
 * Serves the prototype's paper figures as monthly documents. The prototype only has lifetime
 * totals plus a 12-point `readTrend`, so totals are spread over the months since publication in
 * proportion to that trend. Additive figures (downloads, views, citations, mentions) are monthly
 * increments that sum back to the prototype's totals; altmetric is a level that reaches the
 * prototype's score in the latest month; audience, geo and split are shares, repeated each month.
 */
export class SeedMetricsSource implements MetricsSource {
  private readonly papers: Map<string, ProtoPaper>;

  constructor(papers: ProtoPaper[]) {
    this.papers = new Map(papers.map((p) => [p.id, p]));
  }

  monthly(ref: MetricsPaperRef, asOf: string): Promise<PaperMetrics[]> {
    const proto = this.papers.get(ref.paperId);
    if (!proto) return Promise.resolve([]);

    const publishedMonth = ref.published.slice(0, 7);
    const months = trailingMonths(asOf, 12).filter((m) => m >= publishedMonth);
    if (months.length === 0) return Promise.resolve([]);

    const weights = proto.readTrend.slice(-months.length);
    const spread = (total: number) => distribute(total, weights);
    const downloads = spread(proto.reads.downloads);
    const views = spread(proto.reads.views);
    const citations = spread(proto.reads.citations);
    const news = spread(proto.mentions.news);
    const policy = spread(proto.mentions.policy);
    const social = spread(proto.mentions.social);
    const patents = spread(proto.mentions.patents);
    const altmetric = cumulative(spread(proto.reads.altmetric));

    return Promise.resolve(
      months.map((month, i) => ({
        paperId: ref.paperId,
        topicId: ref.topicId,
        month,
        downloads: downloads[i],
        views: views[i],
        citations: citations[i],
        altmetric: altmetric[i],
        audience: { ...proto.audience },
        geo: proto.geo.map(([country, share]) => ({ country, share })),
        split: { ...proto.split },
        mentions: { news: news[i], policy: policy[i], social: social[i], patents: patents[i] },
      })),
    );
  }
}

/** Splits an integer total across buckets in proportion to `weights`; the parts sum to `total`. */
export function distribute(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0) return weights.map((_, i) => (i === weights.length - 1 ? total : 0));
  let allotted = 0;
  return weights.map((w, i) => {
    if (i === weights.length - 1) return total - allotted;
    const part = Math.floor((total * w) / sum);
    allotted += part;
    return part;
  });
}

const cumulative = (xs: number[]): number[] => {
  let run = 0;
  return xs.map((x) => (run += x));
};
