import { Inject, Injectable } from '@nestjs/common';
import { Client, estypes } from '@elastic/elasticsearch';
import { getMany, readAll } from '../common/es';
import { ES_CLIENT } from '../elastic/elastic.module';
import { ALIASES } from '../elastic/indices';
import type { Gap, GapSeverity, Person, Topic, Work } from '../model/types';
import { ScopeService } from '../scope/scope.service';
import type { GapListItemDto, GapsQueryDto } from './gaps.dto';

export const SEVERITY_RANK: Record<GapSeverity, number> = { critical: 3, high: 2, medium: 1 };

/** Most severe first, then the least healthy topic, then id. */
export function byAttention(healthOf: (topicId: string) => number) {
  return (a: Gap, b: Gap): number =>
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || healthOf(a.topicId) - healthOf(b.topicId) || a.id.localeCompare(b.id);
}

const roundInvested = (i: { budget: number; fte: number } | undefined) => ({
  budget: Math.round((i?.budget ?? 0) * 100) / 100,
  fte: Math.round((i?.fte ?? 0) * 10) / 10,
});

@Injectable()
export class GapsService {
  constructor(
    @Inject(ES_CLIENT) private readonly es: Client,
    private readonly scope: ScopeService,
  ) {}

  /** The first `limit` (default 20) of `ranked`, and how many gaps matched in all. */
  async list(user: Person, q: GapsQueryDto): Promise<{ gaps: GapListItemDto[]; total: number }> {
    return this.ranked(user, q, q.limit ?? 20);
  }

  /**
   * Gaps in the caller's scope matching `q`, most in need of attention first, decorated, cut to `limit` (all of them
   * when unset), with the number that matched before the cut. Every work item in flight and every matching gap is read
   * (see `readAll`), so coverage and the ranking hold however many there are, and only then is the list cut.
   */
  async ranked(user: Person, q: Omit<GapsQueryDto, 'limit'>, limit?: number): Promise<{ gaps: GapListItemDto[]; total: number }> {
    const scope = ScopeService.toFilter(await this.scope.topicScope(user), 'topicId');
    const filter: estypes.QueryDslQueryContainer[] = [scope];
    const mustNot: estypes.QueryDslQueryContainer[] = [];
    if (q.topicId) filter.push({ term: { topicId: q.topicId } });
    if (q.severity) filter.push({ term: { severity: q.severity } });
    if (q.status) filter.push({ term: { status: q.status } });
    if (q.attention) mustNot.push({ term: { status: 'closed' } });

    // Work in flight (anything not complete): `active` items cover a gap; all of it counts as invested in it.
    const [inFlight, matching] = await Promise.all([
      readAll<Pick<Work, 'gapIds' | 'status' | 'budget' | 'fte'>>(this.es, ALIASES.work, {
        _source: ['gapIds', 'status', 'budget', 'fte'],
        query: {
          bool: {
            filter: [scope, ...(q.topicId ? [{ term: { topicId: q.topicId } }] : [])],
            must_not: [{ term: { status: 'complete' } }],
          },
        },
      }),
      readAll<Gap>(this.es, ALIASES.gaps, { query: { bool: { filter, must_not: mustNot } } }),
    ]);
    const activeOn = new Map<string, number>();
    const invested = new Map<string, { budget: number; fte: number }>();
    for (const w of inFlight) {
      for (const id of w.gapIds) {
        if (w.status === 'active') activeOn.set(id, (activeOn.get(id) ?? 0) + 1);
        const i = invested.get(id) ?? { budget: 0, fte: 0 };
        invested.set(id, { budget: i.budget + w.budget.allocated, fte: i.fte + w.fte });
      }
    }
    const covered = new Set(activeOn.keys());
    const gaps = q.attention ? matching.filter((g) => !covered.has(g.id)) : matching;

    const topics = await getMany<Topic>(this.es, ALIASES.topics, gaps.map((g) => g.topicId), ['id', 'name', 'health', 'healthScore', 'bin']);
    const page = gaps.sort(byAttention((id) => topics.get(id)?.healthScore ?? 100)).slice(0, limit ?? gaps.length);
    const owners = await getMany<Person>(this.es, ALIASES.people, page.map((g) => g.ownerId), ['id', 'name', 'initials']);

    const items = page.map((g) => {
      const t = topics.get(g.topicId);
      const o = owners.get(g.ownerId);
      return {
        ...g,
        topic: { id: g.topicId, name: t?.name ?? g.topicId, health: t?.health ?? 'watch', healthScore: t?.healthScore ?? 0, bin: t?.bin ?? 4 },
        owner: o ? { id: o.id, name: o.name, initials: o.initials } : null,
        covered: covered.has(g.id),
        activeWork: activeOn.get(g.id) ?? 0,
        invested: roundInvested(invested.get(g.id)),
      };
    });
    return { gaps: items, total: gaps.length };
  }
}
