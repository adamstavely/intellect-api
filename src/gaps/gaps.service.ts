import { Inject, Injectable } from '@nestjs/common';
import { Client, estypes } from '@elastic/elasticsearch';
import { getMany, MAX_DOCS, sources } from '../common/es';
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

@Injectable()
export class GapsService {
  constructor(
    @Inject(ES_CLIENT) private readonly es: Client,
    private readonly scope: ScopeService,
  ) {}

  async list(user: Person, q: GapsQueryDto): Promise<GapListItemDto[]> {
    const scope = ScopeService.toFilter(await this.scope.topicScope(user), 'topicId');
    const filter: estypes.QueryDslQueryContainer[] = [scope];
    const mustNot: estypes.QueryDslQueryContainer[] = [];
    if (q.topicId) filter.push({ term: { topicId: q.topicId } });
    if (q.severity) filter.push({ term: { severity: q.severity } });
    if (q.status) filter.push({ term: { status: q.status } });

    const activeWork = sources(
      await this.es.search<Pick<Work, 'gapIds'>>({
        index: ALIASES.work,
        size: MAX_DOCS,
        _source: ['gapIds'],
        query: { bool: { filter: [scope, { term: { status: 'active' } }, ...(q.topicId ? [{ term: { topicId: q.topicId } }] : [])] } },
      }),
    );
    const covered = new Set(activeWork.flatMap((w) => w.gapIds));
    if (q.attention) {
      mustNot.push({ term: { status: 'closed' } });
      if (covered.size) mustNot.push({ terms: { id: [...covered] } });
    }

    const gaps = sources(await this.es.search<Gap>({ index: ALIASES.gaps, size: MAX_DOCS, query: { bool: { filter, must_not: mustNot } } }));
    const [topics, owners] = await Promise.all([
      getMany<Topic>(this.es, ALIASES.topics, gaps.map((g) => g.topicId), ['id', 'name', 'health', 'healthScore']),
      getMany<Person>(this.es, ALIASES.people, gaps.map((g) => g.ownerId), ['id', 'name', 'initials']),
    ]);

    return gaps
      .sort(byAttention((id) => topics.get(id)?.healthScore ?? 100))
      .slice(0, q.limit ?? 20)
      .map((g) => {
        const t = topics.get(g.topicId);
        const o = owners.get(g.ownerId);
        return {
          ...g,
          topic: { id: g.topicId, name: t?.name ?? g.topicId, health: t?.health ?? 'watch', healthScore: t?.healthScore ?? 0 },
          owner: o ? { id: o.id, name: o.name, initials: o.initials } : null,
          covered: covered.has(g.id),
        };
      });
  }
}
