import { Inject, Injectable } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { Clock } from '../common/clock';
import { getMany, MAX_DOCS, sources } from '../common/es';
import { ES_CLIENT } from '../elastic/elastic.module';
import { ALIASES } from '../elastic/indices';
import type { OrgUnit, Person, Topic } from '../model/types';
import { recentPaperCounts } from '../papers/recent-papers';
import { ScopeService } from '../scope/scope.service';
import type { OrgCenterDto, OrgDto, OrgTeamDto, OrgTopicDto } from './org.dto';
import { rollup } from './rollup';

@Injectable()
export class OrgService {
  constructor(
    @Inject(ES_CLIENT) private readonly es: Client,
    private readonly scope: ScopeService,
    private readonly clock: Clock,
  ) {}

  /** Centers → teams → topics with roll-ups. Outside the Chief's view, units with no visible topics are left out. */
  async tree(user: Person): Promise<OrgDto> {
    const scope = await this.scope.topicScope(user);
    const [unitsRes, topicsRes] = await Promise.all([
      this.es.search<OrgUnit>({ index: ALIASES.orgUnits, size: MAX_DOCS, sort: [{ 'name.keyword': 'asc' }] }),
      this.es.search<Topic>({
        index: ALIASES.topics,
        size: MAX_DOCS,
        query: { bool: { filter: [ScopeService.toFilter(scope, 'id')] } },
        sort: [{ healthScore: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const units = sources(unitsRes);
    const topics = sources(topicsRes);
    const leads = await getMany<Person>(this.es, ALIASES.people, units.map((u) => u.leadId).filter((x): x is string => !!x), ['id', 'name', 'initials']);
    const lead = (id: string | null) => {
      const p = id ? leads.get(id) : undefined;
      return p ? { id: p.id, name: p.name, initials: p.initials } : null;
    };
    const recent = await recentPaperCounts(this.es, topics.map((t) => t.id), this.clock.today());
    const keep = (n: number) => scope.all || n > 0;

    const teams: (OrgTeamDto & { parentId: string | null })[] = units
      .filter((u) => u.kind === 'team')
      .map((u) => {
        const own = topics.filter((t) => t.teamId === u.id);
        return { id: u.id, name: u.name, code: u.code, parentId: u.parentId, lead: lead(u.leadId), rollup: rollup(own, recent), topics: own.map(toOrgTopic) };
      })
      .filter((t) => keep(t.topics.length));

    const centers: OrgCenterDto[] = units
      .filter((u) => u.kind === 'center')
      .map((u) => {
        const own = topics.filter((t) => t.centerId === u.id);
        return {
          id: u.id,
          name: u.name,
          code: u.code,
          focus: u.focus,
          lead: lead(u.leadId),
          rollup: rollup(own, recent),
          teams: teams.filter((t) => t.parentId === u.id).map(withoutParent),
        };
      })
      .filter((c) => keep(c.rollup.topics));

    return { centers, otherTeams: teams.filter((t) => !t.parentId || !units.some((u) => u.id === t.parentId)).map(withoutParent) };
  }
}

const toOrgTopic = (t: Topic): OrgTopicDto => ({
  id: t.id,
  name: t.name,
  bin: t.bin,
  health: t.health,
  healthScore: t.healthScore,
  momentum: t.momentum,
  leadId: t.leadId,
  openGaps: t.stats.openGaps,
  coverage: t.stats.coverage,
  fte: t.stats.fte,
});

const withoutParent = ({ parentId: _parentId, ...team }: OrgTeamDto & { parentId: string | null }): OrgTeamDto => team;
